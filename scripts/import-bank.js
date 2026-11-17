// Load the course's question bank into the database.
//   node scripts/import-bank.js
// Reads data/units.json, data/yaml/*.yml (the instructor's published questions) and data/choices.json
// (the hand-written multiple-choice options), and upserts them, so running it twice changes nothing.
// Everything happens in one transaction: either the whole bank loads or none of it does.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { createMigrationConnection } = require('../server/db');

const DATA = path.join(__dirname, '..', 'data');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

function loadSource() {
  const index = yaml.load(fs.readFileSync(path.join(DATA, 'yaml', 'index.yml'), 'utf8'));
  const questions = [];
  for (const file of index.files) {
    const doc = yaml.load(fs.readFileSync(path.join(DATA, 'yaml', file), 'utf8'));
    for (const q of doc.questions || []) questions.push(q);
  }
  return { index, questions, units: readJson('units.json'), choices: readJson('choices.json') };
}

// Check the source data before touching the database, so a typo fails loudly and early.
function validate({ index, questions, units, choices }) {
  const problems = [];
  const groupOfTag = new Map();
  for (const g of index.tag_groups) for (const t of g.tags) groupOfTag.set(String(t), g.name);
  const codes = new Set();
  const cardTitles = new Map();
  for (const q of questions) {
    if (codes.has(q.id)) problems.push(`duplicate question id ${q.id}`);
    codes.add(q.id);
    if (!units.some((u) => q.card >= u.first_card && q.card <= u.last_card)) problems.push(`${q.id}: card ${q.card} is in no unit`);
    for (const t of (q.tags || []).map(String)) if (!groupOfTag.has(t)) problems.push(`${q.id}: tag "${t}" is in no tag group`);
    const seen = cardTitles.get(q.card);
    if (seen && seen !== q.source_card) problems.push(`card ${q.card} has two titles: "${seen}" and "${q.source_card}"`);
    cardTitles.set(q.card, q.source_card);
  }
  for (const id of Object.keys(choices)) if (!codes.has(id)) problems.push(`choices.json mentions unknown question ${id}`);
  if (problems.length) throw new Error('source data problems:\n  ' + problems.join('\n  '));
  return { groupOfTag, cardTitles };
}

async function importBank(conn, log = () => {}) {
  const src = loadSource();
  const { groupOfTag, cardTitles } = validate(src);

  await conn.beginTransaction();
  try {
    for (const u of src.units) {
      await conn.execute(
        'INSERT INTO unit (unit_id, title, blurb) VALUES (?, ?, ?) AS new ON DUPLICATE KEY UPDATE title = new.title, blurb = new.blurb',
        [u.unit_id, u.title, u.blurb]
      );
    }
    for (const [cardNo, title] of cardTitles) {
      const unit = src.units.find((u) => cardNo >= u.first_card && cardNo <= u.last_card);
      await conn.execute(
        'INSERT INTO card (card_no, title, unit_id) VALUES (?, ?, ?) AS new ON DUPLICATE KEY UPDATE title = new.title, unit_id = new.unit_id',
        [cardNo, title, unit.unit_id]
      );
    }
    for (const g of src.index.tag_groups) {
      await conn.execute('INSERT INTO tag_group (name) VALUES (?) ON DUPLICATE KEY UPDATE name = name', [g.name]);
    }
    const [groups] = await conn.query('SELECT tag_group_id, name FROM tag_group');
    const groupId = new Map(groups.map((g) => [g.name, g.tag_group_id]));
    const tagNames = [...new Set(src.questions.flatMap((q) => (q.tags || []).map(String)))].sort();
    for (const name of tagNames) {
      await conn.execute(
        'INSERT INTO tag (name, tag_group_id) VALUES (?, ?) AS new ON DUPLICATE KEY UPDATE tag_group_id = new.tag_group_id',
        [name, groupId.get(groupOfTag.get(name))]
      );
    }
    const [tags] = await conn.query('SELECT tag_id, name FROM tag');
    const tagId = new Map(tags.map((t) => [t.name, t.tag_id]));

    let options = 0;
    for (const q of src.questions) {
      const c = src.choices[q.id];
      await conn.execute(
        `INSERT INTO question (code, card_no, origin, prompt, prompt_override, answer) VALUES (?, ?, ?, ?, ?, ?) AS new
         ON DUPLICATE KEY UPDATE card_no = new.card_no, origin = new.origin, prompt = new.prompt,
                                 prompt_override = new.prompt_override, answer = new.answer`,
        [q.id, q.card, q.origin || 'direct', String(q.prompt).trim(), c && c.p ? c.p : null, String(q.answer).trim()]
      );
      const [[{ question_id }]] = await conn.query('SELECT question_id FROM question WHERE code = ?', [q.id]);
      for (const t of (q.tags || []).map(String)) {
        await conn.execute(
          'INSERT INTO question_tag (question_id, tag_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE question_id = question_id',
          [question_id, tagId.get(t)]
        );
      }
      // options are replaced as a set, so edits to the authored choices take effect on re-import
      await conn.execute('DELETE FROM choice_option WHERE question_id = ?', [question_id]);
      if (c) {
        for (const text of c.r) { await conn.execute('INSERT INTO choice_option (question_id, text, is_correct) VALUES (?, ?, TRUE)', [question_id, text]); options++; }
        for (const text of c.w) { await conn.execute('INSERT INTO choice_option (question_id, text, is_correct) VALUES (?, ?, FALSE)', [question_id, text]); options++; }
      }
    }
    await conn.commit();
    const summary = { units: src.units.length, cards: cardTitles.size, tag_groups: src.index.tag_groups.length, tags: tagNames.length, questions: src.questions.length, options };
    log(JSON.stringify(summary));
    return summary;
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}

module.exports = { importBank, loadSource };

if (require.main === module) {
  (async () => {
    const conn = await createMigrationConnection();
    try {
      const s = await importBank(conn);
      console.log('imported:', Object.entries(s).map(([k, v]) => `${v} ${k}`).join(', '));
    } finally {
      await conn.end();
    }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
