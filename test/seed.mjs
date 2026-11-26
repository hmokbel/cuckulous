// Seeds a demo room with three members and some real-looking work.
// Usage: BASE=http://localhost:8799 CODE=test-code node test/seed.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.BASE || "http://localhost:8799";
const CODE = process.env.CODE || "test-code";
const j = async (path, opts = {}) =>
  (await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } })).json();
const agent = async (key) => {
  const c = new Client({ name: "seed", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${room}/${key}`)));
  return async (name, args) => JSON.parse((await c.callTool({ name, arguments: args })).content[0].text);
};

const { room_id: room, owner_key: owner } = await j("/api/rooms", {
  method: "POST",
  body: JSON.stringify({
    code: CODE,
    name: "Noah",
    title: "Is $2^n + 1$ ever a perfect cube?",
    brief: "Find every positive integer $n$ with $2^n + 1 = m^3$.\n\nRules: break it into steps, claim before you work, show every calculation, and post results with a check anyone can rerun.",
  }),
});
const invite = async (name) => (await j(`/api/r/${room}/invite`, { method: "POST", headers: { "x-key": owner }, body: JSON.stringify({ name }) })).member_key;
const hussein = await invite("Hussein");
const ali = await invite("Ali");
await invite("Sara");

const N = await agent(owner);
const H = await agent(hussein);
const A = await agent(ali);
await N("add_step", { title: "Factor the equation", detail: "Rewrite $2^n = m^3 - 1 = (m-1)(m^2+m+1)$." });
await N("add_step", { title: "Parity of $m^2+m+1$", detail: "Show $m^2+m+1$ is always odd." });
await N("add_step", { title: "Finish: solve the small case", detail: "" });
await H("claim_step", { step_id: 1 });
const p1 = await H("post", { step_id: 1, kind: "result", body: "$m^3 - 1 = (m-1)(m^2+m+1)$, so $2^n = (m-1)(m^2+m+1)$. Both factors must be powers of 2." });
await N("merge_step", { step_id: 1, post_id: p1.post_id });
await A("claim_step", { step_id: 2 });
await A("post", { step_id: 2, kind: "attempt", body: "$m^2 + m = m(m+1)$ is a product of consecutive integers, so it's even. Then $m^2+m+1$ is odd." });
await A("post", { step_id: 2, kind: "result", body: "An odd power of 2 must be $2^0 = 1$, so $m^2+m+1 = 1$, giving $m = 0$ or $m=-1$. Neither gives a positive $n$... wait, check $m=3$: $2^3+1 = 9$, not a cube. Need to recheck step 1." });
await H("post", { kind: "question", body: "Are we allowing $n = 0$? Then $2^0 + 1 = 2$, not a cube either." });
console.log(`${BASE}/r/${room}\n${BASE}/r/${room}/admin#${owner}\n${BASE}/r/${room}/join#${hussein}`);
