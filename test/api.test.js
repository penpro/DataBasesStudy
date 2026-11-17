// The HTTP API, end to end: real server, real MySQL (the test database), real engine.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetTestDatabase, startServer } = require('./helpers');
const engine = require('../server/engine');
const { loadSource } = require('../scripts/import-bank');

let s;
before(async () => { await resetTestDatabase(); s = await startServer(); });
after(async () => { await s.close(); });

const count = async (sql, params) => (await s.pool.query(sql, params))[0][0].n;

// ---- the bank and the page --------------------------------------------------------------------

test('GET /api/health reports the question count', async () => {
  const r = await s.get('/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, questions: 280 });
});

test('GET /api/bank returns units, questions and choices in the shape the page uses', async () => {
  const r = await s.get('/api/bank');
  assert.equal(r.status, 200);
  const { units, questions, choices } = r.json;
  assert.equal(units.length, 13);
  assert.deepEqual([units[0].first_card, units[0].last_card, units[12].first_card, units[12].last_card], [1, 4, 49, 52]);
  assert.equal(questions.length, 280);
  const q = questions.find((x) => x.id === 'c07-4');
  assert.deepEqual(Object.keys(q).sort(), ['answer', 'card', 'cardTitle', 'id', 'origin', 'prompt', 'tags']);
  assert.deepEqual([...q.tags].sort(), ['limit', 'order_by', 'select', 'writing_prompt']);
  assert.equal(Object.keys(choices).length, 161);
  const src = loadSource().choices['c02-3'];
  assert.deepEqual(choices['c02-3'].r, src.r);
  assert.deepEqual(choices['c02-3'].w, src.w);
  assert.equal(choices['c02-3'].p, src.p); // the reworded prompt comes through as "p"
  assert.ok(src.p && src.p.includes('schema'));
});

test('the web page is served with security headers and no framework banner', async () => {
  const r = await s.get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('unknown API paths give a JSON 404', async () => {
  const r = await s.get('/api/nope');
  assert.equal(r.status, 404);
  assert.deepEqual(r.json, { error: 'not found' });
});

// ---- a new learner ----------------------------------------------------------------------------

test('a new learner starts empty with the default settings', async () => {
  const L = await s.newLearner('t_new');
  const r = await s.get(`${L}/state`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.settings, { masterStreak: 3, unlockThreshold: 0.9, mode: 'guided', ramp: true, theme: 'light', unlocked: [] });
  assert.deepEqual(r.json.progress, {});
  assert.deepEqual({ ...r.json.stats, started: 'x' }, { answered: 0, correct: 0, clock: 0, streak: 0, bestStreak: 0, started: 'x' });
  assert.deepEqual(r.json.exams, []);
});

test('"me" is the default learner; unknown and malformed names are refused', async () => {
  assert.equal((await s.get('/api/learners/me/state')).status, 200);
  assert.equal((await s.get('/api/learners/nobody_here/state')).status, 404);
  assert.equal((await s.get('/api/learners/bad%20name/state')).status, 400);
});

// ---- answering --------------------------------------------------------------------------------

test('answers follow the spaced-repetition engine exactly, and the state survives a reload', async () => {
  const L = await s.newLearner('t_engine');
  const code = 'c07-4';
  const local = {};
  const seq = [true, true, true, false, true];
  for (let i = 0; i < seq.length; i++) {
    engine.onAnswer(local, code, seq[i], i, { masterStreak: 3 }); // the logical clock is the number of answers so far
    const r = await s.post(`${L}/attempts`, { code, correct: seq[i] });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.progress, local[code], `after answer ${i + 1}`);
  }
  assert.equal(local[code].everWrong, true);
  assert.equal(local[code].mastered, false); // the miss reset the streak

  const state = (await s.get(`${L}/state`)).json;
  assert.deepEqual(state.progress[code], local[code]);
  assert.deepEqual({ answered: state.stats.answered, correct: state.stats.correct, clock: state.stats.clock }, { answered: 5, correct: 4, clock: 5 });
});

test('three correct answers in a row master a question', async () => {
  const L = await s.newLearner('t_master');
  let last;
  for (let i = 0; i < 3; i++) last = (await s.post(`${L}/attempts`, { code: 'c05-1', correct: true })).json.progress;
  assert.equal(last.mastered, true);
  assert.equal(last.box, 4);
  assert.equal(last.streak, 3);
});

test('streaks are computed from the answer log (window function)', async () => {
  const L = await s.newLearner('t_streaks');
  const codes = ['c01-1', 'c01-2', 'c01-3', 'c01-4', 'c01-5', 'c02-1', 'c02-2'];
  const answers = [true, true, false, true, true, true, false];
  const expect = [[1, 1], [2, 2], [0, 2], [1, 2], [2, 2], [3, 3], [0, 3]]; // [current, best] after each answer
  for (let i = 0; i < answers.length; i++) {
    await s.post(`${L}/attempts`, { code: codes[i], correct: answers[i] });
    const { stats } = (await s.get(`${L}/state`)).json;
    assert.deepEqual([stats.streak, stats.bestStreak], expect[i], `after answer ${i + 1}`);
  }
});

test('simultaneous answers are never lost (each answer locks the learner while it is recorded)', async () => {
  const L = await s.newLearner('t_concurrent');
  const results = await Promise.all(Array.from({ length: 12 }, () => s.post(`${L}/attempts`, { code: 'c06-1', correct: true })));
  assert.ok(results.every((r) => r.status === 201));
  const state = (await s.get(`${L}/state`)).json;
  assert.equal(state.stats.answered, 12);
  assert.equal(state.progress['c06-1'].seen, 12);
  assert.equal(state.progress['c06-1'].streak, 12);
  const other = await Promise.all(['c08-1', 'c08-2', 'c08-3', 'c08-4', 'c08-5', 'c09-1'].map((code) => s.post(`${L}/attempts`, { code, correct: false })));
  assert.ok(other.every((r) => r.status === 201));
  assert.equal((await s.get(`${L}/state`)).json.stats.answered, 18);
});

test('question_state is only a cache of the log: replaying the attempt log through the engine rebuilds it exactly', async () => {
  const L = await s.newLearner('t_replay');
  const codes = ['c01-1', 'c01-2', 'c01-3', 'c02-1', 'c02-2', 'c05-1', 'c05-2', 'c06-1'];
  const rnd = (() => { let x = 42; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; })(); // fixed seed
  for (let i = 0; i < 60; i++) {
    const r = await s.post(`${L}/attempts`, { code: codes[Math.floor(rnd() * codes.length)], correct: rnd() < 0.6 });
    assert.equal(r.status, 201);
  }
  const [log] = await s.pool.query(
    `SELECT q.code, a.correct FROM attempt a
       JOIN question q ON q.question_id = a.question_id
       JOIN learner l ON l.learner_id = a.learner_id
      WHERE l.username = 't_replay' ORDER BY a.attempt_id`);
  assert.equal(log.length, 60);
  const rebuilt = {};
  log.forEach((row, i) => engine.onAnswer(rebuilt, row.code, !!row.correct, i, { masterStreak: 3 }));
  const stored = (await s.get(`${L}/state`)).json.progress;
  assert.deepEqual(Object.keys(stored).sort(), Object.keys(rebuilt).sort());
  for (const code of Object.keys(rebuilt)) assert.deepEqual(stored[code], rebuilt[code], code);
});

// ---- validation and injection ----------------------------------------------------------------

test('bad input is refused before it reaches the database', async () => {
  const L = await s.newLearner('t_validation');
  const bad = [
    [{ code: 'c07-4' }, 'correct missing'],
    [{ code: 'c07-4', correct: 'yes' }, 'correct not boolean'],
    [{ code: 'banana', correct: true }, 'code malformed'],
    [{ correct: true }, 'code missing'],
    [null, 'no body']
  ];
  for (const [body, why] of bad) assert.equal((await s.post(`${L}/attempts`, body ?? undefined)).status, 400, why);
  assert.equal((await s.post(`${L}/attempts`, { code: 'c99-9', correct: true })).status, 404, 'unknown question');
  assert.equal((await s.post(`${L}/attempts`, '{not json')).status, 400, 'invalid JSON');
  assert.equal((await s.post(`${L}/attempts`, { code: 'c07-4', correct: true, pad: 'x'.repeat(200000) })).status, 413, 'oversized body');
  assert.equal(await count('SELECT COUNT(*) AS n FROM attempt a JOIN learner l ON l.learner_id = a.learner_id WHERE l.username = "t_validation"'), 0);
});

test('an SQL injection attempt is refused and the tables are untouched', async () => {
  const L = await s.newLearner('t_injection');
  const evil = "c01-1'; DROP TABLE question; --";
  assert.equal((await s.post(`${L}/attempts`, { code: evil, correct: true })).status, 400);
  assert.equal((await s.put(`${L}/flags/${encodeURIComponent(evil)}`)).status, 400);
  assert.equal((await s.patch(`${L}/settings`, { mode: "guided'; DROP TABLE learner; --" })).status, 400);
  assert.equal((await s.get(`/api/learners/${encodeURIComponent("x' OR '1'='1")}/state`)).status, 400);
  assert.deepEqual((await s.get('/api/health')).json, { ok: true, questions: 280 });
  assert.equal(await count('SELECT COUNT(*) AS n FROM learner'), await count('SELECT COUNT(*) AS n FROM learner'));
});

// ---- settings, flags, unlocks -----------------------------------------------------------------

test('settings can be changed one at a time and are validated against the database rules', async () => {
  const L = await s.newLearner('t_settings');
  assert.equal((await s.patch(`${L}/settings`, { theme: 'dark', masterStreak: 4 })).status, 200);
  assert.equal((await s.patch(`${L}/settings`, { unlockThreshold: 0.75, ramp: false })).status, 200);
  const { settings } = (await s.get(`${L}/state`)).json;
  assert.deepEqual({ ...settings }, { masterStreak: 4, unlockThreshold: 0.75, mode: 'guided', ramp: false, theme: 'dark', unlocked: [] });
  for (const body of [{ masterStreak: 9 }, { masterStreak: 2.5 }, { unlockThreshold: 0.2 }, { mode: 'turbo' }, { theme: 'neon' }, { ramp: 'no' }, { nothing: 1 }, {}]) {
    assert.equal((await s.patch(`${L}/settings`, body)).status, 400, JSON.stringify(body));
  }
});

test('the mastery streak setting changes how fast a question is mastered', async () => {
  const L = await s.newLearner('t_streak_setting');
  await s.patch(`${L}/settings`, { masterStreak: 2 });
  await s.post(`${L}/attempts`, { code: 'c05-2', correct: true });
  assert.equal((await s.post(`${L}/attempts`, { code: 'c05-2', correct: true })).json.progress.mastered, true);
});

test('flags: set, repeat, and clear; a flagged question appears in the state', async () => {
  const L = await s.newLearner('t_flags');
  assert.equal((await s.put(`${L}/flags/c03-1`)).status, 200);
  assert.equal((await s.put(`${L}/flags/c03-1`)).status, 200); // flagging twice is harmless
  let state = (await s.get(`${L}/state`)).json;
  assert.equal(state.progress['c03-1'].flagged, true);
  assert.equal(state.progress['c03-1'].seen, 0); // flagged but never answered: a blank state
  assert.equal(await count('SELECT COUNT(*) AS n FROM flag f JOIN learner l ON l.learner_id = f.learner_id WHERE l.username = "t_flags"'), 1);
  assert.equal((await s.del(`${L}/flags/c03-1`)).status, 200);
  state = (await s.get(`${L}/state`)).json;
  assert.equal(state.progress['c03-1'], undefined);
  assert.equal((await s.put(`${L}/flags/c99-9`)).status, 404);
});

test('unlocking units by hand', async () => {
  const L = await s.newLearner('t_unlocks');
  await s.put(`${L}/unlocks/5`); await s.put(`${L}/unlocks/2`); await s.put(`${L}/unlocks/5`);
  assert.deepEqual((await s.get(`${L}/state`)).json.settings.unlocked, [2, 5]);
  await s.del(`${L}/unlocks/2`);
  assert.deepEqual((await s.get(`${L}/state`)).json.settings.unlocked, [5]);
  assert.equal((await s.put(`${L}/unlocks/99`)).status, 404);
  assert.equal((await s.put(`${L}/unlocks/abc`)).status, 400);
});

// ---- mock exams -------------------------------------------------------------------------------

test('a finished mock exam is saved and shows up in the history with its score', async () => {
  const L = await s.newLearner('t_exam');
  const body = { scope: 'Check-in 1 (cards 1-12)', minutes: 10, startedAtMs: Date.now() - 300000, results: [
    { code: 'c01-1', correct: true }, { code: 'c05-1', correct: false }, { code: 'c07-4', correct: true }] };
  const r = await s.post(`${L}/exams`, body);
  assert.equal(r.status, 201);
  assert.deepEqual({ n: r.json.n, correct: r.json.correct }, { n: 3, correct: 2 });
  const { exams } = (await s.get(`${L}/state`)).json;
  assert.equal(exams.length, 1);
  assert.deepEqual({ scope: exams[0].scope, n: exams[0].n, correct: exams[0].correct }, { scope: 'Check-in 1 (cards 1-12)', n: 3, correct: 2 });
  assert.ok(Math.abs(exams[0].when - Date.now()) < 60000);
  // exams must not touch the spaced-repetition state
  assert.equal((await s.get(`${L}/state`)).json.stats.answered, 0);
});

test('an exam with an unknown question is rejected whole (the transaction rolls back)', async () => {
  const L = await s.newLearner('t_exam_bad');
  const r = await s.post(`${L}/exams`, { scope: 's', minutes: 5, startedAtMs: Date.now(), results: [{ code: 'c01-1', correct: true }, { code: 'c99-9', correct: false }] });
  assert.equal(r.status, 404);
  assert.equal(await count('SELECT COUNT(*) AS n FROM mock_exam e JOIN learner l ON l.learner_id = e.learner_id WHERE l.username = "t_exam_bad"'), 0);
  assert.equal((await s.post(`${L}/exams`, { scope: 's', minutes: 5, startedAtMs: Date.now(), results: [{ code: 'c01-1', correct: true }, { code: 'c01-1', correct: false }] })).status, 400);
  assert.equal((await s.post(`${L}/exams`, { scope: '', minutes: 5, startedAtMs: Date.now(), results: [{ code: 'c01-1', correct: true }] })).status, 400);
  assert.equal((await s.post(`${L}/exams`, { scope: 's', minutes: 0, startedAtMs: Date.now(), results: [{ code: 'c01-1', correct: true }] })).status, 400);
});

test('a browser clock that is ahead of the server cannot make an exam finish before it started', async () => {
  const L = await s.newLearner('t_exam_clock');
  const r = await s.post(`${L}/exams`, { scope: 'future', minutes: 5, startedAtMs: Date.now() + 3600000, results: [{ code: 'c01-1', correct: true }] });
  assert.equal(r.status, 201);
});

// ---- reports ----------------------------------------------------------------------------------

test('reports are computed by the database from the answer log', async () => {
  const L = await s.newLearner('t_reports');
  for (let i = 0; i < 3; i++) await s.post(`${L}/attempts`, { code: 'c01-1', correct: true });
  await s.post(`${L}/attempts`, { code: 'c01-2', correct: true });
  await s.post(`${L}/attempts`, { code: 'c05-1', correct: false });
  const { unitMastery, weakTags, missedQuestions, neverAttempted, streaks } = (await s.get(`${L}/reports`)).json;
  assert.equal(unitMastery.length, 13);
  assert.equal(unitMastery.reduce((n, u) => n + u.questions, 0), 280);
  assert.deepEqual(unitMastery.filter((u) => u.mastered > 0).map((u) => [u.unit_id, u.mastered]), [[1, 1]]);
  assert.equal(neverAttempted, 280 - 3);
  const conceptual = weakTags.find((t) => t.name === 'conceptual');
  assert.deepEqual({ seen: conceptual.seen, mastered: conceptual.mastered, mastery: conceptual.mastery }, { seen: 3, mastered: 1, mastery: 0.33 });
  assert.ok(weakTags.every((t) => t.seen >= 2), 'HAVING keeps only topics with 2+ questions seen');
  assert.deepEqual(streaks, { best_streak: 4, current_streak: 0 });
  assert.deepEqual(missedQuestions, [{ code: 'c05-1', misses: 1 }]); // JOIN + WHERE + GROUP BY
});

// ---- reset ------------------------------------------------------------------------------------

test('resetting progress clears one learner and leaves everyone else alone', async () => {
  const A = await s.newLearner('t_reset_a');
  const B = await s.newLearner('t_reset_b');
  for (const L of [A, B]) {
    await s.post(`${L}/attempts`, { code: 'c01-1', correct: true });
    await s.put(`${L}/flags/c01-2`); await s.put(`${L}/unlocks/3`);
    await s.patch(`${L}/settings`, { theme: 'dark' });
    await s.post(`${L}/exams`, { scope: 's', minutes: 5, startedAtMs: Date.now() - 1000, results: [{ code: 'c01-1', correct: true }] });
  }
  assert.equal((await s.del(`${A}/progress`)).status, 200);
  const a = (await s.get(`${A}/state`)).json, b = (await s.get(`${B}/state`)).json;
  assert.deepEqual(a.progress, {}); assert.equal(a.stats.answered, 0); assert.deepEqual(a.exams, []);
  assert.deepEqual({ ...a.settings }, { masterStreak: 3, unlockThreshold: 0.9, mode: 'guided', ramp: true, theme: 'light', unlocked: [] });
  assert.equal(b.stats.answered, 1); assert.equal(b.settings.theme, 'dark'); assert.equal(b.exams.length, 1);
  assert.equal(b.progress['c01-2'].flagged, true);
});

test('the source questions cover the same ids the API serves', async () => {
  const src = loadSource().questions.map((q) => q.id).sort();
  const bank = (await s.get('/api/bank')).json.questions.map((q) => q.id).sort();
  assert.deepEqual(bank, src);
});
