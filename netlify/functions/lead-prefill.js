const ghl  = require('./_ghl');
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

// Pulls a GHL contact's details for pre-filling the quote form, and advances the
// opportunity to "Quote Requested" (Terri has opened it to quote). Keeps lead PII
// out of the URL — the browser only ever passes the opaque contact id.
exports.handler = async (event) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  const cid = event.queryStringParameters?.cid;
  if (!cid) return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing contact id' }) };
  if (!ghl.enabled()) return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefill: null, ghl: 'disabled' }) };

  try {
    const [contact, fieldMap] = await Promise.all([ghl.getContact(cid), ghl.getCustomFieldMap()]);
    if (!contact) return { statusCode: 404, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Contact not found' }) };

    // Map custom fields by key
    const cf = {};
    (contact.customFields || []).forEach(f => {
      const key = fieldMap[f.id];
      if (key) cf[key] = f.value != null ? f.value : (f.field_value != null ? f.field_value : f.fieldValue);
    });
    const g = (k) => cf['contact.' + k] || '';

    const month = g('travel_month'), year = g('travel_year');
    const prefill = {
      contactId:   cid,
      clientName:  [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim(),
      destination: g('your_destination'),
      dates:       [month, year].filter(Boolean).join(' '),
      adults:      (g('how_many_people_will_be_traveling') || '').replace(/[^0-9]/g, ''),
      phone:       contact.phone || '',
      email:       contact.email || '',
      budget:      g('budget'),
    };

    // Advance the opportunity — Terri has opened this lead to quote it.
    await ghl.moveToStage({ contactId: cid, name: prefill.clientName || 'Travel enquiry', stageId: ghl.STAGES.quoteRequested });

    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefill }) };
  } catch (err) {
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message || 'Failed to load lead.' }) };
  }
};
