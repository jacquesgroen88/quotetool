const store = require('./_store');
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

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function isTestRecord(clientName, destination) {
  const name = (clientName  || '').toLowerCase().trim();
  const dest = (destination || '').toLowerCase().trim();
  if (/^jacques(\s+test|\s*$)/i.test(name)) return true;
  if (name === 'terri bensch') return true;
  if (name === dest && name !== '') return true;
  return false;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const adminPass = process.env.ADMIN_PASSWORD || 'Reviewtap';
  if (!body.password || body.password !== adminPass) {
    return {
      statusCode: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid password' }),
    };
  }

  // Delete a specific quote by ID
  if (body.quoteId) {
    try {
      const deleted = await store.removeRecord(body.quoteId);
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleted, quoteId: body.quoteId }),
      };
    } catch (err) {
      return {
        statusCode: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message }),
      };
    }
  }

  // Auto-detect and delete all internal test records
  if (body.deleteTestRecords) {
    try {
      const keys = await store.listAll('quote');
      const results = [];
      for (const key of keys) {
        let record;
        try { record = await store.getJSON(key); } catch { continue; }
        if (!record) continue;
        if (isTestRecord(record.clientName, record.destination)) {
          const deleted = await store.removeRecord(key);
          results.push({
            quoteId:     key,
            clientName:  record.clientName,
            destination: record.destination,
            deleted,
          });
        }
      }
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deletedCount: results.filter(r => r.deleted).length,
          results,
        }),
      };
    } catch (err) {
      return {
        statusCode: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message }),
      };
    }
  }

  return {
    statusCode: 400,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Provide quoteId (string) or deleteTestRecords: true' }),
  };
};
