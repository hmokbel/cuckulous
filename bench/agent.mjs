// Model drivers for the benchmark. Each driver keeps one conversation and exposes:
//   start(system, kickoff)
//   next(signal) -> { calls: [{ id, name, input, error? }], usage, model, stop, pause? }
//   addResults([{ id, content, isError }]) ; addUserText(text)
// Tools are passed in (the room's MCP tools plus a local `wait`), so the
// benchmark agents use exactly what a connected ChatGPT or Claude would.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// USD per million tokens: [input, output, cache read, cache write]. Estimates
// from list prices; add OpenAI models you use. Unknown models show no cost.
export const PRICES = {
  "claude-fable-5-2": [8, 40, 0.2, 10],
  "claude-fable-5-1": [10, 50, 1, 12.5],
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-opus-5": [5, 25, 0.5, 6.25],
  "claude-opus-4-8": [5, 25, 0.5, 6.25],
  "claude-sonnet-5-5": [2, 10, 0.1, 2.5],
  "claude-sonnet-5": [2, 10, 0.2, 2.5],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
};
export function costOf(model, u) {
  const key = Object.keys(PRICES).filter((k) => (model || "").startsWith(k)).sort((a, b) => b.length - a.length)[0];
  if (!key) return null;
  const p = PRICES[key];
  return ((u.input || 0) * p[0] + (u.output || 0) * p[1] + (u.cacheRead || 0) * p[2] + (u.cacheWrite || 0) * p[3]) / 1e6;
}

const ADAPTIVE_RE = /^claude-(opus-(4-[678]|5)|sonnet-(4-6|5)|haiku-5|fable|mythos)/;
const FALLBACK_RE = /^claude-(fable-5-[12]|opus-5|sonnet-5-5)/;

// Small check of tool input against the MCP JSON schema (eager input streaming
// means the API doesn't validate it for us). The room validates again.
function check(schema, v) {
  if (!schema || schema.type !== "object") return null;
  if (!v || typeof v !== "object" || Array.isArray(v)) return "input must be an object";
  for (const k of schema.required || []) if (!(k in v)) return `${k} is required`;
  for (const [k, val] of Object.entries(v)) {
    const p = schema.properties?.[k];
    if (!p) {
      if (schema.additionalProperties === false) return `${k} is not allowed`;
      continue;
    }
    if (p.type === "string" && typeof val !== "string") return `${k} must be a string`;
    if (p.type === "integer" && !Number.isInteger(val)) return `${k} must be an integer`;
    if (p.enum && !p.enum.includes(val)) return `${k} must be one of ${p.enum.join(", ")}`;
  }
  return null;
}

// After a mid-output server-side fallback, model-internal blocks before the last
// `fallback` block must be left out when the turn is sent back.
function echoAfterFallback(content) {
  const last = content.map((b) => b.type).lastIndexOf("fallback");
  if (last < 0) return content;
  const paired = new Set(content.filter((b) => b.tool_use_id && b.type.endsWith("_tool_result")).map((b) => b.tool_use_id));
  return content.filter((b, i) => {
    if (i >= last || b.type === "text" || b.type === "fallback" || b.type.endsWith("_tool_result")) return true;
    if (b.type === "server_tool_use") return paired.has(b.id);
    return false;
  });
}

