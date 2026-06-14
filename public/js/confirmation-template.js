// ─── IziTravel Booking Confirmation HTML Template ────────────────────────────
// Builds a fully self-contained branded confirmation from a single confirmed
// package. Runs client-side; logo passed as a base64 data URL or URL.
// NOTE: the confirmation uses a different contact number to the quote tool —
// confirm with Terri before relying on it (CONTEXT.md open item).

const CONFIRM_PHONE  = '+27 82 967 2060';
const CONFIRM_EMAIL  = 'terrib@izitravel.co.za';
const CONFIRM_OFFICE = '+27 16 023 0214';

const CONF_DESTINATION_IMAGES = {
  zanzibar:   'https://images.unsplash.com/photo-1586611292717-f828b167408c?q=80&w=2000&auto=format&fit=crop',
  mauritius:  'https://images.unsplash.com/photo-1518548419970-58e3b4079ab2?q=80&w=2000&auto=format&fit=crop',
  maldives:   'https://images.unsplash.com/photo-1573843981267-be1999ff37cd?q=80&w=2000&auto=format&fit=crop',
  thailand:   'https://images.unsplash.com/photo-1552465011-b4e21bf6e79a?q=80&w=2000&auto=format&fit=crop',
  phuket:     'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=2000&auto=format&fit=crop',
  bali:       'https://images.unsplash.com/photo-1537996194471-e657df975ab4?q=80&w=2000&auto=format&fit=crop',
  dubai:      'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?q=80&w=2000&auto=format&fit=crop',
  seychelles: 'https://images.unsplash.com/photo-1511275539165-cc46b1ee89bf?q=80&w=2000&auto=format&fit=crop',
  default:    'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?q=80&w=2000&auto=format&fit=crop',
};

function confHeroImage(destination) {
  if (!destination) return CONF_DESTINATION_IMAGES.default;
  const key = destination.toLowerCase();
  for (const [name, url] of Object.entries(CONF_DESTINATION_IMAGES)) {
    if (key.includes(name)) return url;
  }
  return CONF_DESTINATION_IMAGES.default;
}

function confEsc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function paxName(p) {
  return [p.title, p.firstName, p.surname].filter(Boolean).join(' ').trim();
}

function buildConfirmationFilename(data) {
  const safe = (s) => (s || '').replace(/[^a-zA-Z0-9 \-]/g, '').trim();
  const parts = ['IziTravel Confirmation'];
  if (safe(data.clientName))  parts.push(safe(data.clientName));
  if (safe(data.destination)) parts.push(safe(data.destination));
  if (parts.length === 1)     parts.push(new Date().toISOString().slice(0, 10));
  return parts.join(' - ') + '.html';
}

