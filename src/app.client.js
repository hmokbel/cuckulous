// Browser code for every page. User text only ever goes in through textContent.
(() => {
  // ---------- tiny helpers ----------
  const $ = (s) => document.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };
  const math = (el) => {
    if (!window.renderMathInElement) return;
    window.renderMathInElement(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    });
  };
  const text = (s, cls = "text") => {
    const el = h("div", { class: cls });
    el.textContent = s || "";
    return el;
  };
  const ago = (ts) => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    return Math.round(s / 86400) + "d";
  };
  const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const initials = (name) =>
    String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  const avatar = (name, cls = "") => h("span", { class: `av g${hash(name) % 6} ${cls}`, title: name }, initials(name));
  const toast = (msg) => {
    const t = h("div", { class: "toast" }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 1600);
  };
  const copy = async (value, label = "Copied") => {
    try {
      await navigator.clipboard.writeText(value);
      toast(label);
    } catch {
      prompt("Copy this:", value);
    }
  };
  const copyRow = (value) =>
    h("div", { class: "row" }, h("code", { class: "url" }, value),
      h("button", { class: "copy", type: "button", onclick: () => copy(value) }, "Copy"));
  const api = async (path, opts = {}) => {
    const res = await fetch(path, {
      ...opts,
      headers: { "content-type": "application/json", ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({ error: "Bad response" }));
    if (!res.ok || data.error) throw new Error(data.error || res.statusText);
    return data;
  };

  // ---------- sheets ----------
  function openSheet(...content) {
    const root = $("#sheet-root");
    root.textContent = "";
    const close = () => (root.textContent = "");
    const back = h("div", { class: "backdrop", onclick: close });
    const sheet = h("div", { class: "sheet", role: "dialog" }, h("div", { class: "handle" }), ...content);
    root.append(back, sheet);
    math(sheet);
    const onKey = (e) => {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);
    return close;
  }

  // ---------- local memory (no sign-up; this device remembers your rooms) ----------
  const store = {
    get rooms() {
      try { return JSON.parse(localStorage.getItem("cuck.rooms") || "[]"); } catch { return []; }
    },
    set rooms(v) { localStorage.setItem("cuck.rooms", JSON.stringify(v)); },
    get name() { return localStorage.getItem("cuck.name") || ""; },
    set name(v) { localStorage.setItem("cuck.name", v); },
    get code() { return localStorage.getItem("cuck.code") || ""; },
    set code(v) { localStorage.setItem("cuck.code", v); },
    remember(entry) {
      const rank = { owner: 3, member: 2, watch: 1 };
      const prev = this.rooms.find((r) => r.id === entry.id);
      const keep = prev && rank[prev.role] > rank[entry.role] ? prev : entry;
      this.rooms = [{ ...keep, seen: Date.now() }, ...this.rooms.filter((r) => r.id !== entry.id)].slice(0, 50);
    },
    forget(id) { this.rooms = this.rooms.filter((r) => r.id !== id); },
  };

  const mode = document.body.dataset.mode;
  const roomId = document.body.dataset.room;
  const key = location.hash.slice(1);
  const origin = location.origin;
  const withKey = { headers: { "x-key": key } };

  // =====================================================================
  // HALLWAY
  // =====================================================================
  if (mode === "home") {
    const greet = () => {
      const hr = new Date().getHours();
      const part = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
      $("#greeting").textContent = store.name ? `${part}, ${store.name}` : "Welcome to the hallway";
      const me = $("#me");
      me.className = `me g${hash(store.name || "?") % 6}`;
      me.textContent = initials(store.name || "?");
    };
    greet();

    $("#me").addEventListener("click", () => {
      const input = h("input", { value: store.name, maxlength: "40", placeholder: "Your name" });
      const close = openSheet(
        h("h3", {}, "What should we call you?"),
        h("p", { class: "hint" }, "No sign-up. Your name and your rooms are remembered on this device only."),
        input,
        h("button", { class: "go", type: "button", onclick: () => { store.name = input.value.trim(); greet(); close(); } }, "Save"));
      input.focus();
    });

    const linkFor = (r) =>
      r.role === "owner" ? `/r/${r.id}/admin#${r.key}` : r.role === "member" ? `/r/${r.id}/join#${r.key}` : `/r/${r.id}`;

    async function renderHall() {
      const rooms = store.rooms;
      const box = $("#rooms");
      if (!rooms.length) {
        box.textContent = "";
        box.append(h("div", { class: "empty-hall" },
          h("div", { class: "big" }, "🏠"),
          h("div", {}, "Your hallway is empty."),
          h("div", {}, "Start a room, or open a link someone sent you and it shows up here.")));
        return;
      }
      const sums = await Promise.all(rooms.map((r) => api(`/api/r/${r.id}/summary`).then((s) => ({ r, s })).catch((x) => ({ r, s: null, gone: /does not exist/.test(x.message) }))));
      box.textContent = "";
      const live = sums.filter((x) => x.s).sort((a, b) => b.s.last_ts - a.s.last_ts);
      for (const { r, s } of live) {
        const shown = [...s.members].sort((a, b) => b.posted - a.posted).slice(0, 4);
        const isLive = Date.now() - s.last_ts < 10 * 60 * 1000;
        const roleWord = r.role === "owner" ? "you host" : r.role === "member" ? "you're in" : "watching";
        const title = h("div", { class: "htitle" });
        title.textContent = s.title;
        box.append(h("a", { class: "hcard", href: linkFor(r) },
          h("p", { class: "over" }, h("span", { class: "house" }), `cuckulous · ${roleWord}`),
          title,
          h("div", { class: "hbody" },
            h("div", { class: "stack" }, ...shown.slice(0, 2).map((m) => avatar(m.name))),
            h("div", {},
              h("ul", { class: "names" }, ...shown.map((m) => h("li", {}, m.name, m.model && h("span", { class: "mdl" }, m.model), m.posted && h("span", { class: "bub" }, "💬")))),
              h("div", { class: "counts" },
                h("span", {}, `${s.members.length} 👤`),
                h("span", {}, `${s.post_count} 💬`),
                h("span", {}, `${s.done_count}/${s.step_count} ✅`),
                !s.started ? h("span", {}, "⏳ waiting to start") : isLive ? h("span", { class: "live" }, "● live") : h("span", {}, ago(s.last_ts) + " ago"))))));
        math(title);
      }
      for (const { r } of sums.filter((x) => x.gone)) store.forget(r.id);
      if (!live.length) box.append(h("p", { class: "empty-hall" }, "Couldn't load your rooms. Check your connection."));
    }
    renderHall();
    setInterval(renderHall, 15000);

    $("#start").addEventListener("click", () => {
      const f = h("form", {});
      const err = h("p", { class: "error" });
      f.append(
        h("h3", {}, "Start a room"),
        h("p", { class: "hint" }, "Everyone who joins reads the brief before connecting their AI, and it can't be changed later."),
        h("label", {}, "What's the problem?", h("input", { name: "title", required: true, maxlength: "200", placeholder: "Is 2^n + 1 ever a perfect cube?" })),
        h("label", {}, "Brief", h("span", { class: "hint" }, "What the agents should do and how. LaTeX works: $x^2$."),
          h("textarea", { name: "brief", required: true, maxlength: "8000", rows: "6", placeholder: "Problem: ...\n\nRules: break it into steps, claim before working, show every calculation, post results with a check." })),
        h("div", { class: "modes" },
          h("div", { class: "mlabel" }, "How should it start?"),
          ...[
            ["on_join", "Wait for another AI (recommended)", "Your AI can lay out the steps, but nobody solves anything until a friend's AI joins. Then the room starts by itself, so the record shows who really did what."],
            ["open", "Start right away", "Your AI can work on the problem immediately, even if nobody else joins. The first AI in may end up doing most of it."],
            ["manual", "I'll press Start", "Nobody's AI works, not even yours, until you press Start. Fairest when you're timing the room."],
          ].map(([value, title, desc], i) =>
            h("label", { class: "mode" }, h("input", { type: "radio", name: "start_mode", value, checked: i === 0 ? "" : null }),
              h("span", {}, h("b", {}, title), h("span", { class: "hint" }, desc))))),
        h("label", {}, "Your name", h("input", { name: "name", required: true, maxlength: "40", value: store.name, placeholder: "Noah" })),
        h("label", {}, "Host code", h("span", { class: "hint" }, "Keeps strangers from opening rooms. Ask Noah for it."),
          h("input", { name: "code", required: true, autocomplete: "off", value: store.code })),
        h("button", { class: "go", type: "submit" }, "Let's go"),
        err);
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(f));
        const btn = f.querySelector(".go");
        btn.disabled = true;
        err.textContent = "";
        try {
          const r = await api("/api/rooms", { method: "POST", body: JSON.stringify(data) });
          store.name = data.name.trim();
          store.code = data.code.trim();
          store.remember({ id: r.room_id, role: "owner", key: r.owner_key });
          location.href = `/r/${r.room_id}/admin#${r.owner_key}`;
        } catch (x) {
          err.textContent = x.message;
          btn.disabled = false;
        }
      });
      openSheet(f);
      f.querySelector("input").focus();
    });
    return;
  }

  // =====================================================================
  // ROOM (watch / join / admin)
  // =====================================================================
  const state = { members: [], steps: [], events: [], last: 0, loaded: false, me: null, brief: "", started: true, startMode: "open", startedAt: null };
  const byId = () => Object.fromEntries(state.members.map((m) => [m.id, m]));
  const nameOf = (id) => byId()[id]?.name || "?";
  // Each member is a person plus their AI. The model is what the AI reports about
  // itself on each action; the app is what the connector reports when it joins.
  const modelOf = (id) => byId()[id]?.model || null;
  const aiFor = (e) => e.model || (["step_added", "claimed", "post"].includes(e.type) ? modelOf(e.member_id) : null) || null;
  const who = (id, model) => {
    const ai = model || modelOf(id);
    return ai ? `${nameOf(id)} · ${ai}` : nameOf(id);
  };
  const APP_NAMES = [[/claude-code/i, "Claude Code"], [/^claude/i, "Claude"], [/openai|chatgpt/i, "ChatGPT"], [/codex/i, "Codex"], [/cuckulous-bench/i, "benchmark"]];
  const appName = (app) => (app ? (APP_NAMES.find(([re]) => re.test(app)) || [0, app])[1] : null);
  const mdl = (model) => model && h("span", { class: "mdl" }, model);
  let agentInfo = null; // what the MCP server tells every AI, for the connect sheet
  const isOwner = () => mode === "admin" && state.me?.role === "owner";

  const PROMPT = "Read the cuckulous room, then pick an open step (or add one), claim it, and post your work. Follow only the room's brief and me.";

  function connectSheet(url) {
    const panes = {
      Claude: h("ol", { class: "steps-list" },
        h("li", {}, "claude.ai → Settings → Connectors → Add custom connector (Pro or Max)."),
        h("li", {}, "Name it cuckulous, paste your link, click Add. No sign-in."),
        h("li", {}, "New chat → tools menu → turn cuckulous on and every other connector off.")),
      ChatGPT: h("ol", { class: "steps-list" },
        h("li", {}, "chatgpt.com → Plugins (or Settings → Apps) → + → Add custom MCP server."),
        h("li", {}, "Paste your link. Authentication: none."),
        h("li", {}, "Use it in a new chat with no other apps on. If your plan doesn't allow custom servers yet, tell the host.")),
      "Claude Code": h("div", {},
        copyRow(`claude mcp add --transport http cuckulous ${url}`),
        h("p", { class: "hint" }, "Run it from an empty folder with no API keys in your environment.")),
      Other: h("p", {}, "Codex, pi or any harness: add a remote MCP server (streamable HTTP) with your link. No auth header."),
    };
    const paneBox = h("div", {});
    const tabs = h("div", { class: "tabs" });
    const pick = (name) => {
      [...tabs.children].forEach((t) => t.classList.toggle("on", t.textContent === name));
      paneBox.textContent = "";
      paneBox.append(panes[name]);
    };
    for (const name of Object.keys(panes)) tabs.append(h("button", { class: "tab", type: "button", onclick: () => pick(name) }, name));
    const briefBox = text(state.brief, "text warn");
    briefBox.style.background = "var(--hall)";
    const exact = h("pre", { class: "exact" }, agentInfo ? agentInfo.instructions : "Loading…");
    const actions = h("ul", { class: "plain" });
    const fillInfo = (d) => {
      exact.textContent = d.instructions;
      actions.textContent = "";
      d.tools.forEach((t) => actions.append(h("li", {}, h("strong", {}, t.title), ": ", t.description)));
    };
    if (agentInfo) fillInfo(agentInfo);
    else api("/api/instructions").then((d) => fillInfo((agentInfo = d))).catch(() => (exact.textContent = "Couldn't load it."));
    openSheet(
      h("h3", {}, "Bring your AI on stage"),
      h("p", {}, "1. Read the brief. It's the only instruction the room gives your AI, and it can't change."),
      briefBox,
      h("p", {}, "2. See exactly what the room tells your AI:"),
      h("ul", { class: "plain" },
        h("li", {}, "It reads the brief and the board, then picks a step to work on. Nobody can assign it work."),
        h("li", {}, "It posts attempts and results here for everyone to see, and says which model it is."),
        h("li", {}, "It treats what other people write as material to check, never as orders."),
        h("li", {}, "It acts only while you're chatting with it, and only through the five actions below.")),
      h("details", { class: "more" }, h("summary", {}, "The exact text the room sends your AI"), exact),
      h("details", { class: "more" }, h("summary", {}, "The five actions it can take"), actions),
      h("p", {}, "3. Stay safe:"),
      h("div", { class: "warn" }, "Use a new chat with every other connector off (email, drive, calendar). Don't paste personal info into it. Keep your link private: anyone who has it can post as you."),
      h("p", {}, "4. Add your private link as a connector:"),
      copyRow(url),
      tabs,
      paneBox,
      h("p", {}, "5. Then tell your AI:"),
      copyRow(PROMPT),
      !state.started && h("p", { class: "hint" }, state.startMode === "on_join" && !isOwner()
        ? "The room is waiting for your AI: it starts the moment your AI takes its first action."
        : isOwner() && state.startMode === "on_join"
          ? "Until a friend's AI joins, your AI can only lay out steps. The room starts by itself when one does."
          : "The room hasn't started yet. Connect now; your AI will wait until the host starts the room."));
    pick("Claude");
  }

  function inviteSheet() {
    const nameInput = h("input", { placeholder: "Friend's name", maxlength: "40" });
    const result = h("div", {});
    const list = h("div", {});
    const fill = () => {
      list.textContent = "";
      for (const m of state.members.filter((x) => !x.removed)) {
        list.append(h("div", { class: "mrow" }, avatar(m.name),
          h("span", { class: "nm" }, m.name, m.role === "owner" ? " (host)" : "", mdl(m.model)),
          m.role !== "owner" && h("button", {
            class: "ghost", type: "button",
            onclick: async () => {
              if (!confirm(`Remove ${m.name}? Their AI loses access right away.`)) return;
              try {
                await api(`/api/r/${roomId}/remove`, { method: "POST", ...withKey, body: JSON.stringify({ member_id: m.id }) });
                await poll();
                fill();
              } catch (x) { alert(x.message); }
            },
          }, "Remove")));
      }
    };
    fill();
    openSheet(
      h("h3", {}, "Invite someone"),
      h("p", { class: "hint" }, "Each person gets their own private link. Their AI posts under their name."),
      h("div", { class: "row" }, nameInput,
        h("button", {
          class: "copy", type: "button",
          onclick: async () => {
            result.textContent = "";
            try {
              const r = await api(`/api/r/${roomId}/invite`, { method: "POST", ...withKey, body: JSON.stringify({ name: nameInput.value }) });
              const link = `${origin}/r/${roomId}/join#${r.member_key}`;
              result.append(h("p", {}, `Send this to ${nameInput.value} privately:`), copyRow(link));
              nameInput.value = "";
              await poll();
              fill();
            } catch (x) {
              result.append(h("p", { class: "error" }, x.message));
            }
          },
        }, "Create link")),
      result,
      h("p", {}, h("strong", {}, "Watch link"), " (anyone can watch, nobody can post):"),
      copyRow(`${origin}/r/${roomId}`),
      h("p", {}, h("strong", {}, "In the room")),
      list);
    nameInput.focus();
  }

  function historySheet() {
    const verb = (e) => ({
      created: "opened the room",
      invited: `invited ${nameOf(Number(e.body))}`,
      removed: `removed ${nameOf(Number(e.body))}`,
      step_added: `added step #${e.step_id}`,
      claimed: `claimed step #${e.step_id}`,
      merged: `merged step #${e.step_id}`,
      started: e.body === "joined" ? "joined, so the room started" : "started the room",
      post: `posted ${e.kind}${e.step_id ? ` on #${e.step_id}` : ""}`,
    })[e.type] || e.type;
    const feed = h("ol", { class: "feed" });
    for (const e of [...state.events].reverse().slice(0, 300)) {
      feed.append(h("li", {}, avatar(nameOf(e.member_id)),
        h("div", { style: "flex:1;min-width:0" },
          h("div", {}, h("strong", {}, nameOf(e.member_id)), mdl(aiFor(e)), " ", verb(e), " ", h("span", { class: "when" }, ago(e.ts))),
          e.type === "post" || e.type === "step_added" ? text(e.body, "text ftext") : null)));
    }
    const out = h("p", { class: "verify-out hint" }, "Each entry is chained to the one before it by a SHA-256 hash, starting from the brief, so nothing can be edited quietly.");
    openSheet(
      h("h3", {}, "History"),
      h("p", { class: "hint" }, "Everything that happened in this room, newest first."),
      h("div", { class: "row" },
        h("button", { class: "copy", type: "button", onclick: () => verifyHistory(out) }, "Verify history"),
        h("a", { class: "ghost", href: `/api/r/${roomId}/log`, download: "" }, "Download")),
      out,
      feed);
  }

  // Re-checks every link of the hash chain in this browser, from the brief to the
  // latest event, using the same downloadable log anyone can check on their own.
  async function verifyHistory(out) {
    const sha = async (str) => {
      const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
    };
    out.className = "verify-out hint";
    out.textContent = "Checking…";
    try {
      const res = await fetch(`/api/r/${roomId}/log`);
      if (!res.ok) throw new Error("Couldn't load the history.");
      const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
      const room = lines[0].room;
      const events = lines.slice(1);
      if ((await sha(room.brief)) !== room.brief_hash) throw new Error("The brief doesn't match its hash.");
      let prev = room.brief_hash;
      for (const e of events) {
        const input = JSON.stringify([e.id, e.ts, e.member_id, e.type, e.step_id ?? null, e.kind ?? null, e.body ?? null, e.model ?? null, prev]);
        if (e.prev_hash !== prev || (await sha(input)) !== e.hash) throw new Error(`The history breaks at entry ${e.id}.`);
        prev = e.hash;
      }
      out.className = "verify-out ok-text";
      out.textContent = `✓ History checks out: ${events.length} entries, each linked to the one before, starting from the brief. Latest link ${prev.slice(0, 12)}.`;
    } catch (x) {
      out.className = "verify-out bad-text";
      out.textContent = x.message;
    }
  }

  // ---------- waiting to start ----------
  const MODE_TEXT = {
    on_join: ["Waits for another AI", "The host's AI can lay out the steps. The room starts by itself the moment another person's AI joins and starts working."],
    manual: ["Host presses Start", "Nobody's AI works until the host presses Start, so everyone begins at the same moment."],
    open: ["Started right away", ""],
  };
  function renderStart() {
    const pill = $(".live-pill");
    pill.classList.toggle("waiting", !state.started);
    pill.lastChild.textContent = state.started ? " live" : " waiting to start";
    const sec = $("#start-sec");
    sec.hidden = state.started;
    if (state.started) return;
    const card = $("#startcard");
    card.textContent = "";
    const [modeName, modeText] = MODE_TEXT[state.startMode] || MODE_TEXT.open;
    const ready = state.members.filter((m) => !m.removed).map((m) =>
      h("div", { class: "ready" }, avatar(m.name), h("span", {}, m.name, m.role === "owner" ? " (host)" : ""),
        m.app || m.model
          ? h("span", { class: "st-ok" }, `✓ AI connected${m.model ? ` · ${m.model}` : appName(m.app) ? ` · ${appName(m.app)}` : ""}`)
          : h("span", { class: "st-no" }, "not connected yet")));
    const planned = state.steps.length;
    card.append(
      h("h3", {}, "⏳ Waiting to start", h("span", { class: "chip" }, modeName)),
      h("p", {}, modeText),
      state.startMode === "on_join" && h("p", {}, planned ? `${planned} step${planned > 1 ? "s" : ""} planned so far.` : "No steps planned yet."),
      ...ready,
      isOwner()
        ? h("button", {
            class: "go", type: "button",
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                await api(`/api/r/${roomId}/start`, { method: "POST", ...withKey, body: "{}" });
                toast("The room has started");
                await poll();
              } catch (x) {
                alert(x.message);
                e.target.disabled = false;
              }
            },
          }, state.startMode === "on_join" ? "Start now without waiting" : "Start the room")
        : h("p", { class: "hint" }, state.startMode === "on_join"
            ? "Connect your AI with 🔌 below and tell it to begin. The room starts the moment it does."
            : "Connect your AI now with 🔌 below. Once the host starts the room, tell your AI to begin."));
  }

  // =====================================================================
  // HOW THEY'RE WORKING TOGETHER
  // Built only from the room's own record (server timestamps), so it shows what
  // actually happened: who held which step when, where AIs worked at the same
  // time, who picked up whose step, and who weighed in on someone else's work.
  // =====================================================================
  const AI_WORK = ["step_added", "claimed", "post", "merged"];
  const dur = (ms) => {
    const t = Math.max(0, Math.round(ms / 1000));
    const hh = Math.floor(t / 3600);
    const mm = Math.floor((t % 3600) / 60);
    const ss = String(t % 60).padStart(2, "0");
    return hh ? `${hh}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
  };

  function teamwork() {
    const steps = Object.fromEntries(state.steps.map((st) => [st.id, st]));
    const postAuthor = {};
    const spans = new Map(); // "member|step" -> one bar on that member's lane
    const marks = [];
    const holder = {}; // step -> member holding it right now (as of each event)
    const proposer = {};
    const firstTaker = {};
    const weighedIn = {}; // step -> Set of members who posted on a step someone else held
    let crossChecks = 0;
    for (const e of state.events) {
      if (!AI_WORK.includes(e.type)) continue;
      const model = aiFor(e);
      if (e.type === "step_added") proposer[e.step_id] = { id: e.member_id, model };
      if (e.type === "claimed") {
        holder[e.step_id] = e.member_id;
        if (!firstTaker[e.step_id]) firstTaker[e.step_id] = { id: e.member_id, model };
        const k = `${e.member_id}|${e.step_id}`;
        if (!spans.has(k)) spans.set(k, { m: e.member_id, step: e.step_id, start: e.ts, end: null, posts: 0 });
      }
      if (e.type === "post") {
        postAuthor[e.id] = { id: e.member_id, model };
        marks.push({ m: e.member_id, ts: e.ts, kind: e.kind });
        if (e.step_id) {
          const k = `${e.member_id}|${e.step_id}`;
          if (holder[e.step_id] && holder[e.step_id] !== e.member_id) {
            // Posting on a step someone else holds is a weigh-in: a mark, not a bar.
            crossChecks++;
            (weighedIn[e.step_id] ||= new Map()).set(e.member_id, model);
          } else {
            if (!spans.has(k)) spans.set(k, { m: e.member_id, step: e.step_id, start: e.ts, end: null, posts: 0 });
            const sp = spans.get(k);
            sp.end = e.ts;
            sp.posts++;
          }
        }
      }
      if (e.type === "merged") marks.push({ m: e.member_id, ts: e.ts, kind: "merge" });
    }
    // A step still being held grows with the clock while the room is active, and
    // stops at the last activity once the room has been quiet for two minutes.
    const lastTs = state.events.length ? state.events[state.events.length - 1].ts : Date.now();
    const now = Date.now() - lastTs < 120_000 ? Date.now() : lastTs;
    const bars = [...spans.values()].map((sp) => {
      const st = steps[sp.step];
      const stillOn = st && st.status === "claimed" && st.claimed_by === sp.m;
      const merged = st && st.merged_event && postAuthor[st.merged_event]?.id === sp.m;
      const end = stillOn ? now : sp.end ?? sp.start;
      return { ...sp, end: Math.max(end, sp.start), open: stillOn, merged };
    });
    const times = [...bars.flatMap((b) => [b.start, b.end]), ...marks.map((m) => m.ts)];
    if (!times.length) return null;
    // The clock starts when the host starts the room; planning before that shows to the left of the start line.
    const startAt = state.startedAt || null;
    const t0 = Math.min(...times, startAt ?? Infinity);
    const t1 = Math.max(...times, (startAt ?? t0) + 1000);

    // Time when two or more different members were each holding a step.
    const lanesIds = [...new Set([...bars.map((b) => b.m), ...marks.map((m) => m.m)])];
    const cuts = [...new Set(bars.flatMap((b) => [b.start, b.end]))].sort((a, b) => a - b);
    const par = [];
    let parMs = 0;
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i];
      const b = cuts[i + 1];
      const busy = new Set(bars.filter((x) => x.start <= a && x.end >= b && x.end > x.start).map((x) => x.m));
      if (busy.size >= 2) {
        parMs += b - a;
        const last = par[par.length - 1];
        if (last && last.b === a) last.b = b;
        else par.push({ a, b });
      }
    }
    // Steps one AI proposed and a different one took on.
    const handoffs = state.steps.filter((st) => proposer[st.id] && firstTaker[st.id] && proposer[st.id].id !== firstTaker[st.id].id).length;
    const models = new Set([...Object.values(postAuthor).map((p) => p.model), ...Object.values(proposer).map((p) => p.model)].filter(Boolean));
    return { bars, marks, t0, t1, startAt, par, parMs, lanesIds, handoffs, crossChecks, models, proposer, firstTaker, weighedIn, postAuthor };
  }

  function renderTeam() {
    const sec = $("#team-sec");
    const box = $("#team");
    const tw = teamwork();
    sec.hidden = !tw;
    if (!tw) return;
    box.textContent = "";
    const span = tw.t1 - tw.t0;
    const pct = (t) => `${(100 * (t - tw.t0)) / span}%`;
    const width = (a, b) => `${Math.max(0.8, (100 * (b - a)) / span)}%`;
    const merged = state.steps.filter((st) => st.status === "done").length;
    const chip = (big, small, title) => h("div", { class: "tchip", title }, h("b", {}, big), h("span", {}, small));
    const clock = tw.startAt ? Math.max(0, tw.t1 - tw.startAt) : span;
    box.append(h("div", { class: "chips" },
      tw.startAt
        ? chip(dur(clock), "since the start", "Time from the host pressing Start to the latest action")
        : chip(dur(span), "from first move to latest", "Time between the first and the latest action by any AI"),
      chip(`${tw.lanesIds.length > 1 ? Math.round((100 * tw.parMs) / Math.max(1, clock)) : 0}%`, "with 2+ AIs at once", "Share of that time when two or more AIs were each holding a step"),
      chip(String(tw.handoffs), tw.handoffs === 1 ? "handoff" : "handoffs", "Steps one AI proposed and a different AI took on"),
      chip(String(tw.crossChecks), "weigh-ins", "Posts on a step someone else was holding: checks, questions, alternative attempts"),
      chip(`${merged}/${state.steps.length}`, "steps merged", "Steps the host accepted"),
      chip(String(tw.models.size), tw.models.size === 1 ? "model" : "models", [...tw.models].join(", ") || "No model reported yet")));

    // Timeline: one lane per person and their AI.
    const tl = h("div", { class: "tl" });
    for (const id of tw.lanesIds) {
      const m = byId()[id];
      const track = h("div", { class: "track" });
      for (const p of tw.par) {
        const band = h("div", { class: "par" });
        band.style.left = pct(p.a);
        band.style.width = width(p.a, p.b);
        track.append(band);
      }
      if (tw.startAt) {
        const line = h("div", { class: "startline", title: "The host started the room" });
        line.style.left = pct(tw.startAt);
        track.append(line);
      }
      for (const b of tw.bars.filter((x) => x.m === id)) {
        const bar = h("div", {
          class: `bar ${b.merged ? "merged" : ""} ${b.open ? "open" : ""}`,
          title: `${nameOf(id)} on step #${b.step}: ${dur(b.end - b.start)}${b.open ? " so far" : ""}${b.merged ? ", merged" : ""}`,
        }, `#${b.step}`);
        bar.style.left = pct(b.start);
        bar.style.width = width(b.start, b.end);
        track.append(bar);
      }
      for (const mk of tw.marks.filter((x) => x.m === id)) {
        const dot = h("div", { class: `mk ${mk.kind}`, title: `${mk.kind === "merge" ? "merged a step" : mk.kind} at +${dur(mk.ts - tw.t0)}` });
        dot.style.left = pct(mk.ts);
        track.append(dot);
      }
      tl.append(h("div", { class: "lane" },
        h("div", { class: "lane-who" }, avatar(m?.name || "?"), h("div", { class: "ln" }, h("b", {}, m?.name || "?"), h("i", {}, m?.model || (appName(m?.app) ? `via ${appName(m.app)}` : "AI not reported")))),
        track));
    }
    tl.append(
      h("div", { class: "axis" }, h("div", {}), tw.startAt
        ? h("div", {}, h("span", {}, tw.startAt > tw.t0 ? `−${dur(tw.startAt - tw.t0)} (planning)` : "start"), h("span", {}, "▏start"), h("span", {}, `+${dur(clock)}`))
        : h("div", {}, h("span", {}, "0:00"), h("span", {}, `+${dur(span / 2)}`), h("span", {}, `+${dur(span)}`))),
      h("div", { class: "tl-key" },
        h("span", {}, h("i", { class: "sw", style: "background:#F5D38B" }), "holding a step (claim → latest post)"),
        h("span", {}, h("i", { class: "sw", style: "background:#9ED7B0" }), "its post was merged"),
        h("span", {}, h("i", { class: "sw", style: "background:rgba(47,165,90,.18)" }), "2+ AIs working at once"),
        h("span", {}, h("i", { class: "mkk result" }), "result"),
        h("span", {}, h("i", { class: "mkk attempt" }), "attempt"),
        h("span", {}, h("i", { class: "mkk note" }), "note or question"),
        h("span", {}, h("i", { class: "mkk merge" }), "merge")));
    box.append(tl);

    // Relay: how each step moved between people and their AIs.
    const hop = (id, model, verb) => h("span", { class: "hop" }, avatar(nameOf(id)), h("em", {}, verb), nameOf(id), mdl(model || null));
    const arrow = () => h("span", { class: "arrow" }, "→");
    const relay = h("div", { class: "relay" });
    for (const st of [...state.steps].sort((a, b) => a.id - b.id)) {
      const chain = [];
      const p = tw.proposer[st.id];
      const t = tw.firstTaker[st.id];
      if (p) chain.push(hop(p.id, p.model, "proposed"));
      if (t) chain.push(hop(t.id, t.model, "took it"));
      for (const [mid, model] of tw.weighedIn[st.id] || []) chain.push(hop(mid, model, "weighed in"));
      if (st.merged_event && tw.postAuthor[st.merged_event]) {
        const a = tw.postAuthor[st.merged_event];
        if (!t || a.id !== t.id) chain.push(hop(a.id, a.model, "solved it"));
        const me = state.events.find((e) => e.type === "merged" && e.step_id === st.id);
        if (me) chain.push(hop(me.member_id, me.model, "merged"));
      }
      const title = h("span", {});
      title.textContent = st.title;
      relay.append(h("div", { class: "relay-row" },
        h("div", { class: "relay-head" }, h("span", { class: "sid" }, `#${st.id}`), title,
          p && t && p.id !== t.id && h("span", { class: "handoff" }, "handoff"),
          h("span", { class: `chip ${st.status}` }, st.status === "done" ? "merged" : st.status)),
        h("div", { class: "relay-chain" }, chain.flatMap((c, i) => (i ? [arrow(), c] : [c])))));
      math(title);
    }
    if (state.steps.length) box.append(relay);
    box.append(h("div", { class: "team-actions" },
      h("button", { class: "ghost", type: "button", onclick: breakdownSheet }, "Who did what, in numbers")));
    $("#team-meta").textContent = "from the room's record";
  }

  // Per person and per model, from the same events.
  function breakdownSheet() {
    const rows = new Map(state.members.map((m) => [m.id, { m, added: 0, claimed: 0, attempt: 0, result: 0, other: 0, merged: 0, merges: 0, models: new Set() }]));
    const byModel = new Map();
    const modelRow = (name) => byModel.get(name) || byModel.set(name, { name, people: new Set(), steps: 0, work: 0, merged: 0 }).get(name);
    const postBy = {};
    for (const e of state.events) {
      const r = rows.get(e.member_id);
      if (!r || !AI_WORK.includes(e.type)) continue;
      const ai = aiFor(e);
      if (e.type === "step_added") r.added++;
      if (e.type === "claimed") r.claimed++;
      if (e.type === "merged") r.merges++;
      if (e.type === "post") {
        postBy[e.id] = { m: e.member_id, ai };
        if (e.kind === "attempt") r.attempt++;
        else if (e.kind === "result") r.result++;
        else r.other++;
      }
      if (ai) {
        r.models.add(ai);
        const mr = modelRow(ai);
        mr.people.add(r.m.name);
        if (e.type === "step_added" || e.type === "claimed") mr.steps++;
        if (e.type === "post" && (e.kind === "attempt" || e.kind === "result")) mr.work++;
      }
    }
    for (const st of state.steps) {
      const p = st.merged_event && postBy[st.merged_event];
      if (!p) continue;
      rows.get(p.m).merged++;
      if (p.ai) modelRow(p.ai).merged++;
    }
    const people = [...rows.values()].filter((r) => r.added + r.claimed + r.attempt + r.result + r.other + r.merges);
    const n = (v) => h("td", { class: "n" }, String(v));
    openSheet(
      h("h3", {}, "Who did what"),
      h("p", { class: "hint" }, "Counted from the room's record. Each AI reports its own model name; the app comes from the connector it joined with. Merged posts are the work the host accepted."),
      h("table", { class: "who" },
        h("thead", {}, h("tr", {}, ["Person", "AI", "Added", "Claimed", "Attempts", "Results", "Notes", "Merged", "Merges done"].map((x) => h("th", {}, x)))),
        h("tbody", {}, people.map((r) => h("tr", {},
          h("td", {}, r.m.name, r.m.role === "owner" ? " ✳" : "", r.m.removed ? " (removed)" : ""),
          h("td", {}, r.models.size ? [...r.models].join(", ") : h("span", { class: "hint" }, "not reported"), appName(r.m.app) ? h("div", { class: "hint" }, `via ${appName(r.m.app)}`) : null),
          n(r.added), n(r.claimed), n(r.attempt), n(r.result), n(r.other), n(r.merged), n(r.merges))))),
      byModel.size
        ? h("table", { class: "who" },
            h("thead", {}, h("tr", {}, ["By model", "Used by", "Steps added or taken", "Attempts and results", "Merged"].map((x) => h("th", {}, x)))),
            h("tbody", {}, [...byModel.values()].map((r) => h("tr", {}, h("td", {}, r.name), h("td", {}, [...r.people].join(", ")), n(r.steps), n(r.work), n(r.merged)))))
        : h("p", { class: "hint" }, "No AI has reported its model yet."));
  }

  function bottomBar() {
    const right = $("#bb-right");
    right.textContent = "";
    const round = (label, title, onclick, cls = "round") => h("button", { class: cls, type: "button", title, "aria-label": title, onclick }, label);
    right.append(round("📜", "History", historySheet));
    if (isOwner()) {
      right.append(round("🔌", "Connect my AI", () => connectSheet(`${origin}/mcp/${roomId}/${key}`)));
      right.append(round("+", "Invite people", inviteSheet, "round plus"));
    } else if (mode === "join" && state.me) {
      right.append(round("🔗", "Copy watch link", () => copy(`${origin}/r/${roomId}`, "Watch link copied")));
      right.append(round("🔌", "Connect my AI", () => connectSheet(`${origin}/mcp/${roomId}/${key}`), "round plus"));
    } else {
      right.append(round("🔗", "Copy watch link", () => copy(`${origin}/r/${roomId}`, "Watch link copied")));
    }
  }

  function render() {
    const members = byId();
    const active = state.members.filter((m) => !m.removed);
    const lastBy = {};
    const did = new Set();
    for (const e of state.events) {
      lastBy[e.member_id] = e.ts;
      if (["post", "claimed", "step_added", "merged"].includes(e.type)) did.add(e.member_id);
    }
    const claimedBy = {};
    for (const s of state.steps) if (s.status === "claimed") claimedBy[s.claimed_by] = s.id;

    const person = (m, big) => {
      const speaking = Date.now() - (lastBy[m.id] || 0) < 90_000 && did.has(m.id);
      return h("div", { class: `person ${speaking ? "speaking" : ""}` },
        avatar(m.name),
        h("div", { class: "pname" }, m.role === "owner" && h("span", { class: "star", title: "host" }, "✳"), h("span", { class: "nm" }, m.name)),
        m.model && h("div", { class: "pmodel", title: appName(m.app) ? `${m.model} via ${appName(m.app)}` : m.model }, m.model),
        big && h("div", { class: "pstatus" }, claimedBy[m.id] ? `on step #${claimedBy[m.id]}` : speaking ? "speaking" : "listening"));
    };
    const stage = $("#stage");
    stage.textContent = "";
    const onStage = active.filter((m) => did.has(m.id) || m.role === "owner");
    const quiet = active.filter((m) => !onStage.includes(m));
    onStage.forEach((m) => stage.append(person(m, true)));
    $("#quiet").textContent = "";
    quiet.forEach((m) => $("#quiet").append(person(m, false)));
    $("#quiet-sec").hidden = !quiet.length;

    const board = $("#board");
    board.textContent = "";
    const posts = state.events.filter((e) => e.type === "post");
    const order = { claimed: 0, open: 1, done: 2 };
    const steps = [...state.steps].sort((a, b) => order[a.status] - order[b.status] || a.id - b.id);
    const postEl = (p, step) => {
      const merged = step && step.merged_event === p.id;
      return h("div", { class: `post ${merged ? "merged" : ""}` },
        avatar(nameOf(p.member_id)),
        h("div", { class: "bubble" },
          h("div", { class: "by" }, nameOf(p.member_id), mdl(aiFor(p)), h("span", { class: `kind ${p.kind}` }, p.kind), merged && h("span", {}, "✅ merged"), h("span", {}, ago(p.ts)),
            isOwner() && step && step.status !== "done" && h("button", {
              class: "merge-btn", type: "button",
              onclick: async () => {
                if (!confirm(`Merge step #${step.id} with this post?`)) return;
                try {
                  await api(`/api/r/${roomId}/merge`, { method: "POST", ...withKey, body: JSON.stringify({ step_id: step.id, post_id: p.id }) });
                  poll();
                } catch (x) { alert(x.message); }
              },
            }, "Merge")),
          text(p.body)));
    };
    for (const s of steps) {
      const title = h("span", { class: "st" });
      title.textContent = s.title;
      const card = h("div", { class: `step ${s.status}` },
        h("div", { class: "step-top" }, h("span", { class: "sid" }, `#${s.id}`), title,
          h("span", { class: `chip ${s.status}` },
            s.status === "claimed" ? `${who(s.claimed_by)} is on it` : s.status === "done" ? "merged" : "open")),
        s.detail && text(s.detail, "text detail"));
      posts.filter((p) => p.step_id === s.id).forEach((p) => card.append(postEl(p, s)));
      board.append(card);
    }
    const loose = posts.filter((p) => !p.step_id);
    if (loose.length) {
      const card = h("div", { class: "step" }, h("div", { class: "step-top" }, h("span", { class: "st" }, "Open floor")));
      loose.forEach((p) => card.append(postEl(p, null)));
      board.append(card);
    }
    if (!board.children.length) board.append(h("p", { class: "empty" }, "Quiet so far. The first agent to arrive will break the problem into steps."));
    math(board);
    $("#meta").textContent = `${state.steps.filter((s) => s.status === "done").length}/${state.steps.length} steps merged · ${posts.length} posts`;
    renderStart();
    renderTeam();
    bottomBar();
  }

  async function poll() {
    try {
      let changed = false;
      for (;;) {
        const d = await api(`/api/r/${roomId}/state?since=${state.last}`);
        if (!state.loaded) {
          $("#title").textContent = d.title;
          math($("#title"));
          document.title = `${d.title} · cuckulous`;
          state.brief = d.brief;
          $("#brief").textContent = d.brief;
          math($("#brief"));
          $("#hash").textContent = d.brief_hash.slice(0, 8);
          state.loaded = true;
          changed = true;
        }
        const startChanged = d.started !== state.started;
        state.started = d.started;
        state.startMode = d.start_mode;
        state.startedAt = d.started_at;
        const membersChanged = startChanged || JSON.stringify(d.members) !== JSON.stringify(state.members);
        const stepsChanged = JSON.stringify(d.steps) !== JSON.stringify(state.steps);
        state.members = d.members;
        state.steps = d.steps;
        if (d.events.length) {
          state.events.push(...d.events);
          state.last = d.events[d.events.length - 1].id;
        }
        changed = changed || membersChanged || stepsChanged || d.events.length > 0;
        if (d.events.length < 500) break;
      }
      if (changed) render();
    } catch (x) {
      $("#title").textContent = x.message;
    }
  }

  (async () => {
    $("#brief-btn").addEventListener("click", () => $("#brief-btn").classList.toggle("open"));
    if (mode === "admin" || mode === "join") {
      if (!key) {
        $("#over-text").textContent = "this link is missing its key";
      } else {
        try {
          state.me = await api(`/api/r/${roomId}/me`, withKey);
          if (mode === "admin" && state.me.role !== "owner") throw new Error("This link isn't the host's.");
          store.remember({ id: roomId, role: state.me.role === "owner" ? "owner" : "member", key });
          if (!store.name) store.name = state.me.name;
        } catch (x) {
          $("#over-text").textContent = x.message;
          state.me = null;
        }
      }
    } else {
      store.remember({ id: roomId, role: "watch" });
    }
    $("#over-text").textContent = state.me
      ? `cuckulous · ${state.me.role === "owner" ? "you host" : `you're in as ${state.me.name}`}`
      : $("#over-text").textContent === "room" ? "cuckulous · watching" : $("#over-text").textContent;
    if (!window.renderMathInElement) await new Promise((r) => window.addEventListener("load", r, { once: true }));
    await poll();
    bottomBar();
    // First visit to a join link: show how to connect right away.
    const seenKey = `cuck.seen.${roomId}`;
    if (mode === "join" && state.me && !localStorage.getItem(seenKey)) {
      localStorage.setItem(seenKey, "1");
      connectSheet(`${origin}/mcp/${roomId}/${key}`);
    }
    setInterval(poll, 3000);
    setInterval(() => state.loaded && render(), 30000);
  })();
})();
