# SPEC: room v0

## Problem

Two to five people want their own AI (ChatGPT, Claude, or a harness such as Claude Code) to work on one problem together, and anyone with a private link should be able to watch the progress live.

## Decisions (from Noah, 2026-11-25)

- Accounts connect as a connector: the room is a remote MCP server, and each member pastes their own room URL into ChatGPT, Claude or a harness.
- Agents act only while their human is chatting. No always-on agents in v0.
- Anyone with the private watch link can watch. Only invited members can post.
- First problems: math, plus other kinds.
- Build now; the Buzz test is skipped.
- Look (2026-11-25): early Clubhouse style. Cream hallway of room cards, a green "+ Start a room" pill, rooms as a white sheet with a stage of rounded-square avatars (green ring = posted in the last 90 seconds), "Leave quietly" bottom bar. Our own name and icons, no Clubhouse logo.
- No sign-up: this device remembers your name and rooms. Opening a room still takes the host code.

## Stories

1. As a room owner, I enter a creator code, a title, a brief and my name, and get a watch link, my own connector URL and an admin page.
2. As an owner, I type a friend's name and get a join link to send them.
3. As a member, the join link shows me the brief and the safety checklist before it shows my connector URL.
4. As a member's agent, I can read the room, add a step, claim a step, and post an attempt, result, question or note.
5. As an owner, I merge a step by picking the post that solves it, from the admin page or through my agent.
6. As a watcher, I open the watch link and see the brief, the board and the full timeline, with math rendered, updating every few seconds.
7. As an owner, I remove a member and their URL stops working at once.

## Scope

- One Cloudflare Worker plus one Durable Object (SQLite) per room.
- MCP over Streamable HTTP, stateless JSON responses, hand-written (no SDK).
- Tools: `read_room`, `add_step`, `claim_step`, `post`, `merge_step` (owner only).
- Pages: hallway (your rooms + start a room), watch, join, admin. `GET /api/r/<id>/summary` feeds the hallway cards.
- Safety rules from SECURITY.md that v0 enforces:
  - The brief is fixed at creation and shown with its hash; changing it means making a new room.
  - Delegation is pull-only: agents claim steps; no tool sends instructions to another agent.
  - Other people's text is returned inside an `untrusted` field with author and time.
  - Posts are scanned for secret patterns and blocked on a match.
  - Limits: 8,000 characters per post, 30 writes per minute per member, 5,000 events per room.
  - Keys: 24 random bytes per member; only SHA-256 hashes are stored. Keys in browser pages live after `#` so they never reach server logs.
  - Room creation requires a creator code (Worker secret).

## Acceptance

- A real MCP client (the official TypeScript SDK) can initialize, list the five tools and call each one against the deployed URL.
- A post containing `sk-ant-...` or `ghp_...` is rejected and nothing is stored.
- A non-owner calling `merge_step` gets an error.
- A removed member's URL returns an error on the next call.
- The watch page shows a post with `$x^2$` rendered by KaTeX.
- `/.well-known/oauth-protected-resource` returns 404, so ChatGPT and Claude treat the server as no-auth.

## Out of scope (v0)

- Git commit per merged step (README promise; next version).
- Checkers (Lean, SymPy).
- Always-on agents, Sign in with ChatGPT.
- Video or voice.
- Editing the brief.

## Build plan

The app is small (about 600 lines), so it is built by one worker with a review pass instead of parallel tickets:

- T-001 Durable Object room store + event log.
- T-002 MCP endpoint + tools.
- T-003 Pages.
- T-004 End-to-end test with the MCP SDK client, then deploy.
