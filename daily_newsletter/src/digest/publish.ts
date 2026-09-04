import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.ts';

/**
 * The public shape of a briefing item.
 *
 * This type is the privacy boundary between the local brain and the public
 * site. Everything the dashboard knows that is *about you* rather than about
 * the world -- your prompts, the sessions they came from, topic weights, the
 * graph, which items you reacted to -- stops here and is never written out.
 * Adding a field to this interface is a decision to publish it.
 */
export interface PublicItem {
  id: string;
  kind: string;
  topic: string | null;
  title: string;
  url: string | null;
  source: string | null;
  summary: string;
  why: string | null;
  published: string | null;
}

export interface PublicDigest {
  date: string;
  items: PublicItem[];
}

export interface PublishResult {
  digests: number;
  items: number;
  outPath: string;
}

/**
 * Write every digest to a single JSON file for the Astro site to read at build
 * time. The site stays fully static: no server, no database, nothing of the
 * brain reachable from the internet.
 */
export function exportBriefings(outPath: string): PublishResult {
  const rows = db.prepare(
    `SELECT i.id, i.digest_date, i.kind, i.title, i.url, i.source, i.summary, i.why,
            i.published, t.label AS topic
     FROM items i LEFT JOIN topics t ON t.id = i.topic_id
     ORDER BY i.digest_date DESC,
       CASE i.kind
         WHEN 'announcement' THEN 0 WHEN 'new-research' THEN 1
         WHEN 'concept' THEN 2 WHEN 'foundational' THEN 3 ELSE 4 END`,
  ).all() as unknown as (PublicItem & { digest_date: string })[];

  const byDate = new Map<string, PublicItem[]>();
  for (const r of rows) {
    const list = byDate.get(r.digest_date) ?? [];
    list.push({
      id: r.id,
      kind: r.kind,
      topic: r.topic ?? null,
      title: r.title,
      url: r.url ?? null,
      source: r.source ?? null,
      summary: r.summary,
      why: r.why ?? null,
      published: r.published ?? null,
    });
    byDate.set(r.digest_date, list);
  }

  const digests: PublicDigest[] = [...byDate.entries()].map(([date, items]) => ({ date, items }));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(digests, null, 2) + '\n', 'utf8');

  return { digests: digests.length, items: rows.length, outPath };
}
