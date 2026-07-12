/**
 * Per-person identity for the Izi tool suite — server-side only.
 *
 * AGENTS env var (Netlify dashboard) is a JSON map of lowercase name -> PIN:
 *   AGENTS={"terri":"482913","jacques":"175064"}
 *
 * The server derives WHO from WHICH PIN was used, so attribution is
 * server-assigned, never client-claimed. PINs are per-person credentials:
 * individually revocable, and rotating one doesn't lock out the others.
 *
 * Rollout safety: while AGENTS is unset, pinRequired() is false and every
 * write works exactly as before (agent = null, no prompts). Setting AGENTS
 * in Netlify flips enforcement on for writes; each person then gets ONE
 * PIN prompt per device (stored in localStorage by public/js/agent.js).
 *
 * This repo is PUBLIC — never hardcode a PIN or fallback credential here.
 */

function agents() {
  try {
    const a = JSON.parse(process.env.AGENTS || '{}');
    return (a && typeof a === 'object' && !Array.isArray(a)) ? a : {};
  } catch { return {}; }
}

function pinRequired() { return Object.keys(agents()).length > 0; }

/** PIN -> lowercase agent name, or null. */
function agentForPin(pin) {
  if (!pin) return null;
  const a = agents();
  for (const name of Object.keys(a)) {
    if (String(a[name]) === String(pin).trim()) return name.toLowerCase();
  }
  return null;
}

/**
 * Validate a credential for READ/admin endpoints: accepts a personal PIN or
 * the legacy shared ADMIN_PASSWORD. Returns { ok, agent, configured }.
 * configured=false means NEITHER auth scheme is set up (caller should 500).
 */
function checkCredential(value) {
  const adminPass  = process.env.ADMIN_PASSWORD || '';
  const configured = !!adminPass || pinRequired();
  if (!configured) return { ok: false, agent: null, configured: false };
  const agent = agentForPin(value);
  if (agent) return { ok: true, agent, configured: true };
  if (adminPass && value && value === adminPass) return { ok: true, agent: null, configured: true };
  return { ok: false, agent: null, configured: true };
}

/**
 * Append an event to record._activity: { event, agent, at, n? }.
 * Consecutive 'edited' events by the same agent within 30 min coalesce into
 * one entry (auto-save fires after every chat edit — per-event would be noise).
 * Underscore prefix means view pages strip it and the AI editor never sees it.
 */
function appendActivity(record, event, agent) {
  if (!record || typeof record !== 'object') return;
  const at = new Date().toISOString();
  if (!Array.isArray(record._activity)) record._activity = [];
  const last = record._activity[record._activity.length - 1];
  if (event === 'edited' && last && last.event === 'edited' && last.agent === (agent || null)
      && (Date.parse(at) - Date.parse(last.at)) < 30 * 60 * 1000) {
    last.at = at;
    last.n = (last.n || 1) + 1;
  } else {
    record._activity.push({ event, agent: agent || null, at });
  }
  if (record._activity.length > 50) record._activity = record._activity.slice(-50);
}

module.exports = { agents, pinRequired, agentForPin, checkCredential, appendActivity };
