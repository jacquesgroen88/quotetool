const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');
const https    = require('https');
const fs       = require('fs');
const path     = require('path');

// Load .env for local dev (no dotenv dependency needed)
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

// Use Node https module — avoids Node 18 native fetch (undici) connection
// reliability issues from some Netlify Lambda IPs (same fix as _store.js)
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

    req.on('error', (err) => reject(new Error(`OpenRouter connection error: ${err.message}`)));

    // 20-second socket timeout — kills hung connections at TCP level
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error('The AI is taking longer than usual. Please try again — it usually works on the second attempt.'));
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

    const prompt = `You are a travel quote formatter for IziTravel, a South African travel agency.

Extract structured package data from this supplier document and return ONLY valid JSON (no markdown, no extra text).

Client details provided:
- Name: ${cd.clientName || 'Unknown'}
- Occasion: ${cd.occasion || ''}
- Destination: ${cd.destination || ''}
- Dates: ${cd.dates || ''}
- Adults: ${cd.adults || '2'}

Return this exact JSON structure:
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
      "description": "Full resort marketing description verbatim",
      "inclusions": ["inclusion 1", "inclusion 2"],
      "addedValue": ["added value item if present"],
      "flightDetails": "Flight details specific to this option — departure city, flight numbers, times, dates, luggage allowance. Use 'See flight details below' if flights are shared. Use empty string \"\" if no flight info exists in the document.",
      "pricePerPerson": "R00,000.00",
      "totalPrice": "R00,000.00",
      "totalPax": "number of pax for this price if stated"
    }
  ],
  "flightDetails": "Shared flight information that applies to ALL options (only populate if flights are not option-specific). Use empty string if each option has its own flightDetails or if no flights are mentioned.",
  "exclusions": ["exclusion 1", "exclusion 2"]
}

Rules:
- Keep resort descriptions verbatim and complete
- Each inclusion as its own array item
- If multiple room types for same resort, create separate options
- PRICING (critical): Search the entire document thoroughly for prices — they may appear as "R 45,000", "R45000", "ZAR 45,000", "from R45k", or in a table/grid. Extract every price found and assign to the correct option. If a price is genuinely absent from the document, omit the price fields entirely (do not write placeholder text).
- FLIGHT DETAILS: If flight info exists in the document, extract it fully. If each option has different flights, put them in options[].flightDetails. If all options share the same flights, put them in the top-level flightDetails and set each option's flightDetails to "See flight details below". If NO flight info is in the document, use empty string "" — never write placeholder text like "not provided" or "not available".
- IMPORTANT: Do NOT mention the supplier, wholesaler, booking platform or distributor name anywhere (e.g. "AFS", "Afristay", "Tourvest", "Thompsons", "Club Travel" etc). This is an IziTravel client-facing quote — the client must only see IziTravel as the source
- Strip any booking reference codes, agent codes, or internal identifiers from the output
- resortName should be ONLY the resort/hotel name and star rating — no supplier branding

Supplier document:
${rawText}`;

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in environment.');

    // Hard 22-second deadline — wins the race before Netlify's 26s gateway limit
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('The AI is taking longer than usual. Please try again — it usually works on the second attempt.')), 22000)
    );

    const { body } = await Promise.race([
      callOpenRouter(apiKey, {
        model:      'anthropic/claude-haiku-4.5',
        messages:   [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        provider:   { order: ['Anthropic'], allow_fallbacks: false },
      }),
      timeout,
    ]);

    const aiData  = JSON.parse(body);
    if (aiData.error) throw new Error(`OpenRouter error: ${aiData.error.message || JSON.stringify(aiData.error)}`);
    const content = aiData.choices?.[0]?.message?.content;
    if (!content) throw new Error(`No content in AI response. Raw: ${JSON.stringify(aiData).slice(0, 300)}`);

    const cleaned   = content.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const quoteData = JSON.parse(cleaned);

    // Agent-provided values always win
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
