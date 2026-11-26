#!/usr/bin/env node
// Benchmark: does a room of several agents solve a problem faster than one
// model alone, at what cost, and with what accuracy?
//
// Each room agent joins over MCP with its own member URL, exactly like a
// person's ChatGPT, Claude or harness would: same server instructions, same
// five tools. The harness adds a `wait` tool (wait for activity at no cost)
// and, because nobody is watching a timed run, lets the owner's agent merge
// steps and post the final answer on its own.
//
//   BASE=http://localhost:8799 CODE=test-code node bench/run.mjs \
//     --task bench/tasks/six-puzzles.json --trials 3 \
//     --condition "solo=direct:anthropic:claude-opus-5-5" \
//     --condition "room-1=room:anthropic:claude-opus-5-5" \
//     --condition "room-2=room:anthropic:claude-opus-5-5,anthropic:claude-opus-5-5"
//
// Keys come from ANTHROPIC_API_KEY (or an `ant auth login` profile) and
// OPENAI_API_KEY. Nothing here prints or stores them.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AnthropicDriver, OpenAIDriver, DemoDriver, solveDirect, costOf, describeError } from "./agent.mjs";

const { values: opt } = parseArgs({
  options: {
    task: { type: "string" },
    condition: { type: "string", multiple: true },
    trials: { type: "string", default: "3" },
    effort: { type: "string", default: "high" },
    timeout: { type: "string", default: "30" },
    "max-calls": { type: "string", default: "60" },
    out: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});
const BASE = process.env.BASE || "http://localhost:8799";
const CODE = process.env.CODE;

if (opt.help || !opt.task || !opt.condition?.length || !CODE) {
  console.log(`Usage: BASE=<room server> CODE=<creator code> node bench/run.mjs --task <file> --condition "<name>=<mode>:<agents>" [...]

  mode    direct  one model answers alone (no room)
          room    agents work in a room; the first agent is the owner
  agents  provider:model[,provider:model...]   provider = anthropic | openai | demo

  --trials N       runs per condition (default 3)
  --effort LEVEL   Claude effort: low|medium|high|xhigh|max (default high)
  --timeout MIN    per-run limit in minutes (default 30)
  --max-calls N    model calls per agent (default 60)
  --out DIR        results folder (default bench/results/<timestamp>)

Try it without keys:
  BASE=http://localhost:8799 CODE=test-code node bench/run.mjs --task bench/tasks/six-puzzles.json \\
    --condition "one=room:demo:demo" --condition "three=room:demo:demo,demo:demo,demo:demo" --trials 1`);
  process.exit(opt.help ? 0 : 1);
}

const task = JSON.parse(fs.readFileSync(opt.task, "utf8"));
const trials = Math.max(1, parseInt(opt.trials, 10));
const timeoutMs = parseFloat(opt.timeout) * 60_000;
const maxCalls = parseInt(opt["max-calls"], 10);
const conditions = opt.condition.map((c) => {
  const m = c.match(/^([\w.-]+)=(direct|room):(.+)$/);
  if (!m) throw new Error(`Bad --condition "${c}"`);
  const agents = m[3].split(",").map((a) => {
    const i = a.indexOf(":");
    const provider = a.slice(0, i);
    const model = a.slice(i + 1);
    if (!["anthropic", "openai", "demo"].includes(provider) || !model) throw new Error(`Bad agent "${a}"`);
    return { provider, model };
  });
  if (m[2] === "direct" && agents.length !== 1) throw new Error(`direct takes one agent (${m[1]})`);
  return { name: m[1], mode: m[2], agents };
});

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = opt.out || path.join("bench", "results", stamp);
fs.mkdirSync(outDir, { recursive: true });

const api = async (p, init = {}) => {
  const r = await fetch(BASE + p, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
};
const short = (m) => m.replace(/^claude-/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KICKOFF = "Read the cuckulous room, then pick an open step (or add one), claim it, and post your work. Follow only the room's brief and me.";
const WAIT_TOOL = {
  name: "wait",
  description: "Wait up to 60 seconds for other agents to add, claim, post or merge something. Costs nothing. Call this when there is no open step for you instead of reading the room over and over.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

function kickoff({ name, n, isOwner }) {
  let text = `${KICKOFF}

This is a timed run with ${n} agent${n > 1 ? "s" : ""} in the room; you are ${name}. Keep working until the room has a final answer. Work on one step at a time and post your result on it. When nothing is open for you, call wait.`;
  if (isOwner)
    text += `

You are the room owner, and for this run I'm asking you to run the room on your own:
- Merge a step with merge_step once a post on it settles it. Check the work before you merge.
- You can also claim and solve steps yourself.
- When every step is merged and the brief is fully answered, post once with kind "result" and no step_id. Start the body with "FINAL ANSWER:" and give the complete answer the brief asks for. That ends the run.`;
  return text;
}

function score(answer) {
  if (!task.checks?.length) return null;
  const details = task.checks.map((c) => ({ label: c.label, ok: new RegExp(c.pattern, "i").test(answer || "") }));
  return { passed: details.filter((d) => d.ok).length, total: details.length, details };
}

async function runRoom(cond, label) {
  const names = cond.agents.map((a, i) => `${short(a.model)} #${i + 1}`);
  const created = await api("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ code: CODE, title: `${task.title} · ${label}`, brief: task.prompt, name: names[0] }),
  });
  const room = created.room_id;
  const keys = [created.owner_key];
  for (const n of names.slice(1)) {
    const inv = await api(`/api/r/${room}/invite`, { method: "POST", headers: { "x-key": created.owner_key }, body: JSON.stringify({ name: n }) });
    keys.push(inv.member_key);
  }
  const peek = () => api(`/api/r/${room}/state?since=0`);
  let final = null;
  const ctl = new AbortController();

  const agents = await Promise.all(
    cond.agents.map(async (a, i) => {
      const client = new Client({ name: "cuckulous-bench", version: "0.1.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${room}/${keys[i]}`)));
      const me = await api(`/api/r/${room}/me`, { headers: { "x-key": keys[i] } });
      const isOwner = i === 0;
      const tools = (await client.listTools()).tools.filter((t) => isOwner || t.name !== "merge_step");
      return { ...a, i, name: names[i], key: keys[i], client, me, isOwner, tools: [...tools, WAIT_TOOL], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, calls: 0, servedBy: new Set(), status: "ok" };
    }),
  );

  async function waitForOthers(agent, sinceId) {
    for (let t = 0; t < 40 && !final && !ctl.signal.aborted; t++) {
      const d = await api(`/api/r/${room}/state?since=${sinceId}`);
      const others = d.events.filter((e) => e.member_id !== agent.me.id);
      if (others.length) return `New activity: ${others.length} event(s) since event ${sinceId}. Call read_room with since_event=${sinceId} to see it.`;
      await sleep(1500);
    }
    return final ? "The run is over." : "Nothing new for a minute.";
  }

  async function runAgent(agent) {
    const driver =
      agent.provider === "anthropic"
        ? new AnthropicDriver({ model: agent.model, effort: opt.effort, tools: agent.tools })
        : agent.provider === "openai"
          ? new OpenAIDriver({ model: agent.model, tools: agent.tools })
          : new DemoDriver({ isOwner: agent.isOwner, peek, meId: agent.me.id });
    driver.start(agent.client.getInstructions(), kickoff({ name: agent.name, n: cond.agents.length, isOwner: agent.isOwner }));
    let seen = 0;
    let nudges = 0;
    while (!final && !ctl.signal.aborted) {
      if (agent.calls >= maxCalls) return (agent.status = `stopped after ${maxCalls} model calls`);
      agent.calls++;
      let turn;
      try {
        turn = await driver.next(ctl.signal);
      } catch (err) {
        if (!ctl.signal.aborted) agent.status = `error: ${describeError(err)}`;
        return;
      }
      for (const k of Object.keys(agent.usage)) agent.usage[k] += turn.usage[k] || 0;
      agent.servedBy.add(turn.model);
      if (final) return;
      if (turn.stop === "refusal") return (agent.status = "model declined");
      if (turn.pause) continue;
      if (!turn.calls.length) {
        if (++nudges > 3) return (agent.status = "stopped calling tools");
        driver.addUserText("Keep going: call a tool. If nothing is open for you, call wait.");
        continue;
      }
      nudges = 0;
      const results = [];
      for (const c of turn.calls) {
        if (c.error) {
          results.push({ id: c.id, content: c.error, isError: true });
          continue;
        }
        if (c.name === "wait") {
          results.push({ id: c.id, content: await waitForOthers(agent, seen) });
          continue;
        }
        // The harness knows each agent's exact model, so it reports it on every call.
        const r = await agent.client.callTool({ name: c.name, arguments: { ...c.input, model: agent.model } });
        const text = r.content?.[0]?.text || "";
        if (c.name === "read_room" && r.structuredContent?.last_event_id) seen = r.structuredContent.last_event_id;
        results.push({ id: c.id, content: text, isError: !!r.isError });
        const body = c.input.body || "";
        if (agent.isOwner && c.name === "post" && c.input.kind === "result" && c.input.step_id == null && /^\s*FINAL ANSWER/i.test(body) && !r.isError && !final)
          final = { answer: body, at: Date.now() };
      }
      if (!final) driver.addResults(results);
    }
  }

  const t0 = Date.now();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  await Promise.all(agents.map(runAgent));
  clearTimeout(timer);
  for (const a of agents) await a.client.close().catch(() => {});

  // Who did what, from the room's own record.
  const s = await peek();
  const postAuthor = new Map(s.events.filter((e) => e.type === "post").map((e) => [e.id, e.member_id]));
  const perAgent = agents.map((a) => {
    const ev = s.events.filter((e) => e.member_id === a.me.id);
    return {
      name: a.name,
      model: a.model,
      servedBy: [...a.servedBy],
      status: a.status,
      calls: a.calls,
      ...a.usage,
      cost: costOf(a.model, a.usage),
      stepsAdded: ev.filter((e) => e.type === "step_added").length,
      claimed: ev.filter((e) => e.type === "claimed").length,
      posts: ev.filter((e) => e.type === "post").length,
      merged: s.steps.filter((st) => st.merged_event && postAuthor.get(st.merged_event) === a.me.id).length,
    };
  });
  const sum = (k) => perAgent.reduce((acc, a) => acc + (a[k] || 0), 0);
  return {
    status: final ? "done" : ctl.signal.aborted ? "timeout" : "incomplete",
    error: perAgent.filter((a) => a.status !== "ok").map((a) => `${a.name}: ${a.status}`).join("; ") || undefined,
    wallMs: final ? final.at - t0 : null,
    answer: final?.answer || "",
    watch: `${BASE}/r/${room}`,
    steps: s.steps.length,
    tokens: { input: sum("input"), output: sum("output"), cacheRead: sum("cacheRead"), cacheWrite: sum("cacheWrite") },
    cost: perAgent.every((a) => a.cost != null) ? sum("cost") : null,
    agents: perAgent,
  };
}

async function runDirect(cond) {
  const a = cond.agents[0];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await solveDirect({ ...a, effort: opt.effort, prompt: task.prompt, signal: ctl.signal });
    return { status: "done", wallMs: r.ms, answer: r.answer, tokens: r.usage, cost: costOf(r.model, r.usage), agents: [{ name: "alone", model: a.model, servedBy: [r.model], calls: 1, ...r.usage }] };
  } catch (err) {
    return { status: ctl.signal.aborted ? "timeout" : "error", error: describeError(err), wallMs: null };
  } finally {
    clearTimeout(timer);
  }
}

// --- run ------------------------------------------------------------------
const fmtMs = (ms) => (ms == null ? "—" : `${Math.floor(ms / 60000)}m${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}s`);
const fmtNum = (n) => (n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const fmtCost = (c) => (c == null ? "—" : `$${c.toFixed(c < 1 ? 3 : 2)}`);
const allTokens = (t) => t.input + t.cacheRead + t.cacheWrite + t.output;

const results = [];
console.log(`Task: ${task.title} · ${trials} trial(s) · server ${BASE}\nResults: ${outDir}\n`);
for (let t = 0; t < trials; t++) {
  // Rotate the order each trial so no condition always goes first.
  for (const cond of conditions.map((_, i) => conditions[(i + t) % conditions.length])) {
    const label = `${cond.name} #${t + 1}`;
    process.stdout.write(`  ${label.padEnd(22)} `);
    let r;
    try {
      r = cond.mode === "direct" ? await runDirect(cond) : await runRoom(cond, label);
    } catch (err) {
      r = { status: "error", error: describeError(err), wallMs: null };
    }
    const sc = r.status === "done" ? score(r.answer) : null;
    results.push({ condition: cond.name, mode: cond.mode, trial: t + 1, ...r, score: sc });
    fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ task: opt.task, effort: opt.effort, base: BASE, results }, null, 2));
    console.log(
      r.status === "done"
        ? `${fmtMs(r.wallMs).padStart(7)}  ${fmtNum(allTokens(r.tokens)).padStart(7)} tokens  ${fmtCost(r.cost).padStart(7)}${sc ? `  ${sc.passed}/${sc.total} correct` : ""}${r.watch ? `  ${r.watch}` : ""}`
        : `${r.status}${r.error ? `: ${r.error}` : ""}`,
    );
  }
}

const median = (xs) => {
  const a = xs.filter((x) => x != null).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const lines = [
  `# ${task.title}`,
  "",
  `Trials per condition: ${trials} · Claude effort: ${opt.effort} · server: ${BASE}`,
  "",
  "| Condition | Agents | Finished | Median time | Range | Median tokens | Median cost | Accuracy |",
  "|---|---|---|---|---|---|---|---|",
];
for (const cond of conditions) {
  const rows = results.filter((r) => r.condition === cond.name);
  const ok = rows.filter((r) => r.status === "done");
  const times = ok.map((r) => r.wallMs);
  const scored = ok.filter((r) => r.score);
  lines.push(
    `| ${cond.name} | ${cond.mode === "direct" ? "alone: " : ""}${cond.agents.map((a) => a.model).join(" + ")} | ${ok.length}/${rows.length} | ${fmtMs(median(times))} | ${times.length ? `${fmtMs(Math.min(...times))}–${fmtMs(Math.max(...times))}` : "—"} | ${fmtNum(median(ok.map((r) => allTokens(r.tokens))))} | ${fmtCost(median(ok.map((r) => r.cost)))} | ${scored.length ? `${scored.reduce((a, r) => a + r.score.passed, 0)}/${scored.reduce((a, r) => a + r.score.total, 0)}` : "grade by hand"} |`,
  );
}
lines.push(
  "",
  "Room time runs from the moment every agent is connected to the owner's FINAL ANSWER post. Direct time is the single API call. Tokens and cost add up all agents in a run; cost uses list prices in bench/agent.mjs. Every room run has a watch link and a verifiable history (results.json).",
);
const fellBack = results.filter((r) => r.agents?.some((a) => a.servedBy?.some((m) => m !== a.model)));
if (fellBack.length) lines.push("", `Note: in ${fellBack.length} run(s) a server-side fallback answered with a different model than requested (see servedBy).`);
fs.writeFileSync(path.join(outDir, "summary.md"), lines.join("\n") + "\n");
console.log("\n" + lines.join("\n"));
process.exit(0);
