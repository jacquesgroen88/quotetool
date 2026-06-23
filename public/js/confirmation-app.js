// ─── IziTravel Confirmation Generator — App Logic ────────────────────────────
const ConfApp = (() => {
  let state = {
    file: null, confirmationData: null, logoBase64: null,
    currentBlobUrl: null, confirmationId: null, confirmationUrl: null,
    leadContactId: null, clientEmail: null, clientPhone: null,
    chatMessages: [], isEditing: false, confHistory: [],
  };
  const $ = (id) => document.getElementById(id);

  function showView(name) {
    ['view-upload', 'view-generating', 'view-editor'].forEach(id => {
      const el = $(id); if (el) el.hidden = (id !== name);
    });
  }
  function setStatus(t) { const el = $('gen-status'); if (el) el.textContent = t; }

  async function loadLogo() {
    try {
      const res = await fetch('/assets/izilogo.jpg'); const blob = await res.blob();
      return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
    } catch { return null; }
  }
  function fileToBase64(file) {
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
  }

  function refreshPreview() {
    if (!state.confirmationData) return;
    const html = buildConfirmationHTML(state.confirmationData, state.logoBase64);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    if (state.currentBlobUrl) URL.revokeObjectURL(state.currentBlobUrl);
    state.currentBlobUrl = url;
    $('preview-frame').src = url;
  }

  function downloadConfirmation() {
    if (!state.confirmationData) return;
    const html = buildConfirmationHTML(state.confirmationData, state.logoBase64);
    window.IziPDF.download(html, buildConfirmationFilename(state.confirmationData));
  }

  // ── Markup — relative to supplier base, applied to all 4 money fields ──
  function applyMarkup() {
    if (!state.confirmationData) return;
    const pct = parseFloat(($('markup-pct') || {}).value);
    if (isNaN(pct) || pct < 0) { alert('Enter a markup percentage of 0 or more.'); return; }
    const cd = state.confirmationData; const p = cd.pricing || (cd.pricing = {});

    // Snapshot base once so markup is always relative to the supplier figures.
    if (p._baseAll == null) {
      p._baseAll = { pricePerPerson: p.pricePerPerson, total: p.total, deposit: p.deposit, balance: p.balance };
    }
    const base = p._baseAll;
    const mult = 1 + pct / 100;
    const mk = (s) => {
      if (!s) return s;
      const n = parseFloat(String(s).replace(/[^0-9.]/g, '')); if (isNaN(n)) return s;
      return 'R' + Math.round(n * mult).toLocaleString('en-ZA');
    };
    p.pricePerPerson = mk(base.pricePerPerson);
    p.total          = mk(base.total);
    p.deposit        = mk(base.deposit);
    p.balance        = mk(base.balance);
    p.markupPct      = pct > 0 ? pct : 0;
    // keep base markup reference fields current for the admin
    p._baseTotal     = base.total; p._basePerPerson = base.pricePerPerson;

    refreshPreview();
    if (state.confirmationId) saveLink(true);
    const btn = $('markup-apply-btn');
    if (btn) { btn.textContent = pct > 0 ? '✓ Applied' : '✓ Reset'; setTimeout(() => { btn.textContent = 'Apply'; }, 1800); }
  }

  async function runGenerate() {
    if (!state.file) { alert('Please upload a supplier confirmation first.'); return; }
    const clientDetails = {
      clientName:  $('f-clientName').value.trim(),
      destination: $('f-destination').value.trim(),
      tripType:    $('f-tripType').value.trim(),
    };
    showView('view-generating'); setStatus('Reading the supplier document…');
    try {
      const fileData = await fileToBase64(state.file);
      setStatus('Rebranding with AI — about 15–20 seconds…');
      const res = await fetch('/.netlify/functions/generate-confirmation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData, filename: state.file.name, clientDetails }),
      });
      let json = {};
      try { json = await res.json(); } catch { throw new Error(`Server error ${res.status} — the request may have timed out.`); }
      if (!res.ok || json.error) throw new Error(json.error || `Server error: ${res.status}`);
      state.confirmationData = json.result;
      state.chatMessages = []; state.confHistory = []; renderChatHistory(); updateUndoBtn();

      // ── Telephone handling ──────────────────────────────────────────────
      // Prefer a GHL-prefilled phone, then the manual field, then anything the
      // AI extracted from the supplier doc. If none, confirm before proceeding.
      const manualPhone = (($('f-phone') || {}).value || '').trim();
      if (manualPhone) state.clientPhone = manualPhone;
      const manualEmail = (($('f-email') || {}).value || '').trim();
      if (manualEmail) state.clientEmail = manualEmail;
      const cd = state.confirmationData;
      const extractedPhone = cd.clientPhone || cd.phone || cd.contactPhone ||
        ((cd.passengers || []).map(p => p && p.phone).find(Boolean));
      if (!state.clientPhone && extractedPhone) state.clientPhone = extractedPhone;
      if (!state.clientPhone) {
        const proceed = confirm(
          'No telephone number was detected on the supplier confirmation or entered.\n\n' +
          'Generate the booking confirmation without a phone number?\n\n' +
          'Without it, "Send via WhatsApp" and later automations (payment reminders, ' +
          'post-trip review requests) won’t work for this client.');
        if (!proceed) {
          showView('view-upload');
          const pf = $('f-phone');
          if (pf) { pf.focus(); pf.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
          return;
        }
      }
      // Persist the resolved phone onto the record so it shows + saves.
      if (state.clientPhone) cd.clientPhone = state.clientPhone;

      refreshPreview();
      renderIntegrity(state.confirmationData);
      showView('view-editor');
      document.dispatchEvent(new CustomEvent('confirmationReady', { detail: state.confirmationData }));
      setLink(null); saveLink(false);
    } catch (err) {
      showView('view-upload');
      alert('Error: ' + (err.message || 'Failed to generate confirmation.'));
    }
  }

  async function saveLink(silent) {
    try {
      if (!silent) setLink(null);
      const body = { confirmationData: state.confirmationData, logoBase64: state.logoBase64 };
      if (state.confirmationId) body.confirmationId = state.confirmationId;
      if (state.leadContactId)  body.contactId      = state.leadContactId;
      const res = await fetch('/.netlify/functions/save-confirmation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      let data = {};
      try { data = await res.json(); } catch { data = { error: `HTTP ${res.status}` }; }
      if (data.confirmationUrl) {
        state.confirmationUrl = data.confirmationUrl; state.confirmationId = data.confirmationId;
        if (!silent) setLink(data.confirmationUrl);
        const ib = $('invoice-btn');
        if (ib && state.confirmationId) {
          ib.style.display = 'inline-flex';
          ib.onclick = () => window.open('/invoice.html?from=' + encodeURIComponent(state.confirmationId) + (state.leadContactId ? '&cid=' + encodeURIComponent(state.leadContactId) : ''), '_blank');
        }
      } else if (!silent) setLinkError(data.error || `HTTP ${res.status}`);
    } catch (err) { if (!silent) setLinkError((err && err.message) || 'Network error'); }
  }

  function setLinkError(msg) {
    const el = $('link-section');
    if (el) el.innerHTML = `<span class="qlink-saving" style="color:#f87171">⚠ Link unavailable — use Download. (${msg})</span>`;
  }
  function setLink(url) {
    const el = $('link-section'); if (!el) return;
    if (!url) { el.innerHTML = '<span class="qlink-saving">Generating shareable link…</span>'; return; }
    el.innerHTML = `<div class="qlink-row"><input class="qlink-input" value="${url}" readonly/><button class="qlink-copy" id="link-copy">Copy</button></div>
      <p class="qlink-hint">Send this to your client — opens the branded confirmation.</p>`;
    $('link-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(() => { $('link-copy').textContent = '✓'; setTimeout(() => { $('link-copy').textContent = 'Copy'; }, 1800); });
    });
    const cd    = state.confirmationData || {};
    const cname = cd.clientName || (cd.passengers && cd.passengers[0] && [cd.passengers[0].title, cd.passengers[0].firstName].filter(Boolean).join(' ')) || 'there';
    const dest  = cd.destination || 'your holiday';

    const waSec = $('wa-btn-section'), waBtn = $('wa-btn');
    if (waSec && waBtn) {
      const waNum  = normWa(state.clientPhone);
      const waText = encodeURIComponent(`Hi ${cname}! Here is your IziTravel booking confirmation for ${dest}: ${url}`);
      const waHref = waNum ? `https://wa.me/${waNum}?text=${waText}` : `https://wa.me/?text=${waText}`;
      waBtn.href = waHref;
      waBtn.onclick = (e) => { e.preventDefault(); onSend(waHref); };
      waSec.style.display = 'block';
    }
    const emailBtn = $('email-btn');
    if (emailBtn) {
      const to = state.clientEmail || '';
      const subj = encodeURIComponent('Your IziTravel Booking Confirmation — ' + dest);
      const bodyTxt = encodeURIComponent(`Hi ${cname},\n\nGreat news — here is your IziTravel booking confirmation:\n${url}\n\nPlease check all the details and let me know if anything needs adjusting.\n\nWarm regards,\nTerri\nIziTravel`);
      const mailHref = `mailto:${to}?subject=${subj}&body=${bodyTxt}`;
      emailBtn.href = mailHref;
      emailBtn.onclick = (e) => { e.preventDefault(); onSend(mailHref); };
      emailBtn.style.display = to ? 'inline-flex' : 'none';
    }
  }

  // ── Supplier price-check card ──
  function renderIntegrity(cd) {
    const card = $('integrity-card'), body = $('integrity-body');
    if (!card || !body) return;
    const c = cd && cd._priceCheck;
    if (!c) { card.style.display = 'none'; return; }
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const p = cd.pricing || {};
    const problems = [];
    if (c.totalInSource === false && c.mathOk === false) problems.push(`Total ${esc(p.total)} isn't in the supplier doc and per-person × pax doesn't add up — likely wrong`);
    else if (c.mathOk === false) problems.push(`Per-person × pax doesn't equal total ${esc(p.total)} — check the figures`);
    else if (c.totalInSource === false) problems.push(`Total ${esc(p.total)} isn't printed in the supplier doc — confirm it's right`);
    if (c.scheduleOk === false) problems.push(`Deposit + balance don't add up to the total — check the payment schedule`);

    if (!problems.length) {
      card.className = 'integrity-card ok';
      body.innerHTML = '<div class="integrity-line"><span>&#9989;</span><span class="integrity-ok-text">Prices match the supplier document, and the payment schedule adds up.</span></div>';
    } else {
      card.className = 'integrity-card warn';
      body.innerHTML = problems.map(pr => `<div class="integrity-line"><span>&#9888;&#65039;</span><span class="integrity-warn-text">${pr}</span></div>`).join('');
    }
    card.style.display = 'block';
  }

  // ── Price re-check after an edit ───────────────────────────────────────────
  // We don't have the supplier raw text on the client, but generate-confirmation
  // left _sourcePrices (every Rand figure found in the doc). Re-run the same
  // math/source checks the server did so the Price Check card stays honest after
  // a chat edit. Advisory only — never alters prices.
  function recheckIntegrity(cd) {
    try {
      if (!cd || !cd.pricing || !Array.isArray(cd._sourcePrices)) return;
      const toRand = (v) => {
        const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
        return isNaN(n) ? null : Math.round(n);
      };
      const source = new Set(cd._sourcePrices);
      const p   = cd.pricing;
      const pp  = toRand(p.pricePerPerson);
      const tot = toRand(p.total);
      const dep = toRand(p.deposit);
      const bal = toRand(p.balance);
      const pax = parseInt(cd.paxCount, 10) || (Array.isArray(cd.passengers) ? cd.passengers.length : 2) || 2;
      const ppInSource    = pp  != null && source.has(pp);
      const totalInSource = tot != null && source.has(tot);
      const mathOk     = (pp != null && tot != null) ? Math.abs(pp * pax - tot) <= pax : null;
      const scheduleOk = (dep != null && bal != null && tot != null) ? Math.abs(dep + bal - tot) <= 1 : null;
      cd._priceCheck = { ppInSource, totalInSource, mathOk, scheduleOk, verified: ppInSource && totalInSource };
    } catch (_) { /* advisory only */ }
  }

  // ── Undo history ───────────────────────────────────────────────────────────
  function pushHistory(data) {
    state.confHistory.push(JSON.parse(JSON.stringify(data)));
    if (state.confHistory.length > 10) state.confHistory.shift();
    updateUndoBtn();
  }
  function updateUndoBtn() {
    const btn = $('undo-btn');
    if (btn) btn.style.display = state.confHistory.length > 0 ? 'block' : 'none';
  }
  function undoLastEdit() {
    if (state.confHistory.length === 0) return;
    state.confirmationData = state.confHistory.pop();
    updateUndoBtn();
    refreshPreview();
    renderIntegrity(state.confirmationData);
    if (state.confirmationId) saveLink(true);
    addChatMsg('ai', '↩ Reverted to the previous version.');
  }

  // ── Chat edit ──────────────────────────────────────────────────────────────
  async function runEdit(message) {
    if (state.isEditing || !message.trim() || !state.confirmationData) return;
    state.isEditing = true;
    addChatMsg('agent', message);
    setChatInputState(true);
    try {
      pushHistory(state.confirmationData);
      const res = await fetch('/.netlify/functions/edit-confirmation', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ confirmationData: state.confirmationData, message }),
      });
      let result = {};
      try { result = await res.json(); } catch { throw new Error('Edit request timed out. Please try again.'); }
      if (result.error) throw new Error(result.error);
      state.confirmationData = result.confirmationData;
      recheckIntegrity(state.confirmationData);
      addChatMsg('ai', result.changes || 'Done — confirmation updated.');
      refreshPreview();
      renderIntegrity(state.confirmationData);
      if (state.confirmationId) saveLink(true);
    } catch (err) {
      addChatMsg('ai', '⚠️ Sorry, I couldn\'t apply that change: ' + (err.message || 'Unknown error'));
    } finally {
      state.isEditing = false;
      setChatInputState(false);
    }
  }

  function addChatMsg(role, text) { state.chatMessages.push({ role, text }); renderChatHistory(); }
  function renderChatHistory() {
    const el = $('chat-history');
    if (!el) return;
    if (state.chatMessages.length === 0) {
      el.innerHTML = '<div class="chat-empty">No changes yet.<br>Use the chips above or type a change below.</div>';
      return;
    }
    el.innerHTML = state.chatMessages.map(m => `
      <div class="chat-msg ${m.role === 'agent' ? 'chat-agent' : 'chat-ai'}">
        <div class="chat-bubble">${escapeHtml(m.text)}</div>
      </div>`).join('');
    el.scrollTop = el.scrollHeight;
  }
  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function setChatInputState(disabled) {
    const inp = $('chat-input'), btn = $('chat-send');
    if (inp) inp.disabled = disabled;
    if (btn) { btn.disabled = disabled; btn.textContent = disabled ? 'Applying…' : 'Apply Change'; }
  }

  // ── File drop ──
  function initDropZone() {
    const zone = $('drop-zone'), input = $('file-input'); if (!zone || !input) return;
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
    input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });
  }
  function handleFile(file) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!['.pdf', '.docx'].includes(ext)) { alert('Please upload a PDF or DOCX.'); return; }
    if (file.size > 8 * 1024 * 1024) { alert('File too large (max 8 MB).'); return; }
    state.file = file;
    const zone = $('drop-zone');
    if (zone) zone.innerHTML = `<div class="drop-file-name">&#128196; ${file.name.replace(/</g,'&lt;')}</div><div class="drop-file-size">${(file.size/1024).toFixed(0)} KB — ready</div><div class="drop-change">Click to change</div>`;
    $('detect-status').textContent = 'Ready — add any overrides, then Generate.';
    $('detect-status').className = 'detect-status success';
  }

  // Prefill from a GHL lead (when opened via "Confirm booking" — ?cid=).
  // Uses noadvance=1 so it does NOT move the opportunity stage back.
  async function prefillFromLead(cid) {
    state.leadContactId = cid;
    try {
      const res  = await fetch('/.netlify/functions/lead-prefill?cid=' + encodeURIComponent(cid) + '&noadvance=1');
      const data = await res.json();
      const p = data && data.prefill;
      if (!p) return;
      state.clientEmail = p.email || null;
      state.clientPhone = p.phone || null;
      const set = (id, v) => { const el = $(id); if (el && v) el.value = v; };
      set('f-clientName', p.clientName);
      set('f-destination', p.destination);
    } catch { /* best-effort */ }
  }
  function normWa(phone) {
    let d = String(phone || '').replace(/[^0-9]/g, '');
    if (!d) return '';
    if (d.charAt(0) === '0') d = '27' + d.slice(1);
    return d;
  }
  function confTotal() {
    const t = state.confirmationData && state.confirmationData.pricing && state.confirmationData.pricing.total;
    if (!t) return null;
    const n = parseFloat(String(t).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : Math.round(n);
  }
  function onSend(openHref) {
    // Open FIRST, inside the click gesture — opening after confirm() gets
    // popup-blocked, which is why the channel never opened.
    window.open(openHref, '_blank');
    const doMark = !!state.leadContactId &&
      confirm('Mark this booking confirmation as “Sent” in CRM?\nMoves the deal to Booking Confirmation Sent and updates the deal value to this amount.');
    if (doMark) {
      fetch('/.netlify/functions/mark-confirmation-sent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId:       state.leadContactId,
          total:           confTotal(),
          confirmationUrl: state.confirmationUrl,
          name:            [(state.confirmationData && state.confirmationData.clientName) || '', (state.confirmationData && state.confirmationData.destination) || ''].filter(Boolean).join(' - '),
        }),
      }).catch(() => {});
    }
  }

  // Prefill from explicit query params (used by "Create confirmation" in the
  // quotes admin — the client details are already known from the quote).
  function prefillFromParams(params) {
    const set = (id, v) => { const el = $(id); if (el && v) el.value = v; };
    const name = params.get('name') || '';
    const dest = params.get('dest') || '';
    const email = params.get('email') || '';
    const phone = params.get('phone') || '';
    set('f-clientName', name);
    set('f-destination', dest);
    set('f-email', email);
    set('f-phone', phone);
    set('f-tripType', params.get('trip') || '');
    if (email) state.clientEmail = email;
    if (phone) state.clientPhone = phone;
    const ds = $('detect-status');
    if (ds && (name || dest)) { ds.textContent = '✓ Prefilled from the quote — upload the supplier confirmation, then Generate.'; ds.className = 'detect-status success'; }
  }

  async function init() {
    state.logoBase64 = await loadLogo();
    const params = new URLSearchParams(location.search);
    const cid = params.get('cid');
    const hasExplicit = params.get('name') || params.get('email') || params.get('phone') || params.get('dest');
    if (cid) state.leadContactId = cid;       // keeps stage moves working on send
    if (hasExplicit) prefillFromParams(params); // quotes-admin path — details known
    else if (cid)    prefillFromLead(cid);      // leads-board path — fetch from CRM
    initDropZone();
    $('generate-btn') && $('generate-btn').addEventListener('click', runGenerate);
    $('download-btn') && $('download-btn').addEventListener('click', downloadConfirmation);
    $('markup-apply-btn') && $('markup-apply-btn').addEventListener('click', applyMarkup);

    // Chat edit — send button, Enter key, quick chips, undo
    const sendBtn = $('chat-send');
    if (sendBtn) sendBtn.addEventListener('click', () => {
      const inp = $('chat-input'); const val = inp.value.trim();
      if (val) { inp.value = ''; runEdit(val); }
    });
    const chatInput = $('chat-input');
    if (chatInput) chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const val = chatInput.value.trim();
        if (val) { chatInput.value = ''; runEdit(val); }
      }
    });
    document.querySelectorAll('[data-chip]').forEach(chip => {
      chip.addEventListener('click', () => {
        const inp = $('chat-input');
        if (inp) { inp.value = chip.getAttribute('data-chip'); inp.focus(); }
      });
    });
    $('undo-btn') && $('undo-btn').addEventListener('click', undoLastEdit);

    $('new-btn') && $('new-btn').addEventListener('click', () => {
      state = { file: null, confirmationData: null, logoBase64: state.logoBase64, currentBlobUrl: null, confirmationId: null, confirmationUrl: null, chatMessages: [], isEditing: false, confHistory: [] };
      renderChatHistory(); updateUndoBtn();
      const zone = $('drop-zone');
      if (zone) zone.innerHTML = '<div class="drop-icon">&#128196;</div><div class="drop-main">Drop supplier confirmation here</div><div class="drop-sub">PDF or DOCX &mdash; up to 8 MB</div><div class="drop-btn">Browse Files</div>';
      ['f-clientName', 'f-destination', 'f-tripType', 'f-phone', 'f-email'].forEach(id => { const el = $(id); if (el) el.value = ''; });
      $('detect-status').textContent = '';
      const wa = $('wa-btn-section'); if (wa) wa.style.display = 'none';
      showView('view-upload');
    });
  }
  return { init };
})();
document.addEventListener('DOMContentLoaded', ConfApp.init);
