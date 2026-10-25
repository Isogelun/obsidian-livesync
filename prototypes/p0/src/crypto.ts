import { argon2id } from 'hash-wasm';

export const FORMAT = 'cloud-p0-v1';
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const KDF = { memoryKiB: 65536, iterations: 3, parallelism: 1 } as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const utf8 = (text: string) => encoder.encode(text);
export const decode = (bytes: Uint8Array) => decoder.decode(bytes);
export const random = (size: number) => crypto.getRandomValues(new Uint8Array(size));
const buffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;
export function base64(bytes: Uint8Array): string {
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
}
export function unbase64(text: string, maximum: number): Uint8Array {
    if (typeof text !== 'string' || text.length > Math.ceil(maximum / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
        throw new Error('Invalid encoded field.');
    }
    const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    if (bytes.length > maximum || base64(bytes) !== text) throw new Error('Invalid encoded length.');
    return bytes;
}
function exact(text: string, length: number) {
    const bytes = unbase64(text, length);
    if (bytes.length !== length) throw new Error('Invalid key or nonce length.');
    return bytes;
}
type Box = { nonce: string; ciphertext: string };
async function key(bytes: Uint8Array) {
    if (bytes.length !== 32) throw new Error('Invalid key length.');
    return crypto.subtle.importKey('raw', buffer(bytes), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(bytes: Uint8Array, secret: Uint8Array, aad: string): Promise<Box> {
    const nonce = random(12);
    return { nonce: base64(nonce), ciphertext: base64(new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: buffer(nonce), additionalData: buffer(utf8(aad)), tagLength: 128 },
        await key(secret), buffer(bytes),
    ))) };
}
export async function decrypt(box: Box, secret: Uint8Array, aad: string, maximum: number) {
    return new Uint8Array(await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: buffer(exact(box.nonce, 12)), additionalData: buffer(utf8(aad)), tagLength: 128 },
        await key(secret), buffer(unbase64(box.ciphertext, maximum + 16)),
    ));
}
async function derive(root: Uint8Array, vault: string, purpose: string) {
    const source = await crypto.subtle.importKey('raw', buffer(root), 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({
        name: 'HKDF', hash: 'SHA-256', salt: buffer(utf8(vault)), info: buffer(utf8(`${FORMAT}:${purpose}`)),
    }, source, 256));
}
export type KeyPack = {
    format: typeof FORMAT;
    vault: string;
    kdf: { memoryKiB: number; iterations: number; parallelism: number; salt: string };
    password: Box;
    recovery: Box;
};
function validatePack(pack: KeyPack) {
    if (pack.format !== FORMAT || !/^[\w-]{1,80}$/.test(pack.vault)) throw new Error('Unsupported key pack.');
    if (pack.kdf.memoryKiB !== KDF.memoryKiB || pack.kdf.iterations !== KDF.iterations || pack.kdf.parallelism !== KDF.parallelism) {
        throw new Error('Unsupported KDF parameters.');
    }
    exact(pack.kdf.salt, 16);
}
async function passwordKey(password: string, salt: string) {
    if (!password || utf8(password).length > 1024) throw new Error('Invalid passphrase length.');
    return argon2id({ password, salt: exact(salt, 16), memorySize: KDF.memoryKiB,
        iterations: KDF.iterations, parallelism: KDF.parallelism, hashLength: 32, outputType: 'binary' });
}
export async function createKeyPack(password: string) {
    const root = random(32);
    const recoveryKey = random(32);
    const vault = crypto.randomUUID();
    const salt = base64(random(16));
    const wrapping = await passwordKey(password, salt);
    try {
        const pack: KeyPack = { format: FORMAT, vault, kdf: { ...KDF, salt },
            password: await encrypt(root, wrapping, `${FORMAT}:${vault}:password`),
            recovery: await encrypt(root, recoveryKey, `${FORMAT}:${vault}:recovery`) };
        return { pack, root, recoveryCode: base64(recoveryKey) };
    } catch (error) { root.fill(0); throw error; }
    finally { wrapping.fill(0); recoveryKey.fill(0); }
}
export async function unlock(pack: KeyPack, credential: string, recovery = false) {
    validatePack(pack);
    const wrapping = recovery ? exact(credential, 32) : await passwordKey(credential, pack.kdf.salt);
    try {
        const root = await decrypt(recovery ? pack.recovery : pack.password, wrapping,
            `${FORMAT}:${pack.vault}:${recovery ? 'recovery' : 'password'}`, 32);
        if (root.length !== 32) throw new Error('Invalid root key.');
        return root;
    } finally { wrapping.fill(0); }
}
export async function changePassword(pack: KeyPack, root: Uint8Array, password: string): Promise<KeyPack> {
    validatePack(pack);
    const salt = base64(random(16));
    const wrapping = await passwordKey(password, salt);
    try { return { ...pack, kdf: { ...KDF, salt }, password: await encrypt(root, wrapping, `${FORMAT}:${pack.vault}:password`) }; }
    finally { wrapping.fill(0); }
}
export type DraftContext = { vault: string; device: string; note: string; generation: number };
export type DraftRecord = { format: typeof FORMAT; context: DraftContext; wrappedKey: Box; content: Box };
function contextText(c: DraftContext) {
    if (![c.vault, c.device, c.note].every(x => typeof x === 'string' && /^[\w-]{1,80}$/.test(x)) ||
        !Number.isSafeInteger(c.generation) || c.generation < 1) throw new Error('Invalid draft identity.');
    return JSON.stringify([FORMAT, 'draft', c.vault, c.device, c.note, c.generation]);
}
export async function sealDraft(text: string, root: Uint8Array, context: DraftContext): Promise<DraftRecord> {
    const bytes = utf8(text);
    if (bytes.length > MAX_TEXT_BYTES) throw new Error('Draft exceeds prototype size limit.');
    const aad = contextText(context);
    const contentKey = random(32);
    const wrapping = await derive(root, context.vault, 'draft-key-wrap');
    try { return { format: FORMAT, context: { ...context },
        wrappedKey: await encrypt(contentKey, wrapping, `${aad}:key`), content: await encrypt(bytes, contentKey, `${aad}:body`) }; }
    finally { contentKey.fill(0); wrapping.fill(0); bytes.fill(0); }
}
export async function openDraft(record: DraftRecord, root: Uint8Array, expected: DraftContext) {
    const aad = contextText(expected);
    if (record.format !== FORMAT || contextText(record.context) !== aad) throw new Error('Draft identity mismatch.');
    const wrapping = await derive(root, expected.vault, 'draft-key-wrap');
    let contentKey: Uint8Array | undefined;
    let plaintext: Uint8Array | undefined;
    try {
        contentKey = await decrypt(record.wrappedKey, wrapping, `${aad}:key`, 32);
        plaintext = await decrypt(record.content, contentKey, `${aad}:body`, MAX_TEXT_BYTES);
        return decode(plaintext);
    } finally { wrapping.fill(0); contentKey?.fill(0); plaintext?.fill(0); }
}
