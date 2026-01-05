import { rm } from "node:fs/promises";
import { join } from "node:path";

// 削除対象のディレクトリ・ファイル名
const COMMON_TARGETS = ["node_modules", ".turbo", ".next", "dist", "build", "out", "coverage", "*.tsbuildinfo"];

// コントラクト開発固有の削除対象
const CONTRACTS_TARGETS = ["artifacts", "cache", "typechain-types"];

async function getWorkspacePaths(): Promise<string[]> {
  const packageJson = await Bun.file("package.json").json();
  const patterns = packageJson.workspaces?.packages ?? packageJson.workspaces ?? [];

  const paths: string[] = ["."]; // ルートディレクトリも含める

  // パターンごとのディレクトリ探索を並列化
  const patternTasks = patterns.map(async (pattern: string) => {
    const dir = pattern.replace(/\/\*$/, "");
    const glob = new Bun.Glob("*");

    const entries: string[] = [];
    for await (const entry of glob.scan({ cwd: dir, onlyFiles: false })) {
      entries.push(entry);
    }

    // エントリーごとの package.json チェックも並列化
    await Promise.all(
      entries.map(async entry => {
        const fullPath = join(dir, entry);
        if (entry === "node_modules") return;

        if (await Bun.file(join(fullPath, "package.json")).exists()) {
          paths.push(fullPath);
        }
      }),
    );
  });

  await Promise.all(patternTasks);

  return paths;
}

async function clean() {
  const start = performance.now();
  console.log("🧹 Cleaning project...");

  const workspaces = await getWorkspacePaths();

  // 全ワークスペース × 全ターゲット の処理を並列化
  const tasks = workspaces.flatMap(ws => {
    const targets = [...COMMON_TARGETS, ...(ws.includes("packages/contracts") ? CONTRACTS_TARGETS : [])];

    return targets.map(async target => {
      if (target.includes("*")) {
        // ワイルドカードの場合は glob スキャンしながら並列削除
        const glob = new Bun.Glob(target);
        const subTasks: Promise<void>[] = [];

        for await (const file of glob.scan({ cwd: ws, absolute: true })) {
          subTasks.push(rm(file, { recursive: true, force: true }));
        }
        await Promise.all(subTasks);
      } else {
        // 固定パスの場合は即削除
        const path = join(ws, target);
        await rm(path, { recursive: true, force: true });
      }
    });
  });

  await Promise.all(tasks);

  const end = performance.now();
  console.log(`✨ Cleaned in ${(end - start).toFixed(2)}ms`);
}

clean().catch(console.error);
