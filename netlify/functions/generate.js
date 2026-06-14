const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');
const https    = require('https');
const fs       = require('fs');
const path     = require('path');

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
  const name = filename.toLowerCase();
  if (name.endsWith('.pdf')) {
    const result = await pdfParse(buffer);
    return result.text;
  }
  if (name.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  throw new Error('Unsupported file type. Please upload a PDF or DOCX.');
}

// Attempt to recover truncated JSON (when max_tokens cuts off mid-response)
function repairJSON(str) {
  for (const suffix of [']}', '}]}', '\n]}', '\n}]}']) {
    try { return JSON.parse(str + suffix); } catch {}
  }
  const lastObj = str.lastIndexOf('},');
  if (lastObj > 0) {
    const cut = str.slice(0, lastObj + 1);
    for (const suffix of [']}', '}]}', '\n]}', '\n}]}']) {
      try { return JSON.parse(cut + suffix); } catch {}
    }
  }
  return null;
}

// ── Price integrity check ───────────────────────────────────────────────────
// Verifies every AI-extracted price actually appears in the supplier document,
// so a transcription slip (e.g. R77,444 → R76,444) is caught, not shipped to a
// client. Purely advisory: it ANNOTATES the data, never blocks generation and
// never alters a price. Wrapped so any failure leaves the quote untouched.
function annotatePriceIntegrity(rawText, qd) {
  try {
    if (!qd || !Array.isArray(qd.options)) return;

    const toRand = (v) => {
      const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
      return isNaN(n) ? null : Math.round(n);
    };

    // Every currency figure in the supplier text, as integer rand.
    // Require R/ZAR NOT preceded by a letter so flight codes (QR1364, EK766)
    // and similar are never mistaken for prices.
    const source = new Set();
    const re = /(?:^|[^A-Za-z])(?:R|ZAR)\s*([0-9][0-9\s.,]*[0-9]|[0-9])/gi;
    let m;
    while ((m = re.exec(rawText)) !== null) {
      const r = toRand(m[1]);
      if (r != null && r >= 100) source.add(r);
    }
    qd._sourcePrices = Array.from(source).sort((a, b) => a - b);

    const pax = parseInt(qd.adults, 10) || 2;
    qd.options.forEach((opt) => {
      const pp     = toRand(opt.pricePerPerson);
      const total  = toRand(opt.totalPrice);
      const optPax = parseInt(opt.totalPax, 10) || pax;
      const ppInSource    = pp    != null && source.has(pp);
      const totalInSource = total != null && source.has(total);
      const mathOk = (pp != null && total != null)
        ? Math.abs(pp * optPax - total) <= optPax   // tolerate cent rounding
        : null;
      opt._priceCheck = {
        ppInSource,
        totalInSource,
        mathOk,
        verified: ppInSource && totalInSource,       // both prices found verbatim
      };
    });
  } catch (_) { /* advisory only — never break generation */ }
}

