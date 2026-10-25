import test from 'node:test';
import assert from 'node:assert/strict';
import sodium from 'libsodium-wrappers-sumo';
import { argon2id } from 'hash-wasm';
import { base64, changePassword, createKeyPack, decrypt, KDF, MAX_TEXT_BYTES, openDraft, random, sealDraft, unlock, utf8 } from '../src/crypto.ts';

const identity = { vault: 'test-vault', device: 'device-a', note: 'note-a', generation: 1 };
test('Argon2id agrees with independent libsodium implementation at candidate parameters', async () => {
    await sodium.ready;
    const salt = new Uint8Array(16).fill(2);
    const password = 'P0 中文 password';
    const wasm = await argon2id({ password, salt, memorySize: KDF.memoryKiB, iterations: KDF.iterations,
        parallelism: 1, hashLength: 32, outputType: 'binary' });
    const reference = sodium.crypto_pwhash(32, password, salt, KDF.iterations, KDF.memoryKiB * 1024, sodium.crypto_pwhash_ALG_ARGON2ID13);
    assert.deepEqual(wasm, reference);
    assert.equal(Buffer.from(wasm).toString('hex'), 'c8a0c730e8f4d07c8b31ba460a5d13beacc9a08d66cdc74f336ce75831a465e3');
});
test('AES-256-GCM decrypts the zero-key known-answer vector', async () => {
    const ciphertext = Uint8Array.from(Buffer.from('cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919', 'hex'));
    assert.deepEqual(await decrypt({ nonce: base64(new Uint8Array(12)), ciphertext: base64(ciphertext) }, new Uint8Array(32), '', 16), new Uint8Array(16));
});
test('password, recovery, rewrapping, wrong credentials and untrusted KDF limits', async () => {
    const made = await createKeyPack('old test passphrase');
    assert.deepEqual(await unlock(made.pack, 'old test passphrase'), made.root);
    assert.deepEqual(await unlock(made.pack, made.recoveryCode, true), made.root);
    await assert.rejects(unlock(made.pack, 'incorrect'));
    await assert.rejects(unlock(made.pack, base64(random(32)), true));
    await assert.rejects(unlock({ ...made.pack, kdf: { ...made.pack.kdf, memoryKiB: 2 ** 30 } }, 'old test passphrase'), /KDF/);
    const changed = await changePassword(made.pack, made.root, 'new test passphrase');
    assert.deepEqual(await unlock(changed, 'new test passphrase'), made.root);
    assert.deepEqual(await unlock(changed, made.recoveryCode, true), made.root);
    await assert.rejects(unlock(changed, 'old test passphrase'));
    assert(!JSON.stringify(made.pack).includes(base64(made.root)));
    made.root.fill(0);
});
test('draft roundtrip binds identity, generation, content key and ciphertext', async () => {
    const root = random(32);
    const text = '# 中文笔记\nemoji 😀\n[[Link]]\n';
    const record = await sealDraft(text, root, identity);
    assert.equal(await openDraft(record, root, identity), text);
    assert(!JSON.stringify(record).includes(text));
    assert(!JSON.stringify(record).includes(base64(root)));
    for (const field of ['vault', 'device', 'note'] as const) await assert.rejects(openDraft(record, root, { ...identity, [field]: 'other' }));
    await assert.rejects(openDraft(record, root, { ...identity, generation: 2 }));
    for (const field of ['content', 'wrappedKey'] as const) {
        const altered = structuredClone(record);
        const ciphertext = altered[field].ciphertext;
        altered[field].ciphertext = (ciphertext[0] === 'A' ? 'B' : 'A') + ciphertext.slice(1);
        await assert.rejects(openDraft(altered, root, identity));
    }
    const again = await sealDraft(text, root, identity);
    assert.notDeepEqual(again, record);
    await assert.rejects(openDraft(record, random(32), identity));
    root.fill(0);
});
test('draft size limit applies to UTF-8 bytes', async () => {
    assert(utf8('中').length > 1);
    await assert.rejects(sealDraft('中'.repeat(Math.ceil(MAX_TEXT_BYTES / 3)), random(32), identity), /size limit/);
});
