import type { ProjectRepository } from "../storage/database";
import { normalizeAppSettings, type AppSettings, DEFAULT_APP_SETTINGS } from "./appSettings";

const SETTINGS_KEY = "app-settings";

/**
 * Reads and writes the application settings through `ProjectRepository`, which
 * remains the only thing in the app that touches IndexedDB.
 *
 * Settings must never stop the app from starting: a failed read falls back to
 * the defaults and reports that persistence is unavailable, matching how user
 * snippets already degrade.
 */
export class SettingsStore {
  private current: AppSettings = { ...DEFAULT_APP_SETTINGS };
  private available = true;

  constructor(private readonly repository: Pick<ProjectRepository, "getSetting" | "saveSetting">) {}

  /** The last loaded or saved settings. Synchronous, so hot paths can read it. */
  get settings(): AppSettings {
    return this.current;
  }

  /** False once a read or write has failed; the app keeps running on defaults. */
  get persistenceAvailable(): boolean {
    return this.available;
  }

  async load(): Promise<AppSettings> {
    try {
      const stored = await this.repository.getSetting<unknown>(SETTINGS_KEY);
      this.current = normalizeAppSettings(stored);
    } catch (error) {
      console.error("Settings could not be loaded; using defaults", error);
      this.available = false;
      this.current = { ...DEFAULT_APP_SETTINGS };
    }
    return this.current;
  }

  /**
   * Applies a partial update. The merged value is normalized before it is
   * stored, so an out-of-range value can never reach IndexedDB, and the
   * in-memory value is updated even when the write fails — the run the user
   * just configured should still honour the new limit.
   */
  async update(changes: Partial<AppSettings>): Promise<AppSettings> {
    const next = normalizeAppSettings({ ...this.current, ...changes });
    this.current = next;
    try {
      await this.repository.saveSetting(SETTINGS_KEY, next);
    } catch (error) {
      console.error("Settings could not be saved", error);
      this.available = false;
    }
    return next;
  }
}
