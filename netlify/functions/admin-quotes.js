const { getStore } = require('@netlify/blobs');
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

  try {
    const { password } = JSON.parse(event.body || '{}');
    const adminPass = process.env.ADMIN_PASSWORD || 'izitravel2024';

    if (!password || password !== adminPass) {
      return {
        statusCode: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid password' }),
      };
    }

    const store  = getStore('quotes');
    const { blobs } = await store.list();

    // Fetch metadata for each quote (just the lightweight fields)
    const quotes = await Promise.all(
      blobs.map(async (blob) => {
        try {
          const record = await store.get(blob.key, { type: 'json' });
          const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'http://localhost:3002';
          return {
            quoteId:    blob.key,
            clientName:  record.clientName  || 'Unknown',
            destination: record.destination || 'Unknown',
            dates:       record.dates       || '',
            createdAt:   record.createdAt   || '',
            quoteUrl:    `${siteUrl}/.netlify/functions/view-quote?id=${blob.key}`,
            optionCount: record.quoteData?.options?.length || 0,
          };
        } catch {
          return { quoteId: blob.key, clientName: 'Error loading', createdAt: '' };
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
