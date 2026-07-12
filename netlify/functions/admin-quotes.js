const store  = require('./_store');
const agents = require('./_agents');
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
    // Accepts a personal PIN (AGENTS env) or the shared ADMIN_PASSWORD.
    // Fail closed when neither is configured — this repo is public, so any
    // default committed here is a published credential.
    const cred = agents.checkCredential(password);
    if (!cred.configured) {
      return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'No ADMIN_PASSWORD or AGENTS configured on the server.' }) };
    }
    if (!cred.ok) {
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
            createdBy:   record.createdBy   || '',
            activity:    (record._activity  || []).slice(-10),
            quoteUrl:    `${siteUrl}/.netlify/functions/view-quote?id=${key}`,
            optionCount: record.quoteData?.options?.length || 0,
            options:     (record.quoteData?.options || []).map(o => ({
              n:     o.optionNumber,
              name:  o.resortName    || '',
              pp:    o.pricePerPerson || '',
              total: o.totalPrice    || '',
            })),
            markup:      record.quoteData?.markup || null,
            baseOptions: (record.quoteData?._baseOptions || []).map(b => ({
              n:     b.optionNumber,
              pp:    b.pricePerPerson,
              total: b.totalPrice,
            })),
            phone:       record.phone       || '',
            email:       record.email       || '',
            contactId:   record.contactId   || '',
            occasion:    record.occasion    || '',
            adults:      record.adults      || '',
            children:    record.children    || '',
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
