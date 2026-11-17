// The spaced-repetition engine. This is the SAME file the browser runs (web/js/engine.js), so the
// rules for boxes, streaks and mastery live in exactly one place. The server calls it to work out
// a question's new state; the database only stores the result.
const path = require('path');

globalThis.CS = globalThis.CS || {};
require(path.join(__dirname, '..', 'web', 'js', 'config.js'));
require(path.join(__dirname, '..', 'web', 'js', 'engine.js'));

module.exports = globalThis.CS.engine;
