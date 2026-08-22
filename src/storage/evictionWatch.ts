const MARKER_KEY = "altitude-code:device-marker";

interface DeviceMarker {
  /** How many projects were present the last time the app ran normally. */
  projects: number;
  at: number;
}

/**
 * Notices that this device once held projects and no longer does.
 *
 * Safari clears website data for sites that have not been opened for a while,
 * and it takes IndexedDB with it. Without this, that looks exactly like a first
 * launch: `App.start()` finds no projects, seeds a fresh one, and the user is
 * never told their work was removed rather than lost by Altitude.
 *
 * **Best effort, and deliberately conservative.** The marker lives in
 * `localStorage`, which Safari often clears in the same sweep — when it does,
 * there is nothing left to compare against and no warning is shown. That is the
 * right way to be wrong: a missed warning is a great deal better than telling
 * someone their projects were deleted when they were not.
 */
export class EvictionWatch {
  private readonly storage: Storage | undefined;

  constructor(storage?: Storage) {
    this.storage = this.detectStorage(storage);
  }

  /**
   * True when projects existed before and none do now. Only meaningful when
   * real storage was actually consulted — in session-only mode an empty list
   * says nothing about what is on the device, so the caller must not ask.
   */
  wasEvicted(projectCount: number): boolean {
    if (projectCount > 0) {
      return false;
    }
    const marker = this.read();
    return marker !== undefined && marker.projects > 0;
  }

  record(projectCount: number): void {
    const storage = this.storage;
    if (!storage) {
      return;
    }
    try {
      const marker: DeviceMarker = { projects: projectCount, at: Date.now() };
      storage.setItem(MARKER_KEY, JSON.stringify(marker));
    } catch {
      // A marker that cannot be written simply means no warning next time.
    }
  }

  private read(): DeviceMarker | undefined {
    const storage = this.storage;
    if (!storage) {
      return undefined;
    }
    try {
      const serialized = storage.getItem(MARKER_KEY);
      if (!serialized) {
        return undefined;
      }
      const parsed: unknown = JSON.parse(serialized);
      if (!parsed || typeof parsed !== "object") {
        return undefined;
      }
      const projects = (parsed as { projects?: unknown }).projects;
      return typeof projects === "number" && Number.isFinite(projects)
        ? { projects, at: Date.now() }
        : undefined;
    } catch {
      return undefined;
    }
  }

  private detectStorage(candidate?: Storage): Storage | undefined {
    try {
      const storage = candidate ?? window.localStorage;
      const probeKey = `${MARKER_KEY}:probe`;
      storage.setItem(probeKey, "1");
      storage.removeItem(probeKey);
      return storage;
    } catch {
      return undefined;
    }
  }
}
