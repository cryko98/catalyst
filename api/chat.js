// ============================================================================
//  POST /api/chat  — live conversation with CATA, the Catalyst analyst cat.
//
//  Runs as a Vercel serverless function. The OpenAI key lives ONLY here, in an
//  environment variable, and never reaches the browser.
//
//  CATA can call a `lookup_token` tool that pulls LIVE market data from the
//  DexScreener public API (see api/_tokens.js), so it answers about real coins
//  with real numbers instead of guessing.
//
//  Cost / abuse protection:
//    - Best-effort in-memory per-IP rate limit
//    - Hard caps on input length, history length, tool rounds, and output tokens
//    - You should ALSO set a hard monthly usage limit in the OpenAI dashboard
// ============================================================================

import { CHAT_SYSTEM_PROMPT } from '../prompts/persona.js';
import { lookupToken } from './_tokens.js';

const MODEL = 'gpt-4o-mini';
const MAX_MESSAGE_CHARS = 500; // longest single user message accepted
const MAX_HISTORY = 8; // most recent turns kept for context
const MAX_OUTPUT_TOKENS = 320; // cap CATA's reply length (cost control)
const MAX_TOOL_ROUNDS = 2; // how many times CATA may call tools per message

// Tool schema exposed to the model.
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'lookup_token',
      description:
        'Get LIVE market data (price, market cap, liquidity, 24h volume, price change, chain, pair age) for a crypto token. Call this whenever the user asks about a specific coin, ticker, or contract/mint address, so you can cite real current numbers instead of guessing.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'A ticker (e.g. "ansem" or "$ANSEM"), a token name, or a full contract/mint address.',
          },
        },
        required: ['query'],
      },
    },
  },
];

// --- Best-effort rate limiter (per warm instance) --------------------------
const WINDOW_MS = 60_000;
const MAX_REQ_PER_WINDOW = 8;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
    }
  }
  return arr.length > MAX_REQ_PER_WINDOW;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

async function callOpenAI(apiKey, messages, { withTools }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.8,
        presence_penalty: 0.2,
        ...(withTools ? { tools: TOOLS, tool_choice: 'auto' } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const err = new Error(`OpenAI ${res.status}`);
      err.detail = detail;
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function runTool(name, argsJson) {
  if (name !== 'lookup_token') {
    return { error: `unknown tool: ${name}` };
  }
  let args = {};
  try {
    args = JSON.parse(argsJson || '{}');
  } catch {
    /* leave empty */
  }
  return await lookupToken(args.query);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: 'CATA is offline. (OPENAI_API_KEY not configured.)' });
  }

  if (rateLimited(clientIp(req))) {
    return res
      .status(429)
      .json({ error: 'Easy — too many questions too fast. Give it a second.' });
  }

  // --- Parse & validate input ---------------------------------------------
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Malformed request.' });
    }
  }

  const rawHistory = Array.isArray(body?.messages) ? body.messages : [];
  const message = typeof body?.message === 'string' ? body.message.trim() : '';

  if (!message) {
    return res.status(400).json({ error: 'Type something and CATA will read it.' });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return res
      .status(400)
      .json({ error: `Too long (max ${MAX_MESSAGE_CHARS} characters).` });
  }

  const history = rawHistory
    .filter(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string'
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));

  const messages = [
    { role: 'system', content: CHAT_SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: message },
  ];

  // --- Model loop with tool calls -----------------------------------------
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      // On the final allowed round, drop tools so the model must answer.
      const withTools = round < MAX_TOOL_ROUNDS;
      const data = await callOpenAI(apiKey, messages, { withTools });
      const choice = data?.choices?.[0];
      const msg = choice?.message;

      if (!msg) {
        return res.status(502).json({ error: 'CATA returned nothing. Try again.' });
      }

      const toolCalls = msg.tool_calls || [];
      if (toolCalls.length && withTools) {
        // Record the assistant's tool-call turn, then answer each tool call.
        messages.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: toolCalls,
        });
        for (const call of toolCalls) {
          const result = await runTool(
            call.function?.name,
            call.function?.arguments
          );
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
        continue; // loop again so CATA can use the data
      }

      const reply = (msg.content || '').trim();
      if (!reply) {
        return res.status(502).json({ error: 'CATA returned only silence.' });
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ reply });
    }

    return res.status(502).json({ error: 'CATA got stuck mid-analysis. Try again.' });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: 'CATA took too long. Ask again.' });
    }
    console.error('chat handler error', err?.status || '', err?.detail || err);
    return res.status(502).json({ error: 'CATA hit a snag reaching the market. Try again.' });
  }
}
