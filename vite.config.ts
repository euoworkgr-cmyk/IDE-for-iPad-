import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

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
  build: {
    target: "safari16",
    sourcemap: true
  }
});
