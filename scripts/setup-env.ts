#!/usr/bin/env bun
/**
 * Setup Environment Variables Script
 *
 * 各ディレクトリの .env.example から .env ファイルを生成します。
 *
 * 構成:
 *   - root/.env.example -> root/.env (グローバル変数: DATABASE_URL 等)
 *   - apps/xxx/.env.example -> apps/xxx/.env (アプリ固有変数)
 *
 * turbo.json の globalDotEnv により、root/.env は全タスクで自動的に読み込まれます。
 *
 * 使用方法:
 *   bun run setup-env           # .env.example がある全ディレクトリに .env を生成
 *   bun run setup-env --force   # 既存の .env を上書き
 *   bun run setup-env --dry-run # 実行内容を表示するのみ（書き込みなし）
 */

import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

// =============================================================================
// Constants
// =============================================================================

const ROOT_DIR = resolve(dirname(import.meta.dirname));
const APPS_DIR = join(ROOT_DIR, "apps");

// =============================================================================
// Utilities
// =============================================================================

/**
 * ディレクトリ内のサブディレクトリ一覧を取得
 */
function getSubdirectories(dir: string): string[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir).filter(name => {
    const fullPath = join(dir, name);
    return statSync(fullPath).isDirectory() && !name.startsWith(".");
  });
}

/**
 * .env.example から .env を生成
 */
function generateEnv(
  dir: string,
  label: string,
  force: boolean,
  dryRun: boolean,
): "created" | "overwritten" | "skipped" | "no-example" {
  const examplePath = join(dir, ".env.example");
  const envPath = join(dir, ".env");

  if (!existsSync(examplePath)) {
    return "no-example";
  }

  const envExists = existsSync(envPath);

  if (envExists && !force) {
    console.log(`⏭️  ${label}: .env が既に存在します (--force で上書き)`);
    return "skipped";
  }

  if (dryRun) {
    if (envExists) {
      console.log(`📝 ${label}: .env を上書き予定`);
    } else {
      console.log(`📝 ${label}: .env を生成予定`);
    }
    return envExists ? "overwritten" : "created";
  }

  copyFileSync(examplePath, envPath);

  if (envExists) {
    console.log(`✅ ${label}: .env を上書きしました`);
    return "overwritten";
  } else {
    console.log(`✅ ${label}: .env を生成しました`);
    return "created";
  }
}

// =============================================================================
// Main Logic
// =============================================================================

function main() {
  const { values } = parseArgs({
    options: {
      force: { type: "boolean", default: false, short: "f" },
      "dry-run": { type: "boolean", default: false, short: "n" },
      help: { type: "boolean", default: false, short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
Usage: bun run setup-env [options]

Options:
  -f, --force     既存の .env ファイルを上書きする
  -n, --dry-run   実行内容を表示するのみ（書き込みなし）
  -h, --help      このヘルプを表示

Description:
  各ディレクトリの .env.example から .env ファイルを生成します。

  構成:
    - root/.env    グローバル変数（DATABASE_URL 等）
    - apps/*/.env  アプリ固有変数

  turbo の globalDotEnv により root/.env は全タスクで自動読み込みされます。
`);
    process.exit(0);
  }

  const force = values.force ?? false;
  const dryRun = values["dry-run"] ?? false;

  console.log("🔧 Setup Environment Variables\n");

  let created = 0;
  let overwritten = 0;
  let skipped = 0;

  // Root .env
  console.log("--- Root ---");
  const rootResult = generateEnv(ROOT_DIR, "root", force, dryRun);
  if (rootResult === "created") created++;
  else if (rootResult === "overwritten") overwritten++;
  else if (rootResult === "skipped") skipped++;
  else if (rootResult === "no-example") {
    console.log("⚠️  root: .env.example が見つかりません");
  }

  // Apps
  console.log("\n--- Apps ---");
  for (const name of getSubdirectories(APPS_DIR)) {
    const dir = join(APPS_DIR, name);
    const result = generateEnv(dir, `apps/${name}`, force, dryRun);
    if (result === "created") created++;
    else if (result === "overwritten") overwritten++;
    else if (result === "skipped") skipped++;
    // no-example は無視（.env.example がないアプリはスキップ）
  }

  // サマリー
  console.log("\n" + "=".repeat(60));
  if (dryRun) {
    console.log("🔍 Dry-run 完了（実際の書き込みは行われていません）");
  } else {
    console.log(`✨ 完了: 作成 ${created} 件, 上書き ${overwritten} 件, スキップ ${skipped} 件`);
  }

  if (skipped > 0 && !force) {
    console.log("\n💡 既存の .env を上書きするには --force オプションを使用してください");
  }

  console.log("\n📌 注意:");
  console.log("   - 秘匿情報（API キー等）を適切な値に置き換えてください");
  console.log("   - root/.env は turbo の globalDotEnv により全タスクで読み込まれます");
}

main();
