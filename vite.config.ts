import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * `@sqlite.org/sqlite-wasm` ships three entry points behind one module: the
 * library itself, a `Worker1` message-API worker, and the async proxy the OPFS
 * VFS needs. It reaches the latter two through `new URL(..., import.meta.url)`,
 * which Vite resolves at transform time, so both are emitted as assets and
 * precached — 604 KiB of code Altitude never reaches, because SqlRuntime owns
 * its own Worker and opens an in-memory database.
 *
 * This rewrites those two references, and only those two, to inert relative
 * URLs. It deliberately fails the build if either pattern stops matching:
 * silently precaching them again on a package upgrade is exactly the kind of
 * regression a size budget is supposed to catch.
 *
 * **Remove this the moment SQL gains OPFS persistence** — the async proxy is
 * required for the `opfs` and `opfs-sahpool` VFSes.
 */
function trimUnusedSqliteEntryPoints(): Plugin {
  const unused = ["sqlite3-worker1.mjs", "sqlite3-opfs-async-proxy.js"];

  return {
    name: "altitude:trim-unused-sqlite-entry-points",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("@sqlite.org/sqlite-wasm")) {
        return null;
      }
      let transformed = code;
      for (const file of unused) {
        const reference = `new URL("${file}", import.meta.url)`;
        if (!transformed.includes(reference)) {
          this.error(
            `Expected ${file} to be referenced as ${reference} in @sqlite.org/sqlite-wasm. ` +
              "The package layout changed — re-check what the build precaches before removing this plugin."
          );
        }
        transformed = transformed.replaceAll(reference, `new URL("./${file}", location.href)`);
      }
      return transformed === code ? null : { code: transformed, map: null };
    }
  };
}

const CROSS_ORIGIN_ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp"
};

export default defineConfig({
  base: "./",
  optimizeDeps: {
    // Both packages resolve their own wasm with `new URL(..., import.meta.url)`.
    // esbuild's dependency pre-bundling rewrites that URL to a path inside its
    // own cache directory, where the .wasm file is not, so both are excluded.
    exclude: ["pyodide", "@sqlite.org/sqlite-wasm"]
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Altitude Code",
        short_name: "Altitude",
        description: "Offline-first code editor for iPad",
        theme_color: "#0b1017",
        background_color: "#0b1017",
        display: "standalone",
        orientation: "any",
        start_url: ".",
        scope: ".",
        icons: [
          {
            src: "icons/app-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html",
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,woff2,wasm,zip,json}"],
        maximumFileSizeToCacheInBytes: 11 * 1024 * 1024
      }
    })
  ],
  // The runtime creates its Worker with { type: "module" }, so the Worker must
  // be built as ES too. It also lets the TypeScript transpiler split into its
  // own chunk, which a plain JavaScript run never loads.
  worker: {
    format: "es",
    // A production worker bundle is a separate Rollup build with its own plugin
    // list — `plugins` above does not reach it, and SQLite is only ever
    // imported from a worker.
    plugins: () => [trimUnusedSqliteEntryPoints()]
  },
  build: {
    target: "safari16",
    sourcemap: true
  },
  // Cross-origin isolation (L6). SharedArrayBuffer — how the Python Worker
  // blocks on input() — is only handed out to an isolated page, and these are
  // the same two headers a wasm-hosted compiler will need later. Production
  // serves them from public/_headers; these keep dev and preview identical.
  server: {
    headers: CROSS_ORIGIN_ISOLATION_HEADERS
  },
  preview: {
    headers: CROSS_ORIGIN_ISOLATION_HEADERS
  }
});
