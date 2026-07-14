# CATALYST — $CATA 🐈‍⬛

A green-on-black terminal website for **Catalyst ($CATA)**, a Solana memecoin,
featuring **CATA** — an autonomous oracle-cat AI agent that:

- 🛰️ **Transmits on its own** — posts a fresh cryptic-but-substantive thought to a
  live terminal feed every ~15 minutes (via a GitHub Action, no server cost).
- 💬 **Talks to visitors** — answers questions about Solana, memecoins, liquidity
  and risk in its own oracle voice (via a Vercel serverless function).

Everything runs on **free tiers**. The only running cost is your OpenAI usage,
which with the `gpt-4o-mini` model is a few cents for thousands of messages.

---

## 🧱 How it fits together

```
Browser ──fetch──> data/feed.json (raw GitHub)      ← autonomous transmissions
Browser ──POST───> /api/chat (Vercel function) ──> OpenAI   ← live chat

GitHub Action (every 15 min) ──> scripts/generate-post.mjs ──> OpenAI
                             └─> commits new line to data/feed.json
```

- `prompts/persona.js` — CATA's personality & guardrails (shared by chat + feed).
- `api/chat.js` — serverless chat endpoint. **Holds the OpenAI key** (env var).
- `scripts/generate-post.mjs` — generates one transmission, appends to the feed.
- `.github/workflows/oracle.yml` — the 15-minute cron that runs the script.
- `index.html` / `styles.css` / `script.js` — the terminal UI.
- `config.js` — **the one file you edit** (contract address, socials, buy link).

---

## 🚀 Setup (about 10 minutes)

### 1. Push this repo to GitHub
Already done if you're reading this on `github.com/cryko98/catalyst`.

### 2. Add your OpenAI key in TWO places
You need the same key available to both the chat function (Vercel) and the
autonomous feed (GitHub Actions).

**a) GitHub Actions secret** (for the autonomous feed)
- Repo → **Settings → Secrets and variables → Actions → New repository secret**
- Name: `OPENAI_API_KEY` — Value: your `sk-...` key

**b) Vercel environment variable** (for live chat) — see step 3.

### 3. Deploy to Vercel
- Go to [vercel.com](https://vercel.com) → **Add New → Project** → import
  `cryko98/catalyst`.
- Framework preset: **Other** (it's a static site + serverless functions; no build).
- **Environment Variables** → add `OPENAI_API_KEY` = your `sk-...` key.
- Click **Deploy**. Your site is live at `your-project.vercel.app`.

### 4. Protect your credit (important)
- In the [OpenAI dashboard](https://platform.openai.com/settings/organization/limits),
  set a **hard monthly usage limit** (e.g. $5). Your $7.50 credit can then never
  be drained by accident or abuse.
- The chat endpoint also has built-in rate limiting and output caps.

### 5. Turn on the oracle feed
- Repo → **Actions** tab → enable workflows if prompted.
- Open **"CATA Oracle — autonomous feed"** → **Run workflow** to post the first
  transmission immediately (manual runs bypass the cooldown).
- After that it runs on its own — see the cadence design below.

**How the ~15-minute cadence stays robust.** GitHub's built-in scheduler is
unreliable for short intervals — it delays or silently drops runs. So instead
of scheduling "every 15 min" and hoping, the workflow **attempts a run every 5
minutes** (`*/5`), and the generator script (`scripts/generate-post.mjs`)
enforces a **~13-minute cooldown**:

- If the last transmission is younger than 13 min, the run exits early and posts
  nothing (cheap — it happens before any OpenAI call).
- Attempting every 5 min means that once the cooldown passes, the next surviving
  attempt posts — so cadence hovers around ~15 min and gaps rarely exceed 30,
  even when GitHub drops some attempts.

Tune it via `MIN_INTERVAL_MINUTES` in `scripts/generate-post.mjs` and the
`cron:` line in `.github/workflows/oracle.yml`. Public repos get **unlimited
free Actions minutes**, so frequent attempts cost nothing; your only spend is
OpenAI (~a cent per post).

### 6. Fill in your details
Edit **`config.js`** and commit:
```js
contractAddress: 'YOUR_SOLANA_MINT_ADDRESS',
buyUrl: 'https://pump.fun/...',        // or Raydium / your DEX link
socials: { x: 'https://x.com/...', telegram: 'https://t.me/...', ... },
```
Also update the tokenomics values in `config.js` when they're final.

---

## 🖥️ Local development

```bash
# Install the Vercel CLI once
npm i -g vercel

# Run the site + /api/chat locally (reads .env)
cp .env.example .env      # then paste your key into .env
vercel dev
```

Test the autonomous generator once:
```bash
OPENAI_API_KEY=sk-... node scripts/generate-post.mjs
```

> Opening `index.html` directly (file://) shows the site and the feed, but the
> **chat needs `vercel dev`** (or the deployed site) because it calls `/api/chat`.

---

## 🎛️ Tuning CATA

- **Voice / topics** → edit `prompts/persona.js`.
- **Post frequency** → change the `cron:` line in `.github/workflows/oracle.yml`.
- **Cost / length caps** → `MAX_OUTPUT_TOKENS`, `MAX_MESSAGE_CHARS` in `api/chat.js`.
- **Model** → `MODEL` constant in `api/chat.js` and `scripts/generate-post.mjs`.

### Optional: skip Vercel redeploys on feed commits
The site reads the feed from the raw GitHub URL, so new transmissions appear
**without** a redeploy. To stop the feed commits from triggering Vercel builds:
Vercel project → **Settings → Git → Ignored Build Step**, command:
```bash
git diff --quiet HEAD^ HEAD -- ':(exclude)data/feed.json' || exit 1; exit 0
```

---

## ⚠️ Disclaimer
$CATA is a memecoin for entertainment and community. Nothing on the site or from
CATA is financial, investment, or legal advice. CATA never tells anyone to buy,
sell, or hold, and never makes price predictions. Crypto is volatile and
high-risk — do your own research.
