import { Room, LIMITS } from "./room.js";
import { handleMcp } from "./mcp.js";
import { homePage, roomPage, notFound, STYLE } from "./pages.js";
import APP_JS from "./app.client.js";
import { findSecret } from "./scan.js";

export { Room };

const ROOM_RE = /^[A-Za-z0-9_-]{16}$/;
const KEY_RE = /^[A-Za-z0-9_-]{32}$/;

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomId = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameText(a, b) {
  // constant-time-ish compare for the creator code
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};
const html = (body) =>
  new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src https://cdn.jsdelivr.net https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      ...SECURITY_HEADERS,
    },
  });
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...SECURITY_HEADERS },
  });
const out = (r) => json(r, r && r.error ? 400 : 200);

const stubFor = (env, roomId) => env.ROOM.get(env.ROOM.idFromName(roomId));

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const method = request.method;

    // MCP endpoint: /mcp/<room>/<member key>
    if (parts[0] === "mcp") {
      if (parts.length !== 3 || !ROOM_RE.test(parts[1]) || !KEY_RE.test(parts[2])) return notFound();
      return handleMcp(request, stubFor(env, parts[1]), await sha256(parts[2]));
    }

    if (method === "GET" && url.pathname === "/") return html(homePage());
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
    if (method === "GET" && url.pathname === "/app.js")
      return new Response(APP_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
    if (method === "GET" && url.pathname === "/style.css")
      return new Response(STYLE, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "no-cache" } });

    // Create a room
    if (method === "POST" && url.pathname === "/api/rooms") {
      const b = await body(request);
      if (!env.CREATE_CODE || !sameText(String(b.code || "").trim(), env.CREATE_CODE))
        return json({ error: "Wrong creator code." }, 403);
      const title = String(b.title || "").trim();
      const brief = String(b.brief || "").trim();
      const name = String(b.name || "").trim();
      if (!title || !brief || !name) return json({ error: "Title, brief and name are all needed." }, 400);
      if (title.length > LIMITS.title || brief.length > LIMITS.brief || name.length > LIMITS.name)
        return json({ error: "Something is too long." }, 400);
      const secret = findSecret(title + "\n" + brief);
      if (secret) return json({ error: `The brief looks like it contains ${secret}. Remove it first.` }, 400);
      const roomId = randomId(12);
      const ownerKey = randomId(24);
      const r = await stubFor(env, roomId).create({
        title,
        brief,
        briefHash: await sha256(brief),
        ownerName: name,
        ownerKeyHash: await sha256(ownerKey),
      });
      if (r.error) return json(r, 500);
      return json({ room_id: roomId, owner_key: ownerKey });
    }

    // Room API: /api/r/<room>/<action>
    if (parts[0] === "api" && parts[1] === "r" && parts.length === 4 && ROOM_RE.test(parts[2])) {
      const stub = stubFor(env, parts[2]);
      const action = parts[3];
      if (method === "GET" && action === "summary") {
        const r = await stub.summary();
        return json(r, r.error ? 404 : 200);
      }
      if (method === "GET" && action === "state") {
        const r = await stub.state(Number(url.searchParams.get("since")) || 0);
        return json(r, r.error ? 404 : 200);
      }
      const key = request.headers.get("x-key") || "";
      if (!KEY_RE.test(key)) return json({ error: "Missing or invalid key." }, 403);
      const keyHash = await sha256(key);
      if (method === "GET" && action === "me") {
        const r = await stub.whoami(keyHash);
        return json(r, r.error ? 403 : 200);
      }
      if (method === "POST") {
        const b = await body(request);
        if (action === "invite") {
          const name = String(b.name || "").trim();
          if (!name || name.length > LIMITS.name) return json({ error: "Give a name up to 40 characters." }, 400);
          const memberKey = randomId(24);
          const r = await stub.invite(keyHash, name, await sha256(memberKey));
          return r.error ? out(r) : json({ ok: true, member_key: memberKey });
        }
        if (action === "remove") return out(await stub.remove(keyHash, Number(b.member_id)));
        if (action === "link") return out(await stub.addLink(keyHash, b.title, b.url));
        if (action === "unlink") return out(await stub.removeLink(keyHash, Number(b.link_id)));
        if (action === "step") return out(await stub.addStep(keyHash, b.title, b.detail));
        if (action === "say") return out(await stub.say(keyHash, b.body));
        if (action === "merge") return out(await stub.merge(keyHash, Number(b.step_id), Number(b.post_id)));
      }
      return notFound();
    }

    // Pages: /r/<room>, /r/<room>/join, /r/<room>/admin
    if (method === "GET" && parts[0] === "r" && ROOM_RE.test(parts[1] || "")) {
      if (parts.length === 2) return html(roomPage(parts[1], "watch"));
      if (parts.length === 3 && parts[2] === "join") return html(roomPage(parts[1], "join"));
      if (parts.length === 3 && parts[2] === "admin") return html(roomPage(parts[1], "admin"));
    }

    return notFound();
  },
};
