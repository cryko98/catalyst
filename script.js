/* ============================================================================
   CATALYST — front-end logic
   - Wires CONFIG (contract, socials, buy link, tokenomics) into the page
   - Streams CATA's autonomous feed (polls the JSON, types entries in)
   - Runs the live oracle chat against /api/chat
   ========================================================================== */

(function () {
  'use strict';

  const CONFIG = window.CATALYST_CONFIG || {};
  const $ = (sel, root = document) => root.querySelector(sel);

  // ---- SVG social icons -----------------------------------------------------
  const ICONS = {
    x: '<svg class="social-icon" viewBox="0 0 24 24"><path d="M18.9 1.6h3.5l-7.6 8.7L24 22.4h-7l-5.5-7.2-6.3 7.2H1.7l8.1-9.3L0 1.6h7.2l5 6.6 5.7-6.6Zm-1.2 18.7h1.9L6.4 3.6H4.3l13.4 16.7Z"/></svg>',
    telegram: '<svg class="social-icon" viewBox="0 0 24 24"><path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm5.6 8.2-1.9 8.9c-.1.6-.5.8-1 .5l-2.8-2.1-1.4 1.3c-.1.2-.3.3-.6.3l.2-2.9 5.2-4.7c.2-.2 0-.3-.3-.1L8.3 13 5.5 12c-.6-.2-.6-.6.1-.9l11-4.2c.5-.2 1 .1.8.9Z"/></svg>',
    dexscreener: '<svg class="social-icon" viewBox="0 0 24 24"><path d="M3 3h18v18H3V3Zm2 2v14h14V5H5Zm2 9h2v3H7v-3Zm4-4h2v7h-2v-7Zm4-3h2v10h-2V7Z"/></svg>',
    github: '<svg class="social-icon" viewBox="0 0 24 24"><path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7 0-.7 0-.7 1.2.1 1.9 1.2 1.9 1.2 1.1 1.9 2.9 1.3 3.6 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2 0-.4-.5-1.6.2-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C18 4.7 19 5 19 5c.7 1.6.2 2.8.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z"/></svg>',
  };

  function renderSocials(el) {
    if (!el) return;
    const socials = CONFIG.socials || {};
    const html = Object.entries(socials)
      .filter(([, url]) => url)
      .map(
        ([key, url]) =>
          `<a href="${url}" target="_blank" rel="noopener" aria-label="${key}">${ICONS[key] || key}</a>`
      )
      .join('');
    el.innerHTML = html;
  }

  // ---- Wire CONFIG into the page -------------------------------------------
  function applyConfig() {
    const ca = CONFIG.contractAddress || 'TBA';
    const caEl = $('#contract-address');
    if (caEl) caEl.textContent = ca;

    const buy = $('#buy-link');
    if (buy) {
      buy.href = CONFIG.buyUrl && CONFIG.buyUrl !== '#' ? CONFIG.buyUrl : '#';
      if (!CONFIG.buyUrl || CONFIG.buyUrl === '#') {
        buy.addEventListener('click', (e) => {
          e.preventDefault();
          alert('Acquisition link goes live at launch. The oracle counsels patience.');
        });
      }
    }

    const tok = CONFIG.tokenomics || {};
    if (tok.supply) $('#tok-supply').textContent = tok.supply;
    if (tok.tax) $('#tok-tax').textContent = tok.tax;
    if (tok.liquidity) $('#tok-lp').textContent = tok.liquidity;
    if (tok.mintAuthority) $('#tok-mint').textContent = tok.mintAuthority;

    renderSocials($('#nav-socials'));
    renderSocials($('#footer-socials'));

    const year = $('#year');
    if (year) year.textContent = new Date().getFullYear();

    // Copy contract address
    const copyBtn = $('#copy-ca');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const value = (caEl && caEl.textContent) || '';
        if (!value || value === 'TBA') {
          copyBtn.textContent = 'soon';
          setTimeout(() => (copyBtn.textContent = 'copy'), 1200);
          return;
        }
        try {
          await navigator.clipboard.writeText(value);
          copyBtn.textContent = 'copied';
        } catch {
          copyBtn.textContent = 'err';
        }
        setTimeout(() => (copyBtn.textContent = 'copy'), 1400);
      });
    }
  }

  // ---- Feed -----------------------------------------------------------------
  const feedEl = $('#feed');
  const seenIds = new Set();
  let feedInitialized = false;

  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  }

  function makeEntryNode(entry, { typed } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'feed__entry';
    const meta = document.createElement('div');
    meta.className = 'feed__meta';
    meta.innerHTML = `<span class="who">CATA</span> · <span>${fmtTime(entry.ts)}</span> · <span>TRANSMISSION</span>`;
    const text = document.createElement('div');
    text.className = 'feed__text';
    wrap.appendChild(meta);
    wrap.appendChild(text);

    if (typed) {
      typeText(text, entry.text);
    } else {
      text.textContent = entry.text;
    }
    return wrap;
  }

  function typeText(el, str, speed = 14) {
    el.classList.add('feed__cursor');
    let i = 0;
    (function tick() {
      if (i <= str.length) {
        el.textContent = str.slice(0, i);
        i++;
        setTimeout(tick, speed);
      } else {
        el.classList.remove('feed__cursor');
      }
    })();
  }

  async function fetchFeed() {
    // Try the live (raw GitHub) source first, then the bundled fallback.
    const sources = [CONFIG.feedUrl, './data/feed.json'].filter(Boolean);
    for (const url of sources) {
      try {
        const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (Array.isArray(data)) return data;
      } catch {
        /* try next source */
      }
    }
    return null;
  }

  function renderFeed(entries) {
    if (!feedEl) return;

    if (!feedInitialized) {
      feedEl.innerHTML = '';
      // Oldest at top, newest at bottom, so the stream reads like a log.
      const ordered = [...entries].reverse();
      ordered.forEach((e) => {
        seenIds.add(e.id);
        feedEl.appendChild(makeEntryNode(e, { typed: false }));
      });
      feedEl.scrollTop = feedEl.scrollHeight;
      feedInitialized = true;
      return;
    }

    // Append only genuinely new entries (feed is newest-first).
    const fresh = entries.filter((e) => !seenIds.has(e.id)).reverse();
    fresh.forEach((e) => {
      seenIds.add(e.id);
      const nearBottom =
        feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 80;
      feedEl.appendChild(makeEntryNode(e, { typed: true }));
      if (nearBottom) feedEl.scrollTop = feedEl.scrollHeight;
    });
  }

  async function pollFeed() {
    const entries = await fetchFeed();
    if (entries && entries.length) {
      renderFeed(entries);
      const status = $('#feed-status');
      if (status) status.innerHTML = '<span class="pulse"></span> LIVE';
    } else if (!feedInitialized && feedEl) {
      feedEl.innerHTML =
        '<div class="feed__loading">the oracle is warming up… transmissions will appear shortly<span class="blink">_</span></div>';
    }
  }

  function startFeed() {
    pollFeed();
    setInterval(pollFeed, CONFIG.feedPollMs || 60000);
  }

  // ---- Chat -----------------------------------------------------------------
  const chatEl = $('#chat');
  const chatForm = $('#chat-form');
  const chatInput = $('#chat-input');
  const history = []; // {role, content}

  function addChatLine(who, text, cls = '') {
    const line = document.createElement('div');
    line.className = `chat__line chat__line--${who === 'CATA' ? 'cata' : 'user'} ${cls}`;
    line.innerHTML = `<span class="chat__who">${who}</span><span class="chat__text"></span>`;
    line.querySelector('.chat__text').textContent = text;
    chatEl.appendChild(line);
    chatEl.scrollTop = chatEl.scrollHeight;
    return line;
  }

  async function sendMessage(message) {
    addChatLine('SEEKER', message);
    history.push({ role: 'user', content: message });

    const thinking = addChatLine('CATA', 'consulting the grass', 'chat__typing');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, messages: history.slice(-8) }),
      });

      const data = await res.json().catch(() => ({}));
      thinking.classList.remove('chat__typing');
      const textEl = thinking.querySelector('.chat__text');

      if (!res.ok) {
        textEl.textContent =
          data.error || 'The oracle is unreachable. Try again shortly.';
        textEl.parentElement.classList.add('chat__error');
        return;
      }

      const reply = data.reply || 'The oracle returned only silence.';
      textEl.textContent = '';
      // gentle typing effect for the reply
      let i = 0;
      (function tick() {
        if (i <= reply.length) {
          textEl.textContent = reply.slice(0, i++);
          chatEl.scrollTop = chatEl.scrollHeight;
          setTimeout(tick, 12);
        }
      })();
      history.push({ role: 'assistant', content: reply });
    } catch (err) {
      thinking.classList.remove('chat__typing');
      const textEl = thinking.querySelector('.chat__text');
      textEl.textContent =
        'The connection to the oracle failed. (Is /api/chat deployed?)';
      textEl.parentElement.classList.add('chat__error');
    }
  }

  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = chatInput.value.trim();
      if (!msg) return;
      chatInput.value = '';
      sendMessage(msg);
    });
  }

  // ---- Boot -----------------------------------------------------------------
  applyConfig();
  startFeed();
})();
