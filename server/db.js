// Database connection settings and pool factory, shared by the API, the scripts, and the tests.
const path = require('path');
const mysql = require('mysql2/promise');

// Load .env (never overrides variables already set in the real environment).
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

function settings(database) {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (!DB_USER || !DB_PASSWORD) {
    throw new Error('DB_USER and DB_PASSWORD are not set. Copy .env.example to .env and fill it in.');
  }
  return {
    host: DB_HOST || '127.0.0.1',
    port: Number(DB_PORT) || 3306,
    user: DB_USER,
    password: DB_PASSWORD,
    database: database || DB_NAME || 'cs330_study',
    charset: 'utf8mb4'
  };
}

// A pool for the API: parameterized queries only, a handful of connections.
function createPool(database) {
  return mysql.createPool({
    ...settings(database),
    waitForConnections: true,
    connectionLimit: 8,
    decimalNumbers: true // DECIMAL columns come back as numbers, not strings
  });
}

// A single connection that may run several statements at once (migrations only).
function createMigrationConnection(database) {
  return mysql.createConnection({ ...settings(database), multipleStatements: true });
}

module.exports = { createPool, createMigrationConnection, settings };
