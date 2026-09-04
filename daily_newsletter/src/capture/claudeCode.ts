import fs from 'node:fs';
import path from 'node:path';
import { TRANSCRIPTS_DIR } from '../config.ts';
import { db, getMeta, setMeta } from '../db.ts';

interface TranscriptLine {
  type?: string;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  isSidechain?: boolean;
  message?: { role?: string; content?: unknown };
}

export interface IngestResult {
  filesScanned: number;
  filesSkipped: number;
  inserted: number;
  examined: number;
}

/**
 * Harvest the things *you* typed out of Claude Code's local transcripts.
 *
 * A transcript line is a real prompt only when `message.content` is a plain
 * string. Tool results arrive on the same `type: "user"` channel but carry an
 * array of content blocks, and they are machine output -- folding them in
 * would swamp the interest map with file paths and stack traces.
 */
export function ingestClaudeCode(opts: { full?: boolean } = {}): IngestResult {
  if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    throw new Error(`no transcripts directory at ${TRANSCRIPTS_DIR} (set DN_TRANSCRIPTS)`);
  }

  const files = walk(TRANSCRIPTS_DIR);
  const marks: Record<string, number> = opts.full ? {} : JSON.parse(getMeta('cc:mtimes') ?? '{}');

  const insert = db.prepare(
    `INSERT INTO prompts (id, source, session_id, project, ts, text, processed)
     VALUES (?, 'claude-code', ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO NOTHING`,
  );

  const result: IngestResult = { filesScanned: 0, filesSkipped: 0, inserted: 0, examined: 0 };

  for (const file of files) {
    const mtime = fs.statSync(file).mtimeMs;
    if (marks[file] === mtime) {
      result.filesSkipped++;
      continue;
    }
    result.filesScanned++;

    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let rec: TranscriptLine;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (rec.type !== 'user' || rec.isSidechain) continue;
      if (typeof rec.message?.content !== 'string') continue;
      result.examined++;

      const text = rec.message.content.trim();
      if (!isRealPrompt(text)) continue;

      const id = rec.uuid ?? `${file}:${rec.timestamp}`;
      const changed = insert.run(
        id,
        rec.sessionId ?? null,
        rec.cwd ? path.basename(rec.cwd) : null,
        rec.timestamp ?? new Date().toISOString(),
        text,
      );
      result.inserted += Number(changed.changes);
    }

    marks[file] = mtime;
  }

  setMeta('cc:mtimes', JSON.stringify(marks));
  setMeta('cc:lastIngest', new Date().toISOString());
  return result;
}

/** Filters out the machinery: system reminders, bare slash commands, one-word acks. */
function isRealPrompt(text: string): boolean {
  if (text.length < 8) return false;
  if (text.startsWith('<')) return false; // <system-reminder>, <command-name>, <local-command-stdout>
  if (/^\/[a-z0-9:-]+$/i.test(text)) return false; // a bare "/clear"
  if (/^(y|yes|no|ok|okay|continue|go|ㄱ|ㅇㅇ|응|넵)$/i.test(text)) return false;
  return true;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}
