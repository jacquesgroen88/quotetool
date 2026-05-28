const store = require('./_store');
const { v4: uuidv4 } = require('uuid');
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

  // Initialise Netlify Blobs context for v1 functions (reads from event.blobs)
  store.init(event);

  try {
    const { quoteData, logoBase64, quoteId: existingId } = JSON.parse(event.body);
    if (!quoteData) throw new Error('quoteData is required');

    // If an existing ID is provided, update that record; otherwise create a new one
    const quoteId = existingId || uuidv4();

    const record = {
      quoteId,
      quoteData,
      logoBase64: logoBase64 || null,
      createdAt:  new Date().toISOString(),
      clientName: quoteData.clientName  || 'Unknown',
      destination: quoteData.destination || 'Unknown',
      dates:       quoteData.dates       || '',
    };

    await store.setJSON(quoteId, record);

    // Build the public view URL
    const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'http://localhost:3002';
    const quoteUrl = `${siteUrl}/.netlify/functions/view-quote?id=${quoteId}`;

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteId, quoteUrl, updated: !!existingId }),
    };
  } catch (err) {
    const msg = (err && (err.message || err.toString())) || 'Failed to save quote.';
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: msg }),
    };
  }
};
