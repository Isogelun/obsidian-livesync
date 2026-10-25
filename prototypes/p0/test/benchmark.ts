import { performance } from 'node:perf_hooks';
import { createKeyPack, random, unlock } from '../src/crypto.ts';
import { decryptParts, encryptParts, PART_BYTES } from '../src/stream.ts';

const start = performance.now();
const made = await createKeyPack('synthetic benchmark passphrase');
const createMs = performance.now() - start;
const beforeUnlock = performance.now();
(await unlock(made.pack, 'synthetic benchmark passphrase')).fill(0);
const unlockMs = performance.now() - beforeUnlock;
const results = [];
for (const megabytes of [8, 128]) {
    const key = random(32);
    const block = new Uint8Array(PART_BYTES).fill(0x5a);
    const totalParts = megabytes * 1024 * 1024 / PART_BYTES;
    async function* input() { for (let i = 0; i < totalParts; i++) yield block; }
    let peakRss = process.memoryUsage().rss;
    const baselineRss = peakRss;
    let decoded = 0;
    const time = performance.now();
    for await (const part of decryptParts(encryptParts(input(), key, 'benchmark-object'), key, 'benchmark-object')) {
        if (part[0] !== 0x5a || part[part.length - 1] !== 0x5a) throw new Error('Benchmark content mismatch.');
        decoded += part.length;
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }
    if (decoded !== megabytes * 1024 * 1024) throw new Error('Benchmark length mismatch.');
    results.push({ megabytes, partBytes: PART_BYTES, elapsedMs: Math.round(performance.now() - time),
        baselineRssMiB: Math.round(baselineRss / 1048576), sampledPeakRssMiB: Math.round(peakRss / 1048576),
        peakIncreaseMiB: Math.round((peakRss - baselineRss) / 1048576) });
    key.fill(0);
}
made.root.fill(0);
console.log(JSON.stringify({ runtime: process.version, platform: process.platform, arch: process.arch,
    createMs: Math.round(createMs), unlockMs: Math.round(unlockMs), results,
    limitation: 'Sequential in-process pipeline; excludes network, host file APIs, power loss and mobile devices. RSS sampling is not a memory bound.' }, null, 2));
