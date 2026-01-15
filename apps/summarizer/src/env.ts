/**
 * Summarizer Environment Configuration
 *
 * マーケットデータと約定履歴を集計し、
 * 統計サマリー（markout、P&L 等）を生成するサービスの設定。
 *
 * 環境変数のテンプレートは .env.example を参照してください。
 * bun run setup-env で .env ファイルを自動生成できます。
 *
 */

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * t3-env (@t3-oss/env-core) による型安全な環境変数バリデーション
 *
 * 注意: `process.env` を直接参照せず、この `env` を import して使用してください。
 * Zod スキーマによりランタイムで型検証が行われます。
 */
export const env = createEnv({
  server: {
    // =========================================================================
    // Database
    // =========================================================================

    /**
     * PostgreSQL データベース接続 URL
     *
     * 形式: postgresql://USER:PASSWORD@HOST:PORT/DATABASE
     * 例: postgresql://postgres:password@localhost:5432/mm_bot
     *
     * .env.example の DATABASE_URL を参照
     */
    DATABASE_URL: z.url(),

    // =========================================================================
    // Logging
    // =========================================================================

    /**
     * ログ出力レベル
     *
     * 有効値: ERROR | WARN | LOG | INFO | DEBUG
     * - ERROR: エラーのみ
     * - WARN: 警告以上
     * - LOG: 通常ログ以上
     * - INFO: 情報レベル以上 (デフォルト)
     * - DEBUG: 全ログ出力（集計詳細等）
     *
     * .env.example の LOG_LEVEL を参照
     */
    LOG_LEVEL: z.enum(["ERROR", "WARN", "LOG", "INFO", "DEBUG"]).default("INFO"),

    // =========================================================================
    // Application
    // =========================================================================

    /**
     * アプリケーション実行環境
     *
     * 有効値: development | test | production
     * - development: ローカル開発（詳細ログ）
     * - test: テスト実行時
     * - production: 本番環境（最適化）
     *
     * .env.example の APP_ENV を参照
     */
    APP_ENV: z.enum(["development", "test", "production"]).default("development"),

    // =========================================================================
    // Trading
    // =========================================================================

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

    // =========================================================================
    // Scheduler
    // =========================================================================

    /**
     * サマリー生成の実行間隔 (ミリ秒)
     *
     * この間隔で定期的に統計集計を実行
     * 短いほどリアルタイム性が高いが DB 負荷が増加
     *
     * summarizer 専用
     * デフォルト: 10,000ms (10秒)
     */
    RUN_INTERVAL_MS: z.coerce.number().default(10_000),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
