const store = require('./_store');
const fs   = require('fs');
const path = require('path');

try {
  const envPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
    });
  }
} catch {}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  // Initialise Netlify Blobs context for v1 functions
  store.init(event);

  try {
    const { password } = JSON.parse(event.body || '{}');
    const adminPass = process.env.ADMIN_PASSWORD || 'Reviewtap';

    if (!password || password !== adminPass) {
      return {
        statusCode: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid password' }),
      };
    }

    const keys = await store.listAll();

    // Fetch metadata for each quote
    const quotes = await Promise.all(
      keys.map(async (key) => {
        try {
          const record = await store.getJSON(key);
          const blob = { key };
          const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'http://localhost:3002';
          return {
            quoteId:    key,
            clientName:  record.clientName  || 'Unknown',
            destination: record.destination || 'Unknown',
            dates:       record.dates       || '',
            createdAt:   record.createdAt   || '',
            quoteUrl:    `${siteUrl}/.netlify/functions/view-quote?id=${key}`,
            optionCount: record.quoteData?.options?.length || 0,
          };
        } catch {
          return { quoteId: key, clientName: 'Error loading', createdAt: '' };
        }
      })
    );

    // Sort newest first
    quotes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quotes }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to list quotes.' }),
    };
  }
};
