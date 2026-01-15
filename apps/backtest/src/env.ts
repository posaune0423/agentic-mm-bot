/**
 * Backtest Environment Configuration
 *
 * Requirements: 11.1-11.4
 * - Replay md_* data with fixed tick interval
 * - Simulated execution (touch fill)
 * - Output metrics and CSV
 *
 * 環境変数は dotenvx で暗号化されたファイルで管理されています。
 * - ローカル: `.encrypted.local`（デフォルト）
 * - 本番: 実行環境の env、または別ファイル（例: `.encrypted`）
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
    /**
     * PostgreSQL データベース接続 URL
     *
     * 形式: postgresql://USER:PASSWORD@HOST:PORT/DATABASE
     * 例: postgresql://postgres:password@localhost:5432/mm_bot
     *
     * `.encrypted.local`（または指定された暗号化ファイル）の DATABASE_URL を参照
     */
    DATABASE_URL: z.url(),

    /**
     * ログ出力レベル
     *
     * 有効値: ERROR | WARN | LOG | INFO | DEBUG
     * - ERROR: エラーのみ
     * - WARN: 警告以上
     * - LOG: 通常ログ以上
     * - INFO: 情報レベル以上 (デフォルト)
     * - DEBUG: 全ログ出力
     *
     * `.encrypted.local`（または指定された暗号化ファイル）の LOG_LEVEL を参照
     */
    LOG_LEVEL: z.enum(["ERROR", "WARN", "LOG", "INFO", "DEBUG"]).default("INFO"),

    /**
     * 使用する取引所の識別子
     *
     * 有効値: extended (現在は extended のみサポート)
     *
     * `.encrypted.local`（または指定された暗号化ファイル）の EXCHANGE を参照
     */
    EXCHANGE: z.string().default("extended"),

    /**
     * 取引対象のシンボル（通貨ペア）
     *
     * 形式: BASE-QUOTE
     * 例: BTC-USD, ETH-USD
     *
     * `.encrypted.local`（または指定された暗号化ファイル）の SYMBOL を参照
     */
    SYMBOL: z.string(),

    /**
     * バックテスト開始時刻
     *
     * ISO 8601 形式または Date にパース可能な文字列
     * 例: 2024-01-01T00:00:00Z
     *
     * backtest 専用
     */
    START_TIME: z.coerce.date(),

    /**
     * バックテスト終了時刻
     *
     * ISO 8601 形式または Date にパース可能な文字列
     * 例: 2024-01-02T00:00:00Z
     *
     * backtest 専用
     */
    END_TIME: z.coerce.date(),

    /**
     * メインループの tick 間隔 (ミリ秒)
     *
     * バックテストでは固定間隔でデータを再生します (11.2)
     * 小さいほど細かい粒度でシミュレーションしますが処理時間が増加
     *
     * `.encrypted.local`（または指定された暗号化ファイル）の TICK_INTERVAL_MS を参照
     * デフォルト: 200ms
     */
    TICK_INTERVAL_MS: z.coerce.number().default(200),

    /**
     * バックテスト結果の CSV 出力先ファイルパス (11.4)
     *
     * 指定した場合、約定履歴を CSV 形式で出力
     * 例: ./output/backtest-results.csv
     *
     * backtest 専用
     */
    BACKTEST_OUT_CSV: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
