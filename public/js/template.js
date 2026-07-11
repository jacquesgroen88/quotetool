// ─── IziTravel Quote HTML Template ───────────────────────────────────────────
// Builds a fully self-contained branded HTML quote from structured data.
// Runs client-side; logo is passed as a base64 data URL.

const WEBHOOK_URL  = '/.netlify/functions/quote-accepted';
const AGENT_PHONE  = '+27 60 806 6589';
const AGENT_EMAIL  = 'terrib@izitravel.co.za';
const AGENT_OFFICE = '+27 16 023 0214';
const AGENT_WA     = '27608066589';

const DESTINATION_IMAGES = {
  zanzibar:   'https://images.unsplash.com/photo-1586611292717-f828b167408c?q=80&w=2000&auto=format&fit=crop',
  mauritius:  'https://images.unsplash.com/photo-1518548419970-58e3b4079ab2?q=80&w=2000&auto=format&fit=crop',
  maldives:   'https://images.unsplash.com/photo-1573843981267-be1999ff37cd?q=80&w=2000&auto=format&fit=crop',
  thailand:   'https://images.unsplash.com/photo-1552465011-b4e21bf6e79a?q=80&w=2000&auto=format&fit=crop',
  phuket:     'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=2000&auto=format&fit=crop',
  bangkok:    'https://images.unsplash.com/photo-1508009603885-50cf7c579365?q=80&w=2000&auto=format&fit=crop',
  bali:       'https://images.unsplash.com/photo-1537996194471-e657df975ab4?q=80&w=2000&auto=format&fit=crop',
  dubai:      'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?q=80&w=2000&auto=format&fit=crop',
  greece:     'https://images.unsplash.com/photo-1533105079780-92b9be482077?q=80&w=2000&auto=format&fit=crop',
  seychelles: 'https://images.unsplash.com/photo-1511275539165-cc46b1ee89bf?q=80&w=2000&auto=format&fit=crop',
  default:    'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?q=80&w=2000&auto=format&fit=crop',
};

