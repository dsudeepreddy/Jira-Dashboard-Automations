const fs = require('node:fs');
const path = require('node:path');

const fromDir = path.join(__dirname, '../../shared');
const toDir = path.join(__dirname, '../src/shared');
if (!fs.existsSync(fromDir)) process.exit(0);
fs.mkdirSync(toDir, { recursive: true });
for (const file of fs.readdirSync(fromDir).filter((name) => name.endsWith('.ts'))) {
  fs.copyFileSync(path.join(fromDir, file), path.join(toDir, file));
}
