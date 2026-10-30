import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createSample } from '../demo/input.js';
const { chromium } = createRequire(new URL('../npm/package.json', import.meta.url))('playwright');
const prefix = '/prpr-auto-offset-wasm/';
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!path.startsWith(prefix) || path.includes('..')) { res.writeHead(404).end(); return; }
    const file = path.slice(prefix.length) || 'index.html';
    const body = await readFile(new URL(`../site/${file}`, import.meta.url));
    const mime = file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200, { 'Content-Type': mime }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}${prefix}`);
  await page.waitForFunction(() => !document.querySelector('#run').disabled);
  async function run(expected) {
    await page.locator('#run').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent === '估计完成。');
    const value = parseFloat(await page.locator('#correction').textContent());
    assert(Math.abs(value - expected) < 20, `correction ${value}, expected ${expected}`);
  }
  await run(123);
  await page.locator('#center').fill('50');
  await run(73);
  await page.locator('#notes').fill('[null]');
  await page.locator('#run').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('每个音符需要'));
  assert(await page.locator('#result').isHidden());
  await page.locator('#sample').click();
  // Exercise actual Web Audio decoding and stereo downmix via the upload control.
  const { pcm, sampleRate } = createSample();
  const wav = Buffer.alloc(44 + pcm.length * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < pcm.length; i++) for (let c = 0; c < 2; c++) wav.writeInt16LE(Math.round(pcm[i] * 32767), 44 + i * 4 + c * 2);
  await page.locator('#audio').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: wav });
  await run(123);
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: repository subpath, Worker/WASM, sample, search center, invalid JSON, stereo audio upload, mobile width.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
