import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const CROSS_ORIGIN_ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp"
};

export default defineConfig({
  base: "./",
  optimizeDeps: {
    exclude: ["pyodide"]
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
    format: "es"
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
