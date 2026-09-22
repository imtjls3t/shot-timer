import { readFile, writeFile } from 'node:fs/promises';

const packagePath = new URL('../package.json', import.meta.url);
const lockPath = new URL('../package-lock.json', import.meta.url);
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const lockJson = JSON.parse(await readFile(lockPath, 'utf8'));
const match = /^(\d+)\.(\d+)\.0$/.exec(packageJson.version);

if (!match) throw new Error(`Expected an x.y.0 package version, received ${packageJson.version}.`);

const major = Number(match[1]);
const minor = Number(match[2]) + 1;
const next = `${major}.${minor}.0`;

packageJson.version = next;
lockJson.version = next;
lockJson.packages[''].version = next;
await Promise.all([
  writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`),
  writeFile(lockPath, `${JSON.stringify(lockJson, null, 2)}\n`),
]);
console.log(`Shot Timer version advanced to v${major}.${minor}.`);
