import { FORMAT, MAX_TEXT_BYTES, openDraft, sealDraft, type DraftRecord } from './crypto.ts';

export interface DraftFiles {
    list(): Promise<string[]>;
    read(name: string): Promise<string>;
    writeNew(name: string, content: string): Promise<void>;
}
export const MAX_RECORD_CHARS = Math.ceil((MAX_TEXT_BYTES + 16) / 3) * 4 + 4096;
export class DraftJournal {
    private pending: Promise<unknown> = Promise.resolve();
    private files: DraftFiles;
    private identity: { vault: string; device: string; note: string };
    constructor(files: DraftFiles, identity: { vault: string; device: string; note: string }) {
        this.files = files;
        this.identity = identity;
    }
    private async records() {
        const names = (await this.files.list()).filter(x => /^\d{12}-[\w-]+\.json$/.test(x));
        if (names.length > 128) throw new Error('Prototype journal capacity reached; export before continuing.');
        return names.sort().reverse();
    }
    save(text: string, root: Uint8Array): Promise<void> {
        const task = this.pending.then(async () => {
            const names = await this.records();
            if (names.length >= 128) throw new Error('Prototype journal capacity reached; no drafts were removed.');
            const generation = names.length ? Number(names[0].slice(0, 12)) + 1 : 1;
            if (generation > 999999999999) throw new Error('Draft generation exhausted.');
            const record = await sealDraft(text, root, { ...this.identity, generation });
            const name = `${String(generation).padStart(12, '0')}-${crypto.randomUUID()}.json`;
            const serialised = JSON.stringify(record);
            await this.files.writeNew(name, serialised);
            if (await this.files.read(name) !== serialised) throw new Error('Draft read-back verification failed.');
        });
        this.pending = task.catch(() => undefined);
        return task;
    }
    async recover(root: Uint8Array): Promise<{ text: string; generation: number; rejected: number } | undefined> {
        await this.pending;
        const names = await this.records();
        let rejected = 0;
        for (const name of names) {
            try {
                const serialised = await this.files.read(name);
                if (serialised.length > MAX_RECORD_CHARS) throw new Error('Oversized draft record.');
                const record = JSON.parse(serialised) as DraftRecord;
                if (record.format !== FORMAT) throw new Error('Unsupported draft.');
                const generation = Number(name.slice(0, 12));
                return { text: await openDraft(record, root, { ...this.identity, generation }), generation, rejected };
            } catch { rejected++; }
        }
        if (rejected) throw new Error('No authenticated draft could be recovered. Existing files were retained.');
        return undefined;
    }
    async flush() { await this.pending; }
}