export class AnthropicDriver {
  constructor({ model, effort = "high", tools, apiKey, clientOptions = {} }) {
    // Without apiKey the SDK reads ANTHROPIC_API_KEY or an `ant auth login` profile.
    this.client = new Anthropic({ ...(apiKey ? { apiKey } : {}), maxRetries: 5, ...clientOptions });
    this.model = model;
    this.schemas = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema]));
    this.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema, eager_input_streaming: true }));
    this.extra = ADAPTIVE_RE.test(model) ? { thinking: { type: "adaptive" }, output_config: { effort } } : {};
    this.fallback = FALLBACK_RE.test(model);
    this.messages = [];
  }
  start(system, kickoff) {
    this.system = system;
    this.messages.push({ role: "user", content: kickoff });
  }
  async next(signal) {
    const params = {
      model: this.model,
      max_tokens: 64000,
      cache_control: { type: "ephemeral" },
      system: this.system,
      tools: this.tools,
      messages: this.messages,
      ...this.extra,
    };
    let msg;
    for (let retries = 0; ; retries++) {
      const stream = this.fallback
        ? this.client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, { signal })
        : this.client.messages.stream(params, { signal });
      try {
        msg = await stream.finalMessage();
        break;
      } catch (err) {
        // Re-issue only for unparseable tool input or a dropped stream.
        if (err instanceof Anthropic.APIError || signal?.aborted || retries >= 2) throw err;
      }
    }
    const u = msg.usage || {};
    const usage = {
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0,
    };
    const base = { usage, model: msg.model, stop: msg.stop_reason };
    if (msg.stop_reason === "refusal") return { ...base, calls: [] };
    const content = echoAfterFallback(msg.content);
    this.messages.push({ role: "assistant", content });
    if (msg.stop_reason === "pause_turn") return { ...base, calls: [], pause: true };
    const cut = msg.stop_reason === "max_tokens";
    const calls = content
      .filter((b) => b.type === "tool_use")
      .map((b) => {
        if (cut) return { id: b.id, name: b.name, error: "Your output hit max_tokens and this call was cut off. Send less at once." };
        const problem = this.schemas[b.name] ? check(this.schemas[b.name], b.input) : `Unknown tool ${b.name}`;
        return problem
          ? { id: b.id, name: b.name, error: JSON.stringify({ INVALID_JSON: JSON.stringify(b.input), problem }) }
          : { id: b.id, name: b.name, input: b.input };
      });
    return { ...base, calls };
  }
  addResults(results) {
    this.messages.push({
      role: "user",
      content: results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })),
    });
  }
  addUserText(text) {
    this.messages.push({ role: "user", content: text });
  }
}

export class OpenAIDriver {
  constructor({ model, tools, apiKey, clientOptions = {} }) {
    this.client = new OpenAI({ ...(apiKey ? { apiKey } : {}), maxRetries: 5, ...clientOptions });
    this.model = model;
    this.schemas = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema]));
    this.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  }
  start(system, kickoff) {
    this.messages = [
      { role: "system", content: system },
      { role: "user", content: kickoff },
    ];
  }
  async next(signal) {
    const r = await this.client.chat.completions.create(
      { model: this.model, messages: this.messages, tools: this.tools, max_completion_tokens: 16384 },
      { signal },
    );
    const choice = r.choices[0];
    const tc = (choice.message.tool_calls || []).filter((c) => c.type === "function");
    this.messages.push({ role: "assistant", content: choice.message.content ?? null, ...(tc.length ? { tool_calls: tc } : {}) });
    const u = r.usage || {};
    const cached = u.prompt_tokens_details?.cached_tokens || 0;
    const usage = { input: (u.prompt_tokens || 0) - cached, output: u.completion_tokens || 0, cacheRead: cached, cacheWrite: 0 };
    const calls = tc.map((c) => {
      let input;
      try {
        input = JSON.parse(c.function.arguments || "{}");
      } catch {
        return { id: c.id, name: c.function.name, error: JSON.stringify({ INVALID_JSON: c.function.arguments }) };
      }
      if (choice.finish_reason === "length") return { id: c.id, name: c.function.name, error: "Your output was cut off. Send less at once." };
      const problem = this.schemas[c.function.name] ? check(this.schemas[c.function.name], input) : `Unknown tool ${c.function.name}`;
      return problem ? { id: c.id, name: c.function.name, error: problem } : { id: c.id, name: c.function.name, input };
    });
    return { usage, model: r.model, stop: choice.finish_reason === "content_filter" ? "refusal" : choice.finish_reason, calls };
  }
  addResults(results) {
    for (const r of results) this.messages.push({ role: "tool", tool_call_id: r.id, content: r.content });
  }
  addUserText(text) {
    this.messages.push({ role: "user", content: text });
  }
}

