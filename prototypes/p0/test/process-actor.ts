import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createKeyPack, unlock, type KeyPack } from '../src/crypto.ts';
import { DraftJournal } from '../src/drafts.ts';
import { nodeFiles } from './node-files.ts';

const [action, directory] = process.argv.slice(2);
const packPath = join(directory, 'keys.json');
const passphrase = 'P0 synthetic test passphrase';
if (action === 'write') {
    const created = await createKeyPack(passphrase);
    await writeFile(packPath, JSON.stringify(created.pack));
    const journal = new DraftJournal(nodeFiles(directory), { vault: created.pack.vault, device: 'device-a', note: 'note-a' });
    await journal.save('第一代 draft', created.root);
    await journal.save('第二代 draft 😀', created.root);
    created.root.fill(0);
    process.stdout.write('SAVED\n');
    // The parent terminates this process after the confirmed write, before a normal shutdown.
    setInterval(() => {}, 1000);
} else {
    const pack = JSON.parse(await readFile(packPath, 'utf8')) as KeyPack;
    const root = await unlock(pack, passphrase);
    const result = await new DraftJournal(nodeFiles(directory), { vault: pack.vault, device: 'device-a', note: 'note-a' }).recover(root);
    root.fill(0);
    process.stdout.write(JSON.stringify(result));
}
