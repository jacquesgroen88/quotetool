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
          'X-Title':        'IziTravel Quote Generator',
          'User-Agent':     'IziTravel-Quote-Tool/1.0',
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

const SYSTEM_PROMPT = `You are an AI assistant helping a travel agent modify a client travel QUOTE.
You are given the current quote as JSON and a natural-language instruction.
Do NOT rewrite the whole quote. Return ONLY a small list of edit OPERATIONS that achieve the instruction, as JSON — no markdown, no commentary:

{
  "changes": "one clear sentence describing exactly what you changed",
  "ops": [ { "op": "set", "path": "clientTitle", "value": "Mr & Mrs" } ]
}

Each op is exactly one of:
- { "op": "set",    "path": "<field path>",       "value": <new value> }   // set or replace a field
- { "op": "append", "path": "<array field path>", "value": <item> }        // add one item to a list
- { "op": "remove", "path": "<array field path>", "index": <0-based> }      // remove a list item; OMIT "index" to remove the LAST item
- { "op": "delete", "path": "<field path>" }                                // remove a field entirely

PATHS use dot notation with zero-based [index] for arrays, and MUST match the JSON you are given. Examples:
- "clientTitle"                → top-level field
- "dates"                      → top-level field
- "options[0].pricePerPerson"  → a field on the first option
- "options[1].inclusions"      → the inclusions list of the second option
- "exclusions"                 → the top-level exclusions list

RULES:
- Make ONLY the change requested. Touch the fewest fields possible.
- "Option N" means options[N-1] (option 1 = options[0]).
- Prices are strings like "R25 000" — keep the same currency format. Only change a price when explicitly asked. If you change a per-person price and the instruction implies the total should follow, also set that same option's totalPrice; otherwise leave totals alone.
- Never invent fields that do not already exist in the JSON.
- Preserve client/passenger name capitalisation exactly as given.
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
    const { quoteData, message } = JSON.parse(event.body);
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in environment.');

    // Show the AI only the client-visible fields (internal bookkeeping stripped).
    const forAI = stripForDisplay(quoteData || {});

    const userPrompt = `Current quote data:
${JSON.stringify(forAI, null, 2)}

Agent instruction: "${message}"`;

    const { body } = await callOpenRouter(apiKey, {
      model:    'anthropic/claude-haiku-4.5',
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

    // Apply the ops to a clone of the FULL quote (internal fields intact) — the
    // model never named those paths, so they pass through untouched.
    const merged = JSON.parse(JSON.stringify(quoteData || {}));

    let changes = result.changes || 'Quote updated.';
    if (Array.isArray(result.ops) && result.ops.length) {
      const { applied, appliedPaths } = applyOps(merged, result.ops);
      if (!applied) throw new Error("I couldn't apply that change — please rephrase or be more specific.");

      // If any option changed, invalidate derived state so it isn't stale:
      // the markup baseline (re-snapshots from current prices on next markup) and
      // the per-option import-time price check (no longer reflects the new price).
      if (appliedPaths.some(p => /^options/.test(p))) {
        delete merged._baseOptions;
        const touched = new Set();
        appliedPaths.forEach(p => { const m = p.match(/^options\[(\d+)\]/); if (m) touched.add(Number(m[1])); });
        if (Array.isArray(merged.options)) {
          touched.forEach(i => { if (merged.options[i]) delete merged.options[i]._priceCheck; });
        }
      }
    } else if (result.data && typeof result.data === 'object') {
      // Backward-compatible fallback: model returned a full object instead of ops.
      // Overlay client-visible fields, then restore the original internal fields.
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
      body: JSON.stringify({ quoteData: merged, changes }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to apply changes.' }),
    };
  }
};
