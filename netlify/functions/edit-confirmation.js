const https = require('https');
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

function callOpenRouter(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = https.request(
      {
        hostname: 'openrouter.ai',
        path:     '/api/v1/chat/completions',
        method:   'POST',
        headers: {
          'Authorization':  `Bearer ${apiKey}`,
          'Content-Type':   'application/json',
          'Content-Length': bodyBuf.length,
          'HTTP-Referer':   'https://izitravel.co.za',
          'X-Title':        'IziTravel Confirmation Generator',
          'User-Agent':     'IziTravel-Confirmation-Tool/1.0',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', (err) => reject(err));
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Edit request timed out. Please try again.')); });
    req.write(bodyBuf);
    req.end();
  });
}

// Pull internal bookkeeping fields out of the data before the AI sees them, so
// it can never drop or mangle them. These drive the markup baseline and the
// Supplier Price Check card. Returns the stripped copies; merge them back after.
function stripInternal(cd) {
  const internal = { top: {}, pricing: {} };
  if (cd && typeof cd === 'object') {
    for (const k of Object.keys(cd)) {
      if (k.charAt(0) === '_' || k === 'recordType') { internal.top[k] = cd[k]; delete cd[k]; }
    }
    if (cd.pricing && typeof cd.pricing === 'object') {
      for (const k of Object.keys(cd.pricing)) {
        if (k.charAt(0) === '_' || k === 'markupPct') { internal.pricing[k] = cd.pricing[k]; delete cd.pricing[k]; }
      }
    }
  }
  return internal;
}

function restoreInternal(cd, internal) {
  if (!cd || typeof cd !== 'object') return cd;
  Object.assign(cd, internal.top);
  if (Object.keys(internal.pricing).length) {
    if (!cd.pricing || typeof cd.pricing !== 'object') cd.pricing = {};
    Object.assign(cd.pricing, internal.pricing);
  }
  return cd;
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
    const { confirmationData, message } = JSON.parse(event.body);
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in environment.');

    // Strip internal state so the AI only ever touches client-visible fields.
    const working  = JSON.parse(JSON.stringify(confirmationData || {}));
    const internal = stripInternal(working);

    const systemPrompt = `You are an AI assistant helping a travel agent modify a client BOOKING CONFIRMATION.
You receive the current confirmation data as JSON and a natural language instruction.
Return ONLY a JSON object — no markdown, no explanation:
{
  "changes": "one clear sentence describing exactly what you changed",
  "data": { ...the complete modified confirmation object... }
}
Make ONLY the change requested. Keep every other field exactly as-is.
The "data" field must be the COMPLETE confirmation object, not just the changed parts.

RULES:
- PASSENGER NAMES: preserve capitalisation exactly as given (surnames are often ALL CAPS — keep them ALL CAPS). Never normalise spelling or case unless explicitly told to.
- PRICING: amounts are strings like "R77 444.00". If the agent changes a price, keep the figures reconciled: deposit + balance must equal total, and pricePerPerson × paxCount should equal total. If an instruction makes them not reconcile, still apply it but say so in "changes".
- BRANDING: never introduce a supplier or wholesaler name (Holiday Factory, AFS, Tourvest, Thompsons, Club Travel, etc.).
- Keep arrays (inclusions, exclusions, flights, passengers, etc.) in the same shape they arrived in.`;

    const userPrompt = `Current confirmation data:
${JSON.stringify(working, null, 2)}

Agent instruction: "${message}"`;

    const { body } = await callOpenRouter(apiKey, {
      model:    'anthropic/claude-haiku-4.5',
      provider: { order: ['Anthropic'], allow_fallbacks: true },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      max_tokens: 4096,
    });

    const aiData = JSON.parse(body);
    if (aiData.error) throw new Error(`OpenRouter error: ${aiData.error.message || JSON.stringify(aiData.error)}`);
    const content = aiData.choices?.[0]?.message?.content;
    if (!content) throw new Error('No response from AI.');

    const cleaned = content.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const result  = JSON.parse(cleaned);

    // Merge the protected internal fields back onto the edited object.
    const merged = restoreInternal(result.data, internal);

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmationData: merged, changes: result.changes }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to apply changes.' }),
    };
  }
};
