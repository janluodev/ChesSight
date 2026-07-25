import test from 'node:test';
import assert from 'node:assert/strict';

// 每个用例用独立 query 参数重新 import，避免模块级语言状态互相污染
async function freshI18n() {
  return import(`../js/i18n.js?test=${crypto.randomUUID()}`);
}

test('dictionary is complete: every key has non-empty zh and en', async () => {
  const { DICT } = await freshI18n();
  const keys = Object.keys(DICT);
  assert.ok(keys.length > 50, `expected a substantial dictionary, got ${keys.length} keys`);
  for (const key of keys) {
    assert.equal(typeof DICT[key].zh, 'string', `${key} missing zh`);
    assert.equal(typeof DICT[key].en, 'string', `${key} missing en`);
    assert.ok(DICT[key].zh.trim(), `${key} has empty zh`);
    assert.ok(DICT[key].en.trim(), `${key} has empty en`);
  }
});

test('default language is English and t() interpolates variables', async () => {
  const i18n = await freshI18n();
  assert.equal(i18n.getLang(), 'en');
  assert.equal(i18n.t('status.mateW'), 'Checkmate! White wins');
  assert.equal(
    i18n.t('hint.best', { san: 'Nf3', from: 'g1', to: 'f3' }),
    '💡 Stockfish 18 best move: Nf3 (g1 → f3)',
  );
  assert.equal(i18n.t('missing.key'), 'missing.key');
});

test('setLang switches output language and rejects unknown languages', async () => {
  const i18n = await freshI18n();
  i18n.setLang('zh');
  assert.equal(i18n.getLang(), 'zh');
  assert.equal(i18n.t('status.mateW'), '将杀！白方获胜');
  i18n.setLang('en');
  assert.equal(i18n.t('status.mateW'), 'Checkmate! White wins');
  i18n.setLang('fr');
  assert.equal(i18n.getLang(), 'en');
});

test('all openings expose complete English fields', async () => {
  const { OPENINGS } = await import('../js/openings.js');
  assert.equal(OPENINGS.length, 14);
  for (const op of OPENINGS) {
    for (const field of ['nameEn', 'originEn', 'prosEn', 'consEn']) {
      assert.equal(typeof op[field], 'string', `${op.id} missing ${field}`);
      assert.ok(op[field].trim().length > 0, `${op.id} has empty ${field}`);
    }
  }
});
