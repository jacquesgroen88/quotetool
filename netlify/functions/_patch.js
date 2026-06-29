// ─── Shared edit-patch engine ────────────────────────────────────────────────
// The AI edit tools used to ask the model to RE-EMIT the entire quote/confirmation
// object to change a single field. On a large multi-option quote that is thousands
// of output tokens — slow enough to blow past the function timeout ("Edit request
// timed out") and risky (the model can silently re-type or drop prices).
//
// Instead the model now returns a small list of edit OPERATIONS, which we apply
// here in code. A one-field edit is a few tokens, finishes in ~1-2s, and untouched
// prices / inclusions are never regenerated, so they can never drift.

// Reject path segments that could pollute the prototype chain.
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

// Parse "options[0].inclusions" → ['options', 0, 'inclusions'].
// Supports dot notation and zero-based [n] array indices.
function parsePath(path) {
  if (typeof path !== 'string' || !path.trim()) return null;
  const segs = [];
  for (const part of path.split('.')) {
    const m = part.match(/^([^[\]]*)((?:\[\d+\])*)$/);
    if (!m) return null;
    const key = m[1];
    if (key) {
      if (BAD_KEYS.has(key)) return null;
      segs.push(key);
    }
    const idxBlock = m[2];
    if (idxBlock) {
      const nums = idxBlock.match(/\d+/g) || [];
      for (const n of nums) segs.push(Number(n));
    }
    if (!key && !idxBlock) return null; // empty segment (e.g. "a..b")
  }
  return segs.length ? segs : null;
}

// Walk to the parent container of the final segment.
function getParent(obj, segs) {
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[segs[i]];
  }
  return (cur != null && typeof cur === 'object') ? cur : null;
}

// Apply a list of ops to obj IN PLACE. Returns which ops applied / failed and the
// list of applied paths (so callers can invalidate derived state like price checks).
function applyOps(obj, ops) {
  const appliedPaths = [];
  const failed = [];
  if (!Array.isArray(ops)) return { applied: 0, failed: [], appliedPaths };

  for (const op of ops) {
    try {
      const action = op && (op.op || op.action);
      const segs = parsePath(op && op.path);
      if (!action || !segs) { failed.push(op); continue; }
      const last = segs[segs.length - 1];
      const parent = getParent(obj, segs);
      if (parent == null) { failed.push(op); continue; }

      if (action === 'set') {
        parent[last] = op.value;
        appliedPaths.push(op.path);
      } else if (action === 'append') {
        if (parent[last] == null) parent[last] = [];
        if (!Array.isArray(parent[last])) { failed.push(op); continue; }
        const items = Array.isArray(op.value) ? op.value : [op.value];
        parent[last].push(...items);
        appliedPaths.push(op.path);
      } else if (action === 'remove') {
        const arr = parent[last];
        if (!Array.isArray(arr) || arr.length === 0) { failed.push(op); continue; }
        let idx = (op.index == null || op.index === '') ? arr.length - 1 : Number(op.index);
        if (idx < 0) idx = arr.length + idx; // allow -1 = last
        if (!Number.isInteger(idx) || idx < 0 || idx >= arr.length) { failed.push(op); continue; }
        arr.splice(idx, 1);
        appliedPaths.push(op.path);
      } else if (action === 'delete') {
        if (Array.isArray(parent) && typeof last === 'number') {
          if (last < 0 || last >= parent.length) { failed.push(op); continue; }
          parent.splice(last, 1);
          appliedPaths.push(op.path);
        } else if (!Array.isArray(parent) && Object.prototype.hasOwnProperty.call(parent, last)) {
          delete parent[last];
          appliedPaths.push(op.path);
        } else {
          failed.push(op);
        }
      } else {
        failed.push(op);
      }
    } catch {
      failed.push(op);
    }
  }
  return { applied: appliedPaths.length, failed, appliedPaths };
}

// Deep clone, dropping internal bookkeeping fields (underscore-prefixed at any
// depth, plus top-level recordType). This is what we show the AI: it can never
// see, drop, or mangle the markup baseline / price-check / source prices.
function stripForDisplay(v) {
  if (Array.isArray(v)) return v.map(stripForDisplay);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      if (k.charAt(0) === '_' || k === 'recordType') continue;
      out[k] = stripForDisplay(v[k]);
    }
    return out;
  }
  return v;
}

module.exports = { parsePath, applyOps, stripForDisplay };
