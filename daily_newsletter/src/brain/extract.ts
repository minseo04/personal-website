import { MODEL_FAST, TOPIC_KINDS, type TopicKind } from '../config.ts';
import { db } from '../db.ts';
import { completeJson } from '../llm.ts';
import { addMention, allTopics, slug, upsertTopic } from './graph.ts';

const BATCH = 25;
const MAX_PROMPT_CHARS = 500;

const SYSTEM = `You map a developer's AI conversations onto the topics they are trying to learn.

Their declared interests: AI models, agent harnesses, agent design, plus adjacent CS and ECE.

For each numbered prompt, return the KNOWLEDGE topics behind it -- subjects the
person would plausibly want to read research or announcements about.

Rules:
- Most prompts are routine chores ("pull the repo", "fix this typo", "run the tests").
  These have NO knowledge topic. Return an empty array. Be strict: a wrong topic
  pollutes the map permanently, a missed one costs nothing.
- Extract the SUBJECT, never the action. "debug my retry loop in the agent" is
  about agent reliability, not about debugging.
- At most 3 topics per prompt, usually 0 or 1.
- Prefer an id from the known list when it means the same thing. Do not invent a
  near-duplicate of an existing id.
- New ids: lowercase kebab-case, 1-4 words, canonical and reusable
  ("tool-use", "rag", "kv-cache", "mcp"), never a phrase specific to one prompt.
- Prompts may be in Korean or English. Topic labels are always English.
- kind is one of: ${TOPIC_KINDS.join(', ')}.
  model=specific models/families, agent=agent design & multi-agent,
  harness=the tooling around models (Claude Code, MCP, evals, prompting infra),
  technique=methods (RAG, distillation, quantization),
  infra=serving/training/hardware, adjacent=other CS or ECE.

Output shape:
[{"i": 0, "topics": [{"id":"tool-use","label":"Tool use","kind":"agent"}]}, {"i": 1, "topics": []}]`;

interface Extraction {
  i: number;
  topics: { id: string; label: string; kind: string }[];
}

export interface ExtractResult {
  prompts: number;
  batches: number;
  topicsTouched: number;
  failures: number;
}

export async function extractTopics(
  opts: { limit?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<ExtractResult> {
  const pending = db.prepare(
    `SELECT id, ts, text FROM prompts WHERE processed = 0 ORDER BY ts ASC ${opts.limit ? 'LIMIT ' + Number(opts.limit) : ''}`,
  ).all() as unknown as { id: string; ts: string; text: string }[];

  const result: ExtractResult = { prompts: pending.length, batches: 0, topicsTouched: 0, failures: 0 };
  if (!pending.length) return result;

  const markDone = db.prepare('UPDATE prompts SET processed = 1 WHERE id = ?');
  const touched = new Set<string>();

  for (let start = 0; start < pending.length; start += BATCH) {
    const batch = pending.slice(start, start + BATCH);
    result.batches++;

    // Give the model the vocabulary it already established, so the map
    // converges on stable ids instead of sprouting synonyms.
    const known = allTopics()
      .slice(0, 120)
      .map((t) => `${t.id} (${t.kind})`)
      .join(', ');

    const body = batch
      .map((p, i) => `[${i}] ${p.text.replace(/\s+/g, ' ').slice(0, MAX_PROMPT_CHARS)}`)
      .join('\n');

    let out: Extraction[];
    try {
      out = await completeJson<Extraction[]>(
        `Known topic ids: ${known || '(none yet)'}\n\nPrompts:\n${body}`,
        { system: SYSTEM, model: MODEL_FAST, maxTokens: 4096 },
      );
    } catch (e) {
      result.failures++;
      console.warn(`  ! batch ${result.batches} failed: ${(e as Error).message}`);
      continue; // leave unprocessed; a later run retries them
    }

    for (const entry of Array.isArray(out) ? out : []) {
      const prompt = batch[entry.i];
      if (!prompt) continue;
      const ids: string[] = [];

      for (const t of entry.topics ?? []) {
        const id = slug(t.id || t.label || '');
        if (!id) continue;
        const kind: TopicKind = (TOPIC_KINDS as readonly string[]).includes(t.kind)
          ? (t.kind as TopicKind)
          : 'adjacent';
        upsertTopic(id, t.label || id, kind, prompt.ts);
        addMention(id, prompt.id, prompt.ts);
        ids.push(id);
        touched.add(id);
      }
    }

    // Only the batches the model actually answered get retired.
    for (const p of batch) markDone.run(p.id);
    opts.onProgress?.(Math.min(start + BATCH, pending.length), pending.length);
  }

  result.topicsTouched = touched.size;
  return result;
}
