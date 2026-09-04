/**
 * Everything personal lives here, so it is changed in one place rather than
 * hunted through templates. Every link is optional -- an empty string simply
 * does not render, so the contact row grows as you add to it.
 */
export const SITE = {
  /** Appears in the header, the page titles and the footer. */
  name: 'Minseo Kim',

  /** The one line under your name. Say what you build, not what you are. */
  role: 'I build developer tools for working with AI agents.',

  /** Used as the default meta description across the site. */
  tagline:
    'I build developer tools for working with AI agents, and keep a public log of what I am learning about models, harnesses and agent design.',

  /**
   * Shown on the home page and the resume. Delete it once you are not looking
   * -- a stale availability line is worse than none.
   */
  lookingFor:
    'I am looking for internship and research positions in AI systems, agent infrastructure, and developer tooling.',

  // ---- contact ----
  // Starting with GitHub only. Fill any of the others in later and they appear
  // in the footer automatically; no template changes needed.
  github: 'https://github.com/minseo04',
  linkedin: '',
  email: '', // publishing an address invites scrapers; a separate one is wise
  x: '',
  scholar: '',

  startYear: 2026,
};

export const NAV = [
  { href: '/', label: 'About' },
  { href: '/projects', label: 'Projects' },
  { href: '/writing', label: 'Writing' },
  { href: '/study-log', label: 'Study log' },
  { href: '/briefings', label: 'Briefings' },
  { href: '/resume', label: 'Resume' },
];
