// ─── IziTravel Quote Generator — App Logic ───────────────────────────────────

const App = (() => {
  // ── State ──────────────────────────────────────────────────────────────────
  let state = {
    file:         null,         // The uploaded File object
    quoteData:    null,         // Current structured JSON data
    logoBase64:   null,         // Logo preloaded as base64 data URL
    chatMessages: [],           // [{role:'agent'|'ai', text:'...'}]
    currentBlobUrl: null,       // Active iframe blob URL
    isEditing:    false,        // True while edit AI call is in progress
    quoteUrl:     null,         // Shareable client link from save-quote
    editQuoteId:  null,         // UUID of the saved quote being edited (null = new quote)
    quoteHistory: [],           // Stack of previous quoteData states for undo (max 10)
    leadContactId: null,        // GHL contact id when this quote was started from a lead
  };

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  // ── Views ──────────────────────────────────────────────────────────────────
  function showView(name) {
    ['view-upload', 'view-generating', 'view-editor'].forEach(id => {
      const el = $(id);
      if (el) el.hidden = (id !== name);
    });
  }

  function setStatus(text) {
    const el = $('gen-status');
    if (el) el.textContent = text;
  }

  // ── Logo loader ────────────────────────────────────────────────────────────
  async function loadLogo() {
    try {
      const res  = await fetch('/assets/izilogo.jpg');
      const blob = await res.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  // ── File → base64 ─────────────────────────────────────────────────────────
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── Preview iframe ─────────────────────────────────────────────────────────
  function refreshPreview() {
    if (!state.quoteData) return;
    const html = buildQuoteHTML(state.quoteData, state.logoBase64);
    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const iframe = $('preview-frame');
    if (state.currentBlobUrl) URL.revokeObjectURL(state.currentBlobUrl);
    state.currentBlobUrl = url;
    iframe.src = url;
  }

  // ── Download ───────────────────────────────────────────────────────────────
  function downloadQuote() {
    if (!state.quoteData) return;
    const html = buildQuoteHTML(state.quoteData, state.logoBase64);
    window.IziPDF.download(html, buildFilename(state.quoteData));
  }

  // ── Undo history ──────────────────────────────────────────────────────────
  function pushHistory(data) {
    state.quoteHistory.push(JSON.parse(JSON.stringify(data))); // deep clone
    if (state.quoteHistory.length > 10) state.quoteHistory.shift(); // keep last 10
    updateUndoBtn();
  }

  function updateUndoBtn() {
    const btn = $('undo-btn');
    if (btn) btn.style.display = state.quoteHistory.length > 0 ? 'block' : 'none';
  }

  function undoLastEdit() {
    if (state.quoteHistory.length === 0) return;
    const prev = state.quoteHistory.pop();
    state.quoteData = prev;
    updateUndoBtn();
    refreshPreview();
    saveQuoteLink(state.quoteData, true); // serialized — queues if the first save is still in flight
    addChatMsg('ai', '↩ Reverted to the previous version.');
  }

  // ── Price markup ──────────────────────────────────────────────────────────
  function applyMarkup() {
    if (!state.quoteData) return;
    const pctStr = ($('markup-pct') || {}).value;
    const pct = parseFloat(pctStr);
    if (isNaN(pct) || pct < 0) { alert('Please enter a markup percentage of 0 or more.'); return; }

    const updated = { ...state.quoteData };

    // Snapshot the pre-markup ("base"/supplier) prices ONCE, so markup is always
    // relative to the original: re-applying replaces rather than compounds, and
    // entering 0 restores the supplier prices. Also lets the admin show base → marked-up.
    // Re-snapshot if the option count changed (option added/removed via chat
    // edit) so base prices stay index-aligned with the live options.
    if (!Array.isArray(updated._baseOptions) || updated._baseOptions.length !== (updated.options || []).length) {
      updated._baseOptions = (updated.options || []).map(o => ({
        optionNumber:   o.optionNumber,
        pricePerPerson: o.pricePerPerson,
        totalPrice:     o.totalPrice,
      }));
    }

    const multiplier = 1 + pct / 100;
    function markupFrom(priceStr) {
      if (!priceStr) return priceStr;
      const num = parseFloat(String(priceStr).replace(/[^0-9.]/g, ''));
      if (isNaN(num)) return priceStr;
      return 'R' + Math.round(num * multiplier).toLocaleString('en-ZA');
    }

    // Key by array index, NOT optionNumber — the AI doesn't always emit
    // optionNumber, and a missing/duplicate number made every option take the
    // last option's base price.
    updated.options = (updated.options || []).map((opt, i) => {
      const base = updated._baseOptions[i] || opt;
      return {
        ...opt,
        pricePerPerson: markupFrom(base.pricePerPerson),
        totalPrice:     markupFrom(base.totalPrice),
      };
    });

    // Record the margin so the admin dashboard can show whether one was added.
    updated.markup = pct > 0 ? { pct, appliedAt: new Date().toISOString() } : null;

    state.quoteData = updated;
    refreshPreview();
    saveQuoteLink(state.quoteData, true); // serialized — queues if the first save is still in flight

    const btn = $('markup-apply-btn');
    if (btn) { btn.textContent = pct > 0 ? '✓ Applied!' : '✓ Reset'; setTimeout(() => { btn.textContent = 'Apply Markup'; }, 2000); }
  }

  // ── Prefill from a GHL lead (?cid=) ─────────────────────────────────────────
  // Fetches the lead's details server-side (PII stays out of the URL) and fills
  // the form. The function also advances the GHL opportunity to "Quote Requested".
  async function prefillFromLead(cid) {
    try {
      state.leadContactId = cid;
      const res  = await fetch('/.netlify/functions/lead-prefill?cid=' + encodeURIComponent(cid));
      const data = await res.json();
      const p = data && data.prefill;
      if (!p) return;
      const set = (id, v) => { const el = $(id); if (el && v) el.value = v; };
      set('f-clientName', p.clientName);
      set('f-destination', p.destination);
      set('f-dates', p.dates);
      set('f-phone', p.phone);
      set('f-email', p.email);
      if (p.adults) { const el = $('f-adults'); if (el && [...el.options].some(o => o.value === p.adults)) el.value = p.adults; }
      const ds = $('detect-status');
      if (ds) { ds.textContent = '✓ Lead loaded from your CRM — upload the supplier doc and generate.'; ds.className = 'detect-status success'; }
    } catch { /* prefill is best-effort */ }
  }

  // ── Auto-detect ────────────────────────────────────────────────────────────
  async function runDetect(file) {
    try {
      $('detect-status').textContent = 'Scanning document…';
      $('detect-status').className   = 'detect-status loading';
      const fileData = await fileToBase64(file);
      const res      = await fetch('/.netlify/functions/detect', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fileData, filename: file.name }),
      });
      let data = {};
      try { data = await res.json(); } catch { data = {}; }
      // Fill form fields only if the field is still empty
      if (data.clientName  && !$('f-clientName').value)  $('f-clientName').value  = data.clientName;
      if (data.destination && !$('f-destination').value) $('f-destination').value = data.destination;
      if (data.dates       && !$('f-dates').value)       $('f-dates').value       = data.dates;
      // f-adults is a <select> that always has a value ("2" default), so an
      // emptiness guard would never apply the detected count — validate instead.
      if (data.adults) { const el = $('f-adults'); const v = String(data.adults); if (el && [...el.options].some(o => o.value === v)) el.value = v; }
      if (data.occasion    && !$('f-occasion').value)    $('f-occasion').value    = data.occasion;
      $('detect-status').textContent = 'Details detected — please review below.';
      $('detect-status').className   = 'detect-status success';
    } catch {
      $('detect-status').textContent = 'Could not auto-detect — fill in the form manually.';
      $('detect-status').className   = 'detect-status warn';
    }
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  async function runGenerate() {
    if (!state.file) { alert('Please upload a supplier document first.'); return; }

    const clientDetails = {
      clientName:    $('f-clientName').value.trim(),
      clientTitle:   $('f-clientTitle').value.trim(),
      occasion:      $('f-occasion').value.trim(),
      destination:   $('f-destination').value.trim(),
      dates:         $('f-dates').value.trim(),
      adults:        $('f-adults').value.trim(),
      children:      $('f-children').value.trim(),
      personalNote:  $('f-personalNote').value.trim(),
      quoteValidity: $('f-validity').value.trim(),
      phone:         $('f-phone').value.trim(),
      email:         $('f-email').value.trim(),
    };

    showView('view-generating');
    setStatus('Reading document and extracting package data…');

    try {
      const fileData = await fileToBase64(state.file);
      setStatus('Analysing options with AI — this takes about 20 seconds…');

      const res = await fetch('/.netlify/functions/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fileData, filename: state.file.name, clientDetails }),
      });

      let json = {};
      try { json = await res.json(); } catch { throw new Error(`Server error ${res.status} — the request may have timed out. Please try again.`); }
      if (!res.ok || json.error) throw new Error(json.error || `Server error: ${res.status}`);

      {
        const qd = json.result;
        // Stable quote reference — generated once here, not per page view.
        if (!qd.quoteRef) qd.quoteRef = 'IZI-' + Date.now().toString(36).toUpperCase().slice(-6);
        if (clientDetails.clientTitle)   qd.clientTitle   = clientDetails.clientTitle;
        if (clientDetails.children)      qd.children      = clientDetails.children;
        if (clientDetails.personalNote)  qd.personalNote  = clientDetails.personalNote;
        if (clientDetails.quoteValidity) qd.quoteValidity = clientDetails.quoteValidity;
        if (clientDetails.phone)         qd.phone         = clientDetails.phone;
        if (clientDetails.email)         qd.email         = clientDetails.email;
        state.quoteData    = qd;
        state.chatMessages = [];
        renderChatHistory();
        refreshPreview();
        showView('view-editor');
        document.dispatchEvent(new CustomEvent('quoteReady', { detail: qd }));

        // Save quote to get a shareable link (non-blocking)
        setQuoteLink(null); // reset while saving
        saveQuoteLink(qd);
      }

    } catch (err) {
      showView('view-upload');
      alert('Error: ' + (err.message || 'Failed to generate quote. Please try again.'));
    }
  }

  // ── Quote link ─────────────────────────────────────────────────────────────
  // silent=true — used when auto-saving after edits; doesn't reset the link UI.
  // Saves are serialized: if one is in flight, the request is queued and re-run
  // with the LATEST quoteData once it completes. Without this, edits made while
  // the first save is still returning (markup right after generate is the
  // natural workflow) never reached the share link the client opens.
  let saveInFlight = false, saveQueued = false;
  async function saveQuoteLink(quoteData, silent = false) {
    if (saveInFlight) { saveQueued = true; return; }
    saveInFlight = true;
    try {
      if (!silent) setQuoteLink(null); // show "Generating link…" for new saves only
      const body = { quoteData, logoBase64: state.logoBase64 };
      if (state.editQuoteId)   body.quoteId   = state.editQuoteId; // update existing record
      if (state.leadContactId) body.contactId = state.leadContactId; // push stage back to GHL
      const res = await fetch('/.netlify/functions/save-quote', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      let data = {};
      try { data = await res.json(); } catch { data = { error: `HTTP ${res.status} — non-JSON response` }; }
      if (data.quoteUrl) {
        const urlChanged  = state.quoteUrl !== data.quoteUrl;
        state.quoteUrl    = data.quoteUrl;
        state.editQuoteId = data.quoteId;   // store UUID for subsequent updates
        if (!silent || urlChanged) setQuoteLink(data.quoteUrl);
      } else {
        if (!silent) setQuoteLinkError(data.error || `HTTP ${res.status} — no URL returned`);
      }
    } catch (err) {
      if (!silent) setQuoteLinkError((err && (err.message || String(err))) || 'Network error');
    } finally {
      saveInFlight = false;
      if (saveQueued) { saveQueued = false; saveQuoteLink(state.quoteData, true); }
    }
  }

  // ── Load saved quote for editing (called when ?edit=UUID or ?duplicate=UUID in URL) ───
  // asNew=true → treats it as a new quote (duplicate flow — does not set editQuoteId)
  async function loadQuoteForEdit(quoteId, { asNew = false } = {}) {
    showView('view-generating');
    setStatus(asNew ? 'Duplicating quote…' : 'Loading saved quote…');
    try {
      const res  = await fetch(`/.netlify/functions/load-quote?id=${encodeURIComponent(quoteId)}`);
      let data = {};
      try { data = await res.json(); } catch { throw new Error('Could not load quote — server error. Please try again.'); }
      if (!res.ok || data.error) throw new Error(data.error || 'Quote not found');

      state.quoteData    = data.quoteData;
      state.editQuoteId  = asNew ? null : (data.quoteId || quoteId);
      if (data.logoBase64) state.logoBase64 = data.logoBase64;
      state.chatMessages = [];
      renderChatHistory();
      refreshPreview();
      showView('view-editor');
      document.dispatchEvent(new CustomEvent('quoteReady', { detail: data.quoteData }));

      if (asNew) {
        // Duplicate — save as a brand new record
        setQuoteLink(null);
        saveQuoteLink(data.quoteData);
      } else {
        // Edit — reuse existing view link
        const siteUrl  = location.origin;
        const viewUrl  = `${siteUrl}/.netlify/functions/view-quote?id=${state.editQuoteId}`;
        state.quoteUrl = viewUrl;
        setQuoteLink(viewUrl);
      }
    } catch (err) {
      showView('view-upload');
      alert('Could not load saved quote: ' + (err.message || 'Unknown error'));
    }
  }

  function setQuoteLinkError(msg) {
    const el = $('quote-link-section');
    if (el) el.innerHTML = `<span class="qlink-saving" style="color:#f87171">⚠ Link unavailable — use Download instead. (${msg})</span>`;
  }

  // ── Send helpers (personalisation + mark-as-sent) ───────────────────────────
  function normWa(phone) {
    let d = String(phone || '').replace(/[^0-9]/g, '');
    if (!d) return '';
    if (d.charAt(0) === '0') d = '27' + d.slice(1);   // ZA local 0XX → intl 27XX
    return d;
  }
  function avgOptionValue() {
    const opts = (state.quoteData && state.quoteData.options) || [];
    const nums = opts.map(o => parseFloat(String(o.totalPrice || '').replace(/[^0-9.]/g, ''))).filter(n => !isNaN(n) && n > 0);
    if (!nums.length) return null;
    return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
  }
  function onSend(openHref) {
    // Open the channel FIRST, synchronously inside the click gesture — opening
    // after confirm() gets popup-blocked (the dialog consumes the gesture), which
    // is why WhatsApp/email never opened even though the CRM move fired.
    window.open(openHref, '_blank');
    const doMark = !!state.leadContactId &&
      confirm('Mark this quote as “Sent” in CRM?\nMoves the lead to Quote Sent and sets the deal value to the average option price.');
    if (doMark) {
      fetch('/.netlify/functions/mark-quote-sent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: state.leadContactId,
          value:     avgOptionValue(),
          quoteUrl:  state.quoteUrl,
          name:      [(state.quoteData && state.quoteData.clientName) || '', (state.quoteData && state.quoteData.destination) || ''].filter(Boolean).join(' - '),
        }),
      }).catch(() => {});
    }
  }

  function setQuoteLink(url) {
    const el = $('quote-link-section');
    if (!el) return;
    if (!url) {
      el.innerHTML = '<span class="qlink-saving">Generating shareable link…</span>';
      return;
    }
    el.innerHTML = `
      <div class="qlink-row">
        <input class="qlink-input" id="qlink-input" value="${url}" readonly/>
        <button class="qlink-copy" id="qlink-copy">Copy Link</button>
      </div>
      <p class="qlink-hint">Send this link directly to your client — they can view and accept the quote.</p>
    `;
    $('qlink-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(() => {
        $('qlink-copy').textContent = '✓ Copied!';
        setTimeout(() => { $('qlink-copy').textContent = 'Copy Link'; }, 2000);
      });
    });

    // WhatsApp + Email — personalised (name + number) and gated by a "mark as Sent?" prompt
    const dest  = (state.quoteData && state.quoteData.destination) || 'your holiday';
    const cname = (state.quoteData && state.quoteData.clientName) || 'there';

    const waSection = $('wa-btn-section');
    const waBtn     = $('wa-btn');
    if (waSection && waBtn) {
      const waNum  = normWa((state.quoteData && state.quoteData.phone) || '');
      const waText = encodeURIComponent(`Hi ${cname}! Here is your IziTravel quote for ${dest}: ${url}`);
      const waHref = waNum ? `https://wa.me/${waNum}?text=${waText}` : `https://wa.me/?text=${waText}`;
      waBtn.href = waHref;
      waBtn.onclick = (e) => { e.preventDefault(); onSend(waHref); };
      waSection.style.display = 'block';
    }

    const emailBtn = $('email-btn');
    if (emailBtn) {
      const to = (state.quoteData && state.quoteData.email) || '';
      const subj = encodeURIComponent('Your IziTravel Quote — ' + dest);
      const bodyTxt = encodeURIComponent(
        `Hi ${cname},\n\nThank you for your enquiry! Here is your personalised IziTravel quote:\n${url}\n\n` +
        `Click through to view the options and select your favourite. Any questions, just reply or WhatsApp me.\n\nWarm regards,\nTerri\nIziTravel`
      );
      const mailHref = `mailto:${to}?subject=${subj}&body=${bodyTxt}`;
      emailBtn.href = mailHref;
      emailBtn.onclick = (e) => { e.preventDefault(); onSend(mailHref); };
      emailBtn.style.display = to ? 'inline-flex' : 'none';
    }

    // Also populate the edit link (for Terri to come back and edit)
    if (state.editQuoteId) {
      const editUrl     = location.origin + '/?edit=' + state.editQuoteId;
      const editSection = $('edit-link-section');
      const editInput   = $('edit-link-input');
      const editCopy    = $('edit-link-copy');
      if (editSection) editSection.style.display = 'block';
      if (editInput)   editInput.value = editUrl;
      if (editCopy) {
        editCopy.onclick = () => {
          navigator.clipboard.writeText(editUrl).then(() => {
            editCopy.textContent = '✓';
            setTimeout(() => { editCopy.textContent = 'Copy'; }, 2000);
          });
        };
      }
    }
  }

  // ── Chat edit ──────────────────────────────────────────────────────────────
  async function runEdit(message) {
    if (state.isEditing) return;
    if (!message.trim()) return;
    state.isEditing = true;
    addChatMsg('agent', message);
    setChatInputState(true);

    try {
      // Save current state to history before applying AI change (enables undo)
      pushHistory(state.quoteData);

      const res = await fetch('/.netlify/functions/edit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ quoteData: state.quoteData, message }),
      });
      let result = {};
      try { result = await res.json(); } catch { throw new Error('Edit request timed out. Please try again.'); }
      if (result.error) throw new Error(result.error);
      state.quoteData = result.quoteData;
      addChatMsg('ai', result.changes || 'Done — quote updated.');
      refreshPreview();
      // Auto-save updated quote silently (so client link stays current)
      saveQuoteLink(state.quoteData, true); // serialized — queues if the first save is still in flight
    } catch (err) {
      addChatMsg('ai', '⚠️ Sorry, I couldn\'t apply that change: ' + (err.message || 'Unknown error'));
    } finally {
      state.isEditing = false;
      setChatInputState(false);
    }
  }

  function addChatMsg(role, text) {
    state.chatMessages.push({ role, text });
    renderChatHistory();
  }

  function renderChatHistory() {
    const el = $('chat-history');
    if (!el) return;
    if (state.chatMessages.length === 0) {
      el.innerHTML = `<div class="chat-empty">
        No changes yet.<br>
        Use the chips above or type a change below.
      </div>`;
      return;
    }
    el.innerHTML = state.chatMessages.map(m => `
      <div class="chat-msg ${m.role === 'agent' ? 'chat-agent' : 'chat-ai'}">
        <div class="chat-bubble">${escapeHtml(m.text)}</div>
      </div>
    `).join('');
    el.scrollTop = el.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setChatInputState(disabled) {
    const inp = $('chat-input');
    const btn = $('chat-send');
    if (inp) inp.disabled = disabled;
    if (btn) { btn.disabled = disabled; btn.textContent = disabled ? 'Applying…' : 'Apply Change'; }
  }

  // ── File drop zone ─────────────────────────────────────────────────────────
  function initDropZone() {
    const zone  = $('drop-zone');
    const input = $('file-input');
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelected(file);
    });

    input.addEventListener('change', () => {
      if (input.files[0]) handleFileSelected(input.files[0]);
    });
  }

  function handleFileSelected(file) {
    const allowed = ['.pdf', '.docx'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) {
      alert('Please upload a PDF or DOCX file.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      alert('File is too large (max 8 MB). Please compress the document and try again.');
      return;
    }
    state.file = file;
    const zone = $('drop-zone');
    if (zone) {
      zone.innerHTML = `
        <div class="drop-file-name">&#128196; ${escapeHtml(file.name)}</div>
        <div class="drop-file-size">${(file.size / 1024).toFixed(0)} KB &mdash; ready to use</div>
        <div class="drop-change">Click to change</div>
      `;
    }
    $('detect-status').textContent = '';
    $('detect-status').className   = 'detect-status';
    runDetect(file);
  }

  // ── Quick-edit chips ───────────────────────────────────────────────────────
  function initQuickChips() {
    document.querySelectorAll('[data-chip]').forEach(chip => {
      chip.addEventListener('click', () => {
        const input = $('chat-input');
        if (input) {
          input.value = chip.getAttribute('data-chip');
          input.focus();
        }
      });
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    state.logoBase64 = await loadLogo();

    initDropZone();
    initQuickChips();

    // Check for ?edit=UUID or ?duplicate=UUID in URL
    const params      = new URLSearchParams(location.search);
    const editId      = params.get('edit');
    const duplicateId = params.get('duplicate');
    const cid         = params.get('cid');
    if (editId)      loadQuoteForEdit(editId);
    else if (duplicateId) loadQuoteForEdit(duplicateId, { asNew: true });
    else if (cid)    prefillFromLead(cid);

    // Generate button
    const genBtn = $('generate-btn');
    if (genBtn) genBtn.addEventListener('click', runGenerate);

    // Chat send
    const sendBtn = $('chat-send');
    if (sendBtn) sendBtn.addEventListener('click', () => {
      const val = $('chat-input').value.trim();
      if (val) { $('chat-input').value = ''; runEdit(val); }
    });

    // Chat input — Enter key
    const chatInput = $('chat-input');
    if (chatInput) chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const val = chatInput.value.trim();
        if (val) { chatInput.value = ''; runEdit(val); }
      }
    });

    // Undo button
    const undoBtn = $('undo-btn');
    if (undoBtn) undoBtn.addEventListener('click', undoLastEdit);

    // Markup apply button
    const markupBtn = $('markup-apply-btn');
    if (markupBtn) markupBtn.addEventListener('click', applyMarkup);

    // Download button
    const dlBtn = $('download-btn');
    if (dlBtn) dlBtn.addEventListener('click', downloadQuote);

    // New quote button
    const newBtn = $('new-quote-btn');
    if (newBtn) newBtn.addEventListener('click', () => {
      state.file = null;
      state.quoteData = null;
      state.quoteUrl = null;
      state.editQuoteId = null;
      state.leadContactId = null; // else the NEXT quote's "mark as sent" hits the OLD lead's CRM card
      state.chatMessages = [];
      state.quoteHistory = [];
      updateUndoBtn();
      if (state.currentBlobUrl) URL.revokeObjectURL(state.currentBlobUrl);
      state.currentBlobUrl = null;
      // Reset drop zone
      const zone = $('drop-zone');
      if (zone) zone.innerHTML = dropZoneDefault;
      // Reset form
      ['f-clientName','f-clientTitle','f-occasion','f-destination','f-dates',
       'f-adults','f-children','f-personalNote','f-phone','f-email'].forEach(id => {
        const el = $(id);
        if (el) el.value = '';
      });
      $('f-validity').value = '48';
      // Hide WhatsApp button
      const waSection = $('wa-btn-section');
      if (waSection) waSection.style.display = 'none';
      $('detect-status').textContent = '';
      showView('view-upload');
    });
  }

  const dropZoneDefault = `
    <div class="drop-icon">&#128196;</div>
    <div class="drop-main">Drop supplier document here</div>
    <div class="drop-sub">PDF or DOCX &mdash; up to 8 MB</div>
    <div class="drop-btn">Browse Files</div>
  `;

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
