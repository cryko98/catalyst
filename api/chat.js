// ============================================================================
//  POST /api/chat  — live conversation with CATA, the Catalyst Oracle.
//
//  Runs as a Vercel serverless function. The OpenAI key lives ONLY here,
//  in an environment variable, and never reaches the browser.
//
//  Cost / abuse protection:
//    - Best-effort in-memory per-IP rate limit
//    - Hard caps on input length, history length, and output tokens
//    - You should ALSO set a hard monthly usage limit in the OpenAI dashboard
// ============================================================================

import { CHAT_SYSTEM_PROMPT } from '../prompts/persona.js';

const MODEL = 'gpt-4o-mini';
const MAX_MESSAGE_CHARS = 500; // longest single user message accepted
const MAX_HISTORY = 8; // most recent turns kept for context
const MAX_OUTPUT_TOKENS = 220; // cap CATA's reply length (cost control)

// --- Best-effort rate limiter (per warm instance) --------------------------
// Serverless instances are ephemeral and not shared, so this is a soft guard.
// The real ceiling is the OpenAI dashboard usage limit. Good enough to stop
// a single visitor from hammering the endpoint from one tab.
const WINDOW_MS = 60_000;
const MAX_REQ_PER_WINDOW = 8;
const hits = new Map(); // ip -> number[] (timestamps)

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  // opportunistic cleanup so the map can't grow without bound
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: 'The oracle is silent. (OPENAI_API_KEY not configured.)' });
  }

  if (rateLimited(clientIp(req))) {
    return res
      .status(429)
      .json({ error: 'The oracle needs a moment. Slow your questions, seeker.' });
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
    return res.status(400).json({ error: 'Speak, and the oracle listens.' });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return res
      .status(400)
      .json({ error: `Your question is too long (max ${MAX_MESSAGE_CHARS} characters).` });
  }

  // Sanitize prior turns: only role user/assistant, string content, capped.
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

  // --- Call OpenAI ---------------------------------------------------------
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.85,
        presence_penalty: 0.3,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!openaiRes.ok) {
      const detail = await openaiRes.text().catch(() => '');
      console.error('OpenAI error', openaiRes.status, detail);
      return res
        .status(502)
        .json({ error: 'The oracle could not be reached. Try again shortly.' });
    }

    const data = await openaiRes.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return res.status(502).json({ error: 'The oracle returned only silence.' });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ reply });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: 'The oracle took too long. Ask again.' });
    }
    console.error('chat handler error', err);
    return res.status(500).json({ error: 'A disturbance in the terminal. Try again.' });
  }
}
