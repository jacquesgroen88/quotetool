/**
 * GoHighLevel (LeadConnector) helper — server-side only.
 *
 * The PIT key is read from process.env.GHL_PIT_KEY and must be set in the
 * Netlify dashboard (Site configuration → Environment variables). It is NEVER
 * hardcoded or sent to the browser. If the key is absent, enabled() is false and
 * every call no-ops — so the quote/confirmation tools keep working with no GHL.
 *
 * Location, pipeline and stage IDs are NOT secret (they're in the project docs),
 * so they live as constants but can be overridden by env vars.
 */
const https = require('https');

const GHL_HOST  = 'services.leadconnectorhq.com';
const VERSION   = '2021-07-28';
const LOCATION  = process.env.GHL_LOCATION || 'LrnHCFtZlP8Kxex8fUpv';
const PIPELINE  = process.env.GHL_PIPELINE || 'FPuzKcSy3JDf2R8jhGyz';

// Sales Pipeline stages (full lifecycle — from the live Izi Travel sub-account)
const STAGES = {
  newEnquiry:              '35ee9266-72b1-4222-a77f-b35eb5460393',
  quoteRequested:          '07c693fe-c777-441b-8691-62bee175aa11',
  quoteSent:               '31f8120d-baf3-407f-b29d-c87ff380de9b',
  quoteFollowUp:           'd5e26e16-68ba-43a4-a40f-67c23d26c8ca',
  bookingConfirmationSent: 'aea09582-8d94-478d-9845-d219c453f7d6',
  invoiced:                'dbda7d9e-d86b-41bc-b9f0-2f963c1d692d',
  depositPaid:             'ce5d9259-cd27-4883-be9f-e42e84a9aeef',
  paidInFull:              'e4c022a0-642f-44c5-ad04-6cba23855157',
  commissionSplit:         'fbe958ee-253a-4a1b-80b6-4278378a2cde',
  bookingConfirmed:        'aea09582-8d94-478d-9845-d219c453f7d6', // alias (back-compat)
};

function pit()     { return process.env.GHL_PIT_KEY || ''; }
function enabled() { return !!pit(); }

function ghReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const buf = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const headers = {
      'Authorization': `Bearer ${pit()}`,
      'Version':       VERSION,
      'Accept':        'application/json',
    };
    if (buf) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = buf.length; }
    const req = https.request({ hostname: GHL_HOST, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch {} resolve({ status: res.statusCode, json, body: data }); });
    });
    req.on('error', (err) => reject(new Error(`GHL ${err.message}`)));
    req.setTimeout(9000, () => { req.destroy(); reject(new Error('GHL request timed out')); });
    if (buf) req.write(buf);
    req.end();
  });
}

// ── Reads ──
async function getContact(contactId) {
  const { status, json } = await ghReq('GET', `/contacts/${contactId}`, null);
  if (status < 200 || status >= 300) return null;
  return json && (json.contact || json);
}

async function getCustomFieldMap() {
  // id -> fieldKey (e.g. 'contact.your_destination')
  const { status, json } = await ghReq('GET', `/locations/${LOCATION}/customFields`, null);
  const map = {};
  if (status >= 200 && status < 300) {
    (json.customFields || json.customField || []).forEach(f => { if (f.id) map[f.id] = f.fieldKey || f.name; });
  }
  return map;
}

async function findContactByEmail(email) {
  if (!enabled() || !email) return null;
  try {
    const { status, json } = await ghReq('GET', `/contacts/?locationId=${LOCATION}&query=${encodeURIComponent(email)}&limit=5`, null);
    if (status < 200 || status >= 300) return null;
    const list = (json && json.contacts) || [];
    return list.find(c => (c.email || '').toLowerCase() === String(email).toLowerCase()) || list[0] || null;
  } catch { return null; }
}

async function findOpportunity(contactId) {
  const { status, json } = await ghReq('GET', `/opportunities/search?location_id=${LOCATION}&contact_id=${contactId}`, null);
  if (status < 200 || status >= 300) return null;
  const opps = (json && json.opportunities) || [];
  return opps[0] || null;
}

// ── Writes ──
async function createOpportunity({ contactId, name, stageId, status = 'open', monetaryValue }) {
  const body = { pipelineId: PIPELINE, locationId: LOCATION, pipelineStageId: stageId, name: name || 'Travel enquiry', status, contactId };
  if (monetaryValue != null) body.monetaryValue = monetaryValue;
  const r = await ghReq('POST', '/opportunities/', body);
  return r;
}

async function updateOpportunity(oppId, { stageId, status, name, monetaryValue }) {
  const body = { pipelineId: PIPELINE };
  if (stageId)            body.pipelineStageId = stageId;
  if (status)             body.status = status;
  if (name)               body.name = name;
  if (monetaryValue != null) body.monetaryValue = monetaryValue;
  return ghReq('PUT', `/opportunities/${oppId}`, body);
}

/** Find the contact's opportunity and move it to stageId; create one if none exists. */
async function moveToStage({ contactId, name, stageId, status, monetaryValue }) {
  if (!enabled() || !contactId) return { skipped: true };
  try {
    const opp = await findOpportunity(contactId);
    if (opp && opp.id) {
      await updateOpportunity(opp.id, { stageId, status, monetaryValue });
      return { ok: true, oppId: opp.id, created: false };
    }
    const r = await createOpportunity({ contactId, name, stageId, status: status || 'open', monetaryValue });
    return { ok: r.status >= 200 && r.status < 300, oppId: r.json && (r.json.opportunity || {}).id, created: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function addNote(contactId, noteBody) {
  if (!enabled() || !contactId || !noteBody) return { skipped: true };
  try { const r = await ghReq('POST', `/contacts/${contactId}/notes`, { body: noteBody }); return { ok: r.status >= 200 && r.status < 300 }; }
  catch (e) { return { ok: false, error: e.message }; }
}

async function addTags(contactId, tags) {
  if (!enabled() || !contactId || !tags || !tags.length) return { skipped: true };
  try { const r = await ghReq('POST', `/contacts/${contactId}/tags`, { tags }); return { ok: r.status >= 200 && r.status < 300 }; }
  catch (e) { return { ok: false, error: e.message }; }
}

/** Send an email to a contact via GHL Conversations (logged on the contact). */
async function sendEmail(contactId, subject, htmlBody) {
  if (!enabled() || !contactId) return { skipped: true };
  try {
    const r = await ghReq('POST', '/conversations/messages', { type: 'Email', contactId, subject, html: htmlBody });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, body: r.body };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = {
  enabled, STAGES, LOCATION, PIPELINE,
  getContact, getCustomFieldMap, findOpportunity, findContactByEmail,
  moveToStage, addNote, addTags, sendEmail,
  _raw: ghReq,
};
