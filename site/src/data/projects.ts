/**
 * One list, rendered on both the home page (the featured ones) and /projects.
 * Order matters: the first entries are what a reviewer sees first.
 *
 * `owned` and `learned` exist because this site is aimed at internship and
 * research applications. A reviewer skimming a portfolio wants to know what you
 * were actually responsible for and what you took away -- not a feature list.
 */
export interface Project {
  name: string;
  /** One line. What it is, in plain terms. */
  blurb: string;
  /** When you worked on it. */
  period?: string;
  /** A paragraph. How it works and what is interesting about the design. */
  detail: string;
  /** What you personally built and were responsible for. */
  owned?: string;
  /** What the project taught you. Be specific; vague lessons read as filler. */
  learned?: string;
  href?: string;
  repo?: string;
  tags: string[];
  featured?: boolean;
}

export const PROJECTS: Project[] = [
  {
    name: 'BlockBoard',
    blurb: 'A local-first visual workspace where AI chat, task, data, map and code blocks share one canvas.',
    period: '2026 – Present',
    detail:
      'Blocks live on a shared React Flow canvas, so a chat block can hand its output to a data block or a code block without leaving the workspace. Tool calling runs across Ollama, OpenAI, Anthropic and Google behind one interface, with Zod schemas validating every call and approval gates in front of anything destructive — a model proposing a data change has to get past a person before it lands. Local-first means the work stays on your machine rather than in a vendor’s account.',
    owned:
      'Built the desktop and web stack in TypeScript, React, Zustand, Tauri and Rust, and maintained 380+ automated tests across both the TypeScript and Rust codebases.',
    learned:
      'That the hard part of multi-provider tool calling is not the plumbing but the trust boundary. Schema validation catches malformed calls; only an approval gate catches a well-formed call that should not run.',
    tags: ['TypeScript', 'React', 'Rust', 'Tauri', 'LLM tool calling'],
    featured: true,
  },
  {
    name: 'Harness IDE',
    blurb: 'A visual testbed for configuring, testing and evaluating LLM agent harnesses.',
    period: '2026 – Present',
    detail:
      'A workbench for the layer between a model and the application: you configure a harness, run it against local and hosted models, and compare the results side by side. The current line of work is how an agent should refer to objects in a UI — comparing raw UUIDs, semantic IDs, and schema-constrained references to find which gives a model the best chance of pointing at the right thing reliably.',
    owned: 'Designing and building the harness configuration model, the evaluation runs, and the comparison experiments.',
    learned:
      'That object referencing is a real bottleneck in agent reliability. A model that reasons correctly still fails if it cannot name the thing it wants to act on.',
    tags: ['agents', 'harness', 'evals', 'developer tools'],
    featured: true,
  },
  {
    name: 'daily_newsletter',
    blurb:
      'A secondary brain that learns what I am studying from my own AI conversations and briefs me on it daily.',
    period: '2026',
    detail:
      'It reads the prompts I typed to Claude Code, has a model name the knowledge topic behind each one, and keeps an interest map whose weights decay on a 21-day half-life, so subjects I have dropped fade without any pruning. That map drives searches across arXiv, Hacker News, GitHub releases and blog feeds, and a second pass selects and writes up the handful of items worth reading. Storage is node:sqlite and inference goes through the local Claude CLI, so it runs with no native dependencies and no API key.',
    owned:
      'Built end to end: the transcript parser, the topic extraction and decay model, the source fetchers, the curation pass, and the dashboard.',
    learned:
      'That precision beats recall when building a profile of someone. The extractor discards most prompts as routine chores, because a wrong topic pollutes the map permanently while a missed one costs nothing. The briefings on this site are its output.',
    href: '/briefings',
    tags: ['agents', 'TypeScript', 'SQLite', 'information retrieval'],
    featured: true,
  },
];
