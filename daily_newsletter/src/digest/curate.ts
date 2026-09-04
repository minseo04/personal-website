import crypto from 'node:crypto';
import { ACTIVE_TOPICS, ITEMS_PER_DIGEST, ITEM_KINDS, MODEL_SMART, type ItemKind } from '../config.ts';
import { db } from '../db.ts';
import { completeJson } from '../llm.ts';
import {
  activeTopics,
  markFoundationsDone,
  recomputeWeights,
  topicsNeedingFoundations,
  type Topic,
} from '../brain/graph.ts';
import { arxiv, githubReleases, hackerNews, rss, type Candidate } from './sources.ts';

const SYSTEM = `You are the editor of a one-person research briefing.

The reader is a developer going deep on AI models, agent harnesses, and agent
design, plus adjacent CS and ECE. Their live interests, with weights, are given.
Weight means how hot the topic is for them right now.

Pick the best items and write each one up. Aim for a spread of kinds:
- new-research    a recent paper that genuinely advances a live topic
- announcement    a release, model, or launch they should not miss
- foundational    older, canonical work that deepens a topic they just got into
- concept         something they keep circling but probably have not nailed down.
                  You WRITE this from your own knowledge; there is no source item.
- adjacent        the CS/ECE item worth their time

Balance (soft targets, not hard rules):
- at most 3 "new-research" items -- a wall of arXiv is not a briefing
- exactly 1-2 "concept" items
- if any candidate is marked CANON-ELIGIBLE and is genuinely a landmark for that
  topic, include exactly one "foundational" item using it
- include an "adjacent" item when a good CS/ECE candidate exists

Rules:
- Quality over coverage. A thin item wastes the reader's morning. If the
  candidates are weak, return fewer items rather than padding.
- "summary": 2-3 sentences, concrete and technical. State what the thing
  actually does or claims. No hype, no "researchers have discovered".
- "why": ONE sentence, addressed to the reader, connecting it to their specific
  live topics. This is the whole value of the briefing -- make it earn its place.
- Never pick two items that make the same point.
- "pick" is the candidate index you are using, or null for a "concept" item you
  are writing yourself.
- "topic" must be one of the given topic ids.

Output shape:
{"items":[{"pick":12,"kind":"new-research","topic":"tool-use","title":"...","summary":"...","why":"..."}]}`;

interface Picked {
  pick: number | null;
  kind: string;
  topic: string;
  title: string;
  summary: string;
  why: string;
}

export interface DigestResult {
  date: string;
  topics: string[];
  candidates: number;
  items: number;
}

