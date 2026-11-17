// Start the web server:  npm start   (then open http://localhost:3340)
const path = require('path');
const { createPool } = require('./db');
const { createApp } = require('./app');
const store = require('./store');

async function main() {
  const pool = createPool();
  const defaultLearner = process.env.DEFAULT_LEARNER || 'wes';
  await store.ensureLearner(pool, defaultLearner);

  const app = createApp({ pool, defaultLearner, webDir: path.join(__dirname, '..', 'web') });
  const port = Number(process.env.PORT) || 3340;
  // Loopback only: this is a personal study tool, not something to expose to a network.
  const server = app.listen(port, '127.0.0.1', () => console.log(`CS 330 study tool: http://localhost:${port}`));

  const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
