// Shared test setup. Tests run against their OWN database (DB_NAME_TEST), never the real one:
// it is emptied, migrated, and filled with the question bank once per test file.
const path = require('path');
const { createMigrationConnection, createPool } = require('../server/db');
const { runMigrations } = require('../scripts/migrate');
const { importBank } = require('../scripts/import-bank');
const { createApp } = require('../server/app');

const TEST_DB = process.env.DB_NAME_TEST || 'cs330_study_test';

async function resetTestDatabase() {
  const conn = await createMigrationConnection(TEST_DB);
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    const [tables] = await conn.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()');
    for (const t of tables) await conn.query(`DROP TABLE IF EXISTS \`${t.name}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await runMigrations(conn);
    await importBank(conn);
  } finally {
    await conn.end();
  }
}

// Start the real app on a random free port and return a tiny HTTP client for it.
async function startServer(defaultLearner = 'wes_test') {
  const pool = createPool(TEST_DB);
  const store = require('../server/store');
  await store.ensureLearner(pool, defaultLearner);
  const app = createApp({ pool, defaultLearner, webDir: path.join(__dirname, '..', 'web') });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  }

  return {
    pool, store, base, call,
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b),
    put: (u, b) => call('PUT', u, b),
    patch: (u, b) => call('PATCH', u, b),
    del: (u) => call('DELETE', u),
    async newLearner(name) { await store.ensureLearner(pool, name); return `/api/learners/${name}`; },
    async close() { await new Promise((r) => server.close(r)); await pool.end(); }
  };
}

module.exports = { resetTestDatabase, startServer, TEST_DB };
