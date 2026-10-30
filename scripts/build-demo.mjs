import { cp, mkdir, writeFile } from 'node:fs/promises';
await mkdir('site', { recursive: true });
await cp('demo', 'site', { recursive: true });
await cp('npm/pkg-web', 'site/wasm', { recursive: true });
await writeFile('site/.nojekyll', '');
console.log('Demo built in site/ (serve over HTTP, not file://).');
