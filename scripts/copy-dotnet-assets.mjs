import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

/**
 * Downloads the C# execution engine into `public/dotnet/`, the same way
 * `copy-pyodide-assets.mjs` and `copy-php-assets.mjs` place their runtimes —
 * generated, gitignored, never committed.
 *
 * The difference is where it comes from. Pyodide and PHP are npm packages;
 * a Roslyn host is not, and the deploy pipeline (Cloudflare Pages) runs Node
 * with no .NET SDK, so it cannot be built here. It is built instead by
 * `.github/workflows/build-csharp-runtime.yml` and published as a release
 * asset, which this script fetches.
 *
 * The version comes from `runtime-csharp/VERSION`, which is also what the
 * workflow tags the release with — one file, so the build and the download
 * cannot drift apart.
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(projectRoot, "public/dotnet");
const stampPath = resolve(destination, ".version");

const version = readFileSync(resolve(projectRoot, "runtime-csharp/VERSION"), "utf8").trim();
const assetName = `altitude-csharp-runtime-v${version}.tar.gz`;
const releaseBase =
  process.env.ALTITUDE_CSHARP_RELEASE_BASE ??
  `https://github.com/euoworkgr-cmyk/IDE-for-iPad-/releases/download/csharp-runtime-v${version}`;

/** Already have this exact version — nothing to do. */
if (existsSync(stampPath) && readFileSync(stampPath, "utf8").trim() === version) {
  console.log(`C# runtime v${version} already present in public/dotnet/.`);
  process.exit(0);
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

let archive;
let expectedDigest;
try {
  [archive, expectedDigest] = await Promise.all([
    download(`${releaseBase}/${assetName}`),
    download(`${releaseBase}/${assetName}.sha256`).then((buffer) => buffer.toString("utf8").trim())
  ]);
} catch (error) {
  console.error(
    `\nCould not download the C# runtime (v${version}).\n\n` +
      `  ${error.message}\n\n` +
      "This asset is produced by .github/workflows/build-csharp-runtime.yml.\n" +
      "If runtime-csharp/VERSION was just bumped, that workflow has to run and\n" +
      "publish the release before this script can fetch it.\n"
  );
  process.exit(1);
}

// Guards the failure that has already bitten this project once: committed
// Pyodide assets arrived truncated and silently broke Python execution and the
// test suite. A size check alone would not have caught it; a digest does.
const actualDigest = createHash("sha256").update(archive).digest("hex");
if (actualDigest !== expectedDigest) {
  console.error(
    `\nC# runtime checksum mismatch — refusing to install.\n` +
      `  expected ${expectedDigest}\n  actual   ${actualDigest}\n`
  );
  process.exit(1);
}

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });

const archivePath = resolve(tmpdir(), assetName);
writeFileSync(archivePath, archive);
try {
  execFileSync("tar", ["-xzf", archivePath, "-C", destination]);
} finally {
  rmSync(archivePath, { force: true });
}

writeFileSync(stampPath, `${version}\n`);

/** Raw bytes and file count, the two figures the project reports for precache. */
function summarize(directory) {
  let bytes = 0;
  let files = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".version") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = summarize(path);
      bytes += nested.bytes;
      files += nested.files;
    } else {
      bytes += statSync(path).size;
      files += 1;
    }
  }
  return { bytes, files };
}

const { bytes, files } = summarize(destination);
console.log(
  `Downloaded C# runtime v${version} (${(bytes / 1024 / 1024).toFixed(2)} MiB across ${files} files).`
);
