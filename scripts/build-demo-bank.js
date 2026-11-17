// Write web/demo/bank.json: the question bank exactly as GET /api/bank returns it, read from the real
// database. The GitHub Pages demo (web/js/demo.js) has no server, so it loads this snapshot instead.
//   npm run build:demo        (run after the database is migrated and imported; commit the result)
const fs = require('fs');
const path = require('path');
const { createPool, settings } = require('../server/db');
const store = require('../server/store');

async function main() {
  const pool = createPool();
  try {
    const bank = await store.getBank(pool);
    const out = path.join(__dirname, '..', 'web', 'demo', 'bank.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(bank));
    console.log(`wrote ${path.relative(process.cwd(), out)} from "${settings().database}": ${bank.units.length} units, ${bank.questions.length} questions, ${Object.keys(bank.choices).length} choice sets`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
