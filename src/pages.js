// HTML shells. All user text is inserted with textContent on the client, never as HTML.
const KATEX = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist";
const FONT = "https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function shell({ title, mode, room = "", body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#F2EFE4">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${FONT}">
<link rel="stylesheet" href="${KATEX}/katex.min.css">
<script defer src="${KATEX}/katex.min.js"></script>
<script defer src="${KATEX}/contrib/auto-render.min.js"></script>
<link rel="stylesheet" href="/style.css">
</head>
<body data-mode="${mode}" data-room="${esc(room)}">
<div class="app">${body}</div>
<div id="sheet-root"></div>
<script defer src="/app.js"></script>
</body>
</html>`;
}

const ICON = {
  search: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.5-4.5"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>`,
  cal: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>`,
};

export const homePage = () =>
  shell({
    title: "cuckulous",
    mode: "home",
    body: `
<header class="topbar">
  <span class="icon-btn" aria-hidden="true">${ICON.search}</span>
  <span class="wordmark">cuckulous</span>
  <div class="top-right">
    <span class="icon-btn" aria-hidden="true">${ICON.cal}</span>
    <span class="icon-btn" aria-hidden="true">${ICON.bell}</span>
    <button class="me" id="me" type="button" title="Your name"></button>
  </div>
</header>
<main class="hallway">
  <p class="greeting" id="greeting"></p>
  <div id="rooms"></div>
</main>
<button class="fab" id="start" type="button"><span>+</span> Start a room</button>`,
  });

export const roomPage = (room, mode) =>
  shell({
    title: "cuckulous room",
    mode,
    room,
    body: `
<header class="roombar">
  <a href="/" class="back">⌄ Hallway</a>
  <span class="live-pill"><span class="dot"></span> live</span>
</header>
<main class="roomsheet">
  <p class="over" id="over"><span class="house"></span><span id="over-text">room</span></p>
  <h1 class="rtitle" id="title">Loading…</h1>
  <button class="brief" id="brief-btn" type="button">
    <span class="pin">📌</span>
    <span class="brief-text" id="brief"></span>
    <span class="hash" id="hash"></span>
  </button>
  <section>
    <h2 class="sec">On stage</h2>
    <div class="stage" id="stage"></div>
  </section>
  <section id="quiet-sec" hidden>
    <h2 class="sec">In the room</h2>
    <div class="stage small" id="quiet"></div>
  </section>
  <section>
    <h2 class="sec">The floor <span class="sec-meta" id="meta"></span></h2>
    <div id="board"></div>
  </section>
</main>
<footer class="bottombar">
  <a href="/" class="leave">✌️ Leave quietly</a>
  <div class="bb-right" id="bb-right"></div>
