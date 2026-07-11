// ─── IziTravel Invoice Generator — App Logic ─────────────────────────────────
(() => {
  const $ = (id) => document.getElementById(id);
  let state = { logoBase64: null, invoiceId: null, invoiceUrl: null, leadContactId: null, clientEmail: null, clientPhone: null, extra: {} };

  async function loadLogo() {
    try { const r = await fetch('/assets/izilogo.jpg'); const b = await r.blob(); return await new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); }); } catch { return null; }
  }
  function todayZA() { try { return new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return ''; } }
  function newInvNo() { return 'INV-' + Date.now().toString(36).toUpperCase().slice(-6); }

  function addLine(desc, amount) {
    const wrap = document.createElement('div');
    wrap.className = 'li';
    wrap.innerHTML = `<input class="li-desc" placeholder="Description" value="${(desc || '').replace(/"/g, '&quot;')}"/><input class="li-amt" placeholder="R0.00" value="${(amount || '').replace(/"/g, '&quot;')}"/>`;
    $('lines').appendChild(wrap);
  }

  function gather() {
    const lineItems = [...document.querySelectorAll('#lines .li')].map(r => ({
      description: r.querySelector('.li-desc').value.trim(),
      amount:      r.querySelector('.li-amt').value.trim(),
    })).filter(li => li.description || li.amount);
    return {
      recordType:  'invoice',
      invoiceNo:   $('f-invoiceNo').value.trim(),
      date:        $('f-date').value.trim(),
      dueDate:     $('f-dueDate').value.trim(),
      clientName:  $('f-clientName').value.trim(),
      email:       $('f-email').value.trim(),
      phone:       $('f-phone').value.trim(),
      destination: $('f-destination').value.trim(),
      lineItems,
      total:       $('f-total').value.trim(),
      deposit:     state.extra.deposit || '',
      depositDue:  state.extra.depositDue || '',
      balance:     state.extra.balance || '',
      balanceDue:  state.extra.balanceDue || '',
      notes:       $('f-notes').value.trim(),
      banking: {
        accountName:   $('b-accountName').value.trim(),
        bank:          $('b-bank').value.trim(),
        accountType:   $('b-accountType').value.trim(),
        accountNumber: $('b-accountNumber').value.trim(),
        branchCode:    $('b-branchCode').value.trim(),
        reference:     $('f-invoiceNo').value.trim(),
      },
    };
  }

  function refreshPreview(data) {
    const html = buildInvoiceHTML(data, state.logoBase64);
    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    $('inv-empty').style.display = 'none';
    const f = $('inv-frame'); f.style.display = 'block'; f.src = url;
    return data;
  }

  function normWa(phone) { let d = String(phone || '').replace(/[^0-9]/g, ''); if (!d) return ''; if (d.charAt(0) === '0') d = '27' + d.slice(1); return d; }
  function totalNum(data) { const n = parseFloat(String(data.total || '').replace(/[^0-9.]/g, '')); return isNaN(n) ? null : Math.round(n); }

  function markInvoiced(data) {
    if (!state.leadContactId) return;
    fetch('/.netlify/functions/mark-invoiced', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: state.leadContactId, total: totalNum(data), invoiceUrl: state.invoiceUrl, name: [data.clientName, data.destination].filter(Boolean).join(' - ') }),
    }).catch(() => {});
  }

  function onSend(openHref, data) {
    // Open FIRST, inside the click gesture — opening after confirm() gets
    // popup-blocked, which is why the channel never opened.
    window.open(openHref, '_blank');
    const doMark = !!state.leadContactId && confirm('Mark this invoice as “Sent” in CRM?\nMoves the deal to Invoiced.');
    if (doMark) markInvoiced(data);
  }

  // Save failed → no shareable URL exists. Offer Download only — WhatsApp/Email
  // buttons here would send the client a message with a broken "link".
  function renderSaveFailed(data) {
    $('link-card').style.display = 'block';
    $('link-row').innerHTML = `<span style="color:#b91c1c;font-size:13px">⚠ Couldn't create a shareable link — download the invoice and attach it instead.</span>
      <a class="btn b-dl" id="i-dl">⤓ Download</a>`;
    $('i-dl').onclick = (e) => { e.preventDefault(); window.IziPDF.download(buildInvoiceHTML(data, state.logoBase64), buildInvoiceFilename(data)); };
  }

  function renderLinks(url, data) {
    const cname = data.clientName || 'there';
    const waNum = normWa(state.clientPhone || data.phone);
    const waText = encodeURIComponent(`Hi ${cname}! Here is your IziTravel invoice ${data.invoiceNo || ''}: ${url}`);
    const waHref = waNum ? `https://wa.me/${waNum}?text=${waText}` : `https://wa.me/?text=${waText}`;
    const to = state.clientEmail || data.email || '';
    const subj = encodeURIComponent('Your IziTravel Invoice ' + (data.invoiceNo || ''));
    const bodyTxt = encodeURIComponent(`Hi ${cname},\n\nPlease find your IziTravel invoice here:\n${url}\n\nBanking details are on the invoice — please use the invoice number as your reference.\n\nWarm regards,\nTerri\nIziTravel`);
    const mailHref = `mailto:${to}?subject=${subj}&body=${bodyTxt}`;

    $('link-card').style.display = 'block';
    $('link-row').innerHTML = `<input class="lk-input" value="${url}" readonly/>
      <button class="btn b-copy" id="i-copy">Copy</button>
      <a class="btn b-dl" id="i-dl">⤓ Download</a>
      <a class="btn b-wa" id="i-wa" target="_blank" rel="noopener">📱 WhatsApp</a>
      <a class="btn b-em" id="i-em">✉ Email</a>`;
    $('i-copy').onclick = () => navigator.clipboard.writeText(url).then(() => { $('i-copy').textContent = '✓'; setTimeout(() => $('i-copy').textContent = 'Copy', 1500); });
    $('i-dl').onclick = (e) => { e.preventDefault(); window.IziPDF.download(buildInvoiceHTML(data, state.logoBase64), buildInvoiceFilename(data)); };
    $('i-wa').href = waHref; $('i-wa').onclick = (e) => { e.preventDefault(); onSend(waHref, data); };
    $('i-em').href = mailHref; $('i-em').onclick = (e) => { e.preventDefault(); onSend(mailHref, data); };
  }

  async function generate() {
    const data = gather();
    refreshPreview(data);
    // save (best-effort) to get a shareable link
    try {
      const body = { invoiceData: data, logoBase64: state.logoBase64 };
      if (state.invoiceId) body.invoiceId = state.invoiceId;
      if (state.leadContactId) body.contactId = state.leadContactId;
      const res = await fetch('/.netlify/functions/save-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (j.invoiceUrl) { state.invoiceUrl = j.invoiceUrl; state.invoiceId = j.invoiceId; renderLinks(j.invoiceUrl, data); }
      else renderSaveFailed(data);
    } catch { renderSaveFailed(data); }
    // Generating an invoice for a CRM lead moves the deal to Invoiced (and sets
    // its value), as well as the send action — per Jacques's request.
    markInvoiced(data);
  }

  async function prefill() {
    const params = new URLSearchParams(location.search);
    const cid = params.get('cid');
    const from = params.get('from'); // confirmation id
    if (cid) {
      state.leadContactId = cid;
      try {
        const r = await fetch('/.netlify/functions/lead-prefill?cid=' + encodeURIComponent(cid) + '&noadvance=1');
        const p = (await r.json()).prefill;
        if (p) { state.clientEmail = p.email; state.clientPhone = p.phone; if (p.clientName) $('f-clientName').value = p.clientName; if (p.email) $('f-email').value = p.email; if (p.phone) $('f-phone').value = p.phone; if (p.destination) $('f-destination').value = p.destination; }
      } catch {}
    }
    if (from) {
      try {
        const r = await fetch('/.netlify/functions/load-confirmation?id=' + encodeURIComponent(from));
        const cd = (await r.json()).confirmationData;
        if (cd) {
          if (cd.clientName)  $('f-clientName').value  = cd.clientName;
          if (cd.destination) $('f-destination').value = cd.destination;
          const p = cd.pricing || {};
          if (p.total) $('f-total').value = p.total;
          state.extra = { deposit: p.deposit, depositDue: p.depositDue, balance: p.balance, balanceDue: p.balanceDue };
          $('lines').innerHTML = '';
          addLine(`Travel package${cd.destination ? ' — ' + cd.destination : ''}`, p.total || '');
        }
      } catch {}
    }
  }

  async function init() {
    state.logoBase64 = await loadLogo();
    $('f-invoiceNo').value = newInvNo();
    $('f-date').value = todayZA();
    // banking defaults (real Izi Travel & Tours account — confirmed 2026-06-14)
    $('b-accountName').value   = 'Izi Travel & Tours';
    $('b-bank').value          = 'Nedbank';
    $('b-accountType').value   = 'Cheque';
    $('b-accountNumber').value = '114 502 1808';
    $('b-branchCode').value    = '198765';
    addLine('', '');
    $('addLine').addEventListener('click', () => addLine('', ''));
    $('genBtn').addEventListener('click', generate);
    await prefill();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
