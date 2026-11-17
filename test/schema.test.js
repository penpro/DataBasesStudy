// The schema itself: structure, constraints, and that the database really enforces them.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetTestDatabase, TEST_DB } = require('./helpers');
const { createPool } = require('../server/db');
const { status } = require('../scripts/migrate');
const { createMigrationConnection } = require('../server/db');

let db;
before(async () => {
  await resetTestDatabase();
  db = createPool(TEST_DB);
});
after(async () => { await db.end(); });

const rows = async (sql, params) => (await db.query(sql, params))[0];

test('every table has a primary key', async () => {
  const tables = (await rows("SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE()")).map((r) => r.n);
  const withPk = (await rows("SELECT table_name AS n FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND constraint_type = 'PRIMARY KEY'")).map((r) => r.n);
  assert.deepEqual(tables.filter((t) => !withPk.includes(t)), []);
  assert.equal(tables.length, 15); // 14 domain tables + schema_migrations
});

test('all 17 foreign keys exist (MySQL silently ignores inline REFERENCES, so check)', async () => {
  const fks = (await rows("SELECT constraint_name AS c FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND constraint_type = 'FOREIGN KEY'")).map((r) => r.c).sort();
  assert.deepEqual(fks, [
    'fk_attempt_learner', 'fk_attempt_question', 'fk_card_unit', 'fk_exam_learner', 'fk_flag_learner', 'fk_flag_question',
    'fk_meq_exam', 'fk_meq_question', 'fk_option_question', 'fk_qt_question', 'fk_qt_tag', 'fk_question_card',
    'fk_state_learner', 'fk_state_question', 'fk_tag_group', 'fk_unlock_learner', 'fk_unlock_unit'
  ]);
});

test('every migration is applied and none was edited afterwards', async () => {
  const conn = await createMigrationConnection(TEST_DB);
  try {
    const s = await status(conn);
    assert.equal(s.length, 7);
    assert.ok(s.every((m) => m.state === 'applied'), JSON.stringify(s));
  } finally { await conn.end(); }
});

async function rejects(sql, params, code) {
  await assert.rejects(() => db.query(sql, params), (e) => { assert.equal(e.code, code, `${sql} -> ${e.code}`); return true; });
}

test('foreign keys reject rows that point at nothing', async () => {
  await rejects('INSERT INTO card (card_no, title, unit_id) VALUES (200, "x", 99)', [], 'ER_NO_REFERENCED_ROW_2');
  await rejects('INSERT INTO question (code, card_no, origin, prompt, answer) VALUES ("c99-1", 200, "direct", "p", "a")', [], 'ER_NO_REFERENCED_ROW_2');
  await rejects('INSERT INTO attempt (learner_id, question_id, correct) VALUES (999999, 1, 1)', [], 'ER_NO_REFERENCED_ROW_2');
  await rejects('INSERT INTO question_tag (question_id, tag_id) VALUES (999999, 1)', [], 'ER_NO_REFERENCED_ROW_2');
});

test('unique constraints reject duplicates', async () => {
  const [{ code }] = await rows('SELECT code FROM question LIMIT 1');
  await rejects('INSERT INTO question (code, card_no, origin, prompt, answer) VALUES (?, 1, "direct", "p", "a")', [code], 'ER_DUP_ENTRY');
  await rejects('INSERT INTO tag_group (name) VALUES ("Concepts")', [], 'ER_DUP_ENTRY');
  const [{ question_id }] = await rows('SELECT question_id FROM choice_option LIMIT 1');
  const [{ text }] = await rows('SELECT text FROM choice_option WHERE question_id = ? LIMIT 1', [question_id]);
  await rejects('INSERT INTO choice_option (question_id, text, is_correct) VALUES (?, ?, 0)', [question_id, text], 'ER_DUP_ENTRY');
});

test('CHECK constraints reject impossible values', async () => {
  await db.query('INSERT INTO learner (username) VALUES ("schema_check")');
  const [{ learner_id }] = await rows('SELECT learner_id FROM learner WHERE username = "schema_check"');
  const [{ question_id }] = await rows('SELECT question_id FROM question LIMIT 1');
  await rejects('INSERT INTO learner (username, master_streak) VALUES ("x1", 9)', [], 'ER_CHECK_CONSTRAINT_VIOLATED');
  await rejects('INSERT INTO learner (username, unlock_threshold) VALUES ("x2", 0.10)', [], 'ER_CHECK_CONSTRAINT_VIOLATED');
  await rejects('INSERT INTO question_state (learner_id, question_id, box) VALUES (?, ?, 7)', [learner_id, question_id], 'ER_CHECK_CONSTRAINT_VIOLATED');
  await rejects('INSERT INTO mock_exam (learner_id, scope_label, minutes) VALUES (?, "s", 0)', [learner_id], 'ER_CHECK_CONSTRAINT_VIOLATED');
  await rejects('INSERT INTO mock_exam (learner_id, scope_label, minutes, started_at, finished_at) VALUES (?, "s", 5, "2026-01-02", "2026-01-01")', [learner_id], 'ER_CHECK_CONSTRAINT_VIOLATED');
});

test('NOT NULL and defaults: a new learner gets the documented defaults', async () => {
  await db.query('INSERT INTO learner (username) VALUES ("defaults_check")');
  const [l] = await rows('SELECT mode, ramp, master_streak, unlock_threshold, theme FROM learner WHERE username = "defaults_check"');
  assert.deepEqual({ ...l }, { mode: 'guided', ramp: 1, master_streak: 3, unlock_threshold: 0.9, theme: 'light' });
  await rejects('INSERT INTO question (code, card_no, origin, prompt, answer) VALUES (NULL, 1, "direct", "p", "a")', [], 'ER_BAD_NULL_ERROR');
});

test('deleting a learner removes their attempts, states, flags and exams (ON DELETE CASCADE)', async () => {
  await db.query('INSERT INTO learner (username) VALUES ("cascade_check")');
  const [{ learner_id }] = await rows('SELECT learner_id FROM learner WHERE username = "cascade_check"');
  const [{ question_id }] = await rows('SELECT question_id FROM question LIMIT 1');
  await db.query('INSERT INTO attempt (learner_id, question_id, correct) VALUES (?, ?, 1)', [learner_id, question_id]);
  await db.query('INSERT INTO question_state (learner_id, question_id) VALUES (?, ?)', [learner_id, question_id]);
  await db.query('INSERT INTO flag (learner_id, question_id) VALUES (?, ?)', [learner_id, question_id]);
  await db.query('INSERT INTO mock_exam (learner_id, scope_label, minutes) VALUES (?, "s", 5)', [learner_id]);
  await db.query('DELETE FROM learner WHERE learner_id = ?', [learner_id]);
  for (const t of ['attempt', 'question_state', 'flag', 'mock_exam']) {
    const [{ n }] = await rows(`SELECT COUNT(*) AS n FROM ${t} WHERE learner_id = ?`, [learner_id]);
    assert.equal(n, 0, t);
  }
});

test('a question that has attempts cannot be deleted (no ON DELETE CASCADE there, on purpose)', async () => {
  await db.query('INSERT INTO learner (username) VALUES ("restrict_check")');
  const [{ learner_id }] = await rows('SELECT learner_id FROM learner WHERE username = "restrict_check"');
  const [{ question_id }] = await rows('SELECT question_id FROM question LIMIT 1');
  await db.query('INSERT INTO attempt (learner_id, question_id, correct) VALUES (?, ?, 1)', [learner_id, question_id]);
  await rejects('DELETE FROM question WHERE question_id = ?', [question_id], 'ER_ROW_IS_REFERENCED_2');
});
