import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const tests = readdirSync('test').filter(file => file.endsWith('.test.ts')).map(file => `test/${file}`);
const commands = [
    ['types', ['node_modules/typescript/bin/tsc', '--noEmit']],
    ['tests', ['--test', '--experimental-strip-types', ...tests]],
    ['plugin-build', ['build.mjs']],
    ['browser', ['--experimental-strip-types', 'test/browser-runner.ts']],
    ['benchmark', ['--experimental-strip-types', 'test/benchmark.ts']],
];
const results = [];
for (const [name, args] of commands) {
    const start = performance.now();
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    results.push({ name, status: result.status, durationMs: Math.round(performance.now() - start),
        stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
    console.log(`${name}: ${result.status === 0 ? 'PASS' : 'FAIL'}`);
    if (result.status !== 0) { process.exitCode = 1; break; }
}
writeFileSync('validation-results.json', JSON.stringify({ recordedAt: new Date().toISOString(),
    runtime: process.version, platform: process.platform, arch: process.arch, results,
    pending: ['Real Obsidian host', 'Android/iOS hardware', 'Native IME', 'Mobile file and network APIs',
        'Protocol v0 and metadata privacy ADR', 'Production key-pack crash safety', 'Durable attachment spool and resume'] }, null, 2) + '\n');
