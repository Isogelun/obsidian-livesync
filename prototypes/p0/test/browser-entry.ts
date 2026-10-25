import { argon2id } from 'hash-wasm';
import { createKeyPack, KDF, openDraft, random, sealDraft, unlock, type DraftRecord, type KeyPack } from '../src/crypto.ts';
import { DraftJournal, type DraftFiles } from '../src/drafts.ts';
import { decryptParts, encryptParts } from '../src/stream.ts';

async function files(namespace: string): Promise<DraftFiles> {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(namespace, { create: true });
    return {
        list: async () => {
            const names: string[] = [];
            // OPFS iteration is available in the test browser, independently of the Obsidian adapter.
            for await (const name of (directory as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> }).keys()) names.push(name);
            return names;
        },
        read: async name => (await (await directory.getFileHandle(name)).getFile()).text(),
        writeNew: async (name, text) => {
            const file = await directory.getFileHandle(name, { create: true });
            const writable = await file.createWritable();
            await writable.write(text);
            await writable.close();
        },
    };
}
const password = 'synthetic cross-runtime passphrase';
export async function run(input: { pack: KeyPack; record: DraftRecord; namespace: string }) {
    const root = await unlock(input.pack, password);
    const text = await openDraft(input.record, root, input.record.context);
    root.fill(0);
    if (text !== 'Node → 浏览器 😀') throw new Error('Cross-runtime draft mismatch.');
    const vector = await argon2id({ password: 'P0 中文 password', salt: new Uint8Array(16).fill(2),
        memorySize: KDF.memoryKiB, iterations: KDF.iterations, parallelism: 1, hashLength: 32, outputType: 'hex' });
    const started = performance.now();
    const made = await createKeyPack(password);
    const creationMs = performance.now() - started;
    const journal = new DraftJournal(await files(input.namespace), { vault: made.pack.vault, device: 'browser', note: 'note' });
    await journal.save('浏览器落盘并重载 😀', made.root);
    const record = await sealDraft('浏览器 → Node 😀', made.root, { vault: made.pack.vault, device: 'browser', note: 'cross', generation: 1 });
    made.root.fill(0);
    const streamKey = random(32);
    async function* source() { yield new Uint8Array([1, 2, 3]); }
    let count = 0;
    for await (const part of decryptParts(encryptParts(source(), streamKey, 'browser-stream'), streamKey, 'browser-stream')) {
        if (part.join(',') !== '1,2,3') throw new Error('Browser stream mismatch.');
        count += part.length;
    }
    streamKey.fill(0);
    if (count !== 3) throw new Error('Browser stream length mismatch.');
    return { pack: made.pack, record, vector, creationMs: Math.round(creationMs) };
}
export async function recover(pack: KeyPack, namespace: string) {
    const root = await unlock(pack, password);
    try {
        const result = await new DraftJournal(await files(namespace), { vault: pack.vault, device: 'browser', note: 'note' }).recover(root);
        if (result?.text !== '浏览器落盘并重载 😀') throw new Error('Reload recovery failed.');
        return { generation: result.generation, rejected: result.rejected };
    } finally { root.fill(0); }
}
