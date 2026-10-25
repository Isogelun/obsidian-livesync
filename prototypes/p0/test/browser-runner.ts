import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { argon2id } from 'hash-wasm';
import { createKeyPack, KDF, openDraft, sealDraft, unlock } from '../src/crypto.ts';
import type * as Harness from './browser-entry.ts';

declare global { interface Window { p0: typeof Harness; } }
const executablePath = process.env.P0_BROWSER_PATH ?? [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!executablePath) throw new Error('Set P0_BROWSER_PATH to a local Chromium browser executable.');
const built = await build({ entryPoints: ['test/browser-entry.ts'], bundle: true, write: false,
    tsconfig: 'tsconfig.json', format: 'iife', globalName: 'p0', platform: 'browser', target: 'es2020',
    define: { 'process.versions.node': 'undefined' }, metafile: true });
assert(!Object.keys(built.metafile!.inputs).some(input => /livesync-commonlib|pouchdb|(?:^|\/)idb\//.test(input)));
const script = built.outputFiles[0].text;
const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/harness.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/harness.js' ? script : '<!doctype html><html><body><script src="/harness.js"></script></body></html>');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No test server port.');
let browser;
try {
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.waitForFunction(() => typeof window.p0?.run === 'function');
    const made = await createKeyPack('synthetic cross-runtime passphrase');
    const record = await sealDraft('Node → 浏览器 😀', made.root, { vault: made.pack.vault, device: 'node', note: 'cross', generation: 1 });
    made.root.fill(0);
    const namespace = `p0-${crypto.randomUUID()}`;
    const result = await page.evaluate(async input => window.p0.run(input), { pack: made.pack, record, namespace });
    const root = await unlock(result.pack, 'synthetic cross-runtime passphrase');
    assert.equal(await openDraft(result.record, root, result.record.context), '浏览器 → Node 😀');
    root.fill(0);
    const vector = await argon2id({ password: 'P0 中文 password', salt: new Uint8Array(16).fill(2), memorySize: KDF.memoryKiB,
        iterations: KDF.iterations, parallelism: 1, hashLength: 32, outputType: 'hex' });
    assert.equal(result.vector, vector);
    await page.reload();
    await page.waitForFunction(() => typeof window.p0?.recover === 'function');
    const recovered = await page.evaluate(async input => window.p0.recover(input.pack, input.namespace), { pack: result.pack, namespace });
    console.log(JSON.stringify({ browser: browser.version(), crossRuntime: 'Node ↔ Chromium passed',
        argon2Vector: vector, browserCreateMs: result.creationMs, reloadedFileRecovery: recovered,
        secretstream: 'passed', limitation: 'OPFS harness only; does not run Obsidian or prove mobile compatibility.' }, null, 2));
} finally {
    await browser?.close();
    server.close();
}
