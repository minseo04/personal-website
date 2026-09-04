import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { DATA_DIR, DB_PATH } from './config.ts';

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Raw human prompts harvested from AI transcripts. One row per thing you typed.
CREATE TABLE IF NOT EXISTS prompts (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  session_id  TEXT,
  project     TEXT,
  ts          TEXT NOT NULL,
  text        TEXT NOT NULL,
  processed   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_prompts_unprocessed ON prompts(processed, ts);

-- Nodes of the interest map.
CREATE TABLE IF NOT EXISTS topics (
  id               TEXT PRIMARY KEY,
  label            TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'adjacent',
  first_seen       TEXT NOT NULL,
  last_seen        TEXT NOT NULL,
  mentions         INTEGER NOT NULL DEFAULT 0,
  weight           REAL NOT NULL DEFAULT 0,
  pinned           INTEGER NOT NULL DEFAULT 0,
  muted            INTEGER NOT NULL DEFAULT 0,
  foundations_done INTEGER NOT NULL DEFAULT 0
);

-- Which prompt surfaced which topic. Drives the decayed weight.
CREATE TABLE IF NOT EXISTS mentions (
  topic_id  TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  ts        TEXT NOT NULL,
  PRIMARY KEY (topic_id, prompt_id)
);
CREATE INDEX IF NOT EXISTS idx_mentions_topic ON mentions(topic_id);

-- Undirected co-occurrence edges (a < b enforced by the writer).
CREATE TABLE IF NOT EXISTS edges (
  a         TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  b         TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  weight    REAL NOT NULL DEFAULT 0,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (a, b)
);

-- Generated digest items.
CREATE TABLE IF NOT EXISTS items (
  id           TEXT PRIMARY KEY,
  digest_date  TEXT NOT NULL,
  topic_id     TEXT,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  url          TEXT,
  source       TEXT,
  summary      TEXT NOT NULL,
  why          TEXT,
  published    TEXT,
  score        REAL NOT NULL DEFAULT 0,
  reaction     TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_date ON items(digest_date);

-- Everything ever surfaced, so a digest never repeats itself.
CREATE TABLE IF NOT EXISTS seen_urls (
  url TEXT PRIMARY KEY,
  ts  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);

export function getMeta(k: string): string | null {
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined;
  return row?.v ?? null;
}

export function setMeta(k: string, v: string): void {
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
}
