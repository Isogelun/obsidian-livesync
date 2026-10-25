import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { random } from '../src/crypto.ts';
import { DraftJournal } from '../src/drafts.ts';
import { nodeFiles } from './node-files.ts';

const identity = { vault: 'vault-a', device: 'device-a', note: 'note-a' };
test('real file journal serialises saves and rejects an incomplete newest write', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cloud-p0-'));
    try {
        const root = random(32);
        const journal = new DraftJournal(nodeFiles(directory), identity);
        await Promise.all([journal.save('first', root), journal.save('第二代 😀', root)]);
        assert.equal((await journal.recover(root))?.generation, 2);
        const bad = '000000000003-interrupted.json';
        await writeFile(join(directory, bad), '{"format":');
        const restarted = new DraftJournal(nodeFiles(directory), identity);
        assert.deepEqual(await restarted.recover(root), { text: '第二代 😀', generation: 2, rejected: 1 });
        await restarted.save('after recovery', root);
        assert.equal((await restarted.recover(root))?.generation, 4);
        for (const name of await readdir(directory)) assert(!(await readFile(join(directory, name), 'utf8')).includes('第二代'));
        await assert.rejects(new DraftJournal(nodeFiles(directory), { ...identity, device: 'other-device' }).recover(root));
    } finally { await rm(directory, { recursive: true, force: true }); }
});
test('failed write is not acknowledged and does not prevent a later save', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cloud-p0-'));
    try {
        const files = nodeFiles(directory);
        let fail = true;
        const journal = new DraftJournal({ ...files, writeNew: async (name, content) => {
            if (fail) { fail = false; throw new Error('Injected disk failure'); }
            await files.writeNew(name, content);
        } }, identity);
        const root = random(32);
        await assert.rejects(journal.save('unconfirmed', root));
        await journal.save('confirmed', root);
        assert.equal((await journal.recover(root))?.text, 'confirmed');
    } finally { await rm(directory, { recursive: true, force: true }); }
});
test('confirmed draft survives process termination and unlock in a new process', { timeout: 30000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cloud-p0-'));
    const actor = new URL('./process-actor.ts', import.meta.url);
    const writer = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(actor), 'write', directory], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
        const ready = new Promise<void>((resolve, reject) => {
            let output = '';
            writer.stdout.on('data', chunk => { output += String(chunk); if (output.includes('SAVED')) resolve(); });
            writer.on('error', reject);
            writer.on('exit', code => reject(new Error(`Writer exited early: ${code}`)));
        });
        await ready;
        const exited = once(writer, 'exit');
        writer.kill('SIGKILL');
        await exited;
        const reader = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(actor), 'read', directory], { encoding: 'utf8', timeout: 15000 });
        assert.equal(reader.status, 0, reader.stderr);
        assert.deepEqual(JSON.parse(reader.stdout), { text: '第二代 draft 😀', generation: 2, rejected: 0 });
    } finally { writer.kill('SIGKILL'); await rm(directory, { recursive: true, force: true }); }
});
