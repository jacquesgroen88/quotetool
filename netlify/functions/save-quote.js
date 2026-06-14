const store = require('./_store');
const ghl   = require('./_ghl');
const { randomUUID } = require('crypto'); // built-in — no uuid package needed
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
    const { quoteData, logoBase64, quoteId: existingId, contactId } = JSON.parse(event.body);
    if (!quoteData) throw new Error('quoteData is required');

    // existingId is a gist ID for updates, or undefined for new quotes
    const inputId = existingId || randomUUID();

    const record = {
      quoteId: inputId,
      quoteData,
      logoBase64: logoBase64 || null,
      createdAt:  new Date().toISOString(),
      clientName:  quoteData.clientName  || 'Unknown',
      destination: quoteData.destination || 'Unknown',
      dates:       quoteData.dates       || '',
      phone:       quoteData.phone       || '',
      email:       quoteData.email       || '',
      occasion:    quoteData.occasion    || '',
      adults:      quoteData.adults      || '',
      children:    quoteData.children    || '',
      contactId:   contactId || null,    // GHL contact, when started from a lead
    };

    // setJSON returns the actual storage key (gist ID in prod, may differ from inputId for new quotes)
    const actualId = await store.setJSON(inputId, record);
    const quoteId  = actualId || inputId;

    // Build the public view URL
    const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'http://localhost:3002';
    const quoteUrl = `${siteUrl}/.netlify/functions/view-quote?id=${quoteId}`;

    // NOTE: generating/saving a quote does NOT move the GHL stage. The lead only
    // moves to "Quote Sent" when Terri actually sends it (email/WhatsApp) and
    // confirms — handled by the mark-quote-sent function. (contactId is stored
    // on the record above so the send action can find the opportunity.)

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
