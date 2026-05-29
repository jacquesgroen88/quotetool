/**
 * Quote storage abstraction
 *
 * Production (Netlify): GitHub Gist API via Node https module
 *   Requires: GITHUB_TOKEN env var (Personal Access Token with "gist" scope)
 *   Create at: https://github.com/settings/tokens → New classic token → check "gist"
 *   Then set GITHUB_TOKEN in Netlify dashboard → Site configuration → Environment variables
 *
 * Local dev (netlify dev): filesystem in .netlify/blobs-local/
 *
 * NOTE: Uses Node's built-in https module (not native fetch / undici) because
 * undici has reliability issues connecting to api.github.com from some Lambda IPs.
 */
const fs    = require('fs');
const path  = require('path');
const https = require('https');

const LOCAL_DIR = path.resolve(__dirname, '../../.netlify/blobs-local');
const GH_HOST   = 'api.github.com';
const GIST_FILE = 'quote.json';
const GIST_TAG  = 'izitravel-quote';

// ── Environment detection ───────────────────────────────────────────────────
function isProduction() {
  return !!process.env.GITHUB_TOKEN;
}

function ensureDir() {
  if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
}

function isGistId(key) {
  return /^[0-9a-f]{20,40}$/i.test(key);
}

// ── https helpers ───────────────────────────────────────────────────────────
function ghBaseHeaders(token) {
  return {
    'Authorization':        `Bearer ${token}`,
    'Accept':               'application/vnd.github.v3+json',
    'User-Agent':           'IziTravel-Quote-Tool/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Make an HTTPS request to api.github.com.
 * Returns { status, body (string) }.
 * Throws on network error or timeout (8 s).
 */
function ghRequest(method, path_, token, payload) {
  return new Promise((resolve, reject) => {
    const bodyBuf = payload ? Buffer.from(JSON.stringify(payload), 'utf8') : null;
    const headers = {
      ...ghBaseHeaders(token),
      'Content-Type': 'application/json',
    };
    if (bodyBuf) headers['Content-Length'] = bodyBuf.length;

    const req = https.request(
      {
        hostname: GH_HOST,
        path:     path_,
        method,
        headers,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end',  () => resolve({ status: res.statusCode, body }));
      }
    );

    req.on('error', (err) => reject(new Error(`GitHub HTTPS error: ${err.message}`)));
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('GitHub API timed out after 8 s')); });

    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function gistDescription(record) {
  const opts  = (record.quoteData?.options || []).length;
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

// ── Public API ──────────────────────────────────────────────────────────────

function init() {} // no-op — kept for compatibility

/**
 * Save or update a quote record.
 * logoBase64 is NOT stored in the gist — it's always loaded from the static site.
 * Returns the actual storage key (gist ID in prod, same key locally).
 */
async function setJSON(key, value) {
  if (isProduction()) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN not set.');

    // Strip logo before saving — always served from /assets/izilogo.jpg
    const { logoBase64: _logo, ...record } = value;
    const desc    = gistDescription(record);
    const content = JSON.stringify(record);

    if (isGistId(key)) {
      // Update existing gist
      const { status, body } = await ghRequest('PATCH', `/gists/${key}`, token, {
        description: desc,
        files: { [GIST_FILE]: { content } },
      });
      if (status < 200 || status >= 300) {
        throw new Error(`GitHub API PATCH ${status}: ${body.slice(0, 200)}`);
      }
      return key;
    }

    // Create new secret gist
    const { status, body } = await ghRequest('POST', '/gists', token, {
      description: desc,
      public:      false,
      files:       { [GIST_FILE]: { content } },
    });
    if (status < 200 || status >= 300) {
      throw new Error(`GitHub API POST ${status}: ${body.slice(0, 200)}`);
    }
    const data = JSON.parse(body);
    return data.id;
  }

  // Local dev: filesystem
  ensureDir();
  fs.writeFileSync(path.join(LOCAL_DIR, key + '.json'), JSON.stringify(value));
  return key;
}

/**
 * Retrieve a quote record by key.
 * Returns null if not found.
 */
async function getJSON(key) {
  if (isProduction()) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN not set');

    const { status, body } = await ghRequest('GET', `/gists/${key}`, token, null);
    if (status === 404) return null;
    if (status < 200 || status >= 300) {
      throw new Error(`GitHub API GET ${status}: ${body.slice(0, 200)}`);
    }
    const data    = JSON.parse(body);
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
 * List all quote keys (gist IDs in prod, filenames locally).
 */
async function listAll() {
  if (isProduction()) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN not set');

    const ids  = [];
    let   page = 1;
    while (true) {
      const { status, body } = await ghRequest('GET', `/gists?per_page=100&page=${page}`, token, null);
      if (status < 200 || status >= 300) break;
      const gists = JSON.parse(body);
      for (const g of gists) {
        if (g.description && g.description.startsWith(GIST_TAG + '|')) ids.push(g.id);
      }
      if (gists.length < 100) break;
      page++;
    }
    return ids;
  }

  ensureDir();
  return fs.readdirSync(LOCAL_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5));
}

module.exports = { init, setJSON, getJSON, listAll };
