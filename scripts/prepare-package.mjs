import { copyFile, writeFile } from 'node:fs/promises';
for (const name of ['README.md', 'LICENSE']) await copyFile(new URL(`../${name}`, import.meta.url), new URL(`../npm/${name}`, import.meta.url));
// wasm-pack writes a nested .gitignore containing '*'. npm otherwise inherits it
// and silently leaves both generated WASM directories out of the published package.
for (const dir of ['pkg', 'pkg-web']) await writeFile(new URL(`../npm/${dir}/.npmignore`, import.meta.url), '');
