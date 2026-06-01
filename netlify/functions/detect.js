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
  throw new Error('Unsupported file type.');
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
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('OpenRouter timeout')); });
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
    const { fileData, filename } = JSON.parse(event.body);
    const base64  = fileData.includes(',') ? fileData.split(',')[1] : fileData;
    const buffer  = Buffer.from(base64, 'base64');
    const rawText = await extractText(buffer, filename);
    const apiKey  = process.env.OPENROUTER_API_KEY;

    const { body } = await callOpenRouter(apiKey, {
      model:      'anthropic/claude-haiku-4.5',
      messages: [{
        role:    'user',
        content: `From this travel supplier document, extract ONLY as JSON (no markdown):
{"clientName":"","destination":"","dates":"","adults":"","occasion":""}
Leave empty string if not found. Look for labels like "Pax:", "Attention:", "Quote for:", "Client:".
Text:\n${rawText.slice(0, 3000)}`,
      }],
      max_tokens: 256,
    });

    const aiData  = JSON.parse(body);
    const content = aiData.choices?.[0]?.message?.content || '{}';
    const cleaned = content.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: cleaned,
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientName: '', destination: '', dates: '', adults: '', occasion: '' }),
    };
  }
};
