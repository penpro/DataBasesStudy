// Forward-only schema migrations.
//   node scripts/migrate.js up       apply every pending migration in order
//   node scripts/migrate.js status   show which migrations are applied or pending
// Each migration is a .sql file in db/migrations, named NNN_description.sql. Applied files are
// recorded in schema_migrations with a checksum, so editing one after it was applied is caught.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createMigrationConnection } = require('../server/db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

function listMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      return { version: file.replace(/\.sql$/, ''), file, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
    });
}

async function ensureLedger(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    VARCHAR(100) NOT NULL,
      checksum   CHAR(64)     NOT NULL,
      applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (version)
    ) ENGINE=InnoDB`);
}

async function appliedMap(conn) {
  const [rows] = await conn.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
  return new Map(rows.map((r) => [r.version, r.checksum]));
}

// Apply pending migrations on an open connection. Returns the list of versions applied.
async function runMigrations(conn, log = () => {}) {
  await ensureLedger(conn);
  const applied = await appliedMap(conn);
  const done = [];
  for (const m of listMigrations()) {
    if (applied.has(m.version)) {
      if (applied.get(m.version) !== m.checksum) {
        throw new Error(`Migration ${m.version} was edited after it was applied. Add a new migration instead.`);
      }
      continue;
    }
    log(`applying ${m.version}`);
    await conn.query(m.sql); // MySQL commits DDL as it goes, so a failure here needs a manual fix
    await conn.query('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [m.version, m.checksum]);
    done.push(m.version);
  }
  return done;
}

async function status(conn) {
  await ensureLedger(conn);
  const applied = await appliedMap(conn);
  return listMigrations().map((m) => ({
    version: m.version,
    state: !applied.has(m.version) ? 'pending' : applied.get(m.version) === m.checksum ? 'applied' : 'EDITED'
  }));
}

async function main() {
  const command = process.argv[2] || 'status';
  const conn = await createMigrationConnection();
  try {
    if (command === 'up') {
      const done = await runMigrations(conn, (m) => console.log('  ' + m));
      console.log(done.length ? `applied ${done.length} migration(s)` : 'nothing to apply, schema is up to date');
    } else if (command === 'status') {
      for (const s of await status(conn)) console.log(s.state.padEnd(8) + s.version);
    } else {
      console.error('usage: node scripts/migrate.js [up|status]');
      process.exitCode = 1;
    }
  } finally {
    await conn.end();
  }
}

module.exports = { runMigrations, status, listMigrations };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
