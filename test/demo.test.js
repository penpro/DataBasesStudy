// The GitHub Pages demo (web/js/demo.js) answers the API's calls without a server. These tests run the
// SAME actions against the demo and against the real API + MySQL and require identical results.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { resetTestDatabase, startServer } = require('./helpers');
const engine = require('../server/engine');
const demoLib = require('../web/js/demo');

let s, L, demo;
const ME = '/api/learners/me';

function memoryStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, removeItem: (k) => { delete m[k]; } };
}

before(async () => {
  await resetTestDatabase();
  s = await startServer();
  L = await s.newLearner('t_demo');
  const bank = (await s.get('/api/bank')).json;
  demo = demoLib.create(memoryStorage(), engine, async () => bank);
});
after(async () => { await s.close(); });

test('the committed demo snapshot (web/demo/bank.json) matches what the database serves', async () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'web', 'demo', 'bank.json'), 'utf8'));
  const live = (await s.get('/api/bank')).json;
  assert.deepEqual(snapshot, live, 'run `npm run build:demo` and commit the result');
});

test('demo and real API agree after the same sequence of actions', async () => {
  const both = async (method, url, body) => {
    const real = await s.call(method, url.replace(ME, L), body);
    let d;
    try { d = { status: 200, json: await demo.handle(method, url, body) }; }
    catch (e) { d = { status: e.status, json: null }; }
    const okReal = real.status < 300;
    assert.equal(d.status < 300, okReal, `${method} ${url}: real ${real.status}, demo ${d.status}`);
    return real;
  };

  await both('PATCH', ME + '/settings', { masterStreak: 2, mode: 'free', unlockThreshold: 0.8 });
  const codes = ['c01-1', 'c01-2', 'c02-1', 'c05-1', 'c05-2', 'c06-1', 'c07-4', 'c03-2'];
  let x = 7;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 70; i++) {
    await both('POST', ME + '/attempts', { code: codes[Math.floor(rnd() * codes.length)], correct: rnd() < 0.55 });
  }
  await both('PUT', ME + '/flags/c05-1');
  await both('PUT', ME + '/flags/c01-1');
  await both('DELETE', ME + '/flags/c01-1');
  await both('PUT', ME + '/unlocks/4');
  await both('PUT', ME + '/unlocks/2');
  await both('DELETE', ME + '/unlocks/2');
  await both('POST', ME + '/exams', { scope: 'Units 1-2', minutes: 30, startedAtMs: Date.now() - 60000,
    results: [{ code: 'c01-1', correct: true }, { code: 'c02-1', correct: false }, { code: 'c05-1', correct: true }] });

  // the same bad requests must be refused by both
  await both('POST', ME + '/attempts', { code: 'zzz', correct: true });
  await both('POST', ME + '/attempts', { code: 'c99-9', correct: true });
  await both('POST', ME + '/attempts', { code: 'c01-1', correct: 'yes' });
  await both('PATCH', ME + '/settings', { masterStreak: 9 });
  await both('PATCH', ME + '/settings', { nope: 1 });
  await both('PUT', ME + '/unlocks/99');
  await both('POST', ME + '/exams', { scope: 'dup', minutes: 5, startedAtMs: 1, results: [{ code: 'c01-1', correct: true }, { code: 'c01-1', correct: true }] });

  const rs = (await s.get(`${L}/state`)).json;
  const ds = await demo.handle('GET', ME + '/state');
  assert.deepEqual(ds.settings, rs.settings);
  assert.deepEqual(ds.progress, rs.progress);
  const { started: _a, ...dStats } = ds.stats;
  const { started: _b, ...rStats } = rs.stats;
  assert.deepEqual(dStats, rStats);
  assert.deepEqual(ds.exams.map(({ when, ...e }) => e), rs.exams.map(({ when, ...e }) => e));

  const rr = (await s.get(`${L}/reports`)).json;
  const dr = await demo.handle('GET', ME + '/reports');
  const norm = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'string' && v !== '' && !isNaN(v) ? Number(v) : v)));
  assert.deepEqual(norm(dr), norm(rr));
});

test('demo reset clears everything, like DELETE /progress', async () => {
  await demo.handle('DELETE', ME + '/progress');
  const st = await demo.handle('GET', ME + '/state');
  assert.deepEqual(st.progress, {});
  assert.equal(st.stats.answered, 0);
  assert.deepEqual(st.settings, { masterStreak: 3, unlockThreshold: 0.9, mode: 'guided', ramp: true, theme: 'light', unlocked: [] });
});
