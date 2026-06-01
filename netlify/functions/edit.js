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
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Edit request timed out. Please try again.')); });
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
    const { quoteData, message } = JSON.parse(event.body);
    const apiKey = process.env.OPENROUTER_API_KEY;

    const systemPrompt = `You are an AI assistant helping a travel agent modify a client quote.
You receive the current quote data as JSON and a natural language instruction.
Return ONLY a JSON object — no markdown, no explanation:
{
  "changes": "one clear sentence describing exactly what you changed",
  "data": { ...the complete modified quoteData object... }
}
Make only the changes requested. Keep all other data exactly as-is.
The "data" field must be the COMPLETE quoteData object, not just the changed parts.`;

    const userPrompt = `Current quote data:
${JSON.stringify(quoteData, null, 2)}

Agent instruction: "${message}"`;

    const { body } = await callOpenRouter(apiKey, {
      model:    'anthropic/claude-haiku-4.5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      max_tokens: 4096,
    });

    const aiData  = JSON.parse(body);
    const content = aiData.choices?.[0]?.message?.content;
    if (!content) throw new Error('No response from AI.');

    const cleaned = content.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const result  = JSON.parse(cleaned);

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteData: result.data, changes: result.changes }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to apply changes.' }),
    };
  }
};
