/**
 * LLM Reflector Environment Configuration
 *
 * Requirements: 1.4, 10.1, 13.1
 * - Environment variables via Zod validation
 * - MODEL for Mastra model router (pluggable LLM provider)
 * - LOG_DIR for reasoning log storage
 *
 * マーケットメイキングのパフォーマンスを分析し、
 * LLM を使用して戦略パラメータの調整提案を生成するサービスの設定。
 *
 * 環境変数のテンプレートは .env.example を参照してください。
 * bun run setup-env で .env ファイルを自動生成できます。
 *
 */

import { z } from "zod";

/**
 * Zod スキーマによる型安全な環境変数定義
 *
 * 注意: `process.env` を直接参照せず、loadEnv() で取得した値を使用してください。
 */
const EnvSchema = z.object({
  // ===========================================================================
  // Database
  // ===========================================================================

  /**
   * PostgreSQL データベース接続 URL
   *
   * 形式: postgresql://USER:PASSWORD@HOST:PORT/DATABASE
   * 例: postgresql://postgres:password@localhost:5432/mm_bot
   *
   * .env.example の DATABASE_URL を参照
   */
  DATABASE_URL: z.url(),

  // ===========================================================================
  // Logging
  // ===========================================================================

  /**
   * ログ出力レベル
   *
   * 有効値: ERROR | WARN | LOG | INFO | DEBUG
   * - ERROR: エラーのみ
   * - WARN: 警告以上
   * - LOG: 通常ログ以上
   * - INFO: 情報レベル以上 (デフォルト)
   * - DEBUG: 全ログ出力（LLM プロンプト・レスポンス詳細等）
   *
   * .env.example の LOG_LEVEL を参照
   */
  LOG_LEVEL: z.enum(["ERROR", "WARN", "LOG", "INFO", "DEBUG"]).default("INFO"),

  // ===========================================================================
  // Application
  // ===========================================================================

  /**
   * アプリケーション実行環境
   *
   * 有効値: development | test | production
   * - development: ローカル開発（詳細ログ、モック許可）
   * - test: テスト実行時
   * - production: 本番環境（コスト最適化、厳格なエラー処理）
   *
   * .env.example の APP_ENV を参照
   */
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),

  // ===========================================================================
  // Trading
  // ===========================================================================

  /**
   * 使用する取引所の識別子
   *
   * 有効値: extended (現在は extended のみサポート)
   *
   * .env.example の EXCHANGE を参照
   */
  EXCHANGE: z.string().default("extended"),

  /**
   * 取引対象のシンボル（通貨ペア）
   *
   * 形式: BASE-QUOTE
   * 例: BTC-USD, ETH-USD
   *
   * .env.example の SYMBOL を参照
   */
  SYMBOL: z.string().default("BTC-USD"),

  // ===========================================================================
  // LLM Configuration
  // ===========================================================================

  /**
   * 使用する LLM モデル (Mastra model router 形式)
   *
   * 形式: provider/model
   * 例:
   * - openai/gpt-4o (推奨: 高精度)
   * - openai/gpt-4o-mini (コスト重視)
   * - anthropic/claude-3-opus (代替)
   * - anthropic/claude-3-sonnet (コスト重視代替)
   *
   * .env.example の MODEL を参照
   * デフォルト: openai/gpt-4o
   */
  MODEL: z.string().default("openai/gpt-4o"),

  /**
   * OpenAI API キー
   *
   * MODEL が openai/* の場合に必要
   * https://platform.openai.com/api-keys から取得
   *
   * Mastra が自動検出するため環境変数名は固定
   * .env.example の OPENAI_API_KEY を参照
   *
   * 注意: 起動時は optional。実行時に provider エラーとして表面化
   */
  OPENAI_API_KEY: z.string().optional(),

  /**
   * Anthropic API キー
   *
   * MODEL が anthropic/* の場合に必要
   * https://console.anthropic.com/settings/keys から取得
   *
   * Mastra が自動検出するため環境変数名は固定
   * .env.example の ANTHROPIC_API_KEY を参照
   *
   * 注意: 起動時は optional。実行時に provider エラーとして表面化
   */
  ANTHROPIC_API_KEY: z.string().optional(),

  // ===========================================================================
  // Log Storage
  // ===========================================================================

  /**
   * ログファイル出力ディレクトリ
   *
   * 相対パスの場合は llm-reflector ルートからの相対位置
   * reasoning ログ（LLM の思考過程）を JSON で保存
   *
   * .env.example の LOG_DIR を参照
   * デフォルト: ./logs
   */
  LOG_DIR: z.string().default("./logs"),

  // ===========================================================================
  // Scheduler
  // ===========================================================================

  /**
   * リフレクション実行の間隔 (ミリ秒)
   *
   * この間隔で定期的に分析・提案生成を実行
   * LLM API コスト・レート制限を考慮して設定
   *
   * llm-reflector 専用
   * デフォルト: 60,000ms (1分)
   */
  RUN_INTERVAL_MS: z.coerce.number().default(60_000),

  /**
   * リフレクション対象の時間窓 (分)
   *
   * 分析対象となる直近の完了した時間窓の長さ
   * 例:
   * - 5: 直近の完了した5分間 (デフォルト)
   * - 15: 直近の完了した15分間
   * - 60: 直近の完了した1時間
   *
   * llm-reflector 専用
   * デフォルト: 5分
   */
  REFLECTION_WINDOW_MINUTES: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * 環境変数を読み込み、バリデーションを実行
 *
 * @returns バリデーション済みの環境変数オブジェクト
 * @throws Error バリデーション失敗時
 *
 * 注意: API キーは起動時に必須ではありません。
 * ローカル開発時にキーがなくても turbo run dev 全体がクラッシュしないよう、
 * 実行時に provider エラーとして表面化させ、ワーカーは生存させます。
 */
export function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map(issue => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");

    throw new Error(`❌ Environment validation failed:\n${issues}`);
  }

  return result.data;
}
