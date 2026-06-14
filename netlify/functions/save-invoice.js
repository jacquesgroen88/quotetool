const store = require('./_store');
const { randomUUID } = require('crypto');
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
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  try {
    const { invoiceData, logoBase64, invoiceId: existingId, contactId } = JSON.parse(event.body);
    if (!invoiceData) throw new Error('invoiceData is required');
    const inputId = existingId || randomUUID();

    const record = {
      recordType:  'invoice',
      invoiceId:   inputId,
      invoiceData,
      logoBase64:  logoBase64 || null,
      createdAt:   new Date().toISOString(),
      clientName:  invoiceData.clientName  || 'Unknown',
      destination: invoiceData.destination || '',
      dates:       invoiceData.invoiceNo   || '',
      contactId:   contactId || null,
    };

    const actualId = await store.setJSON(inputId, record);
    const invId    = actualId || inputId;
    const siteUrl  = process.env.URL || process.env.DEPLOY_URL || 'http://localhost:3002';
    const invoiceUrl = `${siteUrl}/.netlify/functions/view-invoice?id=${invId}`;

    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId: invId, invoiceUrl, updated: !!existingId }) };
  } catch (err) {
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: (err && err.message) || 'Failed to save invoice.' }) };
  }
};
