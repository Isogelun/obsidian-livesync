import { readdir, readFile, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_RECORD_CHARS, type DraftFiles } from '../src/drafts.ts';
export function nodeFiles(directory: string): DraftFiles {
    return {
        list: () => readdir(directory),
        read: async name => {
            if ((await stat(join(directory, name))).size > MAX_RECORD_CHARS * 4) throw new Error('Oversized record.');
            return readFile(join(directory, name), 'utf8');
        },
        writeNew: async (name, content) => {
            const file = await open(join(directory, name), 'wx', 0o600);
            try { await file.writeFile(content); await file.sync(); }
            finally { await file.close(); }
        },
    };
}
