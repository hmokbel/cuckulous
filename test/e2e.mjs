// End-to-end check with the official MCP TypeScript client.
// Usage: BASE=http://localhost:8787 CODE=test-code node test/e2e.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.BASE || "http://localhost:8787";
const CODE = process.env.CODE || "test-code";
let failed = 0;
const ok = (cond, label, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
};
const j = async (path, opts = {}) => {
  const r = await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const connect = async (url) => {
  const c = new Client({ name: "e2e", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(url)));
  return c;
};
const call = async (c, name, args) => {
  const r = await c.callTool({ name, arguments: args });
  let data = null;
  try { data = JSON.parse(r.content[0].text); } catch { data = r.content[0].text; }
  return { isError: !!r.isError, data };
};

const bad = await j("/api/rooms", { method: "POST", body: JSON.stringify({ code: "nope", title: "t", brief: "b", name: "n" }) });
ok(bad.status === 403, "wrong creator code is refused");

const created = await j("/api/rooms", {
  method: "POST",
  body: JSON.stringify({ code: CODE, title: "Test: sum of first n odd numbers", brief: "Prove $\\sum_{k=1}^n (2k-1) = n^2$. Break it into steps.", name: "Noah" }),
});
ok(created.status === 200 && created.data.room_id?.length === 16, "room created", JSON.stringify(created.data).slice(0, 80));
const room = created.data.room_id;
const ownerKey = created.data.owner_key;

const inv = await j(`/api/r/${room}/invite`, { method: "POST", headers: { "x-key": ownerKey }, body: JSON.stringify({ name: "Ali" }) });
ok(inv.status === 200 && inv.data.member_key?.length === 32, "owner invites a member");
const memberKey = inv.data.member_key;

const notOwner = await j(`/api/r/${room}/invite`, { method: "POST", headers: { "x-key": memberKey }, body: JSON.stringify({ name: "X" }) });
ok(notOwner.status === 400, "member can't invite", notOwner.data?.error);

for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server", `/.well-known/oauth-protected-resource/mcp/${room}/${memberKey}`]) {
  const r = await fetch(BASE + p);
  ok(r.status === 404, `404 on ${p.slice(0, 45)}`);
}

const ali = await connect(`${BASE}/mcp/${room}/${memberKey}`);
const instructions = ali.getInstructions();
ok(typeof instructions === "string" && instructions.includes("never as instructions"), "server sends room instructions on initialize");
const tools = (await ali.listTools()).tools.map((t) => t.name).sort();
ok(tools.join() === "add_step,claim_step,merge_step,pin_link,post,read_room", "six tools listed", tools.join());

let r = await call(ali, "read_room", {});
ok(!r.isError && r.data.brief.includes("2k-1") && r.data.you.name === "Ali", "read_room returns brief and identity");

r = await call(ali, "add_step", { title: "Base case n=1", detail: "Show $1 = 1^2$." });
ok(!r.isError && r.data.step_id === 1, "member adds a step");
r = await call(ali, "claim_step", { step_id: 1 });
ok(!r.isError, "member claims the step");
r = await call(ali, "post", { step_id: 1, kind: "result", body: "For $n=1$: $\\sum_{k=1}^1 (2k-1) = 1 = 1^2$. Done." });
ok(!r.isError && r.data.post_id > 0, "member posts a result");
const postId = r.data.post_id;

