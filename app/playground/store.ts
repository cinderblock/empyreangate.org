/**
 * The playground's patch library, in the browser's IndexedDB: the same
 * request/event contract as the gate's WebSocket store, so the shared editor
 * cannot tell the difference. Nothing leaves the browser unless the visitor
 * saves a file or submits.
 */

import {
  linksTo,
  PATCH_FORMAT,
  summarize,
  syncLinks,
  type PatchDoc,
  type PatchStore,
  type PatchStoreEvent,
} from "@empyrean-gate/patch-web/editor";

const DB_NAME = "empyrean-playground";
const DB_VERSION = 1;
const PATCHES = "patches";
/** Which patch was open last, so a reload picks up where you were. */
const ACTIVE_KEY = "empyrean-playground:active";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(PATCHES, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class LocalPatchStore implements PatchStore {
  private db: Promise<IDBDatabase>;
  private listeners = new Set<(e: PatchStoreEvent) => void>();
  private activeListeners = new Set<(id: string | null) => void>();
  active: string | null;
  /** Upgrades an older document to the current format (the patch core's
   * `migrate`, set once it has loaded). Applied to everything read back, so
   * a patch saved before a format change opens as it renders. */
  migrate: (doc: PatchDoc) => PatchDoc = (doc) => doc;

  constructor() {
    this.db = openDb();
    this.active = localStorage.getItem(ACTIVE_KEY);
  }

  subscribe(listener: (e: PatchStoreEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Follow which patch is active (the one the editor reopens on load). */
  onActive(listener: (id: string | null) => void): () => void {
    this.activeListeners.add(listener);
    return () => this.activeListeners.delete(listener);
  }

  private emit(e: PatchStoreEvent) {
    this.listeners.forEach((l) => l(e));
  }

  private async all(): Promise<PatchDoc[]> {
    const db = await this.db;
    return done(
      db.transaction(PATCHES).objectStore(PATCHES).getAll() as IDBRequest<
        PatchDoc[]
      >,
    );
  }

  /** Whether the library holds the patch `id`. */
  async has(id: string): Promise<boolean> {
    const db = await this.db;
    const key = await done(
      db.transaction(PATCHES).objectStore(PATCHES).getKey(id),
    );
    return key !== undefined;
  }

  /** Whether the library is empty (first visit). */
  async isEmpty(): Promise<boolean> {
    return (await this.all()).length === 0;
  }

  list() {
    void this.all().then((docs) =>
      this.emit({
        type: "patches",
        patches: docs
          .map(summarize)
          .sort((a, b) => a.name.localeCompare(b.name)),
      }),
    );
  }

  get(id: string) {
    void this.db
      .then((db) =>
        done(
          db.transaction(PATCHES).objectStore(PATCHES).get(id) as IDBRequest<
            PatchDoc | undefined
          >,
        ),
      )
      .then((doc) => {
        if (doc) this.emit({ type: "patch", patch: this.migrate(doc) });
      });
  }

  /** Save, as the gate's store does: a blank id gets a fresh one, the
   * format is stamped, a blank name becomes "Untitled". Resolves with the
   * stored document. */
  async put(doc: PatchDoc): Promise<PatchDoc> {
    const stored: PatchDoc = {
      ...this.migrate(structuredClone(doc)),
      format: PATCH_FORMAT,
      id: doc.id || crypto.randomUUID(),
      name: doc.name.trim() ? doc.name : "Untitled",
    };
    const db = await this.db;
    const tx = db.transaction(PATCHES, "readwrite");
    await done(tx.objectStore(PATCHES).put(stored));
    await this.propagateLinks(stored);
    return stored;
  }

  /** As the gate's store does on save: the patches that link `saved` as a
   * Sub-patch follow it, and so do the ones linking those. */
  private async propagateLinks(saved: PatchDoc) {
    const queue = [saved];
    const seen = new Set([saved.id]);
    for (let source = queue.pop(); source; source = queue.pop()) {
      for (const doc of await this.all()) {
        if (doc.id === source.id || !linksTo(doc, source.id)) continue;
        const next = this.migrate(doc);
        if (!syncLinks(next, source)) continue;
        const db = await this.db;
        const tx = db.transaction(PATCHES, "readwrite");
        await done(tx.objectStore(PATCHES).put(next));
        if (!seen.has(next.id)) {
          seen.add(next.id);
          queue.push(next);
        }
      }
    }
  }

  save(doc: PatchDoc) {
    void this.put(doc).then((stored) => {
      // Echo, so a brand-new patch adopts its id; then the refreshed list.
      this.emit({ type: "patch", patch: stored });
      this.list();
      if (!doc.id) this.activate(stored.id);
    });
  }

  remove(id: string) {
    void this.db.then(async (db) => {
      const tx = db.transaction(PATCHES, "readwrite");
      await done(tx.objectStore(PATCHES).delete(id));
      if (this.active === id) this.activate(null);
      this.list();
    });
  }

  activate(id: string | null) {
    this.active = id;
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
    this.activeListeners.forEach((l) => l(id));
  }
}
