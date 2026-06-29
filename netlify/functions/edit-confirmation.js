const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { applyOps, stripForDisplay } = require('./_patch');

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
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Edit request timed out. Please try again.')); });
    req.write(bodyBuf);
    req.end();
  });
}

const SYSTEM_PROMPT = `You are an AI assistant helping a travel agent modify a client BOOKING CONFIRMATION.
You are given the current confirmation as JSON and a natural-language instruction.
Do NOT rewrite the whole confirmation. Return ONLY a small list of edit OPERATIONS that achieve the instruction, as JSON — no markdown, no commentary:

{
  "changes": "one clear sentence describing exactly what you changed",
  "ops": [ { "op": "set", "path": "pricing.deposit", "value": "R10 000.00" } ]
}

Each op is exactly one of:
- { "op": "set",    "path": "<field path>",       "value": <new value> }   // set or replace a field
- { "op": "append", "path": "<array field path>", "value": <item> }        // add one item to a list
- { "op": "remove", "path": "<array field path>", "index": <0-based> }      // remove a list item; OMIT "index" to remove the LAST item
- { "op": "delete", "path": "<field path>" }                                // remove a field entirely

PATHS use dot notation with zero-based [index] for arrays, and MUST match the JSON you are given. Examples:
- "roomType"               → top-level field
- "pricing.total"          → a field inside the pricing object
- "inclusions"             → the inclusions list
- "passengers[0].lastName" → a field on the first passenger

RULES:
- Make ONLY the change requested. Touch the fewest fields possible.
- PASSENGER NAMES: preserve capitalisation exactly as given (surnames are often ALL CAPS — keep them ALL CAPS). Never normalise spelling or case unless explicitly told to.
- PRICING: amounts are strings like "R77 444.00". If you change a price, keep the figures reconciled: deposit + balance must equal total, and pricePerPerson × paxCount should equal total. If an instruction makes them not reconcile, still apply it but say so in "changes".
- BRANDING: never introduce a supplier or wholesaler name (Holiday Factory, AFS, Tourvest, Thompsons, Club Travel, etc.).
- Never invent fields that do not already exist in the JSON.
- If you cannot map the instruction to any operation, return "ops": [] and explain why in "changes".`;

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

    // Show the AI only client-visible fields (markup baseline / price-check /
    // source prices stripped — it can never drop or mangle them).
    const forAI = stripForDisplay(confirmationData || {});

    const userPrompt = `Current confirmation data:
${JSON.stringify(forAI, null, 2)}

Agent instruction: "${message}"`;

    const { body } = await callOpenRouter(apiKey, {
      model:    'anthropic/claude-haiku-4.5',
      provider: { order: ['Anthropic'], allow_fallbacks: true },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userPrompt },
      ],
      max_tokens: 1500,
    });

    const aiData = JSON.parse(body);
    if (aiData.error) throw new Error(`OpenRouter error: ${aiData.error.message || JSON.stringify(aiData.error)}`);
    const content = aiData.choices?.[0]?.message?.content;
    if (!content) throw new Error('No response from AI.');

    const cleaned = content.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const result  = JSON.parse(cleaned);

    // Apply ops to a clone of the FULL confirmation (internal fields intact).
    // The client re-runs the Supplier Price Check from the retained _sourcePrices.
    const merged = JSON.parse(JSON.stringify(confirmationData || {}));

    const changes = result.changes || 'Confirmation updated.';
    if (Array.isArray(result.ops) && result.ops.length) {
      const { applied } = applyOps(merged, result.ops);
      if (!applied) throw new Error("I couldn't apply that change — please rephrase or be more specific.");
    } else if (result.data && typeof result.data === 'object') {
      // Backward-compatible fallback: model returned a full object instead of ops.
      const clean = stripForDisplay(result.data);
      for (const k of Object.keys(merged)) {
        if (k.charAt(0) === '_' || k === 'recordType') continue;
        delete merged[k];
      }
      Object.assign(merged, clean);
    } else {
      throw new Error("I couldn't apply that change — please rephrase or be more specific.");
    }

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmationData: merged, changes }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to apply changes.' }),
    };
  }
};
