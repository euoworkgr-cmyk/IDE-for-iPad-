import { describe, expect, it, vi } from "vitest";
import type { ProjectRepository } from "../storage/database";
import { DEFAULT_APP_SETTINGS, MAX_EXECUTION_TIMEOUT_MS } from "./appSettings";
import { SettingsStore } from "./settingsStore";

type SettingsRepository = Pick<ProjectRepository, "getSetting" | "saveSetting">;

function fakeRepository(initial?: unknown): SettingsRepository & { stored: unknown } {
  return {
    stored: initial,
    async getSetting<T>(): Promise<T | undefined> {
      return this.stored as T | undefined;
    },
    async saveSetting<T>(_key: string, value: T): Promise<void> {
      this.stored = value;
    }
  };
}

describe("SettingsStore", () => {
  it("starts on the defaults when nothing has been stored", async () => {
    const store = new SettingsStore(fakeRepository());

    await expect(store.load()).resolves.toEqual(DEFAULT_APP_SETTINGS);
    expect(store.persistenceAvailable).toBe(true);
  });

  it("persists an update and reads it back on the next start", async () => {
    const repository = fakeRepository();
    const store = new SettingsStore(repository);
    await store.load();

    await store.update({ executionTimeoutMs: 20_000, theme: "light" });

    expect(store.settings.executionTimeoutMs).toBe(20_000);
    const reopened = new SettingsStore(repository);
    await expect(reopened.load()).resolves.toEqual({
      ...DEFAULT_APP_SETTINGS,
      executionTimeoutMs: 20_000,
      theme: "light"
    });
  });

  it("never stores a value outside the supported range", async () => {
    const repository = fakeRepository();
    const store = new SettingsStore(repository);
    await store.load();

    await store.update({ executionTimeoutMs: 10 ** 9 });

    expect(repository.stored).toEqual({
      ...DEFAULT_APP_SETTINGS,
      executionTimeoutMs: MAX_EXECUTION_TIMEOUT_MS
    });
  });

  it("repairs a corrupted stored value instead of failing to start", async () => {
    const store = new SettingsStore(
      fakeRepository({ executionTimeoutMs: "forever", theme: "sepia", indentWidth: 3 })
    );

    await expect(store.load()).resolves.toEqual(DEFAULT_APP_SETTINGS);
  });

  it("keeps running on defaults when settings storage cannot be read", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const store = new SettingsStore({
        getSetting: async () => {
          throw new Error("IndexedDB unavailable");
        },
        saveSetting: async () => undefined
      });

      await expect(store.load()).resolves.toEqual(DEFAULT_APP_SETTINGS);
      expect(store.persistenceAvailable).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("applies an update in memory even when the write fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const store = new SettingsStore({
        getSetting: async () => undefined,
        saveSetting: async () => {
          throw new Error("quota exceeded");
        }
      });
      await store.load();

      await store.update({ executionTimeoutMs: 15_000 });

      expect(store.settings.executionTimeoutMs).toBe(15_000);
      expect(store.persistenceAvailable).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});
