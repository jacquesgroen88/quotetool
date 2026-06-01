// IziTravel Quote — Modal & submission logic
// External static file: no template-literal escaping issues.

(function () {
  var ED = null;
  var selOpt = null;
  var origModalBody = null;

  function init() {
    var dataEl = document.getElementById('embedData');
    if (!dataEl) return;
    try { ED = JSON.parse(dataEl.textContent); } catch (e) { return; }

    origModalBody = (document.getElementById('modalBody') || {}).innerHTML || '';

    // Attach click handlers to every Select This Package button
    document.querySelectorAll('.select-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openModal(btn);
      });
    });

    var closeBtn = document.getElementById('modalClose');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    var bg = document.getElementById('modalBg');
    if (bg) bg.addEventListener('click', function (e) {
      if (e.target === bg) closeModal();
    });

    var submitBtn = document.getElementById('mSubmit');
    if (submitBtn) submitBtn.addEventListener('click', doSubmit);
  }

  function openModal(btn) {
    try { selOpt = JSON.parse(btn.getAttribute('data-opt')); } catch (e) { return; }
    var lbl = selOpt.resortName + (selOpt.roomType ? ' · ' + selOpt.roomType : '');
    var chosenEl = document.getElementById('chosenLbl');
    if (chosenEl) chosenEl.innerHTML = 'You selected: <strong>' + lbl + '</strong>';
    var nameEl = document.getElementById('mName');
    if (nameEl) nameEl.value = '';
    var bg = document.getElementById('modalBg');
    if (bg) bg.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    var bg = document.getElementById('modalBg');
    if (bg) bg.style.display = 'none';
    document.body.style.overflow = '';
    var body = document.getElementById('modalBody');
    if (body) body.innerHTML = origModalBody;
    selOpt = null;
    // Re-attach submit handler after innerHTML reset
    var submitBtn = document.getElementById('mSubmit');
    if (submitBtn) submitBtn.addEventListener('click', doSubmit);
  }

  async function doSubmit() {
    var nameEl  = document.getElementById('mName');
    var emailEl = document.getElementById('mEmail');
    var phoneEl = document.getElementById('mPhone');
    var msgEl   = document.getElementById('mMessage');
    var name  = nameEl  ? nameEl.value.trim()  : '';
    var email = emailEl ? emailEl.value.trim() : '';
    var phone = phoneEl ? phoneEl.value.trim() : '';
    var msg   = msgEl   ? msgEl.value.trim()   : '';
    if (!name || !email) { alert('Please enter your name and email address.'); return; }
    var btn = document.getElementById('mSubmit');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    try {
      await fetch(ED.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formType: 'quote_accepted',
          quoteRef: ED.quoteRef,
          clientName: ED.clientName,
          destination: ED.dest,
          dates: ED.dates,
          adults: ED.adults,
          selectedOption: selOpt,
          submittedName: name,
          email: email,
          phone: phone,
          message: msg,
        }),
      });
    } catch (e) {}
    var firstName = name.split(' ')[0];
    var body = document.getElementById('modalBody');
    if (body) {
      body.innerHTML =
        "<div class='msuccess'><div class='tick'>&#127881;</div>" +
        "<h4>You're all set, " + firstName + "!</h4>" +
        "<p>We've received your selection and our travel agent will be in touch with you <strong>shortly</strong> to confirm.<br><br>" +
        "In the meantime, WhatsApp us on <strong>" + (ED.agentPhone || '') + "</strong>.</p></div>";
    }
    document.body.style.overflow = '';
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
