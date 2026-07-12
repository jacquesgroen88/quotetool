const ghl    = require('./_ghl');
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

// Called when Terri actually SENDS a quote (email/WhatsApp) and confirms.
// Moves the lead → Quote Sent and sets the opportunity value to the average of
// the option prices presented. Best-effort: no-op without a key or contact.
exports.handler = async (event) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  try {
    const { contactId, value, quoteUrl, name, pin, quoteId } = JSON.parse(event.body || '{}');
    const agent = agents.agentForPin(pin);
    if (agents.pinRequired() && !agent) {
      return { statusCode: 401, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid PIN' }) };
    }

    // Record who marked it sent on the quote's own history (best-effort).
    if (quoteId) {
      try {
        const rec = await store.getJSON(quoteId);
        if (rec && rec.quoteData) {
          agents.appendActivity(rec, 'marked_sent', agent);
          await store.setJSON(quoteId, rec);
        }
      } catch {}
    }

    if (!ghl.enabled() || !contactId) {
      return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, skipped: true }) };
    }
    const monetaryValue = (value != null && !isNaN(value)) ? Math.round(Number(value)) : undefined;
    await ghl.moveToStage({ contactId, name: name || 'Travel enquiry', stageId: ghl.STAGES.quoteSent, monetaryValue });

    // Stamp the fields the post-quote follow-up cadence + daily digest read from.
    // Best-effort: each no-ops gracefully. Today's date (UTC) in YYYY-MM-DD.
    const today = new Date().toISOString().slice(0, 10);
    await ghl.setContactField(contactId, ghl.FIELDS.quoteSentDate, today);
    const band = ghl.valueBand(monetaryValue);
    if (band) await ghl.setContactField(contactId, ghl.FIELDS.quoteValueBand, band);

    if (quoteUrl) {
      await ghl.addNote(contactId, `📄 Quote sent to client${agent ? ` by ${agent}` : ''} — ${quoteUrl}`);
      await ghl.setContactField(contactId, ghl.FIELDS.proposalLink, quoteUrl); // for the Leads → Quoted view
    }
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, value: monetaryValue }) };
  } catch (err) {
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message || 'Failed.' }) };
  }
};
