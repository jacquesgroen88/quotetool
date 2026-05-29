/**
 * Quote storage abstraction
 *
 * Production (Netlify): GitHub Gist API
 *   Requires: GITHUB_TOKEN env var (Personal Access Token with "gist" scope)
 *   Create at: https://github.com/settings/tokens → New classic token → check "gist"
 *   Then set GITHUB_TOKEN in Netlify dashboard → Site configuration → Environment variables
 *
 * Local dev (netlify dev): filesystem in .netlify/blobs-local/
 */
const fs   = require('fs');
const path = require('path');

const LOCAL_DIR      = path.resolve(__dirname, '../../.netlify/blobs-local');
const GITHUB_API     = 'https://api.github.com';
const GIST_FILE      = 'quote.json';
const GIST_TAG       = 'izitravel-quote'; // prefix used to identify our gists

// ── Environment detection ───────────────────────────────────────────────────
// Use GITHUB_TOKEN presence as the signal — it's only set in production (Netlify dashboard).
// process.env.NETLIFY is available during build but NOT reliably at function runtime.
function isProduction() {
  return !!process.env.GITHUB_TOKEN;
}

function ensureDir() {
  if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
}

function isGistId(key) {
  // GitHub gist IDs are 20–40 hex chars
  return /^[0-9a-f]{20,40}$/i.test(key);
}

// ── GitHub Gist helpers ─────────────────────────────────────────────────────
function ghHeaders() {
  return {
    'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
    'Accept':        'application/vnd.github.v3+json',
    'Content-Type':  'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent':    'IziTravel-Quote-Tool/1.0',
  };
}

function gistDescription(record) {
  const opts = (record.quoteData?.options || []).length;
  const parts = [
    GIST_TAG,
    record.clientName  || 'Unknown',
    record.destination || 'Unknown',
    record.dates       || '',
    String(opts),
    record.createdAt   || new Date().toISOString(),
  ];
  return parts.join('|');
}

async function ghFetch(url, options) {
  // Abort after 8 s so Netlify never kills us silently with a 502
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res;
  try {
    res = await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    throw new Error(`GitHub API request failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch {}
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

// ── Public API ──────────────────────────────────────────────────────────────

// Legacy no-op — no longer needed (replaced Netlify Blobs with GitHub Gists)
function init() {}

/**
 * Save or update a quote record.
 * Returns: the actual storage key (gist ID in prod, same key locally).
 * The returned key may differ from the input key for new quotes in production.
 */
async function setJSON(key, value) {
  if (isProduction()) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error(
        'GITHUB_TOKEN not set. Go to github.com/settings/tokens, create a classic token ' +
        'with "gist" scope, then add GITHUB_TOKEN in Netlify dashboard → Site configuration → ' +
        'Environment variables. Redeploy after saving.'
      );
    }

    const desc    = gistDescription(value);
    const content = JSON.stringify(value);

    if (isGistId(key)) {
      // Update existing gist in-place
      await ghFetch(`${GITHUB_API}/gists/${key}`, {
        method:  'PATCH',
        headers: ghHeaders(),
        body:    JSON.stringify({
          description: desc,
          files: { [GIST_FILE]: { content } },
        }),
      });
      return key;
    }

    // Create new (secret) gist
    const res  = await ghFetch(`${GITHUB_API}/gists`, {
      method:  'POST',
      headers: ghHeaders(),
      body:    JSON.stringify({
        description: desc,
        public:      false,
        files:       { [GIST_FILE]: { content } },
      }),
    });
    const data = await res.json();
    return data.id; // gist ID becomes the quoteId
  }

  // Local dev: filesystem
  ensureDir();
  fs.writeFileSync(path.join(LOCAL_DIR, key + '.json'), JSON.stringify(value));
  return key;
}

/**
 * Retrieve a quote record by key (gist ID in prod, filename locally).
 * Returns null if not found.
 */
async function getJSON(key) {
  if (isProduction()) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN not set');

    // Use raw fetch with timeout for getJSON so we can handle 404 without throwing
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res;
    try {
      res = await fetch(`${GITHUB_API}/gists/${key}`, { headers: ghHeaders(), signal: ctrl.signal });
    } catch (err) {
      throw new Error(`GitHub API request failed: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      let body = ''; try { body = await res.text(); } catch {}
      throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data    = await res.json();
    const content = data.files?.[GIST_FILE]?.content;
    if (!content) return null;
    return JSON.parse(content);
  }

  // Local dev
  const file = path.join(LOCAL_DIR, key + '.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * List all quote keys.
 * In production: returns gist IDs for all izitravel-quote gists (paginates).
 */
async function listAll() {
  if (isProduction()) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN not set');

    const ids = [];
    let page  = 1;
    while (true) {
      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), 8000);
      let res;
      try {
        res = await fetch(`${GITHUB_API}/gists?per_page=100&page=${page}`, { headers: ghHeaders(), signal: ctrl2.signal });
      } catch { break; } finally { clearTimeout(t2); }
      if (!res.ok) break;
      const gists = await res.json();
      for (const g of gists) {
        if (g.description && g.description.startsWith(GIST_TAG + '|')) {
          ids.push(g.id);
        }
      }
      if (gists.length < 100) break;
      page++;
    }
    return ids;
  }

  // Local dev
  ensureDir();
  return fs.readdirSync(LOCAL_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5));
}

module.exports = { init, setJSON, getJSON, listAll };
