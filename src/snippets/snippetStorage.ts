import type { SnippetDefinition } from "./snippetEngine";

const DATABASE_NAME = "altitude-snippets";
const DATABASE_VERSION = 1;
const SNIPPET_STORE = "snippets";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Snippet storage request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Snippet storage transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Snippet storage transaction aborted"));
  });
}

export class SnippetRepository {
  private databasePromise: Promise<IDBDatabase> | undefined;

  constructor(
    private readonly factory: IDBFactory | undefined = globalThis.indexedDB,
    private readonly databaseName = DATABASE_NAME
  ) {}

  async list(): Promise<SnippetDefinition[]> {
    const database = await this.open();
    const transaction = database.transaction(SNIPPET_STORE, "readonly");
    const snippets = await requestResult(
      transaction.objectStore(SNIPPET_STORE).getAll() as IDBRequest<SnippetDefinition[]>
    );
    await transactionDone(transaction);
    return snippets
      .filter((snippet) => snippet.source === "user")
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async save(snippet: SnippetDefinition): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(SNIPPET_STORE, "readwrite");
    transaction.objectStore(SNIPPET_STORE).put(snippet);
    await transactionDone(transaction);
  }

  async delete(snippetId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(SNIPPET_STORE, "readwrite");
    transaction.objectStore(SNIPPET_STORE).delete(snippetId);
    await transactionDone(transaction);
  }

  close(): void {
    void this.databasePromise?.then((database) => database.close());
    this.databasePromise = undefined;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        if (!this.factory) {
          reject(new Error("IndexedDB is not available for snippets"));
          return;
        }
        let request: IDBOpenDBRequest;
        try {
          request = this.factory.open(this.databaseName, DATABASE_VERSION);
        } catch (error) {
          reject(new Error("Snippet storage could not be opened", { cause: error }));
          return;
        }
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(SNIPPET_STORE)) {
            request.result.createObjectStore(SNIPPET_STORE, { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error("Snippet storage could not be opened", { cause: request.error }));
        request.onblocked = () => reject(new Error("Snippet storage is blocked by another app window"));
      });
    }
    return this.databasePromise;
  }
}
