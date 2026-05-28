/**
 * Unified quote store:
 * - Local dev: reads/writes JSON files in .netlify/blobs-local/
 * - Production (Netlify): uses @netlify/blobs
 */
const fs   = require('fs');
const path = require('path');

const LOCAL_DIR = path.resolve(__dirname, '../../.netlify/blobs-local');

function isNetlify() {
  return !!(process.env.NETLIFY && process.env.SITE_ID);
}

function ensureDir() {
  if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
}

async function setJSON(key, value) {
  if (isNetlify()) {
    const { getStore } = require('@netlify/blobs');
    return getStore('quotes').setJSON(key, value);
  }
  ensureDir();
  fs.writeFileSync(path.join(LOCAL_DIR, key + '.json'), JSON.stringify(value));
}

async function getJSON(key) {
  if (isNetlify()) {
    const { getStore } = require('@netlify/blobs');
    return getStore('quotes').get(key, { type: 'json' });
  }
  const file = path.join(LOCAL_DIR, key + '.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function listAll() {
  if (isNetlify()) {
    const { getStore } = require('@netlify/blobs');
    const { blobs } = await getStore('quotes').list();
    return blobs.map(b => b.key);
  }
  ensureDir();
  return fs.readdirSync(LOCAL_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5));
}

module.exports = { setJSON, getJSON, listAll };
