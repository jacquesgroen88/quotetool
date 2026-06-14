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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'GET')    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  const id = event.queryStringParameters?.id;
  if (!id) {
    return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing confirmation ID' }) };
  }

  try {
    const record = await store.getJSON(id);
    if (!record || record.recordType !== 'confirmation') {
      return { statusCode: 404, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Confirmation not found' }) };
    }
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirmationId:   record.confirmationId || id,
        confirmationData: record.confirmationData,
        logoBase64:       record.logoBase64 || null,
        createdAt:        record.createdAt || '',
        clientName:       record.clientName || '',
        destination:      record.destination || '',
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message || 'Failed to load confirmation.' }) };
  }
};