function getHeroImage(destination) {
  if (!destination) return DESTINATION_IMAGES.default;
  const key = destination.toLowerCase();
  for (const [name, url] of Object.entries(DESTINATION_IMAGES)) {
    if (key.includes(name)) return url;
  }
  return DESTINATION_IMAGES.default;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildFilename(data) {
  const safe = (s) => (s || '').replace(/[^a-zA-Z0-9 \-]/g, '').trim();
  const parts = ['IziTravel Quote'];
  if (safe(data.clientName))  parts.push(safe(data.clientName));
  if (safe(data.destination)) parts.push(safe(data.destination));
  if (safe(data.dates))       parts.push(safe(data.dates));
  if (parts.length === 1)     parts.push(new Date().toISOString().slice(0, 10));
  return parts.join(' - ') + '.html';
}

// Deterministic ref for quotes saved before quoteRef was stored — derived from
// content so the client sees the SAME ref on every page view.
function legacyQuoteRef(data) {
  const s = [data.clientName, data.destination, data.dates].join('|');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase().padStart(6, '0').slice(-6);
}

function buildQuoteHTML(data, logoBase64) {
  const heroImg    = getHeroImage(data.destination);
  const quoteRef   = data.quoteRef || ('IZI-' + legacyQuoteRef(data));
  const dest       = data.destination || '';
  const adults     = data.adults ? `${data.adults} Adult${data.adults === '1' ? '' : 's'}` : '2 Adults';
  const childrenTxt = data.children && data.children !== '0' ? ` · ${esc(data.children)} Child${data.children === '1' ? '' : 'ren'}` : '';
  const dates      = data.dates || '';
  const occasion   = data.occasion || '';
  const validity   = data.quoteValidity || '48';

  // Build display name
  const title      = data.clientTitle ? data.clientTitle + ' ' : '';
  const clientName = (title + (data.clientName || 'Valued Client')).trim();
  const greeting   = data.clientTitle
    ? `Hi ${data.clientTitle} ${data.clientName || 'there'}`
    : `Hi ${data.clientName || 'there'}`;

  const logoTag = logoBase64
    ? `<img src="${logoBase64}" alt="IziTravel" style="height:52px;width:auto;display:block"/>`
    : `<span style="font-size:20px;font-weight:900;color:#e63946">IziTravel</span>`;

  // ── Option cards ──
  const optionCards = (data.options || []).map((opt, i) => {
    const inclHTML = (opt.inclusions || []).map(inc =>
      `<li><span class="chk">&#10003;</span>${esc(inc)}</li>`
    ).join('');

    const addedHTML = (opt.addedValue || []).length
      ? `<div class="added-box">
          <div class="added-title">&#10024; Added Value</div>
          <ul>${(opt.addedValue || []).map(av => `<li><span class="chk">&#10003;</span>${esc(av)}</li>`).join('')}</ul>
        </div>`
      : '';

    // Price — moved ABOVE inclusions so it's prominent
    const priceHTML = opt.pricePerPerson
      ? `<div class="price-box">
          <div class="price-row">
            <div>
              <div class="price-label">From</div>
              <div class="price-amount">${esc(opt.pricePerPerson)}</div>
              <div class="price-sub">per person sharing${opt.totalPax ? ` &times; ${esc(opt.totalPax)} pax` : ''}</div>
            </div>
          </div>
          ${opt.totalPrice ? `<div class="price-total">Total Package: ${esc(opt.totalPrice)}</div>` : ''}
        </div>`
      : '';

    // Key differentiator facts — shown prominently under resort name
    const factPills = [
      opt.nights     ? `<span class="fact-pill fact-nights">&#127769; ${esc(opt.nights)} Nights</span>` : '',
      opt.boardBasis ? `<span class="fact-pill fact-board">${esc(opt.boardBasis)}</span>` : '',
      opt.roomType   ? `<span class="fact-pill fact-room">${esc(opt.roomType)}</span>` : '',
    ].filter(Boolean).join('');

    const factsRow = factPills ? `<div class="opt-facts">${factPills}</div>` : '';

    // Per-option flight details — only show when real content exists
    const flightVal = (opt.flightDetails || '').trim();
    const flightIsPlaceholder = !flightVal
      || /not provided|not available|no flight|tbc|n\/a/i.test(flightVal);
    const optFlightHTML = flightIsPlaceholder
      ? ''
      : flightVal === 'See flight details below'
        ? `<div class="opt-flight opt-flight-ref">&#9992; See flight details below</div>`
        : `<div class="opt-flight">
            <div class="opt-flight-title">&#9992; Flight Details</div>
            <div class="opt-flight-body">${esc(flightVal).replace(/\n/g, '<br>')}</div>
          </div>`;

    // Description — collapsible, secondary
    const descHTML = opt.description
      ? `<details class="desc-details">
          <summary class="desc-summary">Resort Details</summary>
          <p class="resort-desc">${esc(opt.description)}</p>
        </details>`
      : '';

    // Embed option data for modal — use JSON in a data attribute
    const optDataAttr = esc(JSON.stringify({
      optionNumber:  opt.optionNumber || i + 1,
      resortName:    opt.resortName   || '',
      roomType:      opt.roomType     || '',
      boardBasis:    opt.boardBasis   || '',
      nights:        opt.nights       || '',
      pricePerPerson: opt.pricePerPerson || '',
      totalPrice:    opt.totalPrice   || '',
    }));

    return `
<div class="opt-card" id="opt-${i + 1}">
  <div class="opt-hdr">
    <span class="opt-num">Option ${esc(String(opt.optionNumber || i + 1))}</span>
  </div>
  <div class="opt-body">
    <h3 class="resort-name">${esc(opt.resortName || 'Resort Option')}</h3>
    ${factsRow}
    ${priceHTML}
    <div class="incl-wrap">
      <div class="incl-title">This package includes:</div>
      <ul class="incl-list">${inclHTML}</ul>
    </div>
    ${addedHTML}
    ${optFlightHTML}
    ${descHTML}
    <button class="select-btn" data-opt="${optDataAttr}">Select This Package &#8594;</button>
  </div>
</div>`;
  }).join('');

  // ── Flights ──
  // Split the schedule into individual legs (one per line) and render each as a row
  const flightLegs = (data.flightDetails || '')
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean);
  const flightHTML = flightLegs.length
    ? `<section class="sec flight-sec">
        <div class="sec-inner">
          <h2 class="sec-title">&#9992; Flight Details</h2>
          <div class="flight-box">
            ${flightLegs.map(leg => `<div class="flight-leg"><span class="flight-leg-icon">&#9992;</span><span>${esc(leg)}</span></div>`).join('')}
          </div>
        </div>
      </section>`
    : '';

  // ── Exclusions ──
  const exclHTML = (data.exclusions || []).length
    ? `<section class="sec excl-sec">
        <div class="sec-inner">
          <h2 class="sec-title">What's Not Included</h2>
          <ul class="excl-list">${(data.exclusions || []).map(e => `<li>${esc(e)}</li>`).join('')}</ul>
        </div>
      </section>`
    : '';

  // ── Personal note ──
  const noteHTML = data.personalNote
    ? `<div class="personal-note"><strong>A note from Terri:</strong> ${esc(data.personalNote)}</div>`
    : '';

  // ── Embedded JS payload data (safe JSON in script tag) ──
  // <-escape so a "</script>" inside any string can't break out of the tag.
  const embedData = JSON.stringify({
    quoteRef,
    clientName,
    dest,
    dates,
    adults,
    agentPhone: AGENT_PHONE,
    agentEmail: AGENT_EMAIL,
    webhookUrl: WEBHOOK_URL,
    waNumber:   AGENT_WA,
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>IziTravel Quote &middot; ${esc(clientName)} &middot; ${esc(dest)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --pink:#e63946;--pink-dark:#b91c1c;--pink-light:#fef2f2;
  --gray-50:#f9fafb;--gray-100:#f3f4f6;--gray-200:#e5e7eb;
  --gray-400:#9ca3af;--gray-500:#6b7280;--gray-700:#374151;--gray-900:#111827;
  --green:#16a34a;--shadow:0 4px 24px rgba(0,0,0,.08);--shadow-lg:0 8px 40px rgba(0,0,0,.14);
}
body{font-family:'Inter',sans-serif;background:#fff;color:var(--gray-900);line-height:1.6}

/* Header — white, matching website */
.site-hdr{background:#fff;border-bottom:1px solid var(--gray-200);padding:0}
.site-hdr-inner{max-width:1100px;margin:0 auto;padding:16px 32px;display:flex;align-items:center;justify-content:space-between;gap:24px}
.hdr-contact{text-align:right;font-size:13px;color:var(--gray-500);line-height:1.9}
.hdr-contact a{color:var(--pink);font-weight:600;text-decoration:none}
.hdr-badge{display:inline-block;background:var(--pink);color:#fff;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 12px;border-radius:999px;margin-left:8px;vertical-align:middle}

/* Pink accent bar */
.accent-bar{background:var(--pink);height:4px}

/* Hero */
.hero{position:relative;height:440px;overflow:hidden;display:flex;align-items:flex-end}
.hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero-ov{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.88) 0%,rgba(0,0,0,.35) 55%,rgba(0,0,0,.1) 100%)}
.hero-cnt{position:relative;z-index:2;max-width:1100px;margin:0 auto;width:100%;padding:0 32px 44px}
.hero-tag{display:inline-block;background:var(--pink);color:#fff;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:5px 14px;border-radius:999px;margin-bottom:10px}
.hero-title{font-size:clamp(28px,4.5vw,50px);font-weight:900;color:#fff;line-height:1.1;letter-spacing:-.03em;margin-bottom:12px}
.hero-meta{display:flex;flex-wrap:wrap;gap:12px}
.hero-pill{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.15);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.2);color:#fff;font-size:13px;font-weight:500;padding:6px 14px;border-radius:999px}
.qref{position:absolute;top:20px;right:32px;background:rgba(255,255,255,.12);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.25);color:#fff;font-size:11px;font-weight:600;padding:5px 12px;border-radius:999px;letter-spacing:.05em}

/* Intro strip */
.intro{background:var(--pink-light);border-bottom:1px solid #fecaca;padding:18px 32px}
.intro-inner{max-width:1100px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.intro-text{font-size:14px;color:var(--gray-700)}.intro-text strong{color:var(--pink-dark);font-weight:700}
.validity-txt{font-size:12px;color:var(--gray-400)}

/* Personal note */
.personal-note{max-width:1100px;margin:0 auto;padding:16px 32px;background:#fffbeb;border-left:4px solid #f59e0b;font-size:14px;color:#92400e}

/* Sections */
.sec{padding:60px 32px}.sec-inner{max-width:1100px;margin:0 auto}
.sec-title{font-size:24px;font-weight:800;letter-spacing:-.02em;margin-bottom:8px}
.sec-sub{font-size:14px;color:var(--gray-500);margin-bottom:36px}

/* Options grid */
.opts-sec{background:var(--gray-50)}
.opts-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;margin-top:36px}

.opt-card{background:#fff;border-radius:18px;border:2px solid var(--gray-200);overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s,box-shadow .2s}
.opt-card:hover{border-color:var(--pink);box-shadow:var(--shadow-lg)}
.opt-hdr{background:var(--pink);padding:10px 22px;display:flex;align-items:center}
.opt-num{color:#fff;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.12em}

.opt-body{padding:22px;display:flex;flex-direction:column;flex:1;gap:16px}
.resort-name{font-size:21px;font-weight:900;color:var(--gray-900);letter-spacing:-.03em;line-height:1.2}

/* Key differentiator facts — prominent pills below resort name */
.opt-facts{display:flex;flex-wrap:wrap;gap:7px}
.fact-pill{font-size:12px;font-weight:700;padding:5px 13px;border-radius:999px;white-space:nowrap;letter-spacing:-.01em}
.fact-nights{background:#1e293b;color:#fff}
.fact-board{background:#15803d;color:#fff}
.fact-room{background:var(--gray-700);color:#fff}

/* Price — now prominent, before inclusions */
.price-box{background:var(--pink-light);border:2px solid #fecaca;border-radius:14px;padding:16px 20px}
.price-row{display:flex;align-items:flex-start}
.price-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--gray-500);margin-bottom:2px}
.price-amount{font-size:34px;font-weight:900;color:var(--pink);letter-spacing:-.04em;line-height:1}
.price-sub{font-size:11px;color:var(--gray-500);margin-top:3px}
.price-total{font-size:13px;font-weight:700;color:var(--pink-dark);margin-top:10px;padding-top:10px;border-top:1px solid #fecaca}

.incl-title{font-size:11px;font-weight:700;color:var(--gray-900);text-transform:uppercase;letter-spacing:.06em;margin-bottom:9px}
.incl-list{list-style:none;display:flex;flex-direction:column;gap:6px}
.incl-list li,.added-box li{display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--gray-700)}
.chk{color:var(--green);font-weight:700;font-size:13px;flex-shrink:0;margin-top:1px}
.added-box{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px}
.added-title{font-size:11px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.06em;margin-bottom:9px}
.added-box ul{list-style:none;display:flex;flex-direction:column;gap:6px}

/* Per-option flight details */
.opt-flight{background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:12px 14px}
.opt-flight-ref{background:var(--gray-50);border-color:var(--gray-200);color:var(--gray-500);font-size:13px;font-style:italic}
.opt-flight-title{font-size:11px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px}
.opt-flight-body{font-size:13px;color:#0c4a6e;line-height:1.75}

/* Collapsible description */
.desc-details{border:1px solid var(--gray-200);border-radius:9px;overflow:hidden}
.desc-summary{display:block;padding:9px 14px;font-size:12px;font-weight:600;color:var(--gray-500);cursor:pointer;user-select:none;list-style:none}
.desc-summary::-webkit-details-marker{display:none}
.desc-summary::before{content:'▶ ';font-size:9px;margin-right:4px;transition:transform .15s}
.desc-details[open] .desc-summary::before{content:'▼ '}
.resort-desc{padding:12px 14px;font-size:13px;color:var(--gray-500);line-height:1.75;border-top:1px solid var(--gray-100)}

.select-btn{width:100%;padding:14px;background:var(--pink);color:#fff;border:none;border-radius:11px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;transition:background .15s,transform .1s;letter-spacing:-.01em}
.select-btn:hover{background:var(--pink-dark)}.select-btn:active{transform:scale(.98)}

/* Flights */
.flight-sec{background:#fff}
.flight-box{background:var(--gray-50);border:1px solid var(--gray-200);border-radius:12px;padding:8px 20px}
.flight-leg{display:flex;align-items:flex-start;gap:10px;padding:13px 0;font-size:13.5px;color:var(--gray-700);line-height:1.5;border-bottom:1px solid var(--gray-200)}
.flight-leg:last-child{border-bottom:none}
.flight-leg-icon{color:var(--pink);flex-shrink:0;font-size:13px;margin-top:2px}

/* Exclusions */
.excl-sec{background:var(--gray-50);padding-top:0}
.excl-list{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:9px;margin-top:20px}
.excl-list li{display:flex;align-items:flex-start;gap:8px;font-size:13.5px;color:var(--gray-500)}
.excl-list li::before{content:'\\2715';color:#f87171;font-weight:700;flex-shrink:0}

/* CTA strip */
.cta-strip{background:var(--gray-900);padding:52px 32px;text-align:center}
.cta-inner{max-width:560px;margin:0 auto}
.cta-strip h2{font-size:28px;font-weight:800;color:#fff;letter-spacing:-.02em;margin-bottom:9px}
.cta-strip p{color:var(--gray-400);font-size:14px;margin-bottom:24px}
.cta-btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.cta-btn{padding:13px 26px;border-radius:11px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;border:none;text-decoration:none;transition:all .15s;display:inline-flex;align-items:center;gap:7px}
.cta-p{background:var(--pink);color:#fff}.cta-p:hover{background:var(--pink-dark)}
.cta-s{background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2)}.cta-s:hover{background:rgba(255,255,255,.15)}

/* Footer */
.site-ftr{background:var(--gray-900);border-top:1px solid rgba(255,255,255,.06);padding:28px 32px}
.ftr-inner{max-width:1100px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.ftr-logo{background:rgba(255,255,255,.92);border-radius:8px;padding:5px 10px;display:inline-flex;align-items:center}
.ftr-logo img{height:32px;width:auto;display:block}
.ftr-text{font-size:11px;color:rgba(255,255,255,.45);text-align:right;line-height:1.8}

/* Modal */
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;align-items:center;justify-content:center;padding:20px}
.modal-bg.open{display:flex}
.modal{background:#fff;border-radius:18px;padding:36px;max-width:460px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);position:relative}
.modal-x{position:absolute;top:14px;right:18px;background:none;border:none;font-size:20px;cursor:pointer;color:var(--gray-400);line-height:1}.modal-x:hover{color:var(--gray-900)}
.modal h3{font-size:20px;font-weight:800;color:var(--gray-900);margin-bottom:5px;letter-spacing:-.02em}
.modal .chosen-lbl{font-size:13px;color:var(--gray-500);margin-bottom:22px}.chosen-lbl strong{color:var(--pink);font-weight:700}
.mfields{display:flex;flex-direction:column;gap:13px}
.mfield label{display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px}
.mfield input,.mfield textarea{width:100%;padding:10px 13px;border:1.5px solid var(--gray-200);border-radius:9px;font-size:13.5px;font-family:inherit;color:var(--gray-900);outline:none;transition:border-color .15s}
.mfield input:focus,.mfield textarea:focus{border-color:var(--pink)}
.mfield textarea{resize:vertical;min-height:70px}
.msubmit{width:100%;padding:14px;background:var(--pink);color:#fff;border:none;border-radius:11px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;margin-top:6px;transition:background .15s}
.msubmit:hover{background:var(--pink-dark)}.msubmit:disabled{background:var(--gray-400);cursor:not-allowed}
.msuccess{text-align:center;padding:14px 0}
.msuccess .tick{font-size:48px;margin-bottom:10px}
.msuccess h4{font-size:18px;font-weight:800;color:var(--gray-900);margin-bottom:7px}
.msuccess p{font-size:13px;color:var(--gray-500);line-height:1.6}

@media(max-width:640px){
  .site-hdr-inner{flex-direction:column;align-items:flex-start}
  .hdr-contact{text-align:left}
  .hero{height:340px}.hero-cnt{padding:0 20px 32px}
  .sec{padding:44px 20px}
  .opts-grid{grid-template-columns:1fr}
  .ftr-inner{flex-direction:column;align-items:flex-start}.ftr-text{text-align:left}
  .intro{padding:16px 20px}.personal-note{padding:14px 20px}
}
</style>
</head>
<body>

<header class="site-hdr">
  <div class="site-hdr-inner">
    <div class="hdr-logo">
      ${logoTag}
    </div>
    <div class="hdr-contact">
      <a href="tel:${AGENT_PHONE.replace(/\s/g, '')}">${AGENT_PHONE}</a> &nbsp;|&nbsp;
      <a href="mailto:${AGENT_EMAIL}">${AGENT_EMAIL}</a>
      <span class="hdr-badge">Holiday Quote</span>
    </div>
  </div>
</header>
<div class="accent-bar"></div>

<section class="hero">
  <img class="hero-img" src="${heroImg}" alt="${esc(dest)}"/>
  <div class="hero-ov"></div>
  <div class="qref">${quoteRef}</div>
  <div class="hero-cnt">
    <div class="hero-tag">${esc(dest) || 'Holiday Package'}</div>
    <h1 class="hero-title">Holiday Quote for<br>${esc(clientName)}${occasion ? ' &middot; ' + esc(occasion) : ''}</h1>
    <div class="hero-meta">
      ${adults ? `<div class="hero-pill">&#128100; ${esc(adults)}${childrenTxt}</div>` : ''}
      ${dates  ? `<div class="hero-pill">&#128197; ${esc(dates)}</div>` : ''}
      <div class="hero-pill">&#9992; ${(data.options || []).length || 1} Package Option${((data.options || []).length || 1) > 1 ? 's' : ''}</div>
    </div>
  </div>
