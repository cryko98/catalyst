// ============================================================================
//  CATALYST — site configuration
//  This is the ONE file you edit to wire the site to your token & socials.
//  Everything here is public (it ships to the browser) — never put secrets here.
//  The OpenAI key lives only in Vercel/GitHub as an environment variable.
// ============================================================================

window.CATALYST_CONFIG = {
  // ---- Token ----------------------------------------------------------------
  // Paste your Solana mint address here after launch. Leave "TBA" until then.
  contractAddress: 'TBA',

  // Where "Acquire $CATA" points (e.g. your pump.fun / Raydium / DEX link).
  buyUrl: '#',

  // ---- Tokenomics (shown on the site; TBA is fine pre-launch) --------------
  tokenomics: {
    supply: 'TBA',
    tax: '0 / 0',
    liquidity: 'Burned',
    mintAuthority: 'Revoked',
  },

  // ---- Socials (icons appear in the nav & footer). Delete any you don't use. -
  // Only entries with a non-empty URL are shown.
  socials: {
    x: '', // e.g. 'https://x.com/yourhandle'
    telegram: '', // e.g. 'https://t.me/yourgroup'
    dexscreener: '', // e.g. 'https://dexscreener.com/solana/...'
  },

  // ---- Live feed source -----------------------------------------------------
  // The autonomous transmissions are committed to data/feed.json by the GitHub
  // Action. Serving them from the raw GitHub URL means new posts appear WITHOUT
  // redeploying Vercel. Falls back to the bundled ./data/feed.json if this
  // fetch fails. Update the user/repo/branch if you fork this.
  feedUrl:
    'https://raw.githubusercontent.com/cryko98/catalyst/main/data/feed.json',

  // How often the site re-checks the feed for new transmissions (ms).
  feedPollMs: 60_000,
};