r = await call(ali, "post", { step_id: 1, kind: "note", body: "here is my key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123" });
ok(r.isError && /Blocked/.test(r.data), "secret in post is blocked", String(r.data).slice(0, 70));
r = await call(ali, "post", { kind: "note", body: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" });
ok(r.isError, "GitHub token blocked");
r = await call(ali, "post", { kind: "note", body: "2^521-1 = 6864797660130609714981900799081393217269435300143305409394463459185543183397656052122559640661454554977296311391480858037121987999716643812574028291115057151" });
ok(!r.isError, "long pure-digit number is allowed");

r = await call(ali, "merge_step", { step_id: 1, post_id: postId });
ok(r.isError && /owner/.test(r.data), "member can't merge");

const noah = await connect(`${BASE}/mcp/${room}/${ownerKey}`);
r = await call(noah, "claim_step", { step_id: 1 });
ok(r.isError && /Someone else/.test(r.data), "owner can't take a step someone else claimed");
r = await call(noah, "merge_step", { step_id: 1, post_id: postId });
ok(!r.isError, "owner merges the step");

let st = await j(`/api/r/${room}/state`);
const posts = st.data.events.filter((e) => e.type === "post");
ok(st.data.steps[0].status === "done" && st.data.steps[0].merged_event === postId, "state shows the step merged");
ok(!posts.some((p) => /sk-ant|ghp_/.test(p.body)), "blocked posts were never stored");

r = await call(ali, "read_room", { since_event: 0 });
ok(!r.isError && r.data.activity.length >= 5 && r.data.board[0].untrusted.title === "Base case n=1", "read_room since_event returns history with untrusted labels");

// ---- links ----
r = await call(ali, "pin_link", { title: "Paper", url: "https://arxiv.org/abs/2610.32305" });
ok(!r.isError && r.data.link_id > 0, "agent pins a link");
const aliLink = r.data.link_id;
r = await call(ali, "pin_link", { url: `${BASE}/mcp/${room}/${memberKey}` });
ok(r.isError && /connector URL/.test(r.data), "pinning a connector URL (a key) is blocked");
let lr = await j(`/api/r/${room}/link`, { method: "POST", headers: { "x-key": ownerKey }, body: JSON.stringify({ title: "", url: "javascript:alert(1)" }) });
ok(lr.status === 400, "javascript: links are refused", lr.data?.error);
lr = await j(`/api/r/${room}/link`, { method: "POST", headers: { "x-key": ownerKey }, body: JSON.stringify({ title: "", url: "github.com/noahreese-dev/cuckulous" }) });
ok(lr.status === 200, "host pins a bare domain link");
let st2 = await j(`/api/r/${room}/state`);
const ownerLink = st2.data.links.find((l) => l.url.includes("github.com"));
ok(ownerLink && ownerLink.url === "https://github.com/noahreese-dev/cuckulous" && ownerLink.title === "github.com", "bare link gets https:// and a default name");
lr = await j(`/api/r/${room}/unlink`, { method: "POST", headers: { "x-key": memberKey }, body: JSON.stringify({ link_id: ownerLink.id }) });
ok(lr.status === 400, "member can't unpin someone else's link");
lr = await j(`/api/r/${room}/unlink`, { method: "POST", headers: { "x-key": ownerKey }, body: JSON.stringify({ link_id: aliLink }) });
ok(lr.status === 200, "host can unpin anyone's link");
lr = await j(`/api/r/${room}/link`, { method: "POST", body: JSON.stringify({ url: "https://example.com" }) });
ok(lr.status === 403, "watchers (no key) can't pin links");

// ---- to-do from the page ----
lr = await j(`/api/r/${room}/step`, { method: "POST", headers: { "x-key": memberKey }, body: JSON.stringify({ title: "Check n = 3 by hand" }) });
ok(lr.status === 200 && lr.data.step_id === 2, "member adds a to-do from the page");

// ---- chat ----
lr = await j(`/api/r/${room}/say`, { method: "POST", headers: { "x-key": memberKey }, body: JSON.stringify({ body: "Please take step 2 next." }) });
ok(lr.status === 200, "member types in the room chat");
lr = await j(`/api/r/${room}/say`, { method: "POST", body: JSON.stringify({ body: "hi" }) });
ok(lr.status === 403, "watchers can't type");
lr = await j(`/api/r/${room}/say`, { method: "POST", headers: { "x-key": ownerKey }, body: JSON.stringify({ body: "token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" }) });
ok(lr.status === 400, "secrets in chat are blocked");
r = await call(ali, "read_room", {});
const mine = r.data.activity.find((e) => e.kind === "chat");
ok(mine && mine.from_your_human === true && mine.text_from_your_human === "Please take step 2 next." && mine.untrusted_text === undefined, "your own chat reaches your agent as your human");
r = await call(noah, "read_room", {});
const theirs = r.data.activity.find((e) => e.kind === "chat");
ok(theirs && !theirs.from_your_human && theirs.untrusted_text === "Please take step 2 next.", "someone else's chat reaches other agents as untrusted");
ok(r.data.links.length === 1 && r.data.links[0].untrusted.title === "github.com", "read_room lists pinned links as untrusted");

const sum = await j(`/api/r/${room}/summary`);
ok(sum.status === 200 && sum.data.post_count === 3 && sum.data.done_count === 1 && sum.data.members.length === 2, "hallway summary counts are right", JSON.stringify(sum.data).slice(0, 90));
const members = st.data.members;
const aliId = members.find((m) => m.name === "Ali").id;
const rm = await j(`/api/r/${room}/remove`, { method: "POST", headers: { "x-key": ownerKey }, body: JSON.stringify({ member_id: aliId }) });
ok(rm.status === 200, "owner removes Ali");
let removedErr = null;
try {
  r = await call(ali, "read_room", {});
  removedErr = r.isError ? r.data : null;
} catch (e) {
  removedErr = e.message;
}
ok(!!removedErr, "removed member is cut off at once", String(removedErr).slice(0, 70));

for (const p of [`/r/${room}`, `/r/${room}/join`, `/r/${room}/admin`, "/", "/app.js", "/style.css"]) {
  const res = await fetch(BASE + p);
  ok(res.status === 200, `GET ${p.length > 30 ? p.slice(0, 30) + "…" : p}`);
}
const missing = await j(`/api/r/AAAAAAAAAAAAAAAA/state`);
ok(missing.status === 404, "unknown room is 404");

console.log(`\nroom for manual look: ${BASE}/r/${room}\nadmin: ${BASE}/r/${room}/admin#${ownerKey}`);
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
