// Download the instructor's published question files into data/yaml.
//   node scripts/fetch-bank.js        then:  npm run import
// Only needed if the course's questions change. This is the one place the project talks to the
// outside world, and it only reads public files from the course website.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const BASE = 'https://srfoster.github.io/oc-classes/cs330/questions/';
const DIR = path.join(__dirname, '..', 'data', 'yaml');

async function get(name) {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const indexText = await get('index.yml');
  const files = yaml.load(indexText).files;
  if (!Array.isArray(files) || !files.length || files.some((f) => !/^[\w.-]+\.yml$/.test(f))) {
    throw new Error('index.yml did not list the question files in the expected form');
  }
  fs.writeFileSync(path.join(DIR, 'index.yml'), indexText);
  for (const f of files) {
    fs.writeFileSync(path.join(DIR, f), await get(f));
    console.log('downloaded ' + f);
  }
  console.log('done. Now run: npm run import');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
