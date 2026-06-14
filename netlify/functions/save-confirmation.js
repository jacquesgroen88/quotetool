const store = require('./_store');
const ghl   = require('./_ghl');
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

function datesOf(cd) {
  const t = cd && cd.travelDates;
  if (!t) return '';
  return [t.start, t.end].filter(Boolean).join(' - ');
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  try {
    const { confirmationData, logoBase64, confirmationId: existingId, contactId } = JSON.parse(event.body);
    if (!confirmationData) throw new Error('confirmationData is required');

    const inputId = existingId || randomUUID();

    const record = {
      recordType:  'confirmation',          // drives the storage namespace
      confirmationId: inputId,
      confirmationData,
      logoBase64:  logoBase64 || null,
      createdAt:   new Date().toISOString(),
      clientName:  confirmationData.clientName  || 'Unknown',
      destination: confirmationData.destination || 'Unknown',
      dates:       datesOf(confirmationData),
      contactId:   contactId || null,
    };

    const actualId = await store.setJSON(inputId, record);
    const confId   = actualId || inputId;

    const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'http://localhost:3002';
    const confirmationUrl = `${siteUrl}/.netlify/functions/view-confirmation?id=${confId}`;

    // Push to GHL → Booking Confirmed — only on the first save (not silent re-saves)
    if (contactId && !existingId) {
      const oppName = [record.clientName, record.destination].filter(Boolean).join(' — ');
      await ghl.moveToStage({ contactId, name: oppName || 'Booking', stageId: ghl.STAGES.bookingConfirmed, status: 'won' });
      await ghl.addNote(contactId, `✅ Booking confirmation sent — ${confirmationUrl}`);
    }

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmationId: confId, confirmationUrl, updated: !!existingId }),
    };
  } catch (err) {
    const msg = (err && (err.message || err.toString())) || 'Failed to save confirmation.';
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: msg }),
    };
  }
};
