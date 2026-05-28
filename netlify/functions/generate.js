const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');
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

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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
      "pricePerPerson": "R00,000.00",
      "totalPrice": "R00,000.00",
      "totalPax": "number of pax for this price if stated"
    }
  ],
  "flightDetails": "Full flight info as readable paragraph or empty string if none",
  "exclusions": ["exclusion 1", "exclusion 2"]
}

Rules:
- Keep descriptions verbatim and complete
- Each inclusion as its own array item
- If multiple room types for same resort, create separate options
- Omit price fields if not found (no placeholders)

Supplier document:
${rawText}`;

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in environment.');

    const apiRes = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://izitravel.co.za',
        'X-Title': 'IziTravel Quote Generator',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4.5',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,
      }),
    });

    const aiData  = await apiRes.json();
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
