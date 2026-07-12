const store  = require('./_store');
const ghl    = require('./_ghl');
const agents = require('./_agents');
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
    const { confirmationData, logoBase64, confirmationId: existingId, contactId, pin, activity } = JSON.parse(event.body);
    if (!confirmationData) throw new Error('confirmationData is required');

    const agent = agents.agentForPin(pin);
    if (agents.pinRequired() && !agent) {
      return { statusCode: 401, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid PIN' }) };
    }

    const inputId = existingId || randomUUID();

    const record = {
      recordType:  'confirmation',          // drives the storage namespace
      confirmationId: inputId,
      confirmationData,
      logoBase64:  logoBase64 || null,
      createdAt:   new Date().toISOString(),
      createdBy:   agent || null,
      clientName:  confirmationData.clientName  || 'Unknown',
      destination: confirmationData.destination || 'Unknown',
      dates:       datesOf(confirmationData),
      contactId:   contactId || null,
    };

    if (existingId) {
      try {
        const prev = await store.getJSON(existingId);
        if (prev) {
          record.createdAt = prev.createdAt || record.createdAt;
          record.createdBy = prev.createdBy != null ? prev.createdBy : record.createdBy;
          record._activity = Array.isArray(prev._activity) ? prev._activity : [];
          if (record.contactId == null && prev.contactId) record.contactId = prev.contactId;
        }
      } catch {}
      agents.appendActivity(record, activity === 'markup_applied' ? 'markup_applied' : 'edited', agent);
    } else {
      agents.appendActivity(record, 'created', agent);
    }

    const actualId = await store.setJSON(inputId, record);
    const confId   = actualId || inputId;

    const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'http://localhost:3002';
    const confirmationUrl = `${siteUrl}/.netlify/functions/view-confirmation?id=${confId}`;

    // NOTE: generating a confirmation does NOT move the GHL stage. It moves to
    // "Booking Confirmation Sent" only when Terri sends it and confirms — handled
    // by mark-confirmation-sent. (contactId is stored on the record for that.)

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
