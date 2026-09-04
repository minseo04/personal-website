import { XMLParser } from 'fast-xml-parser';

export interface Candidate {
  title: string;
  url: string;
  source: string;
  published?: string;
  abstract?: string;
  /** Source-native popularity, normalised loosely to 0..1 by each fetcher. */
  pop?: number;
  topicId?: string;
  /** Surfaced by a relevance (not recency) search: eligible as canon. */
  canon?: boolean;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const UA = 'daily-newsletter/0.1 (personal research digest)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, ...headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

function asArray<T>(x: T | T[] | undefined): T[] {
  return x === undefined ? [] : Array.isArray(x) ? x : [x];
}

/**
 * Recent arXiv papers for a topic. `mode: 'foundational'` drops the date sort
 * and ranks by relevance instead, which surfaces the canonical older work.
 */
export async function arxiv(
  query: string,
  opts: { max?: number; mode?: 'recent' | 'foundational' } = {},
): Promise<Candidate[]> {
  const max = opts.max ?? 8;
  const sort = opts.mode === 'foundational' ? 'relevance' : 'submittedDate';
  const q = `all:${JSON.stringify(query)}`;
  const url =
    `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}` +
    `&start=0&max_results=${max}&sortBy=${sort}&sortOrder=descending`;

  const xml = await getText(url);
  await sleep(3000); // arXiv asks for one request per three seconds

  const feed = parser.parse(xml)?.feed;
  return asArray<any>(feed?.entry).map((e) => ({
    title: String(e.title ?? '').replace(/\s+/g, ' ').trim(),
    url: String(e.id ?? ''),
    source: 'arxiv',
    published: e.published ? new Date(e.published).toISOString() : undefined,
    abstract: String(e.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 1500),
  }));
}

/** Hacker News stories, which stand in for the "what everyone is talking about" signal. */
export async function hackerNews(query: string, sinceDays = 14, minPoints = 30): Promise<Candidate[]> {
  const since = Math.floor(Date.now() / 1000) - sinceDays * 86400;
  const url =
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}` +
    `&tags=story&numericFilters=created_at_i>${since},points>${minPoints}&hitsPerPage=10`;

  const body = JSON.parse(await getText(url)) as {
    hits: { title: string; url?: string; objectID: string; points: number; created_at: string }[];
  };

  return (body.hits ?? [])
    .filter((h) => h.title)
    .map((h) => ({
      title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      source: 'hackernews',
      published: h.created_at,
      pop: Math.min(1, h.points / 500),
    }));
}

/** Repos whose releases are genuine announcements in the agent/harness world. */
export const WATCHED_REPOS = [
  'anthropics/claude-code',
  'anthropics/anthropic-sdk-python',
  'modelcontextprotocol/servers',
  'openai/openai-agents-python',
  'langchain-ai/langgraph',
  'vllm-project/vllm',
  'ggml-org/llama.cpp',
  'huggingface/transformers',
  'BerriAI/litellm',
  'sgl-project/sglang',
];

export async function githubReleases(repos = WATCHED_REPOS, sinceDays = 14): Promise<Candidate[]> {
  const cutoff = Date.now() - sinceDays * 86_400_000;
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };

  const out: Candidate[] = [];
  for (const repo of repos) {
    try {
      const rels = JSON.parse(
        await getText(`https://api.github.com/repos/${repo}/releases?per_page=3`, headers),
      ) as { name?: string; tag_name: string; html_url: string; published_at: string; body?: string; draft: boolean; prerelease: boolean }[];

      for (const r of rels) {
        if (r.draft || !r.published_at) continue;
        if (new Date(r.published_at).getTime() < cutoff) continue;
        out.push({
          title: `${repo} ${r.name || r.tag_name}`,
          url: r.html_url,
          source: 'github',
          published: r.published_at,
          abstract: (r.body ?? '').replace(/\s+/g, ' ').slice(0, 1200),
          pop: r.prerelease ? 0.3 : 0.6,
        });
      }
    } catch {
      // A single unreachable repo should never sink the digest.
    }
  }
  return out;
}

/** Official blogs and researcher feeds -- where real announcements land first. */
export const FEEDS: { name: string; url: string }[] = [
  { name: 'Anthropic', url: 'https://www.anthropic.com/rss.xml' },
  { name: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
  { name: 'Google Research', url: 'https://research.google/blog/rss/' },
  { name: 'DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
  { name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/' },
  { name: 'BAIR', url: 'https://bair.berkeley.edu/blog/feed.xml' },
  { name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml' },
  { name: 'IEEE Spectrum', url: 'https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss' },
];

export async function rss(feeds = FEEDS, sinceDays = 14): Promise<Candidate[]> {
  const cutoff = Date.now() - sinceDays * 86_400_000;
  const out: Candidate[] = [];

  await Promise.all(
    feeds.map(async (feed) => {
      try {
        const doc = parser.parse(await getText(feed.url));
        const entries = [...asArray<any>(doc?.rss?.channel?.item), ...asArray<any>(doc?.feed?.entry)];

        for (const e of entries) {
          const link =
            typeof e.link === 'string'
              ? e.link
              : e.link?.['@_href'] ?? asArray<any>(e.link).find((l) => l?.['@_href'])?.['@_href'];
          const dateRaw = e.pubDate ?? e.published ?? e.updated ?? e['dc:date'];
          const when = dateRaw ? new Date(dateRaw).getTime() : NaN;
          if (!link || !Number.isFinite(when) || when < cutoff) continue;

          const summary = e.description ?? e.summary ?? e.content ?? '';
          out.push({
            title: String(e.title?.['#text'] ?? e.title ?? '').replace(/\s+/g, ' ').trim(),
            url: String(link),
            source: `rss:${feed.name}`,
            published: new Date(when).toISOString(),
            abstract: String(typeof summary === 'object' ? summary['#text'] ?? '' : summary)
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 1200),
            pop: 0.5,
          });
        }
      } catch {
        // Feeds go down. Skip and keep the rest of the digest intact.
      }
    }),
  );

  return out.filter((c) => c.title);
}
