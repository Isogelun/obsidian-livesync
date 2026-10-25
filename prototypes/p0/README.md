# Cloud Notes P0 validation prototype

This isolated prototype verifies candidate cryptography, encrypted draft recovery, and framed stream behaviour. It uses a separate package, plug-in ID, build output, and state directory. It does not initialise the existing Self-hosted LiveSync core.

## Run the verification

Use Node.js 24 and npm. From the repository root:

```sh
npm ci --prefix prototypes/p0 --registry=https://registry.npmjs.org
npm --prefix prototypes/p0 run verify
```

The browser test uses an installed Edge or Chrome executable on Windows. On other systems, set `P0_BROWSER_PATH` to an installed Chromium executable. It launches a disposable headless browser profile and a loopback-only test server; it does not access an existing browser profile or Vault.

[validation-results.json](validation-results.json) records command results from the latest verification. Re-running verification replaces that evidence file. Timings are observations from the recorded environment, rather than supported capacity limits.

## What is exercised

- Argon2id agreement between hash-wasm and Libsodium, plus a fixed cross-runtime vector.
- AES-256-GCM known-answer decryption, random object keys, and authenticated identity binding.
- Password unlock, independent recovery secret, password rewrapping, and KDF parameter rejection.
- Encrypted files, serialised saves, read-back checks, write failures, incomplete newest records, and recovery after terminating a separate process.
- Libsodium secretstream framing, final-tag checks, alteration, removal, reordering, duplication, wrong identity, and truncation rejection.
- HTTP retry after a server stores ciphertext but returns an error; the retry sends the same ciphertext.
- Node-to-browser and browser-to-Node decryption, plus browser OPFS recovery after page reload.
- A bounded-part encryption/decryption benchmark using generated input, with sampled process RSS.

The secretstream consumer can yield authenticated earlier parts before it sees the final tag. A production downloader must quarantine output until whole-stream completion; it must not publish a partial attachment as complete. P0 retry tests keep ciphertext in the running process. They do not implement a durable upload spool or resume an encoder after process death.

## Test the Obsidian artefact

Run `npm --prefix prototypes/p0 run build`. Copy `dist/main.js` and `dist/manifest.json` into `.obsidian/plugins/livesync-cloud-p0-validation/` in a disposable Vault, enable the plug-in, and run **Open encrypted draft validation**. Keep the independent ID. No automatic installation into existing Vaults is performed.

Create a passphrase, save the displayed recovery code offline, type a synthetic note, wait for the read-back confirmation, close Obsidian, reopen the view, and unlock. Repeat using the recovery code. **Save and lock** saves first, then removes visible content and releases the session key. There is no automatic idle lock in this prototype. JavaScript cannot guarantee removal of every memory copy.

Drafts are saved after a 400 ms quiet period following input; composition is left intact until it ends. Unconfirmed edits are not protected from immediate process termination. The adapter reads written ciphertext back, but does not claim a portable `fsync` guarantee. The Node file test explicitly syncs its file handles; this is a different host boundary.

## Prototype limits

- A single test note; 2 MiB maximum UTF-8 draft; 128 retained generations; no automatic pruning.
- Candidate Argon2id parameters: 64 MiB, three iterations, one lane. Mobile measurement is still required before freezing the suite.
- Key derivation currently runs without a dedicated Worker. Unlock-time UI responsiveness remains unverified.
- Fixed 256 KiB stream parts. No production multipart framing, object service, or attachment resume protocol.
- Key-pack initialisation writes a single file. Failure does not enable editing, but robust key-pack replacement and initialisation recovery remain work to complete.
- No directory catalogue, ordinary Vault synchronisation, conversion, search UI, or production server.
- No real Obsidian, Android, or iOS acceptance is implied by browser tests. The OPFS harness does not prove Obsidian adapter semantics or mobile input-method behaviour.

The code remains a validation artefact. It is not a production encrypted notebook or a completed P0 release. See the [Chinese verification report](../../docs/Cloud_Note/p0_runtime_validation_zh.md) for the outcome and outstanding gates. Repository licence and attribution remain applicable: [LICENSE](../../LICENSE).

## References

- [hash-wasm source and API](https://github.com/Daninet/hash-wasm)
- [Libsodium JavaScript bindings](https://github.com/jedisct1/libsodium.js)
- [Libsodium secretstream](https://doc.libsodium.org/secret-key_cryptography/secretstream)
- [Argon2 RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html)
