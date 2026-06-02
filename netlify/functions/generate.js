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
      "flightDetails": "Option-specific flight details, or 'See flight details below' if shared, or \"\" if none.",
      "pricePerPerson": "R00,000.00",
      "totalPrice": "R00,000.00",
      "totalPax": "number of pax for this price if stated"
    }
  ],
  "flightDetails": "Shared flights applying to ALL options. Empty string if each option has its own or if none.",
  "exclusions": ["exclusion 1", "exclusion 2"]
}

Rules:
- Leave description as empty string ""
- Include ALL options found — do not skip any
- Each inclusion as its own array item
- If multiple room types for same resort, create separate options
- PRICING: Search entire document — prices may appear as "R 45,000", "R45000", "ZAR 45,000", "from R45k", in tables. Extract every price.
- Do NOT mention supplier names (AFS, Afristay, Tourvest, Thompsons, Club Travel etc)
- Strip booking reference codes and internal identifiers
- resortName: resort/hotel name and star rating only

Supplier document:
${rawText}`;

    const pass2Prompt = (options) => `From the supplier document below, extract the VERBATIM marketing description for each resort listed. Return ONLY valid JSON:
{"descriptions":[{"optionNumber":1,"description":"Full verbatim description..."},{"optionNumber":2,"description":"..."}]}
Include every option. Keep descriptions complete and verbatim.
Options to describe: ${options.map(o => `${o.optionNumber}. ${o.resortName}`).join(', ')}

Supplier document:
${rawText}`;

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in environment.');

    const callParams = {
      model:    'anthropic/claude-haiku-4.5',
      provider: { order: ['Anthropic'], allow_fallbacks: true },
    };

    // Hard 22s deadline covering both passes
    const hardTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('The AI is taking longer than usual. Please try again.')), 22000)
    );

    const fullExtraction = (async () => {
      // Pass 1: all options, no descriptions (~5-8s)
      const { body: body1 } = await callOpenRouter(apiKey, {
        ...callParams, max_tokens: 1500,
        messages: [{ role: 'user', content: pass1Prompt }],
      });
      const data1 = JSON.parse(body1);
      if (data1.error) throw new Error(`OpenRouter error: ${data1.error.message || JSON.stringify(data1.error)}`);
      const c1 = data1.choices?.[0]?.message?.content;
      if (!c1) throw new Error('No content in pass 1 response.');
      const clean1 = c1.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      let qd;
      try { qd = JSON.parse(clean1); } catch { qd = repairJSON(clean1); }
      if (!qd) throw new Error('Pass 1 response could not be parsed. Please try again.');

      // Pass 2: descriptions only (~5-8s, optional — if it fails we return without descriptions)
      try {
        if (qd.options && qd.options.length > 0) {
          const { body: body2 } = await callOpenRouter(apiKey, {
            ...callParams, max_tokens: 2000,
            messages: [{ role: 'user', content: pass2Prompt(qd.options) }],
          });
          const data2 = JSON.parse(body2);
          const c2 = data2.choices?.[0]?.message?.content || '';
          const clean2 = c2.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
          let desc;
          try { desc = JSON.parse(clean2); } catch { desc = repairJSON(clean2); }
          if (desc && desc.descriptions) {
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

    if (cd.clientName)  quoteData.clientName  = cd.clientName;
    if (cd.destination) quoteData.destination = cd.destination;
    if (cd.dates)       quoteData.dates       = cd.dates;
    if (cd.adults)      quoteData.adults      = cd.adults;
    if (cd.occasion)    quoteData.occasion    = cd.occasion;

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
