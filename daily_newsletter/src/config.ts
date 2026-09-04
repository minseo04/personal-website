import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');
export const DATA_DIR = process.env.DN_DATA_DIR ?? path.join(ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'brain.db');
export const WEB_DIR = path.join(here, 'web');
/** Where `npm run publish` drops the briefings the public Astro site reads. */
export const PUBLIC_SITE_DATA =
  process.env.DN_PUBLISH_TO ?? path.join(ROOT, '..', 'site', 'src', 'data', 'briefings.json');

export const TRANSCRIPTS_DIR =
  process.env.DN_TRANSCRIPTS ?? path.join(os.homedir(), '.claude', 'projects');

/** Days for a topic's interest weight to halve if you never mention it again. */
export const HALF_LIFE_DAYS = Number(process.env.DN_HALF_LIFE_DAYS ?? 21);
/** How many live topics steer a digest. */
export const ACTIVE_TOPICS = Number(process.env.DN_ACTIVE_TOPICS ?? 8);
/** Target item count per digest. */
export const ITEMS_PER_DIGEST = Number(process.env.DN_ITEMS ?? 7);

export const PORT = Number(process.env.PORT ?? 4317);
/**
 * Loopback by default, and that default matters.
 *
 * The dashboard serves your verbatim prompts over an API with no authentication
 * of any kind. Binding all interfaces -- which is what Express does when you
 * pass it no host -- publishes them to everyone on the network you happen to be
 * on. Override only behind a private network or an authenticating proxy.
 */
export const HOST = process.env.DN_HOST ?? '127.0.0.1';

export type LlmBackend = 'cli' | 'api';
export const LLM_BACKEND: LlmBackend =
  (process.env.DN_LLM as LlmBackend) ?? (process.env.ANTHROPIC_API_KEY ? 'api' : 'cli');

/** Cheap + fast: topic extraction over many short prompts. */
export const MODEL_FAST = process.env.DN_MODEL_FAST ?? 'claude-haiku-4-5-20251001';
/** Stronger: curation and the writing of digest items. */
export const MODEL_SMART = process.env.DN_MODEL_SMART ?? 'claude-sonnet-5';

/**
 * Topic buckets. `adjacent` is the CS/ECE catch-all; everything else is the
 * AI-models / harness / agents core the digest is really built around.
 */
export const TOPIC_KINDS = [
  'model',
  'agent',
  'harness',
  'technique',
  'infra',
  'adjacent',
] as const;
export type TopicKind = (typeof TOPIC_KINDS)[number];

export const ITEM_KINDS = [
  'concept',
  'new-research',
  'announcement',
  'foundational',
  'adjacent',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
