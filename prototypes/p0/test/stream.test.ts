import test from 'node:test';
import assert from 'node:assert/strict';
import { random } from '../src/crypto.ts';
import { decryptParts, encryptParts, PART_BYTES } from '../src/stream.ts';
async function* source(items: Uint8Array[]) { yield* items; }
async function collect(parts: AsyncIterable<Uint8Array>) { const result = []; for await (const part of parts) result.push(part); return result; }
test('secretstream roundtrip including empty content and independent restart', async () => {
    const key = random(32);
    const plain = [new Uint8Array(PART_BYTES).fill(42), new Uint8Array([1, 2, 3])];
    const cipher = await collect(encryptParts(source(plain), key, 'vault/object/revision'));
    assert.deepEqual(await collect(decryptParts(source(cipher), key, 'vault/object/revision')), plain);
    const empty = await collect(encryptParts(source([]), key, 'empty'));
    assert.deepEqual(await collect(decryptParts(source(empty), key, 'empty')), []);
    const restarted = await collect(encryptParts(source(plain), key, 'vault/object/revision'));
    assert.notDeepEqual(restarted[0], cipher[0]);
});
test('secretstream rejects missing, reordered, duplicated, altered and appended parts', async () => {
    const key = random(32);
    const cipher = await collect(encryptParts(source([new Uint8Array([1]), new Uint8Array([2])]), key, 'identity'));
    const altered = cipher.map(x => x.slice()); altered[1][0] ^= 1;
    const badCases = [cipher.slice(0, -1), [cipher[0], cipher[2], cipher[1], cipher[3]],
        [cipher[0], cipher[1], cipher[1], cipher[2], cipher[3]], [cipher[0], cipher[2], cipher[3]], altered, [...cipher, cipher[1]]];
    for (const bad of badCases) await assert.rejects(collect(decryptParts(source(bad), key, 'identity')));
    await assert.rejects(collect(decryptParts(source(cipher), key, 'other-identity')));
    await assert.rejects(collect(decryptParts(source(cipher), random(32), 'identity')));
    await assert.rejects(collect(encryptParts(source([new Uint8Array(PART_BYTES + 1)]), key, 'identity')));
});
