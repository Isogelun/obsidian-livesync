import { ItemView, Notice, Plugin, type WorkspaceLeaf } from 'obsidian';
import { createKeyPack, unlock, type KeyPack } from './crypto.ts';
import { DraftJournal, MAX_RECORD_CHARS } from './drafts.ts';

const VIEW = 'cloud-notes-p0';
class ValidationView extends ItemView {
    private root?: Uint8Array;
    private textarea?: HTMLTextAreaElement;
    private status?: HTMLElement;
    private journal?: DraftJournal;
    private device = '';
    private pack?: KeyPack;
    private queue: Promise<void> = Promise.resolve();
    private busy = false;
    private timer?: ReturnType<typeof setTimeout>;
    constructor(leaf: WorkspaceLeaf, private plugin: ValidationPlugin) { super(leaf); }
    getViewType() { return VIEW; }
    getDisplayText() { return 'Cloud Notes P0'; }
    private enqueue(task: () => Promise<void>) {
        this.queue = this.queue.then(task).catch(() => {
            this.status?.setText('Operation failed. Existing drafts were retained. Retry before locking.');
        });
    }
    private async directory(path: string) {
        if (!(await this.app.vault.adapter.exists(path))) await this.app.vault.adapter.mkdir(path);
    }
    override async onOpen() {
        const el = this.contentEl;
        el.empty();
        el.createEl('h2', { text: 'Cloud Notes P0 validation' });
        el.createEl('p', { text: 'Use a disposable test vault. This prototype retains at most 128 draft generations and does not synchronise.' });
        const credential = el.createEl('input', { type: 'password', placeholder: 'Passphrase or recovery code' });
        credential.autocomplete = 'off';
        const recovery = el.createEl('input', { type: 'checkbox' });
        el.createSpan({ text: 'Use recovery code' });
        const open = el.createEl('button', { text: 'Create or unlock' });
        const lock = el.createEl('button', { text: 'Save and lock' });
        this.status = el.createEl('p', { text: 'Locked' });
        const area = el.createEl('textarea');
        area.setAttribute('aria-label', 'Encrypted draft');
        area.rows = 18;
        area.style.width = '100%';
        area.disabled = true;
        this.textarea = area;
        const base = `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}/p0-state`;
        await this.directory(base);
        const packPath = `${base}/keys.json`;
        const devicePath = `${base}/device.json`;
        const adapter = this.app.vault.adapter;
        if (await adapter.exists(devicePath)) {
            const id: unknown = JSON.parse(await adapter.read(devicePath));
            if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) throw new Error('Invalid device identity.');
            this.device = id;
        } else {
            this.device = crypto.randomUUID();
            await adapter.write(devicePath, JSON.stringify(this.device));
        }
        const drafts = `${base}/drafts`;
        await this.directory(drafts);
        open.onclick = () => this.enqueue(async () => {
            if (this.root || this.busy) return;
            this.busy = true;
            try {
                if (await adapter.exists(packPath)) {
                    const serialised = await adapter.read(packPath);
                    if (serialised.length > 8192) throw new Error('Oversized key pack.');
                    this.pack = JSON.parse(serialised) as KeyPack;
                    this.root = await unlock(this.pack, credential.value, recovery.checked);
                } else {
                    if (recovery.checked) throw new Error('No recovery pack exists.');
                    const created = await createKeyPack(credential.value);
                    this.pack = created.pack;
                    try {
                        const serialised = JSON.stringify(created.pack);
                        await adapter.write(packPath, serialised);
                        if (await adapter.read(packPath) !== serialised) throw new Error('Key pack verification failed.');
                    } catch (error) { created.root.fill(0); throw error; }
                    this.root = created.root;
                    // Keep the recovery secret visible until the user locks; never persist it as plaintext.
                    const code = el.createEl('textarea');
                    code.setAttribute('aria-label', 'Recovery code: save offline');
                    code.readOnly = true;
                    code.value = created.recoveryCode;
                    code.classList.add('p0-recovery-code');
                    new Notice('Save the recovery code offline before locking.');
                }
                credential.value = '';
                this.journal = new DraftJournal({
                    list: async () => (await adapter.list(drafts)).files.map(x => x.slice(drafts.length + 1)),
                    read: async name => {
                        const stat = await adapter.stat(`${drafts}/${name}`);
                        if (!stat || stat.size > MAX_RECORD_CHARS * 4) throw new Error('Oversized draft.');
                        return adapter.read(`${drafts}/${name}`);
                    },
                    writeNew: async (name, text) => {
                        if (await adapter.exists(`${drafts}/${name}`)) throw new Error('Draft collision.');
                        await adapter.write(`${drafts}/${name}`, text);
                    },
                }, { vault: this.pack.vault, device: this.device, note: 'p0-note' });
                const saved = await this.journal.recover(this.root);
                area.value = saved?.text ?? '';
                area.disabled = false;
                this.status?.setText(saved?.rejected ? `Recovered older draft; ${saved.rejected} damaged generation(s) retained.` : 'Unlocked; draft recovered.');
            } catch (error) {
                this.clear();
                throw error;
            } finally { this.busy = false; credential.value = ''; }
        });
        const schedule = () => {
            clearTimeout(this.timer);
            this.status?.setText('Unsaved changes; keep this view open.');
            this.timer = setTimeout(() => {
                const snapshot = area.value;
                this.enqueue(() => this.save(snapshot));
            }, 400);
        };
        // Do not interfere with an active input-method composition.
        area.oninput = (event) => {
            if (!(event instanceof InputEvent) || !event.isComposing) schedule();
        };
        area.addEventListener('compositionend', schedule);
        lock.onclick = () => {
            clearTimeout(this.timer);
            const snapshot = area.value;
            area.disabled = true;
            this.enqueue(async () => {
                try { await this.save(snapshot); this.clear(); }
                catch (error) { area.disabled = !this.root; throw error; }
            });
        };
    }
    private async save(text: string) {
        if (!this.root || !this.journal) throw new Error('Unlock before saving.');
        await this.journal.save(text, this.root);
        this.status?.setText('Encrypted draft written and read back.');
    }
    private clear() {
        this.root?.fill(0);
        this.root = undefined;
        if (this.textarea) { this.textarea.value = ''; this.textarea.disabled = true; }
        this.contentEl.querySelectorAll<HTMLTextAreaElement>('.p0-recovery-code').forEach(el => { el.value = ''; el.remove(); });
        this.status?.setText('Locked');
    }
    override async onClose() {
        clearTimeout(this.timer);
        if (this.textarea) this.textarea.disabled = true;
        await this.queue;
        if (this.root && this.textarea) {
            try { await this.save(this.textarea.value); }
            catch { new Notice('Draft save failed. Keep the test vault files for recovery.'); }
        }
        this.clear();
    }
}
export default class ValidationPlugin extends Plugin {
    override onload() {
        this.registerView(VIEW, leaf => new ValidationView(leaf, this));
        this.addCommand({ id: 'open-validation', name: 'Open encrypted draft validation', callback: async () => {
            const existing = this.app.workspace.getLeavesOfType(VIEW)[0];
            if (existing) { await this.app.workspace.revealLeaf(existing); return; }
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.setViewState({ type: VIEW, active: true });
            await this.app.workspace.revealLeaf(leaf);
        } });
    }
    override onunload() { this.app.workspace.detachLeavesOfType(VIEW); }
}
