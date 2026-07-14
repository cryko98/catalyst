// ============================================================================
//  _tokens.js — live token data via the DexScreener public API (no key needed).
//
//  The leading underscore keeps Vercel from turning this into an HTTP endpoint;
//  it is imported by api/chat.js as CATA's lookup_token tool.
//
//  Docs: https://docs.dexscreener.com/api/reference
// ============================================================================

// Base58 (no 0/O/I/l) address, Solana mint length range.
const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`DexScreener ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function summarizePair(p) {
  return {
    name: p.baseToken?.name ?? null,
    symbol: p.baseToken?.symbol ?? null,
    address: p.baseToken?.address ?? null,
    chain: p.chainId ?? null,
    dex: p.dexId ?? null,
    priceUsd: p.priceUsd ?? null,
    marketCapUsd: p.marketCap ?? p.fdv ?? null,
    fdvUsd: p.fdv ?? null,
    liquidityUsd: p.liquidity?.usd ?? null,
    volume24hUsd: p.volume?.h24 ?? null,
    priceChangePct: p.priceChange ?? null, // { m5, h1, h6, h24 }
    pairCreatedAt: p.pairCreatedAt
      ? new Date(p.pairCreatedAt).toISOString()
      : null,
    url: p.url ?? null,
  };
}

/**
 * Look up live market data for a token by ticker, name, or contract/mint address.
 * Returns the highest-liquidity match plus a few alternatives.
 */
export async function lookupToken(rawQuery) {
  const query = String(rawQuery || '')
    .trim()
    .replace(/^\$/, '');
  if (!query) return { found: false, error: 'empty query' };

  const isAddress = SOL_ADDR_RE.test(query);
  let pairs = [];
  try {
    if (isAddress) {
      const data = await fetchJson(
        `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(query)}`
      );
      pairs = Array.isArray(data?.pairs) ? data.pairs : [];
    } else {
      const data = await fetchJson(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`
      );
      pairs = Array.isArray(data?.pairs) ? data.pairs : [];
    }
  } catch (err) {
    return { found: false, query, error: 'lookup failed' };
  }

  // For an address lookup, DexScreener returns every pair the address appears
  // in — including ones where it's the QUOTE side (e.g. a stablecoin). Keep
  // only pairs where the queried address is the BASE token, so we describe the
  // token that was actually asked about, not its trading pair.
  if (isAddress) {
    const q = query.toLowerCase();
    const asBase = pairs.filter(
      (p) => (p.baseToken?.address || '').toLowerCase() === q
    );
    if (asBase.length) pairs = asBase;
  }

  if (!pairs.length) return { found: false, query };

  // Rank by the pair that represents the LIVE market: 24h volume first, then
  // liquidity as a tie-break. This avoids surfacing a high-liquidity but dead
  // (near-zero volume) or stale pool over the token's actively traded pair.
  const score = (p) => [p?.volume?.h24 || 0, p?.liquidity?.usd || 0];
  pairs.sort((a, b) => {
    const [av, al] = score(a);
    const [bv, bl] = score(b);
    return bv - av || bl - al;
  });

  const token = summarizePair(pairs[0]);
  const alternatives = pairs.slice(1, 4).map((p) => ({
    symbol: p.baseToken?.symbol ?? null,
    name: p.baseToken?.name ?? null,
    chain: p.chainId ?? null,
    liquidityUsd: p.liquidity?.usd ?? null,
    address: p.baseToken?.address ?? null,
  }));

  return {
    found: true,
    query,
    matchCount: pairs.length,
    dataAsOf: new Date().toISOString(),
    token,
    alternatives,
  };
}
