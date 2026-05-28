const store = require('./_store');
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

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Initialise Netlify Blobs context for v1 functions
  store.init(event);

  const quoteId = event.queryStringParameters?.id;
  if (!quoteId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: errorPage('Missing quote ID', 'No quote ID was provided in the URL.'),
    };
  }

  try {
    const record = await store.getJSON(quoteId);

    if (!record) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html' },
        body: errorPage('Quote Not Found', 'This quote link has expired or does not exist.'),
      };
    }

    // Read the client-side template.js and inline it
    const templatePath = path.resolve(__dirname, '../../public/js/template.js');
    const templateJs   = fs.readFileSync(templatePath, 'utf8');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>IziTravel Quote — ${esc(record.clientName)} — ${esc(record.destination)}</title>
</head>
<body>
<script id="quotePayload" type="application/json">${JSON.stringify({ quoteData: record.quoteData, logoBase64: record.logoBase64 })}</script>
<script>
${templateJs}
(function(){
  var payload = JSON.parse(document.getElementById('quotePayload').textContent);
  var html = buildQuoteHTML(payload.quoteData, payload.logoBase64);
  document.open(); document.write(html); document.close();
})();
</script>
</body>
</html>`;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: errorPage('Error', err.message || 'Failed to load quote.'),
    };
  }
};

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function errorPage(title, message) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${esc(title)}</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb}
.box{background:#fff;border-radius:16px;padding:48px;text-align:center;max-width:420px;box-shadow:0 4px 24px rgba(0,0,0,.1)}
h1{font-size:22px;color:#111;margin-bottom:8px}p{color:#666;font-size:14px}</style>
</head><body><div class="box"><h1>${esc(title)}</h1><p>${esc(message)}</p></div></body></html>`;
}
