// Loads the named queries from db/queries/*.sql.
// A file is a list of blocks, each starting with a line "-- name: some_name". Everything up to the
// next such line is that query's SQL. Use it as Q.some_name; asking for a name that does not exist
// throws instead of returning undefined, so a typo fails immediately.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'db', 'queries');
const NAME_LINE = /^--\s*name:\s*([a-z_0-9]+)\s*$/;

function load() {
  const queries = {};
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
    let current = null;
    for (const line of fs.readFileSync(path.join(DIR, file), 'utf8').split(/\r?\n/)) {
      const m = NAME_LINE.exec(line);
      if (m) {
        if (queries[m[1]]) throw new Error(`query "${m[1]}" is defined twice (${file})`);
        current = queries[m[1]] = [];
      } else if (current) {
        current.push(line);
      }
    }
  }
  for (const name of Object.keys(queries)) {
    queries[name] = queries[name].join('\n').trim().replace(/;\s*$/, '');
    if (!queries[name]) throw new Error(`query "${name}" is empty`);
  }
  return queries;
}

const queries = load();
module.exports = new Proxy(queries, {
  get(target, name) {
    if (typeof name !== 'string' || name === 'then') return undefined;
    if (!(name in target)) throw new Error(`no such query: ${name}`);
    return target[name];
  }
});
