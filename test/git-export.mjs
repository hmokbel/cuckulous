// Checks tools/room-to-git.mjs against a running server.
// Usage: BASE=http://localhost:8799 CODE=test-code node test/git-export.mjs
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.BASE || "http://localhost:8799";
const CODE = process.env.CODE || "test-code";
const TOOL = new URL("../tools/room-to-git.mjs", import.meta.url).pathname;
let failed = 0;
const ok = (c, label, extra = "") => {
  console.log(`${c ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  if (!c) failed++;
};
const j = async (path, opts = {}) =>
  (await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } })).json();
const run = (...a) => execFileSync("node", [TOOL, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();

const { room_id: room, owner_key: owner } = await j("/api/rooms", {
  method: "POST",
  body: JSON.stringify({ code: CODE, name: "Noah", title: "Export test: sum of odds", brief: "Prove $\\sum (2k-1) = n^2$." }),
});
const aliKey = (await j(`/api/r/${room}/invite`, { method: "POST", headers: { "x-key": owner }, body: JSON.stringify({ name: "Ali" }) })).member_key;
const agent = async (key) => {
  const c = new Client({ name: "t", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${room}/${key}`)));
  return async (name, args) => JSON.parse((await c.callTool({ name, arguments: args })).content[0].text);
};
const N = await agent(owner);
const A = await agent(aliKey);
await N("add_step", { title: "Base case", detail: "Show it for $n=1$." });
await N("add_step", { title: "Induction step" });
await A("claim_step", { step_id: 1, model: "Test Model 1" });
const p1 = await A("post", { step_id: 1, kind: "result", body: "$1 = 1^2$.", model: "Test Model 1" });
await N("merge_step", { step_id: 1, post_id: p1.post_id });

const dir = join(mkdtempSync(join(tmpdir(), "cuck-export-")), "repo");
let out = run(`${BASE}/r/${room}`, "--out", dir);
ok(/1 new step commit/.test(out), "first export adds one step commit", out.trim());
ok(git(dir, "rev-list", "--count", "HEAD") === "2", "repo has the opening commit plus one step");
ok(git(dir, "log", "-1", "--format=%an") === "Ali", "the step commit is authored by the person whose AI solved it");
ok(/Test Model 1/.test(git(dir, "log", "-1", "--format=%B")), "the commit message names the model");
const files = readdirSync(join(dir, "steps"));
ok(files.length === 1 && /^001-base-case\.md$/.test(files[0]), "one step file", files.join());
ok(readFileSync(join(dir, "steps", files[0]), "utf8").includes("$1 = 1^2$."), "step file holds the merged post");
ok(/Prove/.test(readFileSync(join(dir, "README.md"), "utf8")), "README holds the brief");

// Second merge, then re-run: only the new step is added.
await A("claim_step", { step_id: 2 });
const p2 = await A("post", { step_id: 2, kind: "result", body: "Add $2n+1$ to $n^2$.", model: "Test Model 1" });
await N("merge_step", { step_id: 2, post_id: p2.post_id });
out = run(`${BASE}/r/${room}`, "--out", dir);
ok(/1 new step commit/.test(out), "second run adds only the new step", out.trim());
out = run(`${BASE}/r/${room}`, "--out", dir);
ok(/0 new step commits/.test(out), "third run adds nothing");
ok(git(dir, "rev-list", "--count", "HEAD") === "3", "repo now has three commits");

// The same history gives the same commits (deterministic: dates and authors come from the room).
const dir2 = join(mkdtempSync(join(tmpdir(), "cuck-export-")), "repo");
run(room, "--base", BASE, "--out", dir2);
ok(git(dir, "rev-parse", "HEAD") === git(dir2, "rev-parse", "HEAD"), "two exports of the same room give the same commit hash");

// The history file in the repo verifies on its own.
const hist = readFileSync(join(dir, "history.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
ok(hist[0].room.brief_hash && hist.at(-1).type === "merged", "history.jsonl runs from the room line to the latest merge");

// A folder holding a different room is refused.
let refused = false;
try {
  const other = (await j("/api/rooms", { method: "POST", body: JSON.stringify({ code: CODE, name: "X", title: "Other", brief: "b" }) })).room_id;
  run(other, "--base", BASE, "--out", dir);
} catch (e) {
  refused = /holds room/.test(String(e.stderr || e.message));
}
ok(refused, "won't mix two rooms in one repo");

// A server that edits one event in the log: the export must refuse it.
const proxy = createServer(async (req, res) => {
  const r = await fetch(BASE + req.url);
  let body = await r.text();
  if (req.url.endsWith("/log")) body = body.replace("$1 = 1^2$.", "$1 = 2^2$.");
  res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "text/plain" });
  res.end(body);
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
// Async on purpose: a sync child would block the event loop this proxy answers on.
const tamperErr = await new Promise((resolve) =>
  execFile("node", [TOOL, room, "--base", `http://127.0.0.1:${proxy.address().port}`, "--out", join(mkdtempSync(join(tmpdir(), "cuck-export-")), "repo")],
    { timeout: 30000 }, (e, _o, stderr) => resolve(e ? String(stderr) : "")));
const tamperRefused = /History breaks at event/.test(tamperErr);
proxy.close();
ok(tamperRefused, "an edited history is refused, nothing exported");

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
