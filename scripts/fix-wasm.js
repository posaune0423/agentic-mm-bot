const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const workspaceRoot = path.resolve(__dirname, "..");
const executorWasmDir = path.join(workspaceRoot, "apps/executor/wasm");

// Ensure target dir exists
if (!fs.existsSync(executorWasmDir)) {
  console.log(`Creating directory: ${executorWasmDir}`);
  fs.mkdirSync(executorWasmDir, { recursive: true });
}

// Function to find package in node_modules recursively
function findPackage(startDir, packageName) {
  // Check root node_modules
  const rootPath = path.join(startDir, "node_modules", packageName);
  if (fs.existsSync(rootPath)) return rootPath;

  // Check packages/adapters node_modules
  const adapterPath = path.join(startDir, "packages/adapters/node_modules", packageName);
  if (fs.existsSync(adapterPath)) return adapterPath;

  return null;
}

const sdkPath = findPackage(workspaceRoot, "extended-typescript-sdk");

if (!sdkPath) {
  console.warn("Could not find extended-typescript-sdk in standard locations. Skipping WASM fix.");
  // It might be installed in a different way or not yet installed.
  process.exit(0);
}

console.log(`Found SDK at: ${sdkPath}`);

// Check for WASM in the SDK
// The error says it looks in dist/wasm/stark_crypto_wasm
const potentialWasmDirs = [path.join(sdkPath, "dist/wasm"), path.join(sdkPath, "wasm"), path.join(sdkPath, "pkg")];

let wasmSrcDir = potentialWasmDirs.find(d => fs.existsSync(d) && fs.readdirSync(d).length > 0);

if (!wasmSrcDir) {
  console.log("WASM files missing in SDK. Attempting to build...");
  try {
    // Try to build using the package's scripts
    const packageJson = require(path.join(sdkPath, "package.json"));
    if (packageJson.scripts && packageJson.scripts["build:signer"]) {
      console.log("Running npm run build:signer...");
      execSync("npm run build:signer", { cwd: sdkPath, stdio: "inherit" });
    } else {
      console.log("No build:signer script found.");
    }
  } catch (e) {
    console.error("Failed to build signer:", e.message);
  }

  // Check again
  wasmSrcDir = potentialWasmDirs.find(d => fs.existsSync(d) && fs.readdirSync(d).length > 0);
}

if (wasmSrcDir) {
  console.log(`Copying WASM files from ${wasmSrcDir} to ${executorWasmDir}`);
  const files = fs.readdirSync(wasmSrcDir);
  for (const file of files) {
    const src = path.join(wasmSrcDir, file);
    const dest = path.join(executorWasmDir, file);
    fs.copyFileSync(src, dest);
  }
  console.log("WASM setup complete.");
} else {
  console.error("Could not locate or build WASM files. Apps requiring them may fail.");
  // We don't exit 1 to avoid breaking the build if this is optional or I am wrong about the path.
}
