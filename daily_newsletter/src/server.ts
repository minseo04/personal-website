import express from 'express';
import { HOST, PORT, WEB_DIR } from './config.ts';
import { db, getMeta } from './db.ts';
import { allTopics, edges, recomputeWeights, setTopicFlag } from './brain/graph.ts';
import { ingestClaudeCode } from './capture/claudeCode.ts';
import { extractTopics } from './brain/extract.ts';
import { buildDigest } from './digest/curate.ts';

export function createServer() {
  const app = express();
  app.use(express.json());

  /** Guards the long-running pipelines so two clicks cannot overlap. */
  let running: string | null = null;
  const exclusive = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    if (running) throw new Error(`${running} is already running`);
    running = name;
    try {
      return await fn();
    } finally {
      running = null;
    }
  };

  app.get('/api/status', (_req, res) => {
    const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    res.json({
      prompts: one('SELECT COUNT(*) AS n FROM prompts'),
      unprocessed: one('SELECT COUNT(*) AS n FROM prompts WHERE processed = 0'),
      topics: one('SELECT COUNT(*) AS n FROM topics'),
      items: one('SELECT COUNT(*) AS n FROM items'),
      lastIngest: getMeta('cc:lastIngest'),
      running,
    });
  });

  app.get('/api/dates', (_req, res) => {
    res.json(
      db
        .prepare(
          'SELECT digest_date AS date, COUNT(*) AS n FROM items GROUP BY digest_date ORDER BY digest_date DESC',
        )
        .all(),
    );
  });

  app.get('/api/digest', (req, res) => {
    const date =
      (req.query.date as string) ??
      (db.prepare('SELECT MAX(digest_date) AS d FROM items').get() as { d: string | null })?.d;
    if (!date) return res.json({ date: null, items: [] });

    res.json({
      date,
      items: db
        .prepare(
          `SELECT i.*, t.label AS topic_label
           FROM items i LEFT JOIN topics t ON t.id = i.topic_id
           WHERE i.digest_date = ?
           ORDER BY CASE i.kind
             WHEN 'announcement' THEN 0 WHEN 'new-research' THEN 1
             WHEN 'concept' THEN 2 WHEN 'foundational' THEN 3 ELSE 4 END`,
        )
        .all(date),
    });
  });

  app.get('/api/graph', (_req, res) => {
    recomputeWeights();
    res.json({ topics: allTopics(), edges: edges() });
  });

  app.get('/api/topics/:id/prompts', (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT p.id, p.ts, p.text, p.project
           FROM mentions m JOIN prompts p ON p.id = m.prompt_id
           WHERE m.topic_id = ? ORDER BY p.ts DESC LIMIT 25`,
        )
        .all(req.params.id),
    );
  });

  app.post('/api/items/:id/reaction', (req, res) => {
    const { reaction } = req.body as { reaction: string | null };
    db.prepare('UPDATE items SET reaction = ? WHERE id = ?').run(reaction ?? null, req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/topics/:id/flag', (req, res) => {
    const { flag, value } = req.body as { flag: 'pinned' | 'muted'; value: boolean };
    if (flag !== 'pinned' && flag !== 'muted') return res.status(400).json({ error: 'bad flag' });
    setTopicFlag(req.params.id, flag, !!value);
    res.json({ ok: true });
  });

  app.post('/api/refresh', async (_req, res) => {
    try {
      const out = await exclusive('refresh', async () => {
        const ing = ingestClaudeCode();
        const ext = await extractTopics();
        recomputeWeights();
        return { ing, ext };
      });
      res.json(out);
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  });

  app.post('/api/digest', async (_req, res) => {
    try {
      const out = await exclusive('digest', () => buildDigest());
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.use(express.static(WEB_DIR));
  return app;
}

export function serve(port = PORT, host = HOST): void {
  createServer().listen(port, host, () => {
    console.log(`\n  Secondary brain running at http://${host}:${port}\n`);
    if (host !== '127.0.0.1' && host !== 'localhost') {
      console.warn(
        `  WARNING: bound to ${host}, not loopback. This API has no authentication\n` +
          `  and serves your raw prompts. Anyone who can reach this port can read them.\n`,
      );
    }
  });
}
