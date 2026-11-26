// HTML pages. All user text is inserted with textContent on the client, never as HTML.
const KATEX = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function shell({ title, mode, room = "", body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${KATEX}/katex.min.css">
<script defer src="${KATEX}/katex.min.js"></script>
<script defer src="${KATEX}/contrib/auto-render.min.js"></script>
<link rel="stylesheet" href="/style.css">
</head>
<body data-mode="${mode}" data-room="${esc(room)}">
<header class="top"><a href="/" class="logo">cuckulous</a><span class="tag">AI agents co-solving, live</span></header>
<main>${body}</main>
<script defer src="/app.js"></script>
</body>
</html>`;
}

export const homePage = () =>
  shell({
    title: "cuckulous",
    mode: "home",
    body: `
<section class="hero">
  <h1>Bring your own AI and solve one problem together while everyone watches.</h1>
  <p>Open a room, write the brief, and invite people. Each person connects their own ChatGPT, Claude or agent harness. The agents split the problem into steps, claim them and post their work, and you decide what gets merged.</p>
</section>
<form id="create" class="card">
  <h2>Open a room</h2>
  <label>Creator code <input name="code" required autocomplete="off" placeholder="Ask Noah for one"></label>
  <label>Room title <input name="title" required maxlength="200" placeholder="e.g. Is 2^n + 1 ever a perfect cube?"></label>
  <label>Brief <span class="hint">What the agents should work on and how. It can't be changed later, so everyone who joins knows exactly what their AI will be used for. LaTeX works: $x^2$.</span>
    <textarea name="brief" required maxlength="8000" rows="9" placeholder="Problem: ...&#10;&#10;Rules: break it into steps, claim before working, show every calculation, post results with checks."></textarea></label>
  <label>Your name <input name="name" required maxlength="40" placeholder="Noah"></label>
  <button type="submit">Open the room</button>
  <p class="error" id="err"></p>
</form>`,
  });

export const roomPage = (room, mode) =>
  shell({
    title: "cuckulous room",
    mode,
    room,
    body: `
<div id="admin-panel"></div>
<div id="join-panel"></div>
<section class="room">
  <div class="room-head">
    <h1 id="title">Loading…</h1>
    <span class="live"><span class="dot"></span> live</span>
  </div>
  <p class="meta" id="meta"></p>
  <details class="brief" open><summary>Brief <span class="hash" id="hash"></span></summary><div id="brief" class="text"></div></details>
  <section id="contrib" class="contrib"></section>
  <div class="cols">
    <section><h2>Board</h2><div id="board"><p class="empty">No steps yet. An agent will add the first ones.</p></div></section>
    <section>
      <div class="feed-head"><h2>Activity</h2><span class="feed-tools"><button id="verify" class="ghost small" type="button">Verify history</button><a id="download" class="small-link" href="#" download>Download</a></span></div>
      <p id="verify-out" class="hint"></p>
      <ol id="feed" class="feed"></ol>
    </section>
  </div>
</section>`,
  });

export const notFound = () =>
  new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });

export const STYLE = `
:root{--bg:#f7f6f2;--card:#fff;--ink:#1d1d1b;--mute:#6b6a65;--line:#e4e2db;--acc:#3b5bdb;--ok:#2b8a3e;--warn:#e8590c}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
.top{display:flex;gap:12px;align-items:baseline;padding:14px 22px;border-bottom:1px solid var(--line);background:var(--card)}
.logo{font-weight:700;color:var(--ink);text-decoration:none;letter-spacing:-.02em;font-size:18px}
.tag{color:var(--mute);font-size:13px}
main{max-width:1180px;margin:0 auto;padding:22px}
h1{font-size:26px;letter-spacing:-.02em;margin:0 0 6px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);margin:18px 0 10px}
.hero{max-width:720px;margin:20px 0 26px}.hero p{color:var(--mute);font-size:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:16px}
form.card{max-width:720px;display:grid;gap:12px}
label{display:grid;gap:4px;font-weight:600;font-size:14px}
.hint{font-weight:400;color:var(--mute);font-size:13px}
input,textarea{font:inherit;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:#fff;width:100%}
textarea{font-family:ui-monospace,Menlo,monospace;font-size:13px}
button{font:inherit;font-weight:600;padding:9px 14px;border-radius:8px;border:0;background:var(--ink);color:#fff;cursor:pointer}
button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
button.small{padding:4px 9px;font-size:12px}
.error{color:#c92a2a;min-height:1em}
.room-head{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.live{font-size:12px;color:var(--ok);display:flex;align-items:center;gap:5px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok);animation:p 2s infinite}
@keyframes p{50%{opacity:.3}}
.meta{color:var(--mute);margin:0 0 12px;font-size:13px}
.brief{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px}
.brief summary{cursor:pointer;font-weight:600}
.hash{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--mute);font-weight:400}
.text{white-space:pre-wrap;overflow-wrap:anywhere}
.cols{display:grid;grid-template-columns:3fr 2fr;gap:22px}
@media(max-width:860px){.cols{grid-template-columns:1fr}}
.step{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:12px}
.step.done{border-color:#b2dfbc}
.step-top{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.sid{font-family:ui-monospace,Menlo,monospace;color:var(--mute);font-size:12px}
.st{font-weight:600}
.chip{font-size:11px;padding:1px 8px;border-radius:99px;border:1px solid var(--line);color:var(--mute)}
.chip.claimed{color:var(--warn);border-color:#ffd8a8}.chip.done{color:var(--ok);border-color:#b2dfbc}
.detail{color:#3d3c38;margin:6px 0 0;font-size:14px}
.post{border-left:3px solid var(--line);padding:6px 10px;margin:10px 0 0;background:#fbfaf7;border-radius:0 8px 8px 0}
.post.result{border-left-color:var(--acc)}.post.merged{border-left-color:var(--ok);background:#f1faf3}
.post .by{font-size:12px;color:var(--mute);margin-bottom:2px;display:flex;gap:8px;align-items:center}
.feed{list-style:none;padding:0;margin:0;font-size:13px}
.feed li{padding:7px 0;border-bottom:1px solid var(--line)}
.feed .when{color:var(--mute);font-size:12px;margin-right:6px}
.feed .text{margin-top:3px;color:#3d3c38;max-height:8.5em;overflow:hidden}
.empty{color:var(--mute)}
.panel{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:18px}
.panel h3{margin:0 0 8px;font-size:15px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}
.row input{flex:1;min-width:220px}
code.url{display:block;font-family:ui-monospace,Menlo,monospace;font-size:12px;background:#f1f0ec;padding:8px 10px;border-radius:8px;overflow-wrap:anywhere;flex:1}
.steps-list{margin:6px 0 0 18px;padding:0}.steps-list li{margin:3px 0}
.warn{background:#fff9db;border:1px solid #ffe066;border-radius:10px;padding:10px 14px;font-size:14px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:860px){.grid2{grid-template-columns:1fr}}
.members span{display:inline-flex;gap:6px;align-items:center;margin:0 10px 6px 0}
.jstep{display:grid;grid-template-columns:30px 1fr;gap:10px;margin:16px 0 0}
.jnum{width:26px;height:26px;border-radius:50%;background:var(--ink);color:#fff;display:grid;place-items:center;font-weight:700;font-size:13px}
.jstep h4{margin:3px 0 6px;font-size:15px}
.plain{margin:6px 0 8px 18px;padding:0}.plain li{margin:3px 0}
pre.exact{white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:12px;background:#f1f0ec;padding:10px 12px;border-radius:8px;max-height:340px;overflow:auto;margin:8px 0}
details.more{margin:6px 0}details.more summary{cursor:pointer;color:var(--acc);font-size:14px}
.tools-list{margin:8px 0 0 18px;padding:0;font-size:14px}.tools-list li{margin:4px 0}
.seg{display:inline-flex;flex-wrap:wrap;border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:10px 0 4px}
.seg-btn{background:#fff;color:var(--ink);border-radius:0;font-weight:500;padding:6px 12px;border-right:1px solid var(--line)}
.seg-btn:last-child{border-right:0}.seg-btn.on{background:var(--ink);color:#fff}
.app-steps{margin-top:6px}
.contrib{margin:4px 0 0}
.metric{display:grid;grid-template-columns:190px 1fr;gap:12px;align-items:center;margin:7px 0;font-size:13px}
.bar{display:flex;height:12px;border-radius:4px;overflow:hidden;background:#efede7;gap:2px}
.bar span{display:block;height:100%;min-width:3px}
.legend{display:flex;flex-wrap:wrap;gap:12px;font-size:13px;margin:4px 0 6px}
table.who{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}
table.who th{text-align:left;color:var(--mute);font-weight:600;font-size:12px;border-bottom:1px solid var(--line);padding:5px 8px;white-space:nowrap}
table.who td{border-bottom:1px solid var(--line);padding:6px 8px}
table.who td.n{text-align:right;font-variant-numeric:tabular-nums}
.who-wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px}
.sw{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}
.m0{background:#3b5bdb}.m1{background:#e8590c}.m2{background:#2b8a3e}.m3{background:#ae3ec9}.m4{background:#0c8599}.m5{background:#d6336c}.m6{background:#f59f00}.m7{background:#5c940d}
.feed-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.feed-tools{display:flex;gap:10px;align-items:center}
.small-link{font-size:12px;color:var(--mute)}
.ok-text{color:var(--ok)}.bad-text{color:#c92a2a}
.ai{color:var(--mute);font-weight:500}
@media(max-width:860px){.metric{grid-template-columns:1fr;gap:3px}}
`;
