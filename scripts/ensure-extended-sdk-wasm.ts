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

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const DEFAULT_WASM_URLS = {
  js: "https://raw.githubusercontent.com/Bvvvp009/Extended-TS-SDK/main/wasm/stark_crypto_wasm.js",
  wasm: "https://raw.githubusercontent.com/Bvvvp009/Extended-TS-SDK/main/wasm/stark_crypto_wasm_bg.wasm",
} as const;

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

async function ensureFileFromSourceOrDownload(opts: {
  name: string;
  sourcePath: string | null;
  targetPath: string;
  downloadUrl: string;
}): Promise<boolean> {
  const { name, sourcePath, targetPath, downloadUrl } = opts;

  if (await fileExists(targetPath)) return true;

  await mkdir(path.dirname(targetPath), { recursive: true });

  if (sourcePath && (await fileExists(sourcePath))) {
    const bytes = await readFile(sourcePath);
    await writeFile(targetPath, bytes);
    log(`Copied ${name} -> ${targetPath}`);
    return true;
  }

  // Fallback: download (best-effort). If network is unavailable, do not crash postinstall.
  try {
    log(`Downloading ${name}: ${downloadUrl}`);
    const bytes = await downloadBinary(downloadUrl);
    await writeFile(targetPath, bytes);
    log(`Wrote ${bytes.byteLength} bytes -> ${targetPath}`);
    return true;
  } catch (error: unknown) {
    log(`WARN: Failed to download ${name}; skipping. ${(error as Error)?.message ?? String(error)}`);
    return false;
  }
}

async function patchExecutorWasmJsIfNeeded(targetJsPath: string): Promise<void> {
  // Bun/Node compatibility: some builds do not wire "./stark_crypto_wasm_bg.js" imports.
  // Ensure the import module exists and points at the same exports object.
  if (!(await fileExists(targetJsPath))) return;

  const text = await readFile(targetJsPath, "utf8");
  if (text.includes("imports['./stark_crypto_wasm_bg.js']")) return;

  // Common nodejs output pattern: placeholder module is module.exports.
  const needle = "imports['__wbindgen_placeholder__'] = module.exports;\n";
  if (text.includes(needle)) {
    const patched = text.replace(
      needle,
      `${needle}// wasm-bindgen expects this module name for imports in Node builds\nimports['./stark_crypto_wasm_bg.js'] = module.exports;\n`,
    );
    await writeFile(targetJsPath, patched);
    log(`Patched import wiring in ${targetJsPath}`);
    return;
  }

  // Proxy-based output (rare): insert an equivalent proxy mapping.
  const proxyNeedle = "imports['__wbindgen_placeholder__'] = new Proxy({}, {\n";
  if (text.includes(proxyNeedle)) {
    const insertAfter = "});\n";
    const idx = text.indexOf(insertAfter);
    if (idx !== -1) {
      const patched =
        text.slice(0, idx + insertAfter.length) +
        '\n// Also handle the "./stark_crypto_wasm_bg.js" import that wasm-bindgen expects\n' +
        "imports['./stark_crypto_wasm_bg.js'] = new Proxy({}, {\n" +
        "  get: (target, prop) => {\n" +
        "    return exports[prop];\n" +
        "  }\n" +
        "});\n" +
        text.slice(idx + insertAfter.length);
      await writeFile(targetJsPath, patched);
      log(`Patched import wiring in ${targetJsPath}`);
      return;
    }
  }
}

async function main(): Promise<void> {
  const pkgRoot = await findInstalledPackageRoot();
  if (!pkgRoot) {
    log("extended-typescript-sdk is not installed (or not discoverable); skipping.");
    return;
  }

  // v0.0.7+ publishes WASM assets under `wasm/` at package root.
  // Older builds used `dist/wasm/`.
  const pkgWasmDir = path.join(pkgRoot, "wasm");
  const distWasmDir = path.join(pkgRoot, "dist", "wasm");
  const preferDir = (await fileExists(path.join(pkgWasmDir, "stark_crypto_wasm.js"))) ? pkgWasmDir : distWasmDir;

  const executorWasmDir = path.join(process.cwd(), "apps", "executor", "wasm");

  const sourceJs = path.join(preferDir, "stark_crypto_wasm.js");
  const sourceWasm = path.join(preferDir, "stark_crypto_wasm_bg.wasm");

  const targetJs = path.join(executorWasmDir, "stark_crypto_wasm.js");
  const targetWasm = path.join(executorWasmDir, "stark_crypto_wasm_bg.wasm");

  const jsOk = await ensureFileFromSourceOrDownload({
    name: "stark_crypto_wasm.js",
    sourcePath: sourceJs,
    targetPath: targetJs,
    downloadUrl: process.env.EXTENDED_SDK_WASM_JS_URL ?? DEFAULT_WASM_URLS.js,
  });

  const wasmOk = await ensureFileFromSourceOrDownload({
    name: "stark_crypto_wasm_bg.wasm",
    sourcePath: sourceWasm,
    targetPath: targetWasm,
    downloadUrl: process.env.EXTENDED_SDK_WASM_URL ?? DEFAULT_WASM_URLS.wasm,
  });

  if (jsOk) {
    await patchExecutorWasmJsIfNeeded(targetJs);
  }

  if (jsOk && wasmOk) {
    log(`Executor WASM assets ready at: ${executorWasmDir}`);
  } else {
    log("WARN: Executor WASM assets are incomplete; initWasm() may still fail.");
  }
}

await main();