</section>

<div class="intro">
  <div class="intro-inner">
    <div class="intro-text">
      ${esc(greeting)}, please review the options below and click <strong>&ldquo;Select This Package&rdquo;</strong> on your preferred choice. Our travel agent will be in touch with you shortly to confirm.
    </div>
    <div class="validity-txt">Ref: <strong>${quoteRef}</strong> &middot; Valid ${esc(validity)} hours</div>
  </div>
</div>

${noteHTML}

<section class="sec opts-sec">
  <div class="sec-inner">
    <h2 class="sec-title">Your Package Options</h2>
    <p class="sec-sub">All packages depart from Johannesburg and include return flights unless otherwise stated.</p>
    <div class="opts-grid">${optionCards}</div>
  </div>
</section>

${flightHTML}
${exclHTML}

<section class="cta-strip">
  <div class="cta-inner">
    <h2>Ready to confirm your holiday?</h2>
    <p>Select a package above or reach out to us directly.</p>
    <div class="cta-btns">
      <a href="tel:${AGENT_PHONE.replace(/\s/g, '')}" class="cta-btn cta-p">&#128222; Call Us</a>
      <a href="mailto:${AGENT_EMAIL}?subject=Quote+${encodeURIComponent(quoteRef)}" class="cta-btn cta-s">&#9993; Email Us</a>
    </div>
  </div>
