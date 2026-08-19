import type { Project, SessionState } from "../projects/models";

const DATABASE_NAME = "altitude-code";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "projects";
const SETTINGS_STORE = "settings";
const SESSION_KEY = "session";

interface SettingRecord<T> {
  key: string;
  value: T;
}

export class PrimaryStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PrimaryStorageError";
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export class ProjectRepository {
  private databasePromise: Promise<IDBDatabase> | undefined;

  async listProjects(): Promise<Project[]> {
    const database = await this.open();
    const transaction = database.transaction(PROJECT_STORE, "readonly");
    const projects = await requestResult(transaction.objectStore(PROJECT_STORE).getAll() as IDBRequest<Project[]>);
    await transactionDone(transaction);
    return projects.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async saveProject(project: Project): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(PROJECT_STORE, "readwrite");
    transaction.objectStore(PROJECT_STORE).put(project);
    await transactionDone(transaction);
  }

  async deleteProject(projectId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(PROJECT_STORE, "readwrite");
    transaction.objectStore(PROJECT_STORE).delete(projectId);
    await transactionDone(transaction);
  }

  async getSession(): Promise<SessionState | undefined> {
    return this.getSetting<SessionState>(SESSION_KEY);
  }

  async saveSession(session: SessionState): Promise<void> {
    await this.saveSetting(SESSION_KEY, session);
  }

  /**
   * Generic key/value settings. The session was already stored this way; L4
   * needed a second key, so the shape is exposed rather than duplicated. The
   * returned value is whatever was written, which may predate the current
   * build — callers normalize it before use.
   */
  async getSetting<T>(key: string): Promise<T | undefined> {
    const database = await this.open();
    const transaction = database.transaction(SETTINGS_STORE, "readonly");
    const record = await requestResult(
      transaction.objectStore(SETTINGS_STORE).get(key) as IDBRequest<SettingRecord<T> | undefined>
    );
    await transactionDone(transaction);
    return record?.value;
  }

  async saveSetting<T>(key: string, value: T): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(SETTINGS_STORE, "readwrite");
    transaction.objectStore(SETTINGS_STORE).put({ key, value });
    await transactionDone(transaction);
  }

  private open(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        let request: IDBOpenDBRequest;
        try {
          const factory = globalThis.indexedDB;
          if (!factory) {
            reject(new PrimaryStorageError("IndexedDB is not available in this browser context"));
            return;
          }
          request = factory.open(DATABASE_NAME, DATABASE_VERSION);
        } catch (error) {
          reject(new PrimaryStorageError("IndexedDB could not be opened", { cause: error }));
          return;
        }

        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(PROJECT_STORE)) {
            database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
          }
          if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
            database.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(new PrimaryStorageError("IndexedDB could not be opened", { cause: request.error }));
        request.onblocked = () => reject(new PrimaryStorageError("IndexedDB is blocked by another app window"));
      });
    }

    return this.databasePromise;
  }
}
