// Verification layer: checks registry + status vocabulary.
// PLANNED → ATTEMPTED → FAILED/BLOCKED → COMPLETED → VERIFIED. Never collapsed.

export const VSTATUS = ['PLANNED', 'ATTEMPTED', 'FAILED', 'BLOCKED', 'COMPLETED', 'VERIFIED'];

const checks = new Map();

export function defineCheck(name, fn) {
  checks.set(name, fn);
}

/** Run named checks against a value. Returns {passed, results[]}. */
export async function verify(value, checkNames = []) {
  const results = [];
  for (const name of checkNames) {
    const fn = checks.get(name);
    if (!fn) {
      results.push({ check: name, passed: false, detail: 'unknown check' });
      continue;
    }
    try {
      const r = await fn(value);
      results.push({ check: name, passed: !!r.passed, detail: r.detail || '' });
    } catch (e) {
      results.push({ check: name, passed: false, detail: String(e.message || e).slice(0, 200) });
    }
  }
  return { passed: results.every((r) => r.passed), results };
}

// built-ins
defineCheck('nonempty', async (v) => ({
  passed: v !== undefined && v !== null && String(v).length > 0,
  detail: 'value present',
}));

defineCheck('no-placeholders', async (v) => {
  const s = JSON.stringify(v);
  return {
    passed: !/lorem|TODO|FIXME|\[insert|xxx/i.test(s),
    detail: 'no placeholder text',
  };
});

defineCheck('provenance-present', async (v) => {
  const items = Array.isArray(v) ? v : [v];
  const bad = items.filter((f) => f && typeof f === 'object' && 'value' in f && !f.source);
  return { passed: bad.length === 0, detail: `${items.length - bad.length}/${items.length} findings carry provenance` };
});

defineCheck('no-absolute-identity', async (v) => {
  const s = JSON.stringify(v).toLowerCase();
  return {
    passed: !/same person|definitely|confirmed identity/.test(s),
    detail: 'no absolute identity claims over username leads',
  };
});