export async function buildDigest(
  opts: { date?: string; log?: (m: string) => void } = {},
): Promise<DigestResult> {
  const log = opts.log ?? (() => {});
  const date = opts.date ?? new Date().toISOString().slice(0, 10);

  recomputeWeights();
  const topics = activeTopics(ACTIVE_TOPICS);
  if (!topics.length) {
    throw new Error('the interest map is empty -- run `npm run ingest` first');
  }
  log(`active topics: ${topics.map((t) => `${t.label} (${t.weight.toFixed(2)})`).join(', ')}`);

  const candidates = await gather(topics, log);
  log(`gathered ${candidates.length} candidates`);

  const fresh = dedupe(candidates).filter((c) => !alreadySeen(c.url));
  log(`${fresh.length} after dedupe and seen-filter`);
  if (!fresh.length) throw new Error('no unseen candidates found -- try again later');

  const shortlist = prerank(fresh, topics).slice(0, 45);

  const catalogue = shortlist
    .map((c, i) => {
      const when = c.published ? c.published.slice(0, 10) : 'undated';
      const body = c.abstract ? ` :: ${c.abstract.slice(0, 400)}` : '';
      const tags = [c.topicId ? `topic=${c.topicId}` : '', c.canon ? 'CANON-ELIGIBLE' : '']
        .filter(Boolean)
        .join(', ');
      return `[${i}] (${c.source}, ${when}${tags ? ', ' + tags : ''}) ${c.title}${body}`;
    })
    .join('\n');

  const topicLines = topics
    .map((t) => `- ${t.id} (${t.kind}, weight ${t.weight.toFixed(2)}): ${t.label}`)
    .join('\n');

  const picked = await completeJson<{ items: Picked[] }>(
    `Reader's live topics:\n${topicLines}\n\nCandidates:\n${catalogue}\n\n` +
      `Choose up to ${ITEMS_PER_DIGEST} items. Include at least one "concept" item you write yourself.`,
    { system: SYSTEM, model: MODEL_SMART, maxTokens: 8192, timeout: 420 },
  );

  const insert = db.prepare(
    `INSERT INTO items (id, digest_date, topic_id, kind, title, url, source, summary, why, published, score, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  const markSeen = db.prepare(
    'INSERT INTO seen_urls (url, ts) VALUES (?, ?) ON CONFLICT DO NOTHING',
  );

  let written = 0;
  const now = new Date().toISOString();

  for (const p of picked.items ?? []) {
    const src = typeof p.pick === 'number' ? shortlist[p.pick] : undefined;
    if (typeof p.pick === 'number' && !src) continue; // hallucinated index
    const kind: ItemKind = (ITEM_KINDS as readonly string[]).includes(p.kind)
      ? (p.kind as ItemKind)
      : 'concept';
    const url = src?.url ?? null;
    const id = crypto
      .createHash('sha1')
      .update(url ?? `${date}:${kind}:${p.title}`)
      .digest('hex')
      .slice(0, 16);

    insert.run(
      id,
      date,
      topics.some((t) => t.id === p.topic) ? p.topic : null,
      kind,
      p.title || src?.title || '(untitled)',
      url,
      src?.source ?? 'claude',
      p.summary ?? '',
      p.why ?? '',
      src?.published ?? null,
      src?.pop ?? 0,
      now,
    );
    if (url) markSeen.run(url, now);
    written++;
  }

  // Canon only needs covering once per topic.
  for (const t of topics) {
    if (picked.items?.some((p) => p.topic === t.id && p.kind === 'foundational')) {
      markFoundationsDone(t.id);
    }
  }

  return { date, topics: topics.map((t) => t.id), candidates: fresh.length, items: written };
}

async function gather(topics: Topic[], log: (m: string) => void): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const settle = async (label: string, p: Promise<Candidate[]>) => {
    try {
      const r = await p;
      log(`  ${label}: ${r.length}`);
      out.push(...r);
    } catch (e) {
      log(`  ${label}: failed (${(e as Error).message})`);
    }
  };

  // Global announcement sweep -- these are not topic-specific.
  await Promise.all([settle('github releases', githubReleases()), settle('rss', rss())]);

  // Topic-driven search. arXiv is serialised because of its rate limit.
  for (const t of topics.slice(0, 4)) {
    const r = await arxiv(t.label, { max: 6 }).catch(() => []);
    log(`  arxiv "${t.label}": ${r.length}`);
    out.push(...r.map((c) => ({ ...c, topicId: t.id })));
  }

  await Promise.all(
    topics.slice(0, 3).map((t) =>
      settle(
        `hn "${t.label}"`,
        hackerNews(t.label).then((r) => r.map((c) => ({ ...c, topicId: t.id }))),
      ),
    ),
  );

  // One topic per digest gets its canonical literature surfaced.
  const [needsCanon] = topicsNeedingFoundations();
  if (needsCanon) {
    const r = await arxiv(needsCanon.label, { max: 5, mode: 'foundational' }).catch(() => []);
    log(`  foundations "${needsCanon.label}": ${r.length}`);
    out.push(...r.map((c) => ({ ...c, topicId: needsCanon.id, canon: true })));
  }

  return out;
}

function dedupe(list: Candidate[]): Candidate[] {
  const byUrl = new Map<string, Candidate>();
  const titles = new Set<string>();
  for (const c of list) {
    const key = normaliseUrl(c.url);
    const tkey = c.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || byUrl.has(key) || titles.has(tkey)) continue;
    byUrl.set(key, c);
    titles.add(tkey);
  }
  return [...byUrl.values()];
}

function normaliseUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = '';
    url.search = '';
    // arXiv abs/pdf and version suffixes are the same paper.
    url.pathname = url.pathname.replace(/^\/pdf\//, '/abs/').replace(/v\d+$/, '');
    return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return '';
  }
}

function alreadySeen(url: string): boolean {
  return !!db.prepare('SELECT 1 FROM seen_urls WHERE url = ?').get(url);
}

/** Cheap ranking so the model sees the 45 most promising, not all 200. */
function prerank(list: Candidate[], topics: Topic[]): Candidate[] {
  const weightOf = new Map(topics.map((t) => [t.id, t.weight]));
  const maxW = Math.max(...topics.map((t) => t.weight), 1);

  const score = (c: Candidate): number => {
    const ageDays = c.published ? (Date.now() - new Date(c.published).getTime()) / 86_400_000 : 30;
    const recency = Math.exp(-Math.max(0, ageDays) / 10);
    const topical = c.topicId ? (weightOf.get(c.topicId) ?? 0) / maxW : 0.35;
    return recency * 0.4 + topical * 0.4 + (c.pop ?? 0.2) * 0.2;
  };

  const ranked = [...list].sort((x, y) => score(y) - score(x));

  // Canon papers are old on purpose, so the recency term buries them and the
  // shortlist cut drops them before the editor ever sees one. Reserve their
  // slots up front.
  const canon = ranked.filter((c) => c.canon).slice(0, 5);
  const seen = new Set(canon);
  return [...canon, ...ranked.filter((c) => !seen.has(c))];
}
