# personal_website

Two halves that share one privacy boundary.

```
personal_website/
├── daily_newsletter/   PRIVATE. Runs on your machine only.
│                       Reads your Claude Code prompts, builds an interest map,
│                       assembles daily briefings. Never deployed.
│
└── site/               PUBLIC. Static Astro site, deployed to Vercel.
                        Renders the finished briefings and everything you write.
```

## The privacy boundary

The brain knows things about you that the site must never publish: your verbatim
prompts, which sessions they came from, topic weights, the interest graph, and
which items you reacted to.

Exactly one thing crosses over: `npm run publish` in `daily_newsletter/` writes
finished briefing items to `site/src/data/briefings.json`. That file carries nine
fields per item — kind, topic label, title, url, source, summary, why, published
date, id — and nothing else.

The boundary is the `PublicItem` interface in
`daily_newsletter/src/digest/publish.ts`. **Adding a field to that interface is a
decision to publish it.** `data/brain.db`, which holds the raw prompts, is
gitignored at both the subproject and repository level.

## Workflow

```bash
# 1. Update the brain and build a briefing (in daily_newsletter/)
cd daily_newsletter
npm run ingest       # read new prompts, update the interest map
npm run digest       # assemble today's briefing
npm run serve        # read it privately at localhost:4317, with the interest map

# 2. Publish it (still in daily_newsletter/)
npm run publish      # export items -> ../site/src/data/briefings.json

# 3. Ship the site (in site/)
cd ../site
npm run dev          # localhost:4321
npm run build        # -> dist/
```

`site/` also has `npm run sync-briefings`, which runs step 2 for you.

Nothing about step 3 depends on the brain being reachable. The site is fully
static: no server, no database, nothing of yours exposed to the internet.

## Which half goes on a server

Only `site/`. The brain stays on your machine, and not out of caution alone —
it cannot work anywhere else:

- it reads `~/.claude/projects/*.jsonl`, which exist on your machine
- it shells out to your `claude` CLI, authenticated as you
- its dashboard serves your raw prompts with no authentication at all

So the architecture is: the brain runs locally on a schedule, exports briefings,
and the only thing that reaches a server is that JSON file.

```
your machine                                  the internet
------------                                  ------------
ingest -> digest -> publish  --git push-->    Vercel builds site/ -> visitors
(prompts, map, brain.db                       (briefings.json only)
 never leave)
```

## Running it on a schedule

`daily_newsletter/scripts/daily.ps1` runs the whole pipeline once. Add `-Push`
to commit the exported briefings and let Vercel redeploy; without it, everything
stays local.

```powershell
.\daily_newsletter\scripts\daily.ps1 -Push
```

Register it with Task Scheduler to run each morning at 07:00:

```powershell
schtasks /create /tn "Secondary Brain" /sc daily /st 07:00 /tr `
  "powershell -NoProfile -ExecutionPolicy Bypass -File D:\projects\personal_website\daily_newsletter\scripts\daily.ps1 -Push"
```

It logs to `daily_newsletter/data/daily.log`. The task only runs while the
machine is on; Task Scheduler will catch up on the next boot if you tick "Run
task as soon as possible after a scheduled start is missed".

### If you really do want the dashboard remote

Do not expose port 4317. Reach it over [Tailscale](https://tailscale.com) or an
SSH tunnel instead, which needs no code change:

```bash
ssh -L 4317:127.0.0.1:4317 you@your-machine
```

`DN_HOST` exists to widen the binding, but anything other than loopback puts
your unauthenticated prompt history on that network.

## Deploying to Vercel

Import the repository, then **set Root Directory to `site`**. Astro is detected
automatically; the build command is `npm run build` and the output directory is
`dist`. Because `briefings.json` is committed, a deploy needs no access to your
machine or your database.

Before the first deploy, set `site:` in `site/astro.config.mjs` to your real
domain.

## What to fill in

Nothing personal was invented for you. Everything that needs your input is marked
`TODO`:

| File | What |
| --- | --- |
| `site/src/site.ts` | your name, role, tagline, and links — used everywhere |
| `site/src/pages/index.astro` | the About introduction |
| `site/src/pages/projects.astro` | project descriptions (stubs from your repo names) |
| `site/src/pages/resume.astro` | experience, education, skills |
| `site/astro.config.mjs` | your domain |

## Content

- `site/src/content/writing/` — finished posts. Front matter: `title`, `date`,
  `summary`, `draft`.
- `site/src/content/study-log/` — dated notes as they are. Same fields plus
  `topics: []`.

`draft: true` hides an entry from its index *and* from the build, so drafts are
not reachable by direct URL in production.

See `daily_newsletter/README.md` for how the interest map and the briefing
pipeline actually work.