</section>

<footer class="site-ftr">
  <div class="ftr-inner">
    <div class="ftr-logo">${logoTag}</div>
    <div class="ftr-text">
      All prices subject to change and availability at time of booking.<br>
      Travel insurance is compulsory and not included unless stated.<br>
      Prices in South African Rand (ZAR) &middot; IziTravel &middot; Let Us Show You The World!
    </div>
  </div>
</footer>

<div class="modal-bg" id="modalBg" style="display:none">
  <div class="modal">
    <button class="modal-x" id="modalClose">&#10005;</button>
    <div id="modalBody">
      <h3>Confirm Your Selection</h3>
      <p class="chosen-lbl" id="chosenLbl"></p>
      <div class="mfields">
        <div class="mfield"><label>Your Name</label><input type="text" id="mName" placeholder="Full name"/></div>
        <div class="mfield"><label>Email Address</label><input type="email" id="mEmail" placeholder="your@email.com"/></div>
        <div class="mfield"><label>WhatsApp / Phone</label><input type="tel" id="mPhone" placeholder="+27 XX XXX XXXX"/></div>
        <div class="mfield"><label>Questions or special requests? <span style="font-weight:400;color:#9ca3af">(optional)</span></label><textarea id="mMessage" placeholder="e.g. anniversary trip, sea-view room..."></textarea></div>
        <button class="msubmit" id="mSubmit">Confirm My Selection &#10003;</button>
      </div>
    </div>
  </div>
</div>

<script id="embedData" type="application/json">${embedData}</script>
<script src="/js/quote-modal.js" defer></script>
</body>
</html>`;
}

