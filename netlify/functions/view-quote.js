const store = require('./_store');
const { stripForDisplay } = require('./_patch');

// JSON destined for a <script> block: JSON.stringify does not escape "<", so a
// stored string containing "</script>" would break out of the tag. Escape it.
function jsonForScript(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

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

    const siteUrl   = process.env.URL || process.env.DEPLOY_URL || 'https://izitravelquotes.netlify.app';
    const logoUrl   = `${siteUrl}/assets/izilogo.jpg`;
    // Cache-bust using deploy commit ref so browsers always get latest template.js
    const cacheBust = process.env.COMMIT_REF ? process.env.COMMIT_REF.slice(0, 8) : Date.now();

    // The client-facing page must never see internal bookkeeping: supplier
    // source prices, pre-markup baselines, or the markup itself (all visible
    // via View Source otherwise). The template renders none of these.
    const viewData = stripForDisplay(record.quoteData || {});
    delete viewData.markup;

    // Serve a thin HTML shell that loads template.js and rewrites the page.
    // quote-modal.js (external static file) is loaded by the generated HTML —
    // no inline JS in the generated page so no template-literal escaping issues.
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>IziTravel Quote — ${esc(record.clientName)} — ${esc(record.destination)}</title>
</head>
<body>
<script id="quotePayload" type="application/json">${jsonForScript({ quoteData: viewData, logoBase64: logoUrl })}</script>
<script src="${siteUrl}/js/template.js?v=${cacheBust}"></script>
<script>
(function(){
  var p = JSON.parse(document.getElementById('quotePayload').textContent);
  var h = buildQuoteHTML(p.quoteData, p.logoBase64);
  document.open(); document.write(h); document.close();
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
