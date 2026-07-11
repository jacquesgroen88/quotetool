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

  try {
    const { password } = JSON.parse(event.body || '{}');
    // Fail closed: no fallback password — this repo is public (see admin-quotes.js).
    const adminPass = process.env.ADMIN_PASSWORD;
    if (!adminPass) {
      return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'ADMIN_PASSWORD is not configured on the server.' }) };
    }
    if (!password || password !== adminPass) {
      return { statusCode: 401, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid password' }) };
    }

    const keys    = await store.listAll('confirmation');
    const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'http://localhost:3002';

    const confirmations = await Promise.all(keys.map(async (key) => {
      try {
        const record = await store.getJSON(key);
        const cd = record.confirmationData || {};
        const p  = cd.pricing || {};
        return {
          confirmationId: key,
          contactId:   record.contactId   || '',
          clientName:  record.clientName  || cd.clientName  || 'Unknown',
          destination: record.destination || cd.destination || 'Unknown',
          dates:       record.dates       || '',
          createdAt:   record.createdAt   || '',
          viewUrl:     `${siteUrl}/.netlify/functions/view-confirmation?id=${key}`,
          bookingRef:  cd.bookingRef || '',
          resort:      cd.resort?.name || '',
          paxCount:    cd.paxCount || (Array.isArray(cd.passengers) ? String(cd.passengers.length) : ''),
          passengers:  (cd.passengers || []).map(p => [p.title, p.firstName, p.surname].filter(Boolean).join(' ')),
          total:       p.total      || '',
          deposit:     p.deposit    || '',
          depositDue:  p.depositDue || '',
          balance:     p.balance    || '',
          balanceDue:  p.balanceDue || '',
          markup:      (p.markupPct != null && p.markupPct !== 0) ? p.markupPct : null,
          baseTotal:   p._baseTotal || '',
        };
      } catch {
        return { confirmationId: key, clientName: 'Error loading', createdAt: '' };
      }
    }));

    confirmations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmations }),
    };
  } catch (err) {
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message || 'Failed to list confirmations.' }) };
  }
};
