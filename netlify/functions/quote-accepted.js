/**
 * Proxy for quote acceptance submissions.
 * Receives JSON from the client-side quote page (same-origin, no CORS issues)
 * and forwards it to Make.com with proper Content-Type: application/json.
 * This ensures Make.com always receives structured JSON — no 'value' wrapping.
 */
const https = require('https');
const ghl   = require('./_ghl');
const fs    = require('fs');
const path  = require('path');

try {
  const envPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
    });
  }
} catch {}

const MAKE_WEBHOOK = 'https://hook.eu2.make.com/bjdc1oe65zcqw7k5fckx592fssqh5upv';

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  try {
    const body = event.body || '{}';

    // Forward to Make.com server-side (no CORS, always application/json)
    await new Promise((resolve, reject) => {
      const url = new URL(MAKE_WEBHOOK);
      const buf = Buffer.from(body, 'utf8');
      const req = https.request(
        {
          hostname: url.hostname,
          path:     url.pathname + url.search,
          method:   'POST',
          headers: {
            'Content-Type':   'application/json',
            'Content-Length': buf.length,
            'User-Agent':     'IziTravel-Quote-Tool/1.0',
          },
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve(res.statusCode));
        }
      );
      req.on('error', reject);
      req.setTimeout(8000, () => { req.destroy(); reject(new Error('Make.com timed out')); });
      req.write(buf);
      req.end();
    });

    // Advance the GHL opportunity on acceptance (best-effort; matched by client email)
    try {
      const payload = JSON.parse(body);
      const email = payload.email || payload.clientEmail;
      if (email && ghl.enabled()) {
        const contact = await ghl.findContactByEmail(email);
        if (contact && contact.id) {
          await ghl.addTags(contact.id, ['quote-accepted']);
          await ghl.moveToStage({ contactId: contact.id, stageId: ghl.STAGES.quoteFollowUp });
          await ghl.addNote(contact.id, `👍 Client accepted quote ${payload.quoteRef || ''} (${(payload.selectedOption || {}).resortName || ''})`);
        }
      }
    } catch { /* GHL update is best-effort */ }

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to forward submission' }),
    };
  }
};
