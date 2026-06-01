const store  = require('./_store');
const path   = require('path');

// Require template.js for server-side rendering.
// On Netlify Lambda, __dirname = /var/task (function root).
// included_files in netlify.toml bundles public/js/template.js at /var/task/public/js/template.js
const { buildQuoteHTML } = require(path.resolve(__dirname, 'public/js/template.js'));

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

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

    // Logo served from static site — always a URL, never base64
    const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'https://izitravelquotes.netlify.app';
    const logoUrl = `${siteUrl}/assets/izilogo.jpg`;

    // Render HTML directly server-side — no document.write, no client-side template loading
    const html = buildQuoteHTML(record.quoteData, logoUrl);

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