function buildConfirmationHTML(data, logoBase64) {
  const dest        = data.destination || '';
  const heroImg     = confHeroImage(dest);
  const confRef     = (data.bookingRef && String(data.bookingRef).trim())
    ? 'IZI-' + String(data.bookingRef).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-8)
    : 'IZI-' + Date.now().toString(36).toUpperCase().slice(-6);

  const passengers  = Array.isArray(data.passengers) ? data.passengers : [];
  const paxNames    = passengers.map(paxName).filter(Boolean);
  const attention   = paxNames.length ? paxNames.join(' & ') : (data.clientName || 'Valued Traveller');
  const td          = data.travelDates || {};
  const datesStr    = [td.start, td.end].filter(Boolean).join(' – ');
  const nights      = td.nights || (data.resort && data.resort.nights) || '';
  const tripType    = data.tripType || '';
  const resort      = data.resort || {};
  const p           = data.pricing || {};

  const logoTag = logoBase64
    ? `<img src="${logoBase64}" alt="IziTravel" style="height:52px;width:auto;display:block"/>`
    : `<span style="font-size:20px;font-weight:900;color:#e63946">IziTravel</span>`;

  // ── Includes list ──
  const incl = (data.inclusions || []).map(i => `<li><span class="chk">&#10003;</span>${confEsc(i)}</li>`).join('');
  const transfers = (data.transfers || []).map(t => `<li><span class="chk">&#10003;</span>${confEsc(t)}</li>`).join('');

  // ── Resort / board card ──
  const boardBullets = (data.boardDetail || []).map(b => `<li>${confEsc(b)}</li>`).join('');
  const resortLine = [resort.grade, resort.name].filter(Boolean).join(' ');
  const roomLine   = [resort.roomType, resort.roomDesc ? `(${resort.roomDesc})` : ''].filter(Boolean).join(' ');
  const resortCard = (resort.name || data.board)
    ? `<div class="resort-card">
        ${resortLine ? `<div class="resort-name">${confEsc(resortLine)}</div>` : ''}
        <div class="resort-meta">
          ${nights ? `<span class="meta-pill">&#127769; ${confEsc(nights)} Nights</span>` : ''}
          ${data.board ? `<span class="meta-pill meta-board">${confEsc(data.board)}</span>` : ''}
          ${roomLine ? `<span class="meta-pill meta-room">${confEsc(roomLine)}</span>` : ''}
        </div>
        ${boardBullets ? `<ul class="board-list">${boardBullets}</ul>` : ''}
      </div>`
    : '';

  // ── Added value ──
  const added = (data.addedValue || []).length
    ? `<div class="added-box"><div class="added-title">&#10024; Added Value</div>
        <ul>${data.addedValue.map(a => `<li><span class="chk">&#10003;</span>${confEsc(a)}</li>`).join('')}</ul></div>`
    : '';

  // ── Flights table ──
  const flightRows = (data.flights || []).map(f => `
    <tr>
      <td>${confEsc(f.date)}</td>
      <td><strong>${confEsc(f.flightNo)}</strong></td>
      <td>${confEsc([f.from, f.to].filter(Boolean).join(' → '))}</td>
      <td>${confEsc(f.depart)}${f.arrive ? ' – ' + confEsc(f.arrive) : ''}</td>
      <td>${confEsc(f.class)}</td>
    </tr>`).join('');
  const flightTable = flightRows
    ? `<section class="sec">
        <div class="sec-inner">
          <h2 class="sec-title">&#9992; Flight Details</h2>
          ${paxNames.length ? `<p class="pax-line"><strong>Passengers:</strong> ${confEsc(paxNames.join(' · '))}</p>` : ''}
          <div class="flight-wrap">
            <table class="flight-table">
              <thead><tr><th>Date</th><th>Flight</th><th>Route</th><th>Time</th><th>Class</th></tr></thead>
              <tbody>${flightRows}</tbody>
            </table>
          </div>
        </div>
      </section>`
    : '';

  // ── Pricing + payment schedule ──
  const scheduleRows = [];
  if (p.deposit)  scheduleRows.push(`<div class="pay-row"><span>Deposit${p.depositDue ? ` <em>(due ${confEsc(p.depositDue)})</em>` : ''}</span><strong>${confEsc(p.deposit)}</strong></div>`);
  if (p.balance)  scheduleRows.push(`<div class="pay-row"><span>Balance${p.balanceDue ? ` <em>(due ${confEsc(p.balanceDue)})</em>` : ''}</span><strong>${confEsc(p.balance)}</strong></div>`);
  const pricingBlock = (p.total || scheduleRows.length)
    ? `<section class="sec price-sec">
        <div class="sec-inner">
          <div class="price-card">
            ${p.pricePerPerson ? `<div class="pp-line">${confEsc(p.pricePerPerson)} <span>per person</span></div>` : ''}
            ${p.total ? `<div class="total-line"><span>Total Package</span><strong>${confEsc(p.total)}</strong></div>` : ''}
            ${scheduleRows.length ? `<div class="pay-schedule"><div class="pay-title">Payment Schedule</div>${scheduleRows.join('')}</div>` : ''}
          </div>
        </div>
      </section>`
    : '';

  // ── Exclusions ──
  const excl = (data.exclusions || []).length
    ? `<section class="sec excl-sec"><div class="sec-inner">
        <h2 class="sec-title">The above excludes</h2>
        <ul class="excl-list">${data.exclusions.map(e => `<li>${confEsc(e)}</li>`).join('')}</ul>
      </div></section>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>IziTravel Confirmation &middot; ${confEsc(data.clientName || attention)} &middot; ${confEsc(dest)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--pink:#e63946;--pink-dark:#b91c1c;--pink-light:#fef2f2;--gray-50:#f9fafb;--gray-100:#f3f4f6;--gray-200:#e5e7eb;--gray-400:#9ca3af;--gray-500:#6b7280;--gray-700:#374151;--gray-900:#111827;--green:#16a34a;--shadow:0 4px 24px rgba(0,0,0,.08)}
body{font-family:'Inter',sans-serif;background:#fff;color:var(--gray-900);line-height:1.6}
.site-hdr{background:#fff;border-bottom:1px solid var(--gray-200)}
.site-hdr-inner{max-width:1000px;margin:0 auto;padding:16px 32px;display:flex;align-items:center;justify-content:space-between;gap:24px}
.hdr-contact{text-align:right;font-size:13px;color:var(--gray-500);line-height:1.9}
.hdr-contact a{color:var(--pink);font-weight:600;text-decoration:none}
.hdr-badge{display:inline-block;background:var(--pink);color:#fff;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 12px;border-radius:999px;margin-left:8px;vertical-align:middle}
.accent-bar{background:var(--pink);height:4px}
.hero{position:relative;height:300px;overflow:hidden;display:flex;align-items:flex-end}
.hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero-ov{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.9) 0%,rgba(0,0,0,.35) 60%,rgba(0,0,0,.1) 100%)}
.hero-cnt{position:relative;z-index:2;max-width:1000px;margin:0 auto;width:100%;padding:0 32px 34px}
.hero-tag{display:inline-block;background:var(--pink);color:#fff;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:5px 14px;border-radius:999px;margin-bottom:10px}
.hero-title{font-size:clamp(24px,4vw,40px);font-weight:900;color:#fff;line-height:1.1;letter-spacing:-.03em;margin-bottom:10px}
.hero-meta{display:flex;flex-wrap:wrap;gap:10px}
.hero-pill{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.2);color:#fff;font-size:13px;font-weight:500;padding:6px 14px;border-radius:999px}
.cref{position:absolute;top:18px;right:32px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);color:#fff;font-size:11px;font-weight:600;padding:5px 12px;border-radius:999px;letter-spacing:.05em}
.attn{background:var(--pink-light);border-bottom:1px solid #fecaca;padding:20px 32px}
.attn-inner{max-width:1000px;margin:0 auto}
.attn-line{font-size:15px;color:var(--gray-900)}.attn-line strong{color:var(--pink-dark)}
.attn-sub{font-size:13px;color:var(--gray-500);margin-top:4px}
.sec{padding:44px 32px}.sec-inner{max-width:1000px;margin:0 auto}
.sec-title{font-size:22px;font-weight:800;letter-spacing:-.02em;margin-bottom:20px}
.incl-list,.added-box ul,.board-list{list-style:none;display:flex;flex-direction:column;gap:8px}
.incl-list li,.added-box li{display:flex;align-items:flex-start;gap:9px;font-size:14px;color:var(--gray-700)}
.chk{color:var(--green);font-weight:700;flex-shrink:0;margin-top:1px}
.resort-card{background:var(--gray-50);border:1px solid var(--gray-200);border-radius:14px;padding:20px;margin:20px 0}
.resort-name{font-size:18px;font-weight:800;color:var(--gray-900);letter-spacing:-.02em;margin-bottom:10px}
.resort-meta{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px}
.meta-pill{font-size:12px;font-weight:700;padding:5px 13px;border-radius:999px;background:#1e293b;color:#fff}
.meta-board{background:#15803d}.meta-room{background:var(--gray-700)}
.board-list{margin-top:6px}.board-list li{font-size:13px;color:var(--gray-500);padding-left:14px;position:relative}
.board-list li::before{content:'•';position:absolute;left:0;color:var(--pink)}
.added-box{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin-top:16px}
.added-title{font-size:11px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}
.pax-line{font-size:13.5px;color:var(--gray-700);margin-bottom:14px}
.flight-wrap{overflow-x:auto;border:1px solid var(--gray-200);border-radius:12px}
.flight-table{width:100%;border-collapse:collapse;font-size:13.5px}
.flight-table th{background:var(--gray-50);text-align:left;padding:11px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--gray-500);border-bottom:1px solid var(--gray-200)}
.flight-table td{padding:11px 14px;color:var(--gray-700);border-bottom:1px solid var(--gray-100)}
.flight-table tr:last-child td{border-bottom:none}
.price-sec{background:var(--gray-50)}
.price-card{background:#fff;border:2px solid #fecaca;border-radius:16px;padding:24px;max-width:480px}
.pp-line{font-size:14px;color:var(--gray-500);margin-bottom:10px}.pp-line span{font-size:12px}
.total-line{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding-bottom:16px;border-bottom:1px solid var(--gray-200)}
.total-line span{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--gray-500)}
.total-line strong{font-size:30px;font-weight:900;color:var(--pink);letter-spacing:-.03em}
.pay-schedule{margin-top:16px}
.pay-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--gray-400);margin-bottom:10px}
.pay-row{display:flex;justify-content:space-between;gap:16px;font-size:14px;color:var(--gray-700);padding:6px 0}
.pay-row em{font-style:normal;color:var(--gray-400);font-size:12px}
.pay-row strong{color:var(--gray-900)}
.excl-sec{background:var(--gray-50);padding-top:0}
.excl-list{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:9px}
.excl-list li{display:flex;align-items:flex-start;gap:8px;font-size:13.5px;color:var(--gray-500)}
.excl-list li::before{content:'\\2715';color:#f87171;font-weight:700;flex-shrink:0}
.signoff{max-width:1000px;margin:0 auto;padding:8px 32px 44px;font-size:14px;color:var(--gray-700);line-height:1.8}
.site-ftr{background:var(--gray-900);padding:26px 32px}
.ftr-inner{max-width:1000px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.ftr-logo{background:rgba(255,255,255,.92);border-radius:8px;padding:5px 10px;display:inline-flex}
.ftr-logo img{height:32px;width:auto;display:block}
.ftr-text{font-size:11px;color:rgba(255,255,255,.5);text-align:right;line-height:1.8}
.ftr-text a{color:rgba(255,255,255,.7);text-decoration:none}
@media(max-width:640px){.site-hdr-inner{flex-direction:column;align-items:flex-start}.hdr-contact{text-align:left}.hero{height:240px}.hero-cnt{padding:0 20px 26px}.sec{padding:32px 20px}.attn{padding:18px 20px}.ftr-inner{flex-direction:column;align-items:flex-start}.ftr-text{text-align:left}}
@media print{body{font-size:12px}.hero{height:180px}.site-hdr,.accent-bar{position:static}.sec{padding:20px 24px;page-break-inside:avoid}.price-card{box-shadow:none}.hero-pill{-webkit-print-color-adjust:exact;print-color-adjust:exact}a{color:inherit}}
</style>
</head>
<body>
<header class="site-hdr">
  <div class="site-hdr-inner">
    <div class="hdr-logo">${logoTag}</div>
    <div class="hdr-contact">
      <a href="tel:${CONFIRM_PHONE.replace(/\s/g, '')}">${CONFIRM_PHONE}</a> &nbsp;|&nbsp;
      <a href="mailto:${CONFIRM_EMAIL}">${CONFIRM_EMAIL}</a>
      <span class="hdr-badge">Booking Confirmation</span><br>
      <span style="font-size:12px">Office ${CONFIRM_OFFICE}</span>
    </div>
  </div>
</header>
<div class="accent-bar"></div>

<section class="hero">
  <img class="hero-img" src="${heroImg}" alt="${confEsc(dest)}"/>
  <div class="hero-ov"></div>
  <div class="cref">${confRef}</div>
  <div class="hero-cnt">
    <div class="hero-tag">${confEsc(dest) || 'Booking Confirmation'}</div>
    <h1 class="hero-title">${confEsc(dest)} Confirmation</h1>
    <div class="hero-meta">
      ${datesStr ? `<div class="hero-pill">&#128197; ${confEsc(datesStr)}</div>` : ''}
      ${nights   ? `<div class="hero-pill">&#127769; ${confEsc(nights)} Nights</div>` : ''}
      ${paxNames.length ? `<div class="hero-pill">&#128100; ${paxNames.length} Traveller${paxNames.length > 1 ? 's' : ''}</div>` : ''}
    </div>
  </div>
</section>

<div class="attn">
  <div class="attn-inner">
    <div class="attn-line"><strong>Attention:</strong> ${confEsc(attention)}</div>
    <div class="attn-sub">We are delighted to confirm your holiday arrangements${tripType ? ' &mdash; ' + confEsc(tripType) : ''}. Please review the details below.</div>
  </div>
</div>

<section class="sec">
  <div class="sec-inner">
    <h2 class="sec-title">This Package Includes</h2>
    <ul class="incl-list">${incl}${transfers}</ul>
    ${resortCard}
    ${added}
  </div>
</section>

${flightTable}
${pricingBlock}
${excl}

<div class="signoff">
  Please double-check all passenger names against passports and let us know immediately if anything differs. We look forward to making your holiday unforgettable.<br><br>
  Kind regards,<br><strong>Terri &middot; IziTravel</strong>
</div>

<footer class="site-ftr">
  <div class="ftr-inner">
    <div class="ftr-logo">${logoTag}</div>
    <div class="ftr-text">
      <a href="tel:${CONFIRM_PHONE.replace(/\s/g, '')}">${CONFIRM_PHONE}</a> &middot; <a href="mailto:${CONFIRM_EMAIL}">${CONFIRM_EMAIL}</a><br>
      All bookings subject to availability &amp; supplier terms. Travel insurance is compulsory.<br>
      Prices in South African Rand (ZAR) &middot; IziTravel &middot; Let Us Show You The World!
    </div>
  </div>
</footer>
</body>
</html>`;
}
