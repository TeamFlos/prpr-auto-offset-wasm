import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// prepack already built every target. Inspect the actual npm tarball manifest.
const npmCli = process.env.npm_execpath;
assert(npmCli, 'Run via npm run check:package');
const [pack] = JSON.parse(execFileSync(process.execPath,
  [npmCli, 'pack', '--dry-run', '--ignore-scripts', '--json'], { encoding: 'utf8' }));
const files = new Set(pack.files.map(file => file.path));
for (const file of ['README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts',
  ...['pkg', 'pkg-web'].flatMap(dir => ['prpr_auto_offset_wasm.js', 'prpr_auto_offset_wasm.d.ts', 'prpr_auto_offset_wasm_bg.wasm'].map(file => `${dir}/${file}`)),
  'pkg/prpr_auto_offset_wasm_bg.js']) assert(files.has(file), `Missing published file: ${file}`);
for (const file of files) assert(!/node_modules|\.tgz$/.test(file), `Unexpected file: ${file}`);
for (const dir of ['pkg', 'pkg-web']) {
  const bytes = readFileSync(resolve(dir, 'prpr_auto_offset_wasm_bg.wasm'));
  assert.equal(bytes.subarray(0, 4).toString('hex'), '0061736d', `${dir}: valid WASM magic`);
}
console.log(`Package contents verified: ${pack.files.length} files, ${pack.size} bytes packed.`);
