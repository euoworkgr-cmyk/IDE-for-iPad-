import { normalizeStoredProjects } from "../projects/projectRecords";
import type { Project, SessionState } from "../projects/models";
import {
  classifyStorageError,
  describeStorageNotice,
  noticeKindForSaveFailure,
  type StorageNotice
} from "./storageFailure";

const DATABASE_NAME = "altitude-code";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "projects";
const SETTINGS_STORE = "settings";
const SESSION_KEY = "session";

interface SettingRecord<T> {
  key: string;
  value: T;
}

/**
 * "session-only" means IndexedDB could not be used and this repository is
 * serving from memory instead. The app is fully usable in that mode and keeps
 * nothing — which is why entering it always raises a notice.
 */
export type StorageMode = "indexeddb" | "session-only";

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

/**
 * The only interface to project storage, and now also the only place that
 * decides what to do when that storage fails.
 *
 * Failing used to mean throwing `PrimaryStorageError` out of `App.start()`,
 * which ended at a dead page telling the user to check Safari's settings and
 * reload — advice that changes nothing in Private Browsing. It now falls back
 * to an in-memory store and reports why, so the app opens, runs and exports.
 * That is a deliberate trade: a session that keeps nothing is worth more than
 * a session that will not start, *provided* the user is told, which is what
 * the notice is for.
 */
export class ProjectRepository {
  private databasePromise: Promise<IDBDatabase> | undefined;
  private currentMode: StorageMode = "indexeddb";
  private readonly memoryProjects = new Map<string, Project>();
  private readonly memorySettings = new Map<string, unknown>();
  /** Suppresses a repeat of the notice already on screen — autosave is chatty. */
  private lastNoticeKind: StorageNotice["kind"] | undefined;

  constructor(private readonly onNotice: (notice: StorageNotice) => void = () => undefined) {}

  get mode(): StorageMode {
    return this.currentMode;
  }

  async listProjects(): Promise<Project[]> {
    if (this.currentMode === "session-only") {
      return this.sortedMemoryProjects();
    }

    try {
      const database = await this.open();
      const transaction = database.transaction(PROJECT_STORE, "readonly");
      const stored = await requestResult(
        transaction.objectStore(PROJECT_STORE).getAll() as IDBRequest<unknown[]>
      );
      await transactionDone(transaction);

      const { projects, discarded } = normalizeStoredProjects(stored);
      if (discarded > 0) {
        // Not a failure to start: the readable projects are returned and the
        // user is told how many were not. Repairs made in passing are kept in
        // memory and persist on the next ordinary save.
        this.notify(describeStorageNotice("damaged", { damagedCount: discarded }));
      }
      return projects.sort((left, right) => right.updatedAt - left.updatedAt);
    } catch (error) {
      this.degrade(error);
      return this.sortedMemoryProjects();
    }
  }

  async saveProject(project: Project): Promise<void> {
    if (this.currentMode === "session-only") {
      this.memoryProjects.set(project.id, project);
      return;
    }

    try {
      const database = await this.open();
      const transaction = database.transaction(PROJECT_STORE, "readwrite");
      transaction.objectStore(PROJECT_STORE).put(project);
      await transactionDone(transaction);
      this.lastNoticeKind = undefined;
    } catch (error) {
      this.reportWriteFailure(error);
      // Rethrown so SaveCoordinator still marks the save as failed. The notice
      // explains it; the status pill is what says it is still true.
      throw error;
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    if (this.currentMode === "session-only") {
      this.memoryProjects.delete(projectId);
      return;
    }

    try {
      const database = await this.open();
      const transaction = database.transaction(PROJECT_STORE, "readwrite");
      transaction.objectStore(PROJECT_STORE).delete(projectId);
      await transactionDone(transaction);
      this.lastNoticeKind = undefined;
    } catch (error) {
      this.reportWriteFailure(error);
      throw error;
    }
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
    if (this.currentMode === "session-only") {
      return this.memorySettings.get(key) as T | undefined;
    }

    try {
      const database = await this.open();
      const transaction = database.transaction(SETTINGS_STORE, "readonly");
      const record = await requestResult(
        transaction.objectStore(SETTINGS_STORE).get(key) as IDBRequest<SettingRecord<T> | undefined>
      );
      await transactionDone(transaction);
      return record?.value;
    } catch (error) {
      this.degrade(error);
      return this.memorySettings.get(key) as T | undefined;
    }
  }

  async saveSetting<T>(key: string, value: T): Promise<void> {
    if (this.currentMode === "session-only") {
      this.memorySettings.set(key, value);
      return;
    }

    try {
      const database = await this.open();
      const transaction = database.transaction(SETTINGS_STORE, "readwrite");
      transaction.objectStore(SETTINGS_STORE).put({ key, value });
      await transactionDone(transaction);
      this.lastNoticeKind = undefined;
    } catch (error) {
      this.reportWriteFailure(error);
      throw error;
    }
  }

  private sortedMemoryProjects(): Project[] {
    return [...this.memoryProjects.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  /**
   * A write can fail without the database being gone — a full disk leaves
   * everything already stored exactly where it was, and switching to memory
   * there would quietly abandon it. Only a storage layer that has become
   * unusable is worth degrading for.
   */
  private reportWriteFailure(error: unknown): void {
    const reason = classifyStorageError(error);
    if (reason === "unavailable") {
      this.degrade(error);
      return;
    }
    this.notify(describeStorageNotice(noticeKindForSaveFailure(reason)));
  }

  /**
   * Whatever the immediate cause, the standing fact afterwards is the same and
   * is the only thing worth telling the user: this session is keeping nothing.
   */
  private degrade(error: unknown): void {
    if (this.currentMode === "indexeddb") {
      this.currentMode = "session-only";
      this.databasePromise = undefined;
      console.error("Storage is unavailable; continuing in memory for this session", error);
    }
    this.notify(describeStorageNotice("session-only"));
  }

  private notify(notice: StorageNotice): void {
    if (this.lastNoticeKind === notice.kind) {
      return;
    }
    this.lastNoticeKind = notice.kind;
    this.onNotice(notice);
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
      // A failed open must not be cached as a permanently rejected promise: the
      // next call would reuse the rejection instead of retrying, and in
      // session-only mode nothing would ever recover.
      this.databasePromise.catch(() => {
        this.databasePromise = undefined;
      });
    }

    return this.databasePromise;
  }
}
