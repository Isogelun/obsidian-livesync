import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { random } from '../src/crypto.ts';
import { decryptParts, encryptParts, PART_BYTES } from '../src/stream.ts';

test('HTTP retry reuses sealed ciphertext; stream restart gets a new header', async () => {
    const stored = new Map<string, Uint8Array>();
    let failOnce = true;
    const server = createServer(async (req, res) => {
        const chunks: Uint8Array[] = [];
        let length = 0;
        for await (const chunk of req) {
            length += chunk.length;
            if (length > PART_BYTES + 128) { res.writeHead(413).end(); return; }
            chunks.push(Uint8Array.from(chunk));
        }
        const body = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
        const id = req.url!;
        if (stored.has(id) && Buffer.compare(stored.get(id)!, body) !== 0) { res.writeHead(409).end(); return; }
        stored.set(id, body);
        // The server persisted the part, but the client cannot know whether it succeeded.
        if (id === '/1' && failOnce) { failOnce = false; res.writeHead(503).end(); return; }
        res.writeHead(204).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const address = server.address();
        assert(address && typeof address !== 'string');
        const key = random(32);
        async function* plaintext() { yield new Uint8Array(PART_BYTES).fill(42); yield new Uint8Array([7, 8, 9]); }
        let index = 0;
        let retries = 0;
        for await (const ciphertext of encryptParts(plaintext(), key, 'upload-1')) {
            const url: string = `http://127.0.0.1:${address.port}/${index++}`;
            const send = (): Promise<Response> => fetch(url, { method: 'PUT', body: Uint8Array.from(ciphertext).buffer });
            const first = await send();
            if (!first.ok) { retries++; assert.equal((await send()).status, 204); }
        }
        assert.equal(retries, 1);
        async function* downloaded() { for (let i = 0; i < index; i++) yield stored.get(`/${i}`)!; }
        let size = 0;
        for await (const part of decryptParts(downloaded(), key, 'upload-1')) size += part.length;
        assert.equal(size, PART_BYTES + 3);
        const restart = encryptParts(plaintext(), random(32), 'upload-2');
        const header = await restart.next();
        assert.notDeepEqual(header.value, stored.get('/0'));
        await restart.return(undefined);
        key.fill(0);
    } finally {
        const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        server.closeAllConnections();
        await closed;
    }
});
