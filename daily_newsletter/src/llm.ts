import { spawn } from 'node:child_process';
import { DATA_DIR, LLM_BACKEND, MODEL_FAST } from './config.ts';

export interface CompleteOptions {
  model?: string;
  system?: string;
  maxTokens?: number;
  /** Seconds before the call is abandoned. */
  timeout?: number;
}

/**
 * One text completion, routed to whichever backend is configured.
 *
 * The `cli` backend shells out to the local `claude` binary, which uses your
 * existing Claude Code login -- no API key, no per-token billing beyond your
 * plan. The `api` backend hits the Anthropic API directly and is faster per
 * call, which matters once you are extracting topics from hundreds of prompts.
 */
export async function complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
  return LLM_BACKEND === 'api' ? viaApi(prompt, opts) : viaCli(prompt, opts);
}

function viaCli(prompt: string, opts: CompleteOptions, useShell = false): Promise<string> {
  const model = opts.model ?? MODEL_FAST;
  if (!/^[\w.:-]+$/.test(model)) throw new Error(`refusing to pass an unsafe model name: ${model}`);
  const full = opts.system ? `${opts.system}\n\n---\n\n${prompt}` : prompt;
  const timeoutMs = (opts.timeout ?? 300) * 1000;

  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--output-format', 'json', '--model', model], {
      // Run outside the project so the CLI does not load this repo's CLAUDE.md
      // and settings into every extraction call.
      cwd: DATA_DIR,
      // No shell by default: the official installer ships a real claude.exe.
      // Shell is only used as a fallback for npm installs, where `claude` is a
      // .cmd shim that Windows cannot spawn directly.
      shell: useShell,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`claude CLI timed out after ${opts.timeout ?? 300}s`));
    }, timeoutMs);

    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e.code === 'ENOENT' && !useShell && process.platform === 'win32') {
        return viaCli(prompt, opts, true).then(resolve, reject);
      }
      reject(new Error(`could not spawn the "claude" CLI: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 500)}`));
      try {
        const parsed = JSON.parse(out);
        if (parsed.is_error) return reject(new Error(`claude CLI error: ${parsed.result}`));
        resolve(String(parsed.result ?? ''));
      } catch {
        reject(new Error(`unparseable claude CLI output: ${out.slice(0, 300)}`));
      }
    });

    child.stdin.write(full);
    child.stdin.end();
  });
}

async function viaApi(prompt: string, opts: CompleteOptions): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('DN_LLM=api but ANTHROPIC_API_KEY is not set');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.model ?? MODEL_FAST,
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout((opts.timeout ?? 300) * 1000),
  });

  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { content: { type: string; text?: string }[] };
  return body.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
}

/**
 * A completion that must return JSON. Models like to wrap JSON in prose or a
 * fenced block, so we strip both before parsing, and retry once on a failure
 * with the parse error fed back in.
 */
export async function completeJson<T>(prompt: string, opts: CompleteOptions = {}): Promise<T> {
  const ask = `${prompt}\n\nRespond with valid JSON only. No prose, no markdown fences.`;
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await complete(attempt === 0 ? ask : `${ask}\n\nYour previous reply could not be parsed as JSON (${last}). Return only the raw JSON value.`, opts);
    try {
      return JSON.parse(stripFence(raw)) as T;
    } catch (e) {
      last = (e as Error).message;
    }
  }
  throw new Error(`model did not return valid JSON after 2 attempts: ${last}`);
}

function stripFence(s: string): string {
  const t = s.trim();
  const fenced = t.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  if (fenced) return fenced[1].trim();
  // Fall back to the outermost bracketed span, which handles stray preamble.
  const start = t.search(/[[{]/);
  if (start === -1) return t;
  const open = t[start];
  const close = open === '[' ? ']' : '}';
  const end = t.lastIndexOf(close);
  return end > start ? t.slice(start, end + 1) : t;
}
