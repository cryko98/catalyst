// ============================================================================
//  generate-post.mjs — emits ONE new CATA transmission into data/feed.json
//
//  Invoked by .github/workflows/oracle.yml on a 15-minute cron. Requires the
//  OPENAI_API_KEY environment variable (a GitHub Actions secret in CI).
//
//  It reads the existing feed, asks CATA for a fresh transmission, prepends it,
//  trims the file to the most recent MAX_ENTRIES, and writes it back.
// ============================================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FEED_SYSTEM_PROMPT, FEED_TOPIC_SEEDS } from '../prompts/persona.js';

const MODEL = 'gpt-4o-mini';
const MAX_ENTRIES = 200; // keep the feed file from growing without bound
const MAX_OUTPUT_TOKENS = 160;

const __dirname = dirname(fileURLToPath(import.meta.url));
const FEED_PATH = join(__dirname, '..', 'data', 'feed.json');

async function loadFeed() {
  try {
    const raw = await readFile(FEED_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Pick a topic seed, avoiding whatever the previous transmission used. */
function pickSeed(feed) {
  const last = feed[0]?.seed;
  const pool = FEED_TOPIC_SEEDS.filter((s) => s !== last);
  const list = pool.length ? pool : FEED_TOPIC_SEEDS;
  return list[Math.floor(Math.random() * list.length)];
}

/** Give the model a little recent context so it does not repeat itself. */
function recentSummary(feed) {
  const recent = feed.slice(0, 4).map((e) => `- ${e.text}`);
  if (!recent.length) return '';
  return `\n\nYour last few transmissions (do NOT repeat their wording or topic):\n${recent.join('\n')}`;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY is not set.');
    process.exit(1);
  }

  const feed = await loadFeed();
  const seed = pickSeed(feed);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: FEED_SYSTEM_PROMPT },
        { role: 'user', content: `${seed}${recentSummary(feed)}` },
      ],
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 1.0,
      presence_penalty: 0.6,
      frequency_penalty: 0.4,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('OpenAI error', res.status, detail);
    process.exit(1);
  }

  const data = await res.json();
  let text = data?.choices?.[0]?.message?.content?.trim();

  if (!text) {
    console.error('Empty transmission from OpenAI.');
    process.exit(1);
  }

  // Strip surrounding quotes the model sometimes adds.
  text = text.replace(/^["'`]+|["'`]+$/g, '').trim();

  const entry = {
    id: `t-${Date.now()}`,
    ts: new Date().toISOString(),
    text,
    seed,
  };

  const next = [entry, ...feed].slice(0, MAX_ENTRIES);

  await mkdir(dirname(FEED_PATH), { recursive: true });
  await writeFile(FEED_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8');

  console.log('New transmission stored:\n', text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