</footer>`,
  });

export const notFound = () =>
  new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });

export const STYLE = `
:root{
  --hall:#F2EFE4;--card:#FFFFFF;--card2:#FBF9F1;--press:#EAE6D8;--line:#E3DFD1;
  --ink:#141414;--ink2:#3B3A36;--mute:#8A877C;
  --green:#2FA55A;--green-d:#25894A;--halo:rgba(47,165,90,.22);
  --red:#D8463C;--gold:#E9C46A;--blue:#5B7FD6;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--hall);color:var(--ink)}
body{font:16px/1.45 Nunito,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0}
a{color:inherit}
.app{max-width:620px;margin:0 auto;min-height:100vh;position:relative}
[hidden]{display:none!important}

/* hallway */
.topbar{position:sticky;top:0;z-index:5;background:var(--hall);display:flex;align-items:center;gap:10px;padding:14px 18px 10px}
.wordmark{font-weight:900;font-size:21px;letter-spacing:-.02em}
.top-right{margin-left:auto;display:flex;align-items:center;gap:6px}
.icon-btn{display:inline-flex;width:38px;height:38px;align-items:center;justify-content:center;color:var(--ink);opacity:.85}
.me{width:38px;height:38px;border-radius:38%;font-weight:800;font-size:15px;color:#fff;display:inline-flex;align-items:center;justify-content:center}
.hallway{padding:4px 14px 130px}
.greeting{color:var(--mute);font-weight:700;font-size:14px;margin:4px 6px 12px}
.hcard{display:block;text-decoration:none;background:var(--card);border-radius:22px;padding:16px 18px 14px;margin:0 0 12px;box-shadow:0 1px 0 rgba(0,0,0,.04);transition:transform .08s}
.hcard:active{transform:scale(.985);background:var(--card2)}
.over{display:flex;align-items:center;gap:6px;margin:0;font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--mute)}
.house{width:12px;height:12px;background:var(--green);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 3 2 11h3v10h5v-6h4v6h5V11h3z'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 3 2 11h3v10h5v-6h4v6h5V11h3z'/%3E%3C/svg%3E") center/contain no-repeat}
.htitle{font-weight:800;font-size:18px;line-height:1.3;margin:6px 0 12px;color:var(--ink)}
.hbody{display:flex;gap:16px;align-items:flex-start}
.stack{position:relative;width:66px;height:62px;flex:none}
.stack .av{position:absolute;width:44px;height:44px;font-size:15px;border:3px solid var(--card)}
.stack .av:nth-child(1){left:0;top:0}
.stack .av:nth-child(2){left:22px;top:18px}
.names{list-style:none;margin:0;padding:0;font-weight:700;font-size:15px;color:var(--ink2)}
.names li{display:flex;align-items:center;gap:6px;line-height:1.55}
.bub{font-size:12px;opacity:.8}
.counts{margin-top:4px;font-size:13px;font-weight:700;color:var(--mute);display:flex;gap:10px;align-items:center}
.counts .live{color:var(--green)}
.empty-hall{text-align:center;color:var(--mute);font-weight:700;padding:60px 30px}
.empty-hall .big{font-size:44px;margin-bottom:6px}
.fab{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:20;background:var(--green);color:#fff;font-weight:800;font-size:17px;padding:14px 26px;border-radius:999px;box-shadow:0 8px 24px rgba(47,165,90,.35);display:flex;align-items:center;gap:8px}
.fab span{font-size:22px;line-height:1;margin-top:-2px}
.fab:active{background:var(--green-d)}

/* avatars */
.av{border-radius:38%;display:inline-flex;align-items:center;justify-content:center;font-weight:800;color:#fff;letter-spacing:-.02em;user-select:none;position:relative}
.g0{background:linear-gradient(135deg,#F7B9A1,#E88A6E)}
.g1{background:linear-gradient(135deg,#B5D3A7,#7FAF6C)}
.g2{background:linear-gradient(135deg,#C9B8EE,#9A83D8)}
.g3{background:linear-gradient(135deg,#F6A5A8,#E2707A)}
.g4{background:linear-gradient(135deg,#A9CFF0,#6FA6DA)}
.g5{background:linear-gradient(135deg,#F5D38B,#E3AE49)}

/* room */
.roombar{display:flex;align-items:center;justify-content:space-between;padding:14px 20px 12px}
.back{text-decoration:none;font-weight:800;font-size:16px}
.live-pill{display:inline-flex;align-items:center;gap:6px;font-weight:800;font-size:13px;color:var(--green)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--green);animation:blink 2s infinite}
@keyframes blink{50%{opacity:.3}}
.roomsheet{background:var(--card);border-radius:30px 30px 0 0;min-height:calc(100vh - 56px);padding:22px 20px 130px}
.rtitle{font-weight:900;font-size:24px;line-height:1.25;margin:6px 0 14px;letter-spacing:-.01em}
.brief{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;background:var(--hall);border-radius:16px;padding:12px 14px;margin-bottom:8px}
.brief .pin{flex:none}
.brief-text{flex:1;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;color:var(--ink2);max-height:4.4em;overflow:hidden;position:relative}
.brief.open .brief-text{max-height:none}
.hash{flex:none;font-size:11px;font-weight:700;color:var(--mute);font-family:ui-monospace,Menlo,monospace}
.sec{font-size:14px;font-weight:800;color:var(--mute);margin:22px 2px 12px;display:flex;gap:8px;align-items:baseline}
.sec-meta{font-weight:700;font-size:12px}
.stage{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:16px 10px}
.person{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;min-width:0}
.person .av{width:74px;height:74px;font-size:24px;transition:box-shadow .3s}
.stage.small .person .av{width:54px;height:54px;font-size:18px}
.person.speaking .av{box-shadow:0 0 0 3px #fff,0 0 0 6px var(--green);animation:halo 1.6s ease-in-out infinite}
@keyframes halo{0%,100%{box-shadow:0 0 0 3px #fff,0 0 0 6px var(--green),0 0 0 6px var(--halo)}50%{box-shadow:0 0 0 3px #fff,0 0 0 6px var(--green),0 0 0 14px var(--halo)}}
.pname{font-weight:800;font-size:14px;display:flex;align-items:center;gap:4px;max-width:100%}
.pname .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.star{flex:none;width:16px;height:16px;border-radius:50%;background:var(--green);color:#fff;font-size:10px;display:inline-flex;align-items:center;justify-content:center;font-weight:900}
.pstatus{font-size:12px;font-weight:700;color:var(--mute);margin-top:-4px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty-stage{color:var(--mute);font-weight:700;font-size:14px;grid-column:1/-1}

/* the floor */
.step{background:var(--card2);border-radius:20px;padding:14px 16px;margin-bottom:12px;border:1.5px solid transparent}
.step.done{border-color:#BFE3CB;background:#F3FAF5}
.step-top{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.sid{font-weight:800;color:var(--mute);font-size:13px}
.st{font-weight:800;font-size:16px}
.chip{font-size:12px;font-weight:800;padding:2px 10px;border-radius:99px;background:var(--hall);color:var(--mute)}
.chip.claimed{background:#FFF1DC;color:#B26A00}
.chip.done{background:#DDF3E5;color:var(--green-d)}
.detail{color:var(--ink2);margin:6px 0 0;font-size:15px}
.text{white-space:pre-wrap;overflow-wrap:anywhere}
.post{display:flex;gap:10px;margin-top:12px}
.post .av{width:32px;height:32px;font-size:12px;flex:none}
.bubble{flex:1;min-width:0;background:var(--card);border-radius:4px 16px 16px 16px;padding:8px 12px;font-size:15px}
.post.merged .bubble{box-shadow:0 0 0 2px var(--green)}
.by{font-size:12px;font-weight:800;color:var(--mute);display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:2px}
.kind{padding:0 7px;border-radius:99px;background:var(--hall)}
.kind.result{background:#E3EBFB;color:var(--blue)}
.merge-btn{margin-left:auto;background:var(--green);color:#fff;font-weight:800;font-size:12px;padding:3px 10px;border-radius:99px}
.empty{color:var(--mute);font-weight:700}

/* bottom bar */
.bottombar{gap:10px;position:fixed;left:50%;transform:translateX(-50%);bottom:0;width:100%;max-width:620px;background:var(--card);border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:12px 16px calc(12px + env(safe-area-inset-bottom));z-index:10}
.leave{text-decoration:none;background:var(--hall);color:var(--red);font-weight:800;font-size:15px;padding:10px 16px;border-radius:999px;white-space:nowrap;flex:none}
.bb-right{display:flex;gap:8px;align-items:center}
.round{width:42px;height:42px;flex:none;border-radius:50%;background:var(--hall);display:inline-flex;align-items:center;justify-content:center;font-size:20px;position:relative}
.round.plus{background:var(--green);color:#fff;font-weight:900;font-size:26px;line-height:1}
.badge{position:absolute;top:-2px;right:-2px;background:var(--green);color:#fff;font-size:10px;font-weight:900;border-radius:99px;padding:1px 5px}

/* sheets */
.backdrop{position:fixed;inset:0;background:rgba(20,20,20,.38);z-index:40;animation:fade .15s}
@keyframes fade{from{opacity:0}}
.sheet{position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:100%;max-width:620px;max-height:88vh;overflow:auto;background:var(--card);border-radius:30px 30px 0 0;padding:10px 22px calc(26px + env(safe-area-inset-bottom));z-index:41;animation:up .2s ease-out}
@keyframes up{from{transform:translate(-50%,40px);opacity:.4}}
.handle{width:40px;height:5px;border-radius:99px;background:var(--line);margin:0 auto 14px}
.sheet h3{font-weight:900;font-size:20px;margin:4px 0 6px}
.sheet p{margin:8px 0;color:var(--ink2)}
.sheet label{display:grid;gap:5px;font-weight:800;font-size:14px;margin:12px 0}
.hint{font-weight:600;color:var(--mute);font-size:13px}
.sheet input,.sheet textarea{font:inherit;font-weight:600;padding:12px 14px;border:0;border-radius:14px;background:var(--hall);width:100%;outline:none}
.sheet textarea{font-size:15px;resize:vertical}
.sheet input:focus,.sheet textarea:focus{box-shadow:0 0 0 2px var(--green)}
.go{width:100%;background:var(--green);color:#fff;font-weight:800;font-size:17px;padding:14px;border-radius:999px;margin-top:8px}
.go:disabled{opacity:.5}
.error{color:var(--red);font-weight:700;min-height:1em}
.row{display:flex;gap:8px;align-items:center;margin:8px 0}
code.url{display:block;flex:1;min-width:0;font-family:ui-monospace,Menlo,monospace;font-size:12px;background:var(--hall);padding:10px 12px;border-radius:12px;overflow-wrap:anywhere}
.copy{background:var(--ink);color:#fff;font-weight:800;font-size:13px;padding:8px 14px;border-radius:999px;flex:none}
.warn{background:#FFF6DD;border-radius:14px;padding:12px 14px;font-size:14px;font-weight:600}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 6px}
.tab{background:var(--hall);font-weight:800;font-size:14px;padding:7px 14px;border-radius:999px}
.tab.on{background:var(--ink);color:#fff}
.steps-list{margin:6px 0 0 20px;padding:0;font-weight:600}
.steps-list li{margin:4px 0}
.mrow{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}
.mrow .av{width:36px;height:36px;font-size:13px}
.mrow .nm{font-weight:800;flex:1}
.ghost{background:var(--hall);font-weight:800;font-size:13px;padding:6px 12px;border-radius:999px}
.feed{list-style:none;padding:0;margin:0}
.feed li{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px}
.feed .av{width:30px;height:30px;font-size:11px;flex:none}
.feed .when{color:var(--mute);font-weight:700;font-size:12px}
.feed .ftext{margin-top:3px;color:var(--ink2);max-height:7em;overflow:hidden}
.toast{position:fixed;left:50%;top:18px;transform:translateX(-50%);background:var(--ink);color:#fff;font-weight:800;padding:9px 18px;border-radius:999px;z-index:60;font-size:14px}
`;
