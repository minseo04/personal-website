/**
 * One list, rendered on both the home page (the top few) and /projects (all of
 * them). Order matters: the first entries are what a reviewer sees first.
 *
 * `owned` and `learned` exist because this site is aimed at internship and
 * research applications. A reviewer skimming a portfolio wants to know what you
 * were actually responsible for and what you took away -- not a feature list.
 */
export interface Project {
  name: string;
  /** One line. What it is, in plain terms. */
  blurb: string;
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
    name: 'daily_newsletter',
    blurb:
      'A secondary brain that learns what I am studying from my own AI conversations and briefs me on it daily.',
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
  {
    name: 'Harness IDE',
    blurb: 'An IDE built around an agent’s tool calls rather than around files.',
    // TODO: replace with what it actually does and why the design is interesting.
    detail: 'TODO: what problem it solves, and what is unusual about the approach.',
    owned: 'TODO: which parts you built.',
    learned: 'TODO: the most useful thing it taught you.',
    tags: ['agents', 'harness', 'developer tools'],
    featured: true,
  },
  {
    name: 'blockboard',
    blurb: 'A block-based canvas for composing work.',
    // TODO
    detail: 'TODO: describe the project.',
    owned: 'TODO: which parts you built.',
    learned: 'TODO.',
    tags: ['visual programming', 'UI'],
    featured: true,
  },
  {
    name: 'skillgraph-recruit',
    blurb: 'Skill-graph modelling applied to recruiting.',
    // TODO
    detail: 'TODO: describe the project.',
    owned: 'TODO: which parts you built.',
    learned: 'TODO.',
    tags: ['graphs', 'matching'],
  },
];
