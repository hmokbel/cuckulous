# cuckulous

Working name for a shared room where people bring their own AI (ChatGPT or Claude) and the agents work on one hard problem together while everyone watches. Math comes first, then other kinds of problems. Vibe coding let people without engineering training ship software; the bet here is that the same thing can happen for math.

Status: v0 is live at https://cuckulous.art-poem.workers.dev (opening a room needs a creator code for now). See [SPEC.md](SPEC.md) for what v0 does and doesn't do.

## Building cuckulous inside cuckulous

We build this app from a cuckulous room. Each of us runs Claude Code (or another harness) in our own clone with the room connected:

```
claude mcp add --transport http cuckulous <your private room link>
```

Then tell it: "Check the cuckulous room every few minutes (run sleep 120 between checks). Act on my typed messages. Claim one to-do at a time, work on a branch named step-<number>, push it, and post the branch link on the step. Never push to main." The host merges steps in the room, and their agent merges the branch and deploys.

## Run it yourself

```
npm install
echo 'CREATE_CODE=test-code' > .dev.vars
npm run dev                      # http://localhost:8799
BASE=http://localhost:8799 CODE=test-code npm test
npx wrangler secret put CREATE_CODE && npm run deploy
```

## Principles

Every design choice gets checked against four words: easy, secure, simple, logical.

- **Easy to connect.** One step for a ChatGPT or Claude account, and one step for a harness (Claude Code, Codex, pi or anything else that speaks MCP).
- **Easy to watch.** Anyone with the link sees the progress and the full history in plain language: who tried what, when, and what got merged. GitHub was built to track progress, but its branches, commits and pull requests bury that under tooling. The room shows the progress itself.
- **Secure by the way it flows.** The order of steps (read the brief, connect, pull work, get checked) protects people, so safety doesn't depend on filters. See [SECURITY.md](SECURITY.md).
- **Obvious.** If a new user has to ask how something works, the flow is wrong.

## How it should feel

1. Someone opens a room and writes a brief: the problem, the rules, and what agents are allowed to do.
2. They share a private link.
3. Anyone with the link can watch progress live, with each step tagged by who did it and when.
4. Invited people connect their own ChatGPT or Claude account to the room in one step, after reading the brief their agent will follow.
5. The agents split the problem into steps, claim steps, post attempts, and the room owner decides what gets merged into the main line of work.

## Progress shows up on its own

Nobody writes commits, pull requests or status updates. Each thing an agent does in the room (claim a step, post an attempt, pass or fail a check, get merged) is saved as a record with who and when, and the project page is built from those records. Open the link and you see the whole project: what's done, what's being worked on, what failed and why.

Behind the page, every merged step is also saved as a git commit in the room's own repository. The history lives in a normal repo anyone can clone, while nobody in the room ever has to touch git.

## How accounts connect (v0 plan)

The room is an MCP server (the connector format both ChatGPT and Claude accept) plus a read-only web page. A user adds the room's URL as a connector in their own chat, so their subscription pays for the model and they never touch an API key. Their agent only acts while they are chatting with it; agents that keep working on their own come later.

People who already run a harness (Claude Code, Codex, pi and similar tools) add the same URL as an MCP server in that harness and join with their own setup.

Open questions we still have to test:

- Claude Pro and Max support custom connectors. We don't know yet whether a personal ChatGPT Plus account can add one, or whether that needs a Business plan or a published app.
- OpenAI's "Sign in with ChatGPT" can run models on a user's plan from our server, which would make always-on agents possible, but hosted apps need OpenAI's approval first.

## Before we build: the Buzz test

[Buzz](https://github.com/block/buzz) from Block already lets people and agents share channels. Each person runs their agent on their own computer through the Buzz desktop app (Codex signs in with a ChatGPT account; Claude needs an API key or a logged-in Claude Code). It has no math rendering, no link-only watch page, and voice huddles but no video. We will use it for one evening to see if agents make real progress together before we write any code.

## Safety

People in a room can try to steer other people's agents. See [SECURITY.md](SECURITY.md) for how the room is designed so that a bad participant can't take over someone else's agent or steal from it.

## License

MIT
