import sodium from 'libsodium-wrappers-sumo';
import { utf8 } from './crypto.ts';

export const PART_BYTES = 256 * 1024;
function context(aad: string) {
    if (!aad || utf8(aad).length > 1024) throw new Error('Invalid stream identity.');
    return utf8(JSON.stringify(['cloud-p0-stream-v1', aad]));
}
// P0 consumes ordered, already framed parts. Network framing and durable uploads remain separate work.
export async function* encryptParts(parts: AsyncIterable<Uint8Array>, key: Uint8Array, aad: string) {
    await sodium.ready;
    const authenticated = context(aad);
    const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
    yield header;
    for await (const part of parts) {
        if (part.byteLength > PART_BYTES) throw new Error('Part exceeds prototype limit.');
        yield sodium.crypto_secretstream_xchacha20poly1305_push(state, part, authenticated,
            sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE);
    }
    yield sodium.crypto_secretstream_xchacha20poly1305_push(state, new Uint8Array(), authenticated,
        sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL);
}
export async function* decryptParts(parts: AsyncIterable<Uint8Array>, key: Uint8Array, aad: string) {
    await sodium.ready;
    const authenticated = context(aad);
    let state: ReturnType<typeof sodium.crypto_secretstream_xchacha20poly1305_init_pull> | undefined;
    let final = false;
    for await (const part of parts) {
        if (final) throw new Error('Trailing stream data.');
        if (!state) {
            if (part.length !== sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES) throw new Error('Invalid stream header.');
            state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(part, key);
            continue;
        }
        if (part.length < sodium.crypto_secretstream_xchacha20poly1305_ABYTES ||
            part.length > PART_BYTES + sodium.crypto_secretstream_xchacha20poly1305_ABYTES) throw new Error('Invalid stream part.');
        const result = sodium.crypto_secretstream_xchacha20poly1305_pull(state, part, authenticated);
        if (!result) throw new Error('Stream authentication failed.');
        if (result.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL) {
            if (result.message.length) throw new Error('Unexpected final payload.');
            final = true;
        } else if (result.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE) yield result.message;
        else throw new Error('Unsupported stream tag.');
    }
    if (!final) throw new Error('Truncated stream.');
}
