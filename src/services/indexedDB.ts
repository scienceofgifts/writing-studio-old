/**
 * Science of Gifts - IndexedDB Persistence Engine
 * Local-first client database ensuring all application data survives page refreshes,
 * browser restarts, and tab reloads with high storage capacity.
 */

const DB_NAME = 'ScienceOfGifts_WritingStudio_DB';
const DB_VERSION = 2;

export const STORES = {
  PROJECTS: 'projects',
  STYLE_PROFILES: 'style_profiles',
  INTERNAL_LINKS: 'internal_links',
  GLOBAL_INSTRUCTIONS: 'global_instructions',
  RESEARCH_STUDIES: 'research_studies',
  RESEARCH_CLAIMS: 'research_claims',
  RESEARCH_FILES: 'research_files',
  SAVED_IDEAS: 'saved_ideas',
  SETTINGS: 'settings',
  LOCAL_SNAPSHOTS: 'local_snapshots',
  PROJECT_HISTORY: 'project_history',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

class IndexedDBClient {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private isAvailable: boolean;

  constructor() {
    this.isAvailable = typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
  }

  public checkAvailability(): boolean {
    return this.isAvailable;
  }

  public getDatabase(): Promise<IDBDatabase> {
    if (!this.isAvailable) {
      return Promise.reject(new Error('IndexedDB is not supported in this browser environment'));
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object stores if not already present
        if (!db.objectStoreNames.contains(STORES.PROJECTS)) {
          db.createObjectStore(STORES.PROJECTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.STYLE_PROFILES)) {
          db.createObjectStore(STORES.STYLE_PROFILES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.INTERNAL_LINKS)) {
          db.createObjectStore(STORES.INTERNAL_LINKS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.GLOBAL_INSTRUCTIONS)) {
          db.createObjectStore(STORES.GLOBAL_INSTRUCTIONS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.RESEARCH_STUDIES)) {
          db.createObjectStore(STORES.RESEARCH_STUDIES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.RESEARCH_CLAIMS)) {
          db.createObjectStore(STORES.RESEARCH_CLAIMS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.RESEARCH_FILES)) {
          db.createObjectStore(STORES.RESEARCH_FILES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.SAVED_IDEAS)) {
          db.createObjectStore(STORES.SAVED_IDEAS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
          db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORES.LOCAL_SNAPSHOTS)) {
          db.createObjectStore(STORES.LOCAL_SNAPSHOTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.PROJECT_HISTORY)) {
          db.createObjectStore(STORES.PROJECT_HISTORY, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error || new Error('Failed to open IndexedDB'));
      };

      request.onblocked = () => {
        console.warn('IndexedDB database upgrade blocked by other open tabs');
      };
    });

    return this.dbPromise;
  }

  public async getAll<T>(storeName: StoreName): Promise<T[]> {
    if (!this.isAvailable) return [];
    try {
      const db = await this.getDatabase();
      return new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();

        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn(`IndexedDB getAll error in store "${storeName}":`, err);
      return [];
    }
  }

  public async get<T>(storeName: StoreName, key: string): Promise<T | undefined> {
    if (!this.isAvailable) return undefined;
    try {
      const db = await this.getDatabase();
      return new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);

        req.onsuccess = () => resolve(req.result || undefined);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn(`IndexedDB get error in store "${storeName}" key "${key}":`, err);
      return undefined;
    }
  }

  public async put<T>(storeName: StoreName, value: T): Promise<void> {
    if (!this.isAvailable) return;
    try {
      const db = await this.getDatabase();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(value);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn(`IndexedDB put error in store "${storeName}":`, err);
    }
  }

  public async putMany<T>(storeName: StoreName, values: T[]): Promise<void> {
    if (!this.isAvailable || values.length === 0) return;
    try {
      const db = await this.getDatabase();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);

        for (const item of values) {
          store.put(item);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn(`IndexedDB putMany error in store "${storeName}":`, err);
    }
  }

  public async delete(storeName: StoreName, key: string): Promise<void> {
    if (!this.isAvailable) return;
    try {
      const db = await this.getDatabase();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(key);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn(`IndexedDB delete error in store "${storeName}" key "${key}":`, err);
    }
  }

  public async clear(storeName: StoreName): Promise<void> {
    if (!this.isAvailable) return;
    try {
      const db = await this.getDatabase();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.clear();

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn(`IndexedDB clear error in store "${storeName}":`, err);
    }
  }

  public async count(storeName: StoreName): Promise<number> {
    if (!this.isAvailable) return 0;
    try {
      const db = await this.getDatabase();
      return new Promise<number>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.count();

        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn(`IndexedDB count error in store "${storeName}":`, err);
      return 0;
    }
  }

  /**
   * Clears all stores in the database (used only during destructive restore/reset)
   */
  public async clearAllStores(): Promise<void> {
    if (!this.isAvailable) return;
    for (const name of Object.values(STORES)) {
      await this.clear(name);
    }
  }
}

export const indexedDBService = new IndexedDBClient();
