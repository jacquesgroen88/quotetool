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

const GHL_APP = process.env.GHL_APP || 'https://app.reviewtap.co.za';

exports.handler = async (event) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  // This endpoint returns client PII for the whole open pipeline — gate it with
  // the same password as the admin endpoints. Fail closed (public repo — a
  // fallback password here would be a published credential).
  let password = '';
  try { password = JSON.parse(event.body || '{}').password || ''; } catch {}
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass) {
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'ADMIN_PASSWORD is not configured on the server.' }) };
  }
  if (!password || password !== adminPass) {
    return { statusCode: 401, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid password' }) };
  }

  if (!ghl.enabled()) return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ leads: [], ghl: 'disabled' }) };

  const STAGE_NAME = {
    [ghl.STAGES.newEnquiry]:     'New Enquiry',
    [ghl.STAGES.quoteRequested]: 'Quote Requested',
    [ghl.STAGES.quoteSent]:      'Quote Sent',
    [ghl.STAGES.quoteFollowUp]:  'Quote Follow-Up',
  };
  const STAGE_ORDER    = { 'New Enquiry': 0, 'Quote Requested': 1, 'Quote Sent': 2, 'Quote Follow-Up': 3 };
  const QUOTED_STAGES  = { [ghl.STAGES.quoteSent]: 1, [ghl.STAGES.quoteFollowUp]: 1 };

  try {
    const { json } = await ghl._raw('GET', `/opportunities/search?location_id=${ghl.LOCATION}&pipeline_id=${ghl.PIPELINE}&status=open&limit=100`, null);
    const opps     = (json && json.opportunities) || [];
    const fieldMap = await ghl.getCustomFieldMap();
    const now      = new Date();

    const wanted = opps.filter(o => STAGE_NAME[o.pipelineStageId]);

    const leads = await Promise.all(wanted.map(async (o) => {
      const cId = o.contactId || (o.contact || {}).id;
      let contact = null;
      try { contact = await ghl.getContact(cId); } catch {}
      const cf = {};
      ((contact && contact.customFields) || []).forEach(f => {
        const k = fieldMap[f.id];
        if (k) cf[k] = f.value != null ? f.value : (f.field_value != null ? f.field_value : f.fieldValue);
      });
      const g = (k) => cf['contact.' + k] || '';
      const departureDate = g('departure_date'), returnDate = g('return_date');
      // Calendar-day compare in SAST (UTC+2): "departs today" must stay urgent
      // all day, and an unparseable date must not silently drop the flag path.
      const todayDay = Math.floor((now.getTime() + 2 * 3600e3) / 86400000);
      const depMs = departureDate ? Date.parse(departureDate) : NaN;
      const daysUntil = isNaN(depMs) ? null : Math.floor(depMs / 86400000) - todayDay;
      const urgent = daysUntil != null && daysUntil >= 0 && daysUntil <= 30;
      const tags = (contact && contact.tags) || (o.contact && o.contact.tags) || [];

      const group = QUOTED_STAGES[o.pipelineStageId] ? 'quoted' : 'to_quote';
      const proposalView = g('proposal_link');
      let proposalEdit = '';
      if (proposalView) { const m = proposalView.match(/[?&]id=([^&]+)/); if (m) proposalEdit = '/?edit=' + m[1]; }

      return {
        contactId:   cId,
        group, proposalView, proposalEdit,
        name:        (o.contact && o.contact.name) || [contact && contact.firstName, contact && contact.lastName].filter(Boolean).join(' ').trim() || 'Lead',
        email:       (contact && contact.email) || (o.contact && o.contact.email) || '',
        phone:       (contact && contact.phone) || (o.contact && o.contact.phone) || '',
        stage:       STAGE_NAME[o.pipelineStageId],
        destination: g('your_destination'),
        dates:       [departureDate, returnDate].filter(Boolean).join(' - '),
        pax:         (g('how_many_people_will_be_traveling') || '').replace(/[^0-9+]/g, ''),
        budget:      g('budget'),
        tags,
        urgent,
        createdAt:   o.createdAt || '',
        quoteUrl:    `/?cid=${cId}`,
        ghlUrl:      `${GHL_APP}/v2/location/${ghl.LOCATION}/contacts/detail/${cId}`,
      };
    }));

    leads.sort((a, b) =>
      (Number(b.urgent) - Number(a.urgent)) ||
      ((STAGE_ORDER[a.stage] ?? 9) - (STAGE_ORDER[b.stage] ?? 9)) ||
      (new Date(b.createdAt) - new Date(a.createdAt))
    );

    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ leads, count: leads.length }) };
  } catch (err) {
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message || 'Failed to list leads.' }) };
  }
};
