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

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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

    const apiRes = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://izitravel.co.za',
        'X-Title': 'IziTravel Quote Generator',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4.5',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        max_tokens: 4096,
      }),
    });

    const aiData  = await apiRes.json();
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
