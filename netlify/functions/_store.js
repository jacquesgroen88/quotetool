/**
 * Unified quote store:
 * - Production (Netlify): uses @netlify/blobs
 *   IMPORTANT: For Netlify Functions v1, Blobs context is in event.blobs + headers.
 *   Call store.init(event) at the top of each handler before any get/set operation.
 * - Local dev (netlify dev): falls back to filesystem in .netlify/blobs-local/
 *
 * Detection: NETLIFY is set in both prod and local dev, but NETLIFY_DEV is only
 * set during `netlify dev`. So prod = NETLIFY && !NETLIFY_DEV.
 */
const fs   = require('fs');
const path = require('path');

const LOCAL_DIR = path.resolve(__dirname, '../../.netlify/blobs-local');

function isProduction() {
  return !!(process.env.NETLIFY && !process.env.NETLIFY_DEV);
}

function ensureDir() {
  if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
}

/**
 * Must be called once per function invocation with the Lambda event object.
 * Initialises the Netlify Blobs context from event.blobs + request headers.
 * No-op in local dev or if already initialised.
 */
function init(event) {
  if (!isProduction()) return;
  if (!event) return;
  try {
    const { connectLambda } = require('@netlify/blobs');
    connectLambda(event);
  } catch (e) {
    // connectLambda may throw if event.blobs is absent (older CLI / local calls)
    // That's fine — getStore() will still try NETLIFY_BLOBS_CONTEXT as fallback
  }
}

async function setJSON(key, value) {
  if (isProduction()) {
    const { getStore } = require('@netlify/blobs');
    return getStore('quotes').setJSON(key, value);
  }
  ensureDir();
  fs.writeFileSync(path.join(LOCAL_DIR, key + '.json'), JSON.stringify(value));
}

async function getJSON(key) {
  if (isProduction()) {
    const { getStore } = require('@netlify/blobs');
    return getStore('quotes').get(key, { type: 'json' });
  }
  const file = path.join(LOCAL_DIR, key + '.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function listAll() {
  if (isProduction()) {
    const { getStore } = require('@netlify/blobs');
    const { blobs } = await getStore('quotes').list();
    return blobs.map(b => b.key);
  }
  ensureDir();
  return fs.readdirSync(LOCAL_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5));
}

module.exports = { init, setJSON, getJSON, listAll };