// Use https module — avoids Node 18 native fetch (undici) reliability issues
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
    req.on('error', (err) => reject(new Error(`Connection error: ${err.message}`)));
    req.setTimeout(21000, () => {
      req.destroy();
      reject(new Error('Request timed out at socket level'));
    });
    req.write(bodyBuf);
    req.end();
  });
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

    const cd = clientDetails || {};

    // TWO-PASS EXTRACTION
    // Pass 1: All options WITHOUT descriptions (compact — fits all options in ~1000 tokens)
    // Pass 2: Descriptions only (run after pass 1, merged in)
    // This way each call is small and fast, total stays within 22s.

    const pass1Prompt = `You are a travel quote formatter for IziTravel, a South African travel agency.

Extract structured package data from this supplier document and return ONLY valid JSON (no markdown, no extra text).

Client details:
- Name: ${cd.clientName || 'Unknown'}
- Occasion: ${cd.occasion || ''}
- Destination: ${cd.destination || ''}
- Dates: ${cd.dates || ''}
- Adults: ${cd.adults || '2'}

Return this exact JSON (omit description field — it will be fetched separately):
{
  "clientName": "name from doc or provided",
  "destination": "destination name",
  "dates": "travel date range",
  "adults": "number as string",
  "occasion": "occasion if found",
  "options": [
    {
      "optionNumber": 1,
      "resortName": "Full resort name with star rating e.g. 5* Karafuu Beach Resort",
      "roomType": "room type if mentioned",
      "boardBasis": "meal plan e.g. Half Board, All Inclusive",
      "nights": "number of nights as string",
      "description": "",
      "inclusions": ["inclusion 1", "inclusion 2"],
      "addedValue": ["added value item if present"],
      "flightDetails": "Set to 'See flight details below' if the same flights apply to all options (they usually do). Only put option-specific flights here if this option's flights genuinely differ from the others. \"\" if no flights.",
      "pricePerPerson": "R00,000.00",
      "totalPrice": "R00,000.00",
      "totalPax": "number of pax for this price if stated"
    }
  ],
  "flightDetails": "The FULL shared flight schedule. Put EACH flight leg on ITS OWN LINE separated by a newline character (\\n). Format each leg exactly as: 'DATE — FLIGHTNO (Class) — Origin to Destination — DepartTime–ArriveTime'. Example:\\n27 Sep 2026 — EK766 (Economy) — Johannesburg O.R. Tambo to Dubai — 22:20–08:20 +1\\n28 Sep 2026 — EK660 (Economy) — Dubai to Maldives (Velana) — 10:10–15:30. IMPORTANT: travel documents often repeat the SAME flights under each option — that means flights are SHARED, so put the complete schedule HERE and set each option's flightDetails to 'See flight details below'. Only leave empty if options genuinely have different flights.",
  "exclusions": ["exclusion 1", "exclusion 2"]
}

Rules (CRITICAL — follow exactly to keep the response fast and complete):
- Leave description as empty string "" (descriptions are fetched separately)
- Include EVERY option found — never skip any. This is the most important rule.
- INCLUSIONS: List a MAXIMUM of 6 inclusions per option, each kept SHORT (under 8 words). Group/summarise similar items (e.g. "All-inclusive meals & beverages" instead of listing every drink). Do NOT copy long verbatim beverage, activity, or restaurant lists — just the key highlights.
- addedValue: max 3 short items, or omit
- If multiple room types for same resort, create separate options
- FLIGHTS (important): If the same flight schedule repeats under each option, the flights are SHARED — extract the complete schedule into the top-level "flightDetails" field and set every option's flightDetails to "See flight details below". Never leave the top-level flightDetails empty when options say "See flight details below".
- PRICING — read the figures carefully; supplier layouts vary and this is the #1 source of errors:
  • pricePerPerson = the price for ONE adult INCLUDING airport taxes/levies.
  • totalPrice = the final all-in price for ALL travellers, INCLUDING taxes.
  • These MUST reconcile: pricePerPerson × number_of_pax = totalPrice (within rounding). If they do not, you have read the wrong line — re-read the figures.
  • Many quotes show a per-option summary block such as:
        Price per person R 16 194.00   Airport taxes R 7 114.00   x 2 Adult
        Total            R 32 388.00     <- per-person base × pax, EXCLUDES tax — this is NOT a per-person price
        Airport Taxes    R 14 228.00
        Total Package    R 46 616.00     <- the FINAL all-in total — THIS is totalPrice
    For that layout: totalPrice = "Total Package" (46 616). pricePerPerson = "Price per person" + "Airport taxes" (16 194 + 7 114 = 23 308) = Total Package ÷ pax.
  • A line labelled just "Total" (WITHOUT the word "Package") is usually the multi-pax subtotal — NEVER copy it into pricePerPerson.
  • Whenever a "Total Package" / final all-in total is printed, use it for totalPrice rather than calculating your own.
  • If only a per-person price is given with no package total, set totalPrice = pricePerPerson × pax.
  • Prices may appear as "R 45,000", "R45000", "R 16 194.00", "ZAR 45,000".
- Do NOT mention supplier names (AFS, Afristay, Tourvest, Thompsons, Club Travel etc)
- Strip booking reference codes and internal identifiers
- resortName: resort/hotel name and star rating only

Supplier document:
${rawText}`;

    // Pass 2 is INDEPENDENT of pass 1 — it extracts all descriptions directly from
    // the document, so both passes can run in PARALLEL (not sequentially).
    const pass2Prompt = `From the supplier document below, extract the VERBATIM marketing description paragraph for EACH resort/package option, in the order they appear. Return ONLY valid JSON (no markdown):
{"descriptions":[{"optionNumber":1,"description":"Full verbatim resort description paragraph..."},{"optionNumber":2,"description":"..."}]}
Number them 1, 2, 3... in document order. Include every option. Keep each description complete and verbatim. Do NOT mention supplier names (AFS, Afristay, Thompsons, Tourvest, Club Travel etc).

Supplier document:
${rawText}`;

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in environment.');

    const callParams = {
      model:    'anthropic/claude-haiku-4.5',
      provider: { order: ['Anthropic'], allow_fallbacks: true },
    };

    // 22s guard on the CRITICAL path (pass 1 / options). Pass 1 runs ~8s.
    const hardTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('The AI is taking longer than usual. Please try again.')), 22000)
    );

    // ── Run BOTH passes in PARALLEL ──
    // Pass 1 (options) is critical. Pass 2 (descriptions) is optional and gets
    // its OWN 18s deadline that resolves null — so slow descriptions can never
    // fail or delay the quote beyond returning options-only.
    const pass1 = callOpenRouter(apiKey, {
      ...callParams, max_tokens: 2000,
      messages: [{ role: 'user', content: pass1Prompt }],
    });
    const pass2 = Promise.race([
      callOpenRouter(apiKey, {
        ...callParams, max_tokens: 2000,
        messages: [{ role: 'user', content: pass2Prompt }],
      }).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 18000)),
    ]);

    const fullExtraction = (async () => {
      const [res1, res2] = await Promise.all([pass1, pass2]);

      // Pass 1 — structured options (required)
      const data1 = JSON.parse(res1.body);
      if (data1.error) throw new Error(`OpenRouter error: ${data1.error.message || JSON.stringify(data1.error)}`);
      const c1 = data1.choices?.[0]?.message?.content;
      if (!c1) throw new Error('No content in pass 1 response.');
      const clean1 = c1.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      let qd;
      try { qd = JSON.parse(clean1); } catch { qd = repairJSON(clean1); }
      if (!qd) throw new Error('AI response could not be parsed. Please try again.');

      // Pass 2 — merge descriptions (optional)
      try {
        if (res2 && qd.options && qd.options.length > 0) {
          const data2 = JSON.parse(res2.body);
          const c2 = data2.choices?.[0]?.message?.content || '';
          const clean2 = c2.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
          let desc;
          try { desc = JSON.parse(clean2); } catch { desc = repairJSON(clean2); }
          if (desc && Array.isArray(desc.descriptions)) {
            desc.descriptions.forEach(d => {
              const opt = qd.options.find(o => o.optionNumber === d.optionNumber);
              if (opt && d.description) opt.description = d.description;
            });
          }
        }
      } catch { /* descriptions failed — continue with empty descriptions */ }

      return qd;
    })();

    let quoteData = await Promise.race([fullExtraction, hardTimeout]);

    // Safety net: if options say "See flight details below" but the shared
    // flightDetails section is empty, drop the dangling reference so the quote
    // doesn't show a flight pointer with nothing to point at.
    const sharedFlights = (quoteData.flightDetails || '').trim();
    if (!sharedFlights && Array.isArray(quoteData.options)) {
      quoteData.options.forEach(o => {
        if (/see flight details below/i.test(o.flightDetails || '')) o.flightDetails = '';
      });
    }

    if (cd.clientName)  quoteData.clientName  = cd.clientName;
    if (cd.destination) quoteData.destination = cd.destination;
    if (cd.dates)       quoteData.dates       = cd.dates;
    if (cd.adults)      quoteData.adults      = cd.adults;
    if (cd.occasion)    quoteData.occasion    = cd.occasion;

    // Verify extracted prices against the supplier document (advisory, never blocks).
    annotatePriceIntegrity(rawText, quoteData);

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: quoteData }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to generate quote.' }),
    };
  }
};
