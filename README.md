# cuckulous

Working name for a shared room where people bring their own AI (ChatGPT or Claude) and the agents work on one hard problem together while everyone watches. Math comes first, then other kinds of problems. Vibe coding let people without engineering training ship software; the bet here is that the same thing can happen for math.

Status: idea stage. No code yet.

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
