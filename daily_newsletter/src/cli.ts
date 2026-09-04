import { LLM_BACKEND, PORT, PUBLIC_SITE_DATA, TOPIC_KINDS, type TopicKind } from './config.ts';
import { db, getMeta } from './db.ts';
import { ingestClaudeCode } from './capture/claudeCode.ts';
import { extractTopics } from './brain/extract.ts';
import { allTopics, recomputeWeights, seedTopic, setTopicFlag } from './brain/graph.ts';
import { buildDigest } from './digest/curate.ts';
import { exportBriefings } from './digest/publish.ts';
import { serve } from './server.ts';

const [cmd, ...rest] = process.argv.slice(2);

const USAGE = `
  daily-newsletter -- a secondary brain for what you are learning

  npm run ingest            harvest new prompts and update the interest map
  npm run digest            build today's briefing from the live topics
  npm run serve             open the dashboard at http://localhost:${PORT}
  npm run status            what the brain currently holds

  npx tsx src/cli.ts topics [n]         list the interest map
  npx tsx src/cli.ts pin <topic-id>     always include a topic
  npx tsx src/cli.ts mute <topic-id>    never include a topic
  npx tsx src/cli.ts add "<label>" [kind]   plant an interest by hand (pinned)
                            kinds: model, agent, harness, technique, infra, adjacent
  npx tsx src/cli.ts ingest --full      re-scan every transcript from scratch

  npm run publish           export briefings to the public site (items only --
                            no prompts, no weights, no interest graph)
`;

async function main(): Promise<void> {
  switch (cmd) {
    case 'ingest': {
      console.log(`ingesting (LLM backend: ${LLM_BACKEND})...`);
      const ing = ingestClaudeCode({ full: rest.includes('--full') });
      console.log(
        `  scanned ${ing.filesScanned} files (${ing.filesSkipped} unchanged), ` +
          `${ing.examined} messages examined, ${ing.inserted} new prompts`,
      );

      const pending = (
        db.prepare('SELECT COUNT(*) AS n FROM prompts WHERE processed = 0').get() as { n: number }
      ).n;
      if (!pending) {
        console.log('  nothing new to extract');
        break;
      }

      console.log(`  extracting topics from ${pending} prompts...`);
      const ext = await extractTopics({
        onProgress: (d, t) => process.stdout.write(`\r  ${d}/${t}`),
      });
      process.stdout.write('\r');
      console.log(
        `  ${ext.batches} batches, ${ext.topicsTouched} topics touched` +
          (ext.failures ? `, ${ext.failures} batches failed (will retry next run)` : ''),
      );
      recomputeWeights();
      showTopics(12);
      break;
    }

    case 'extract': {
      const ext = await extractTopics({
        onProgress: (d, t) => process.stdout.write(`\r  ${d}/${t}`),
      });
      process.stdout.write('\r');
      console.log(`extracted from ${ext.prompts} prompts, ${ext.topicsTouched} topics touched`);
      recomputeWeights();
      break;
    }

    case 'digest': {
      console.log('building digest...');
      const out = await buildDigest({ log: (m) => console.log(m) });
      console.log(`\n  ${out.items} items written for ${out.date}`);
      console.log(`  run "npm run serve" to read them`);
      break;
    }

    case 'publish': {
      const out = rest[0] ?? PUBLIC_SITE_DATA;
      const r = exportBriefings(out);
      console.log(`exported ${r.items} items across ${r.digests} digests`);
      console.log(`  -> ${r.outPath}`);
      break;
    }

    case 'serve':
      serve();
      return; // keep the process alive

    case 'status': {
      const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
      console.log(`
  prompts captured : ${n('SELECT COUNT(*) AS n FROM prompts')} (${n('SELECT COUNT(*) AS n FROM prompts WHERE processed = 0')} awaiting extraction)
  topics in map    : ${n('SELECT COUNT(*) AS n FROM topics')}
  edges            : ${n('SELECT COUNT(*) AS n FROM edges')}
  digest items     : ${n('SELECT COUNT(*) AS n FROM items')}
  last ingest      : ${getMeta('cc:lastIngest') ?? 'never'}
  llm backend      : ${LLM_BACKEND}`);
      showTopics(10);
      break;
    }

    case 'topics':
      recomputeWeights();
      showTopics(Number(rest[0] ?? 30));
      break;

    case 'pin':
    case 'mute': {
      if (!rest[0]) return void console.error(`usage: ${cmd} <topic-id>`);
      setTopicFlag(rest[0], cmd === 'pin' ? 'pinned' : 'muted', true);
      console.log(`${cmd}ned ${rest[0]}`);
      break;
    }

    case 'add': {
      const label = rest[0];
      if (!label) return void console.error('usage: add "<label>" [kind]');
      const kind = (TOPIC_KINDS as readonly string[]).includes(rest[1] ?? '')
        ? (rest[1] as TopicKind)
        : 'adjacent';
      console.log(`seeded and pinned ${seedTopic(label, kind)} (${kind})`);
      break;
    }

    default:
      console.log(USAGE);
  }
}

function showTopics(limit: number): void {
  const topics = allTopics().slice(0, limit);
  if (!topics.length) return void console.log('\n  (interest map is empty)');
  const pad = Math.max(...topics.map((t) => t.label.length));
  console.log('\n  interest map');
  for (const t of topics) {
    const bar = '#'.repeat(Math.round(Math.min(t.weight, 10) * 2));
    const flags = [t.pinned ? 'pinned' : '', t.muted ? 'muted' : ''].filter(Boolean).join(' ');
    console.log(
      `    ${t.label.padEnd(pad)}  ${t.weight.toFixed(2).padStart(5)}  ${bar}  ${t.kind}${flags ? ' [' + flags + ']' : ''}`,
    );
  }
  console.log();
}

main().catch((e) => {
  console.error(`\nerror: ${(e as Error).message}\n`);
  process.exit(1);
});
