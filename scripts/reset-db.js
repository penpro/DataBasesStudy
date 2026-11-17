// Drop every table in the project database, then migrate and re-import the bank from scratch.
//   node scripts/reset-db.js --yes
// This deletes all learner data (answers, flags, exams). It exists for development: after editing a
// migration that has not been shared with anyone, or to get a clean slate.
const { createMigrationConnection, settings } = require('../server/db');
const { runMigrations } = require('./migrate');
const { importBank } = require('./import-bank');
const store = require('../server/store');
const { createPool } = require('../server/db');

async function main() {
  if (!process.argv.includes('--yes')) {
    console.error(`This will DELETE every table in database "${settings().database}". Run again with --yes to confirm.`);
    process.exit(1);
  }
  const conn = await createMigrationConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    const [tables] = await conn.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()');
    for (const t of tables) await conn.query(`DROP TABLE IF EXISTS \`${t.name}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log(`dropped ${tables.length} table(s)`);
    for (const m of await runMigrations(conn)) console.log('  applied ' + m);
    const s = await importBank(conn);
    console.log('imported:', Object.entries(s).map(([k, v]) => `${v} ${k}`).join(', '));
  } finally {
    await conn.end();
  }
  const pool = createPool();
  await store.ensureLearner(pool, process.env.DEFAULT_LEARNER || 'wes');
  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
