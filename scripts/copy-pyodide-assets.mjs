import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(projectRoot, "node_modules/pyodide");
const destinationRoot = resolve(projectRoot, "public/pyodide");
const runtimeAssets = [
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "pyodide-lock.json",
  "python_stdlib.zip"
];

mkdirSync(destinationRoot, { recursive: true });
for (const asset of runtimeAssets) {
  copyFileSync(resolve(sourceRoot, asset), resolve(destinationRoot, asset));
}

console.log(`Copied ${runtimeAssets.length} local Pyodide runtime assets.`);
