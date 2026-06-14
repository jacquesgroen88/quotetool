const store = require('./_store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };

  const id = event.queryStringParameters?.id;
  if (!id) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: errorPage('Missing confirmation ID', 'No confirmation ID was provided in the URL.') };
  }

  try {
    const record = await store.getJSON(id);
    if (!record || record.recordType !== 'confirmation') {
      return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: errorPage('Confirmation Not Found', 'This confirmation link has expired or does not exist.') };
    }

    const siteUrl   = process.env.URL || process.env.DEPLOY_URL || 'https://izitravelquotes.netlify.app';
    const logoUrl   = `${siteUrl}/assets/izilogo.jpg`;
    const cacheBust = process.env.COMMIT_REF ? process.env.COMMIT_REF.slice(0, 8) : Date.now();

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>IziTravel Confirmation — ${esc(record.clientName)} — ${esc(record.destination)}</title>
</head>
<body>
<script id="confirmationPayload" type="application/json">${JSON.stringify({ confirmationData: record.confirmationData, logoBase64: logoUrl })}</script>
<script src="${siteUrl}/js/confirmation-template.js?v=${cacheBust}"></script>
<script>
(function(){
  var p = JSON.parse(document.getElementById('confirmationPayload').textContent);
  var h = buildConfirmationHTML(p.confirmationData, p.logoBase64);
  document.open(); document.write(h); document.close();
})();
</script>
</body>
</html>`;

    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html };
  } catch (err) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: errorPage('Error', err.message || 'Failed to load confirmation.') };
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
