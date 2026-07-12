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

// Called when Terri SENDS an invoice (email/WhatsApp) and confirms.
// Moves the lead → Invoiced. Best-effort.
exports.handler = async (event) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  try {
    const { contactId, total, invoiceUrl, name, pin, invoiceId } = JSON.parse(event.body || '{}');
    const agent = agents.agentForPin(pin);
    if (agents.pinRequired() && !agent) {
      return { statusCode: 401, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid PIN' }) };
    }

    // Record who marked it sent on the invoice's own history (best-effort).
    if (invoiceId) {
      try {
        const rec = await store.getJSON(invoiceId);
        if (rec && rec.recordType === 'invoice') {
          agents.appendActivity(rec, 'marked_sent', agent);
          await store.setJSON(invoiceId, rec);
        }
      } catch {}
    }

    if (!ghl.enabled() || !contactId) return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, skipped: true }) };
    const monetaryValue = (total != null && !isNaN(total)) ? Math.round(Number(total)) : undefined;
    await ghl.moveToStage({ contactId, name: name || 'Booking', stageId: ghl.STAGES.invoiced, status: 'won', monetaryValue });
    if (invoiceUrl) await ghl.addNote(contactId, `🧾 Invoice sent to client${agent ? ` by ${agent}` : ''} — ${invoiceUrl}`);
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message || 'Failed.' }) };
  }
};
