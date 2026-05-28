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
    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = buildFilename(state.quoteData);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      const data = await res.json();
      // Fill form fields only if the field is still empty
      if (data.clientName  && !$('f-clientName').value)  $('f-clientName').value  = data.clientName;
      if (data.destination && !$('f-destination').value) $('f-destination').value = data.destination;
      if (data.dates       && !$('f-dates').value)       $('f-dates').value       = data.dates;
      if (data.adults      && !$('f-adults').value)      $('f-adults').value       = data.adults;
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

      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `Server error: ${res.status}`);

      {
        const qd = json.result;
        if (clientDetails.clientTitle)   qd.clientTitle   = clientDetails.clientTitle;
        if (clientDetails.children)      qd.children      = clientDetails.children;
        if (clientDetails.personalNote)  qd.personalNote  = clientDetails.personalNote;
        if (clientDetails.quoteValidity) qd.quoteValidity = clientDetails.quoteValidity;
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
  async function saveQuoteLink(quoteData) {
    try {
      const res = await fetch('/.netlify/functions/save-quote', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ quoteData, logoBase64: state.logoBase64 }),
      });
      const data = await res.json();
      if (data.quoteUrl) {
        state.quoteUrl = data.quoteUrl;
        setQuoteLink(data.quoteUrl);
      } else {
        setQuoteLinkError(data.error || 'Could not generate link');
      }
    } catch (err) {
      setQuoteLinkError(err.message || 'Could not generate link');
    }
  }

  function setQuoteLinkError(msg) {
    const el = $('quote-link-section');
    if (el) el.innerHTML = `<span class="qlink-saving" style="color:#f87171">⚠ Link unavailable — use Download instead. (${msg})</span>`;
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
  }

  // ── Chat edit ──────────────────────────────────────────────────────────────
  async function runEdit(message) {
    if (state.isEditing) return;
    if (!message.trim()) return;
    state.isEditing = true;
    addChatMsg('agent', message);
    setChatInputState(true);

    try {
      const res = await fetch('/.netlify/functions/edit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ quoteData: state.quoteData, message }),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      state.quoteData = result.quoteData;
      addChatMsg('ai', result.changes || 'Done — quote updated.');
      refreshPreview();
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
        Use the chips above or type a change below.<br><br>
        <strong>Examples:</strong><br>
        "Change client to Mrs Ferreira"<br>
        "Remove options 3 and 4"<br>
        "Option 2 price is R38,500 pp, total R77,000"
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

    // Download button
    const dlBtn = $('download-btn');
    if (dlBtn) dlBtn.addEventListener('click', downloadQuote);

    // New quote button
    const newBtn = $('new-quote-btn');
    if (newBtn) newBtn.addEventListener('click', () => {
      state.file = null;
      state.quoteData = null;
      state.quoteUrl = null;
      state.chatMessages = [];
      if (state.currentBlobUrl) URL.revokeObjectURL(state.currentBlobUrl);
      state.currentBlobUrl = null;
      // Reset drop zone
      const zone = $('drop-zone');
      if (zone) zone.innerHTML = dropZoneDefault;
      // Reset form
      ['f-clientName','f-clientTitle','f-occasion','f-destination','f-dates',
       'f-adults','f-children','f-personalNote'].forEach(id => {
        const el = $(id);
        if (el) el.value = '';
      });
      $('f-validity').value = '48';
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
