# daily_newsletter

A secondary brain. It reads what you actually ask AI assistants about, builds a
decaying map of your interests from it, and uses that map to assemble a short
daily briefing on AI models, agent harnesses, agent design, and adjacent CS/ECE.

Everything runs locally. Nothing is published anywhere.

```
  ~/.claude/projects/*.jsonl
            |
       [ capture ]      your prompts only -- tool results are excluded
            |
       [ extract ]      Claude reads each prompt and names the knowledge topic
            |
      INTEREST MAP      topics + weights that decay + session co-occurrence edges
            |
       [ gather  ]      arXiv, Hacker News, GitHub releases, official blog RSS
            |
       [ curate  ]      Claude picks and writes up the items that fit the map
            |
        DASHBOARD       localhost:4317
```

## Setup

```bash
npm install
```

No API key required. The app shells out to your local `claude` CLI, which uses
your existing Claude Code login. If you would rather use the Anthropic API, set
`ANTHROPIC_API_KEY` and it switches automatically. See `.env.example`.

## Daily use

```bash
npm run ingest    # read new prompts, update the interest map
npm run digest    # build today's briefing
npm run serve     # read it at http://localhost:4317
```

`serve` alone is enough day to day -- the dashboard has **Sync brain** and
**New briefing** buttons that run the same two pipelines.

## The interest map

Each topic carries a weight that is the sum of its mentions, where a mention
`d` days old counts `0.5 ^ (d / 21)`. So the map **forgets**: a subject you
drilled into last week outranks one you asked about twice two months ago. Change
the half-life with `DN_HALF_LIFE_DAYS`.

Extraction is deliberately strict. Most prompts are chores -- "pull the repo",
"fix this typo" -- and produce no topic at all; on the first run here, 92 of 135
prompts correctly yielded nothing. A wrong topic pollutes the map permanently,
while a missed one costs nothing.

Edges connect topics that appeared in the same **session**, not the same prompt.
Since extraction usually returns at most one topic per prompt, per-prompt
co-occurrence would leave the map as disconnected dots.

### Steering it

The map only learns interests you actually bring to an AI. For anything else,
plant it by hand -- seeded topics are pinned, so they steer digests immediately
regardless of weight.

```bash
npx tsx src/cli.ts add "Mechanistic interpretability" technique
npx tsx src/cli.ts topics          # show the map
npx tsx src/cli.ts pin <topic-id>  # always include
npx tsx src/cli.ts mute <topic-id> # never include
```

Kinds: `model`, `agent`, `harness`, `technique`, `infra`, `adjacent`.
You can also pin and mute by clicking a node on the map.

## The briefing

Every item is one of five kinds, and the editor aims for a spread rather than a
wall of arXiv links:

| kind | what it is |
| --- | --- |
| `concept` | something you keep circling but probably have not nailed down. Written from scratch, no source link |
| `new-research` | a recent paper that advances a live topic |
| `announcement` | a release or launch you should not miss |
| `foundational` | older canonical work, surfaced once per topic when it first gets hot |
| `adjacent` | the CS/ECE item worth your time |

Each item carries a **Why you** line tying it to your specific live topics. That
line is the entire point of the briefing.

Foundational items are ranked by relevance rather than recency, and their
shortlist slots are reserved -- otherwise the recency term buries every landmark
paper before the editor ever sees one.

## Sources

arXiv, Hacker News, GitHub releases for ten watched repos, and RSS from
Anthropic, OpenAI, Google Research, DeepMind, Simon Willison, BAIR, Hugging
Face, and IEEE Spectrum. Edit `WATCHED_REPOS` and `FEEDS` in
`src/digest/sources.ts`.

**On "social media announcements":** X/Twitter has no free API, so it is not a
source. Launches that matter reliably show up in the GitHub releases, official
blog RSS, and Hacker News sweeps within a day.

## Capture sources

Claude Code transcripts are the only capture source implemented, because they
are the only one that needs no setup -- the `.jsonl` files are already on disk.

Neither ChatGPT nor Claude on the web exposes your conversations through an API.
Covering those means either importing an official data export, or a browser
extension that captures your prompts client-side. Both fit behind the same
`prompts` table; see `src/capture/claudeCode.ts` for the shape any new capture
source needs to produce.

## Layout

```
src/
  config.ts              tunables, all overridable by env
  db.ts                  node:sqlite schema (no native deps)
  llm.ts                 claude CLI / Anthropic API adapter, with JSON repair
  capture/claudeCode.ts  transcript scanner
  brain/extract.ts       prompts -> topics
  brain/graph.ts         weights, decay, edges, pin/mute
  digest/sources.ts      arXiv, HN, GitHub, RSS
  digest/curate.ts       shortlist -> written briefing
  server.ts              JSON API + static dashboard
  web/                   dashboard (no framework, no build step)
  cli.ts
data/                    brain.db lives here, gitignored
```

## Privacy

`data/brain.db` contains verbatim prompts you typed to Claude Code. It is
gitignored. Do not commit it.

The dashboard binds `127.0.0.1` and serves your raw prompts over an API with **no
authentication**. That binding is the only thing protecting them, so `DN_HOST`
should stay at its default unless the app is behind a private network such as
Tailscale, or a reverse proxy that authenticates. This is not a service to put on
a public server; see the root `README.md` for how to run it on a schedule
locally and publish only the finished briefings.
