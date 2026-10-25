import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('dist', { recursive: true });
const result = await build({ entryPoints: ['src/main.ts'], outfile: 'dist/main.js', bundle: true,
    tsconfig: 'tsconfig.json',
    format: 'cjs', platform: 'browser', target: ['es2020'], external: ['obsidian'], metafile: true,
    // Libsodium selects its browser path when process is unavailable; Node built-ins must never be loaded here.
    define: { 'process.versions.node': 'undefined' },
});
const forbidden = /livesync-commonlib|pouchdb|(?:^|\/)idb\/|src\/LiveSyncBaseCore|src\/apps\//;
const inputs = Object.keys(result.metafile.inputs);
assert(!inputs.some(input => forbidden.test(input)), 'Old synchronisation dependency entered the P0 bundle.');
for (const output of Object.values(result.metafile.outputs)) {
    assert(output.imports.every(item => item.path === 'obsidian'), 'Unexpected runtime dependency.');
}
await copyFile('manifest.json', 'dist/manifest.json');
await writeFile('dist/metafile.json', JSON.stringify(result.metafile, null, 2));
console.log(JSON.stringify({ inputs: inputs.length, bytes: result.metafile.outputs['dist/main.js'].bytes,
    forbiddenInputs: inputs.filter(input => forbidden.test(input)), external: 'obsidian', installation: 'manual disposable vault only' }, null, 2));
