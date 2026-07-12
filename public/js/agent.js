// Izi tool suite — per-person identity helper (shared by quote/confirmation/invoice apps).
//
// The PIN is asked for AT MOST ONCE per device: stored in localStorage and sent
// with every write. While the server has no AGENTS configured it never returns
// 401 for writes, so nobody is ever prompted. Once AGENTS is set in Netlify,
// the first 401 triggers a single prompt, the PIN is stored, and the request
// is retried transparently.
(function () {
  var KEY = 'izi_agent_pin';

  function getPin() {
    // Migrate the old leads-board key so nobody gets re-prompted.
    var pin = localStorage.getItem(KEY) || '';
    if (!pin) {
      var legacy = localStorage.getItem('izi_admin_pw') || '';
      if (legacy) { localStorage.setItem(KEY, legacy); pin = legacy; }
    }
    return pin;
  }

  function setPin(pin) { if (pin) localStorage.setItem(KEY, pin); }
  function clearPin()  { localStorage.removeItem(KEY); }

  function promptPin() {
    var p = (prompt('Enter your personal PIN (asked once on this device):') || '').trim();
    if (p) setPin(p);
    return p;
  }

  // POST JSON with the stored PIN attached. On 401: one prompt, one retry.
  async function agentFetch(url, bodyObj) {
    var body = bodyObj || {};
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, body, { pin: getPin() })),
    });
    if (res.status === 401) {
      clearPin();
      var np = promptPin();
      if (np) {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({}, body, { pin: np })),
        });
      }
    }
    return res;
  }

  window.IziAgent = { agentFetch: agentFetch, getPin: getPin, setPin: setPin, clearPin: clearPin };
})();