// Scripted agent for trying the harness without keys. It reads the room
// directly (peek) and plays a plausible part: the owner splits, merges and
// writes the final answer; members claim and post. Its answers are placeholders.
export class DemoDriver {
  constructor({ isOwner, peek, meId, delayMs = [300, 900] }) {
    Object.assign(this, { isOwner, peek, meId, delayMs, n: 0 });
  }
  start() {}
  async next(signal) {
    const [lo, hi] = this.delayMs;
    await new Promise((r) => setTimeout(r, lo + Math.random() * (hi - lo)));
    const s = await this.peek();
    const call = (name, input) => ({ id: `demo_${++this.n}`, name, input });
    const posts = s.events.filter((e) => e.type === "post" && e.step_id);
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const out = (calls) => ({ usage, model: "demo", stop: "tool_use", calls });
    if (this.isOwner) {
      if (!s.steps.length)
        return out(["Part A", "Part B", "Part C", "Part D"].map((t) => call("add_step", { title: t, detail: `Solve ${t}.` })));
      const ready = s.steps.filter((st) => st.status !== "done" && posts.some((p) => p.step_id === st.id && p.kind === "result"));
      if (ready.length)
        return out(ready.map((st) => call("merge_step", { step_id: st.id, post_id: posts.filter((p) => p.step_id === st.id && p.kind === "result").at(-1).id })));
      if (s.steps.every((st) => st.status === "done"))
        return out([call("post", { kind: "result", body: `FINAL ANSWER: demo answer combining ${s.steps.length} merged steps.` })]);
    }
    const mine = s.steps.find((st) => st.status === "claimed" && st.claimed_by === this.meId && !posts.some((p) => p.step_id === st.id && p.kind === "result"));
    if (mine) return out([call("post", { step_id: mine.id, kind: "result", body: `Demo result for step ${mine.id}.` })]);
    const open = s.steps.find((st) => st.status === "open");
    if (open) return out([call("claim_step", { step_id: open.id })]);
    return out([call("wait", {})]);
  }
  addResults() {}
  addUserText() {}
}

export function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof OpenAI.AuthenticationError) return "The provider rejected the API key.";
  if (err instanceof Anthropic.RateLimitError || err instanceof OpenAI.RateLimitError) return "Rate limited by the provider (after retries).";
  if (err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) return `Provider error ${err.status ?? ""}: ${String(err.message).slice(0, 200)}`;
  return String(err?.message || err).slice(0, 200);
}

// One model alone, no room: the honest baseline.
export async function solveDirect({ provider, model, effort = "high", prompt, signal }) {
  const system = "Solve the task completely and carefully. Your reply is the final answer.";
  const t0 = Date.now();
  if (provider === "anthropic") {
    const client = new Anthropic({ maxRetries: 5 });
    const params = {
      model,
      max_tokens: 64000,
      system,
      messages: [{ role: "user", content: prompt }],
      ...(ADAPTIVE_RE.test(model) ? { thinking: { type: "adaptive" }, output_config: { effort } } : {}),
    };
    const stream = FALLBACK_RE.test(model)
      ? client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, { signal })
      : client.messages.stream(params, { signal });
    const msg = await stream.finalMessage();
    const u = msg.usage || {};
    return {
      answer: msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""),
      usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 },
      ms: Date.now() - t0,
      model: msg.model,
      stop: msg.stop_reason,
    };
  }
  if (provider === "openai") {
    const client = new OpenAI({ maxRetries: 5 });
    const r = await client.chat.completions.create(
      { model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], max_completion_tokens: 16384 },
      { signal },
    );
    const u = r.usage || {};
    const cached = u.prompt_tokens_details?.cached_tokens || 0;
    return {
      answer: r.choices[0].message.content || "",
      usage: { input: (u.prompt_tokens || 0) - cached, output: u.completion_tokens || 0, cacheRead: cached, cacheWrite: 0 },
      ms: Date.now() - t0,
      model: r.model,
      stop: r.choices[0].finish_reason,
    };
  }
  await new Promise((r) => setTimeout(r, 2000));
  return { answer: "FINAL ANSWER: demo", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, ms: Date.now() - t0, model: "demo", stop: "end_turn" };
}
