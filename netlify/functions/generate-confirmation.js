const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');
const https    = require('https');
const fs       = require('fs');
const path     = require('path');

// Load .env for local dev (no-op in production)
try {
  const envPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
    });
  }
} catch {}

async function extractText(buffer, filename) {
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.pdf'))  return (await pdfParse(buffer)).text;
  if (name.endsWith('.docx')) return (await mammoth.extractRawText({ buffer })).value;
  throw new Error('Unsupported file type. Please upload a PDF or DOCX.');
}

// Recover truncated JSON when max_tokens cuts off mid-response
function repairJSON(str) {
  for (const suffix of ['}', ']}', '"}', '"]}', '\n}']) {
    try { return JSON.parse(str + suffix); } catch {}
  }
  return null;
}

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
    req.on('error', (err) => reject(new Error(`Connection error: ${err.message}`)));
    req.setTimeout(21000, () => { req.destroy(); reject(new Error('Request timed out at socket level')); });
    req.write(bodyBuf);
    req.end();
  });
}

// ── Price integrity for a single confirmed package ───────────────────────────
// Verifies the extracted prices against the supplier text and that the payment
// schedule reconciles. Advisory: annotates only, never blocks. Mirrors the quote
// tool's annotatePriceIntegrity but for a single package (no options[]).
function annotateConfirmationPriceIntegrity(rawText, cd) {
  try {
    if (!cd || !cd.pricing) return;
    const toRand = (v) => {
      const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
      return isNaN(n) ? null : Math.round(n);
    };
    const source = new Set();
    const re = /(?:^|[^A-Za-z])(?:R|ZAR)\s*([0-9][0-9\s.,]*[0-9]|[0-9])/gi;
    let m;
    while ((m = re.exec(rawText)) !== null) {
      const r = toRand(m[1]);
      if (r != null && r >= 100) source.add(r);
    }
    cd._sourcePrices = Array.from(source).sort((a, b) => a - b);

    const p   = cd.pricing;
    const pp  = toRand(p.pricePerPerson);
    const tot = toRand(p.total);
    const dep = toRand(p.deposit);
    const bal = toRand(p.balance);
    const pax = parseInt(cd.paxCount, 10) || (Array.isArray(cd.passengers) ? cd.passengers.length : 2) || 2;

    const ppInSource    = pp  != null && source.has(pp);
    const totalInSource = tot != null && source.has(tot);
    const mathOk    = (pp != null && tot != null) ? Math.abs(pp * pax - tot) <= pax : null;
    const scheduleOk = (dep != null && bal != null && tot != null) ? Math.abs(dep + bal - tot) <= 1 : null;

    cd._priceCheck = { ppInSource, totalInSource, mathOk, scheduleOk, verified: ppInSource && totalInSource };

    // Seed markup base from the verbatim supplier figures (markup always works off these)
    if (p._baseTotal == null)     p._baseTotal     = p.total;
    if (p._basePerPerson == null) p._basePerPerson = p.pricePerPerson;
    if (p.markupPct == null)      p.markupPct      = 0;
  } catch (_) { /* advisory only — never break generation */ }
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
    const { fileData, filename, clientDetails } = JSON.parse(event.body);
    const base64  = fileData.includes(',') ? fileData.split(',')[1] : fileData;
    const buffer  = Buffer.from(base64, 'base64');
    const rawText = await extractText(buffer, filename);
    const apiKey  = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in environment.');

    const cd = clientDetails || {};

    const prompt = `You are a travel-confirmation formatter for IziTravel, a South African travel agency. You are given a SUPPLIER booking confirmation (e.g. from The Holiday Factory). Extract it into clean JSON for a single confirmed package. Return ONLY valid JSON (no markdown, no commentary).

Return EXACTLY this shape:
{
  "bookingRef": "supplier invoice/booking reference if present",
  "destination": "destination name e.g. Maldives",
  "tripType": "${cd.tripType || ''}",
  "clientName": "${cd.clientName || ''}",
  "passengers": [ { "title": "MR/MRS/MISS/etc or empty", "firstName": "First name(s)", "surname": "SURNAME" } ],
  "paxCount": "number of travellers as a string",
  "travelDates": { "start": "e.g. 27 Sep 2026", "end": "e.g. 04 Oct 2026", "nights": "total nights as a string" },
  "resort": { "name": "resort/hotel name", "grade": "star rating e.g. 4* if stated else empty", "roomType": "room type e.g. Ocean Front Double", "roomDesc": "short room description if given", "nights": "accommodation nights as a string" },
  "board": "board basis e.g. All Inclusive / Half Board",
  "boardDetail": [ "short bullet of what the board includes (meals, drinks) — max 6, each under 12 words" ],
  "inclusions": [ "client-friendly inclusion bullets: flights, airport taxes, transfers, accommodation line — max 6" ],
  "addedValue": [ "complimentary extras e.g. WiFi, water sports — max 5" ],
  "exclusions": [ "what is NOT included e.g. visas, items of a personal nature, local government tax — max 6" ],
  "flights": [ { "date": "e.g. 27 Sep", "flightNo": "e.g. QR1364", "from": "origin code/city", "to": "destination code/city", "depart": "HH:mm", "arrive": "HH:mm", "class": "Economy/Business" } ],
  "transfers": [ "transfer description e.g. Return airport speedboat transfer" ],
  "pricing": {
    "pricePerPerson": "R00 000.00",
    "airportTax": "R00 000.00",
    "total": "R00 000.00",
    "deposit": "R00 000.00",
    "depositDue": "due date e.g. 09 Jun 2026",
    "balance": "R00 000.00",
    "balanceDue": "due date e.g. 14 Aug 2026"
  }
}

CRITICAL RULES:
- PASSENGER NAMES: copy EXACTLY as written, preserving capitalisation (surnames are often ALL CAPS — keep them ALL CAPS). Split into title / firstName / surname. Never normalise or change spelling. Use the flight-section names (e.g. "DU TOIT/JOHANNES JACOBUS.MR") to recover titles/full names if the price table omits them.
- PRICING — read carefully:
  * pricePerPerson = the all-in price for ONE traveller INCLUDING airport tax (the per-person "Total" column, e.g. R38 722.00). airportTax = the per-person tax (e.g. R8 478.00).
  * total = the grand TOTAL package figure for ALL travellers (e.g. "TOTAL R77 444.00"). Use it VERBATIM. NEVER recompute or round it.
  * deposit + balance MUST add up to total. Capture each amount and its due date exactly as printed.
  * pricePerPerson × paxCount should equal total. If your figures don't reconcile, re-read — you have grabbed the wrong line.
- FLIGHTS: one object per leg, in order. Ignore carrier/pax codes like "KK x 2".
- BRANDING HYGIENE: do NOT mention the supplier/wholesaler name (Holiday Factory, AFS, Tourvest, Thompsons, Club Travel, etc.) anywhere in the output. Strip booking-form and T&C boilerplate.
- Keep inclusions/board/addedValue concise and client-friendly (not a verbatim dump).

Supplier confirmation document:
${rawText}`;

    const { body } = await callOpenRouter(apiKey, {
      model:      'anthropic/claude-haiku-4.5',
      provider:   { order: ['Anthropic'], allow_fallbacks: true },
      max_tokens: 2000,
      messages:   [{ role: 'user', content: prompt }],
    });

    const aiData = JSON.parse(body);
    if (aiData.error) throw new Error(`OpenRouter error: ${aiData.error.message || JSON.stringify(aiData.error)}`);
    const content = aiData.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content in AI response.');
    const cleaned = content.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    let confirmationData;
    try { confirmationData = JSON.parse(cleaned); } catch { confirmationData = repairJSON(cleaned); }
    if (!confirmationData) throw new Error('AI response could not be parsed. Please try again.');

    // Apply client-detail overrides
    if (cd.clientName)  confirmationData.clientName  = cd.clientName;
    if (cd.destination) confirmationData.destination = cd.destination;
    if (cd.tripType)    confirmationData.tripType    = cd.tripType;

    confirmationData.recordType = 'confirmation';
    if (!confirmationData.pricing) confirmationData.pricing = {};

    annotateConfirmationPriceIntegrity(rawText, confirmationData);

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: confirmationData }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to generate confirmation.' }),
    };
  }
};
