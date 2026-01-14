/**
 * Ensure extended-typescript-sdk ships required WASM artifact.
 *
 * Problem:
 * - extended-typescript-sdk@0.0.1 published to npm contains `dist/wasm/stark_crypto_wasm.js`
 *   but is missing `dist/wasm/stark_crypto_wasm_bg.wasm`.
 * - At runtime, `initWasm()` reads the .wasm from the same directory and crashes with ENOENT.
 *
 * Fix:
 * - Download the missing `.wasm` from the upstream GitHub repository and place it into the
 *   installed package folder.
 *
 * Notes:
 * - This script is intended to run in `postinstall`.
 * - It is safe to run multiple times (idempotent).
 */

import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const DEFAULT_NODE_WASM_URL =
  "https://raw.githubusercontent.com/Bvvvp009/Extended-TS-SDK/main/wasm/stark_crypto_wasm_bg.wasm";

function log(msg: string): void {
  // postinstall script: stdout is acceptable
  // eslint-disable-next-line no-console
  console.log(`[ensure-extended-sdk-wasm] ${msg}`);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

async function downloadBinary(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function findInstalledPackageRoot(): Promise<string | null> {
  const require = createRequire(import.meta.url);

  // 1) Node-style install: node_modules/extended-typescript-sdk
  try {
    const pkgJsonPath = require.resolve("extended-typescript-sdk/package.json");
    return path.dirname(pkgJsonPath);
  } catch {
    // fallthrough
  }

  // 2) Bun-style install: node_modules/.bun/<pkg>@<ver>/node_modules/extended-typescript-sdk
  const bunDir = path.join(process.cwd(), "node_modules", ".bun");
  try {
    const entries = await readdir(bunDir, { withFileTypes: true });
    const candidates = entries
      .filter(e => e.isDirectory() && e.name.startsWith("extended-typescript-sdk@"))
      .map(e => path.join(bunDir, e.name, "node_modules", "extended-typescript-sdk"));

    for (const c of candidates) {
      // Check by looking for dist/index.js (published artifact)
      if (await fileExists(path.join(c, "dist", "index.js"))) return c;
    }
  } catch {
    // ignore
  }

  // 3) Unknown layout
  return null;
}

async function main(): Promise<void> {
  const pkgRoot = await findInstalledPackageRoot();
  if (!pkgRoot) {
    log("extended-typescript-sdk is not installed (or not discoverable); skipping.");
    return;
  }
  const distWasmDir = path.join(pkgRoot, "dist", "wasm");
  const targetWasmPath = path.join(distWasmDir, "stark_crypto_wasm_bg.wasm");

  if (await fileExists(targetWasmPath)) {
    log("WASM artifact already present; ok.");
    return;
  }

  const url = process.env.EXTENDED_SDK_WASM_URL ?? DEFAULT_NODE_WASM_URL;

  log(`Missing WASM artifact: ${targetWasmPath}`);
  log(`Downloading: ${url}`);

  const bytes = await downloadBinary(url);

  await mkdir(distWasmDir, { recursive: true });
  await writeFile(targetWasmPath, bytes);

  log(`Wrote ${bytes.byteLength} bytes -> ${targetWasmPath}`);
}

await main();
