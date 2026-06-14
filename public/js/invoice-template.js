// ─── IziTravel Invoice HTML Template ─────────────────────────────────────────
// Builds a branded, print-ready invoice from structured data. Runs client-side.

const INV_PHONE  = '+27 82 967 2060';
const INV_EMAIL  = 'terrib@izitravel.co.za';
const INV_OFFICE = '+27 16 023 0214';

function invEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildInvoiceFilename(d) {
  const safe = (s) => (s || '').replace(/[^a-zA-Z0-9 \-]/g, '').trim();
  return ['IziTravel Invoice', safe(d.invoiceNo), safe(d.clientName)].filter(Boolean).join(' - ') + '.html';
}

function buildInvoiceHTML(data, logoBase64) {
  const d = data || {};
  const bank = d.banking || {};
  const logoTag = logoBase64
    ? `<img src="${logoBase64}" alt="IziTravel" style="height:50px;width:auto;display:block"/>`
    : `<span style="font-size:20px;font-weight:900;color:#e63946">IziTravel</span>`;

  const rows = (d.lineItems || []).filter(li => li && (li.description || li.amount)).map(li =>
    `<tr><td>${invEsc(li.description)}</td><td class="amt">${invEsc(li.amount)}</td></tr>`
  ).join('') || `<tr><td>Travel package${d.destination ? ' — ' + invEsc(d.destination) : ''}</td><td class="amt">${invEsc(d.total)}</td></tr>`;

  const sched = [];
  if (d.deposit) sched.push(`<div class="pay-row"><span>Deposit${d.depositDue ? ` <em>(due ${invEsc(d.depositDue)})</em>` : ''}</span><strong>${invEsc(d.deposit)}</strong></div>`);
  if (d.balance) sched.push(`<div class="pay-row"><span>Balance${d.balanceDue ? ` <em>(due ${invEsc(d.balanceDue)})</em>` : ''}</span><strong>${invEsc(d.balance)}</strong></div>`);

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>IziTravel Invoice ${invEsc(d.invoiceNo)} — ${invEsc(d.clientName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--pink:#e63946;--pink-dark:#b91c1c;--g50:#f9fafb;--g100:#f3f4f6;--g200:#e5e7eb;--g400:#9ca3af;--g500:#6b7280;--g700:#374151;--g900:#111827}
body{font-family:'Inter',sans-serif;background:var(--g50);color:var(--g900);line-height:1.5;padding:28px}
.sheet{max-width:820px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 28px rgba(0,0,0,.08)}
.top{background:var(--pink);height:5px}
.head{display:flex;justify-content:space-between;align-items:flex-start;padding:28px 36px 18px;gap:20px;flex-wrap:wrap}
.head .contact{font-size:12px;color:var(--g500);line-height:1.8;text-align:right}
.head .contact a{color:var(--pink);text-decoration:none}
.title{padding:0 36px}
.title h1{font-size:30px;font-weight:900;letter-spacing:-.02em;color:var(--g900)}
.title .meta{display:flex;gap:26px;flex-wrap:wrap;margin-top:6px;font-size:13px;color:var(--g500)}
.title .meta b{color:var(--g900)}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:22px 36px}
.party .lbl{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--g400);margin-bottom:5px}
.party .v{font-size:13.5px;color:var(--g700);line-height:1.7}
.party .v strong{color:var(--g900)}
table{width:100%;border-collapse:collapse;margin:0}
.items{padding:0 36px}
.items table th{background:var(--g50);text-align:left;padding:11px 14px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--g500);border-top:1px solid var(--g200);border-bottom:1px solid var(--g200)}
.items table th.amt,.items table td.amt{text-align:right;white-space:nowrap}
.items table td{padding:13px 14px;font-size:13.5px;color:var(--g700);border-bottom:1px solid var(--g100)}
.totbox{padding:14px 36px;display:flex;justify-content:flex-end}
.totbox .tot{min-width:280px}
.tot .total-line{display:flex;justify-content:space-between;align-items:baseline;border-top:2px solid var(--g900);padding-top:12px;margin-top:6px}
.tot .total-line span{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--g500)}
.tot .total-line strong{font-size:26px;font-weight:900;color:var(--pink)}
.pay-row{display:flex;justify-content:space-between;font-size:13px;color:var(--g700);padding:5px 0}
.pay-row em{font-style:normal;color:var(--g400);font-size:11.5px}
.bank{margin:8px 36px 0;background:var(--g50);border:1px solid var(--g200);border-radius:12px;padding:18px 20px}
.bank .lbl{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--pink-dark);margin-bottom:10px}
.bank .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;font-size:13px}
.bank .grid .k{color:var(--g500)}.bank .grid .vv{font-weight:700;color:var(--g900)}
.notes{padding:18px 36px;font-size:12.5px;color:var(--g500);line-height:1.7}
.ftr{background:var(--g900);color:rgba(255,255,255,.6);font-size:11px;text-align:center;padding:16px;line-height:1.7}
.ftr a{color:rgba(255,255,255,.8);text-decoration:none}
@media print{body{background:#fff;padding:0}.sheet{box-shadow:none;border-radius:0;max-width:none}a{color:inherit}.bank,.items table th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="sheet">
  <div class="top"></div>
  <div class="head">
    <div>${logoTag}<div style="font-size:11px;color:#9ca3af;margin-top:6px;letter-spacing:.04em">LET US SHOW YOU THE WORLD!</div></div>
    <div class="contact"><a href="tel:${INV_PHONE.replace(/\s/g,'')}">${INV_PHONE}</a><br><a href="mailto:${INV_EMAIL}">${INV_EMAIL}</a><br>Office ${INV_OFFICE}</div>
  </div>
  <div class="title">
    <h1>INVOICE</h1>
    <div class="meta">
      ${d.invoiceNo ? `<div>Invoice No: <b>${invEsc(d.invoiceNo)}</b></div>` : ''}
      ${d.date ? `<div>Date: <b>${invEsc(d.date)}</b></div>` : ''}
      ${d.dueDate ? `<div>Due: <b>${invEsc(d.dueDate)}</b></div>` : ''}
    </div>
  </div>
  <div class="parties">
    <div class="party"><div class="lbl">Bill To</div><div class="v"><strong>${invEsc(d.clientName) || 'Client'}</strong><br>${d.email ? invEsc(d.email) + '<br>' : ''}${d.phone ? invEsc(d.phone) : ''}</div></div>
    <div class="party"><div class="lbl">Trip</div><div class="v">${invEsc(d.destination) || '—'}${d.dates ? '<br>' + invEsc(d.dates) : ''}</div></div>
  </div>
  <div class="items">
    <table><thead><tr><th>Description</th><th class="amt">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  </div>
  <div class="totbox"><div class="tot">
    ${sched.join('')}
    <div class="total-line"><span>Total Due</span><strong>${invEsc(d.total) || '—'}</strong></div>
  </div></div>
  <div class="bank">
    <div class="lbl">💳 Banking Details — Payment</div>
    <div class="grid">
      <div><span class="k">Account Name:</span> <span class="vv">${invEsc(bank.accountName)}</span></div>
      <div><span class="k">Bank:</span> <span class="vv">${invEsc(bank.bank)}</span></div>
      <div><span class="k">Account No:</span> <span class="vv">${invEsc(bank.accountNumber)}</span></div>
      <div><span class="k">Branch Code:</span> <span class="vv">${invEsc(bank.branchCode)}</span></div>
      <div><span class="k">Account Type:</span> <span class="vv">${invEsc(bank.accountType)}</span></div>
      <div><span class="k">Reference:</span> <span class="vv">${invEsc(bank.reference || d.invoiceNo)}</span></div>
    </div>
  </div>
  <div class="notes">${d.notes ? invEsc(d.notes) + '<br><br>' : ''}Please use the invoice number as your payment reference. Proof of payment can be emailed to ${INV_EMAIL}. Travel documents are released on receipt of full payment.</div>
  <div class="ftr">IziTravel &middot; <a href="tel:${INV_PHONE.replace(/\s/g,'')}">${INV_PHONE}</a> &middot; <a href="mailto:${INV_EMAIL}">${INV_EMAIL}</a> &middot; Prices in South African Rand (ZAR)</div>
</div>
</body></html>`;
}
