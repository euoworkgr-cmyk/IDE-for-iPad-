import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies exactly one PHP build out of `node_modules/php-wasm` into
 * `public/php/`, the same way `copy-pyodide-assets.mjs` handles Pyodide.
 *
 * The copy is not a convenience — it is what keeps the bundle honest. The
 * package ships every PHP release from 5.2 to 8.5 (about 190 MiB of wasm), and
 * its `PhpWeb` entry point reaches all of them through separate dynamic
 * imports. Importing `PhpWeb` would therefore make the bundler emit *every*
 * version. Copying one build and loading it by URL ships one.
 *
 * The Emscripten module resolves its own `.wasm` relative to its own URL, so
 * the two files must land in the same directory and keep their names.
 */

const PHP_VERSION = "8.3";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(projectRoot, "node_modules/php-wasm");
const destinationRoot = resolve(projectRoot, "public/php");
const moduleName = `php${PHP_VERSION}-web.mjs`;

const moduleSource = readFileSync(resolve(sourceRoot, moduleName), "utf8");
const wasmName = moduleSource.match(/[0-9a-f]{40}\.wasm/)?.[0];

if (!wasmName) {
  throw new Error(
    `Could not find the .wasm filename inside ${moduleName}. The php-wasm ` +
      "package layout changed — check which assets the build needs before releasing."
  );
}

mkdirSync(destinationRoot, { recursive: true });
const assets = [moduleName, wasmName];
for (const asset of assets) {
  copyFileSync(resolve(sourceRoot, asset), resolve(destinationRoot, asset));
}

const wasmBytes = statSync(resolve(destinationRoot, wasmName)).size;
console.log(
  `Copied PHP ${PHP_VERSION} runtime assets (${moduleName}, ${wasmName}, ` +
    `${(wasmBytes / 1024 / 1024).toFixed(2)} MiB of wasm).`
);
