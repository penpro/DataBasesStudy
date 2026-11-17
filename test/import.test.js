// The importer: the database holds exactly what the source files contain, and importing twice changes nothing.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetTestDatabase, TEST_DB } = require('./helpers');
const { createPool, createMigrationConnection } = require('../server/db');
const { importBank, loadSource } = require('../scripts/import-bank');

let db;
before(async () => { await resetTestDatabase(); db = createPool(TEST_DB); });
after(async () => { await db.end(); });

const count = async (t) => (await db.query(`SELECT COUNT(*) AS n FROM ${t}`))[0][0].n;

test('row counts match the source files', async () => {
  const src = loadSource();
  assert.equal(await count('unit'), 13);
  assert.equal(await count('card'), 52);
  assert.equal(await count('question'), src.questions.length);
  assert.equal(await count('question_tag'), src.questions.reduce((n, q) => n + (q.tags || []).length, 0));
  assert.equal(await count('choice_option'), Object.values(src.choices).reduce((n, c) => n + c.r.length + c.w.length, 0));
  assert.equal(await count('tag_group'), 4);
});

test('importing again changes nothing (idempotent)', async () => {
  const before = { q: await count('question'), o: await count('choice_option'), t: await count('tag'), qt: await count('question_tag') };
  const conn = await createMigrationConnection(TEST_DB);
  try { await importBank(conn); await importBank(conn); } finally { await conn.end(); }
  assert.deepEqual({ q: await count('question'), o: await count('choice_option'), t: await count('tag'), qt: await count('question_tag') }, before);
});

test('every card belongs to exactly one unit and the units tile the 52 cards', async () => {
  const [units] = await db.query('SELECT u.unit_id, MIN(c.card_no) AS lo, MAX(c.card_no) AS hi, COUNT(*) AS n FROM unit u JOIN card c ON c.unit_id = u.unit_id GROUP BY u.unit_id ORDER BY u.unit_id');
  assert.equal(units.length, 13);
  assert.ok(units.every((u, i) => u.hi - u.lo + 1 === u.n && (i === 0 || u.lo === units[i - 1].hi + 1)));
  assert.equal(units[0].lo, 1);
  assert.equal(units[12].hi, 52);
});

test('a question\'s format is derived from its options: 119 typed, 149 multiple choice, 12 select-all', async () => {
  const [r] = await db.query(`
    SELECT SUM(opts = 0) AS typed, SUM(opts > 0 AND rights = 1) AS mc, SUM(rights >= 2) AS multi
      FROM (SELECT q.question_id, COUNT(o.option_id) AS opts, COALESCE(SUM(o.is_correct), 0) AS rights
              FROM question q LEFT JOIN choice_option o ON o.question_id = q.question_id
             GROUP BY q.question_id) x`);
  assert.deepEqual({ typed: Number(r[0].typed), mc: Number(r[0].mc), multi: Number(r[0].multi) }, { typed: 119, mc: 149, multi: 12 });
});

test('every choice question has at least one correct and one wrong option', async () => {
  const [bad] = await db.query(`
    SELECT q.code FROM question q JOIN choice_option o ON o.question_id = q.question_id
     GROUP BY q.question_id, q.code HAVING SUM(o.is_correct) = 0 OR SUM(o.is_correct) = COUNT(*)`);
  assert.deepEqual(bad, []);
});

test('every question has exactly one "Question type" tag', async () => {
  const [bad] = await db.query(`
    SELECT q.code, COUNT(*) AS n FROM question q
      JOIN question_tag qt ON qt.question_id = q.question_id
      JOIN tag t ON t.tag_id = qt.tag_id
      JOIN tag_group g ON g.tag_group_id = t.tag_group_id
     WHERE g.name = 'Question type' GROUP BY q.question_id, q.code HAVING COUNT(*) <> 1`);
  assert.deepEqual(bad, []);
});

test('the reworded prompts were stored on exactly the questions that had one', async () => {
  const src = loadSource();
  const expected = Object.entries(src.choices).filter(([, c]) => c.p).map(([id]) => id).sort();
  const [rows] = await db.query('SELECT code FROM question WHERE prompt_override IS NOT NULL ORDER BY code');
  assert.deepEqual(rows.map((r) => r.code), expected);
});

test('bad source data is rejected before anything is written', async () => {
  const src = loadSource();
  // simulate a typo: a choices entry for a question that does not exist
  const originalReadFile = require('fs').readFileSync;
  const fs = require('fs');
  fs.readFileSync = function (p, ...rest) {
    const text = originalReadFile.call(this, p, ...rest);
    if (String(p).endsWith('choices.json')) { const j = JSON.parse(text); j['c99-9'] = { r: ['a'], w: ['b', 'c', 'd'] }; return JSON.stringify(j); }
    return text;
  };
  const conn = await createMigrationConnection(TEST_DB);
  const countBefore = await count('question');
  try {
    await assert.rejects(() => importBank(conn), /unknown question c99-9/);
  } finally {
    fs.readFileSync = originalReadFile;
    await conn.end();
  }
  assert.equal(await count('question'), countBefore);
  assert.ok(src.questions.length > 0);
});
