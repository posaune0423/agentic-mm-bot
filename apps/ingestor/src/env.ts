/**
 * Ingestor Environment Configuration
 *
 * WebSocket 経由で取引所からマーケットデータを取得し、
 * データベースに永続化するサービスの設定。
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
     * - DEBUG: 全ログ出力（WebSocket メッセージ等も含む）
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
     * - development: ローカル開発（詳細ログ、リトライ緩和）
     * - test: テスト実行時
     * - production: 本番環境（最適化、厳格なエラー処理）
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
    SYMBOL: z.string(),

    // =========================================================================
    // Extended Exchange Credentials
    // =========================================================================

    /**
     * Extended 取引所のネットワーク環境
     *
     * 有効値: testnet | mainnet
     * - testnet: テストネット（開発・検証用、実資金なし）
     * - mainnet: メインネット（本番取引、実資金）
     *
     * .env.example の EXTENDED_NETWORK を参照
     */
    EXTENDED_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),

    /**
     * Extended 取引所の API キー
     *
     * Extended 取引所のダッシュボードから発行
     * WebSocket 接続の認証に使用
     *
     * .env.example の EXTENDED_API_KEY を参照
     */
    EXTENDED_API_KEY: z.string(),

    /**
     * Stark 署名用秘密鍵 (hex 形式)
     *
     * 例: 0x1234...abcd
     * 注意: 絶対に外部に公開しないこと
     *
     * .env.example の EXTENDED_STARK_PRIVATE_KEY を参照
     */
    EXTENDED_STARK_PRIVATE_KEY: z.string(),

    /**
     * Stark 署名用公開鍵 (hex 形式)
     *
     * 例: 0xabcd...1234
     * 秘密鍵から導出された公開鍵
     *
     * .env.example の EXTENDED_STARK_PUBLIC_KEY を参照
     */
    EXTENDED_STARK_PUBLIC_KEY: z.string(),

    /**
     * Extended 取引所の Vault ID (数値)
     *
     * Extended 取引所で割り当てられた vault の識別子
     * 資金管理に使用
     *
     * .env.example の EXTENDED_VAULT_ID を参照
     */
    EXTENDED_VAULT_ID: z.coerce.number(),

    // =========================================================================
    // Ingestor Configuration
    // =========================================================================

    /**
     * BBO (Best Bid/Offer) 書き込みのスロットル間隔 (ミリ秒)
     *
     * この間隔より短い連続更新は間引かれます
     * DB 負荷軽減のため、頻繁な更新を抑制
     *
     * ingestor 専用
     * デフォルト: 100ms
     */
    BBO_THROTTLE_MS: z.coerce.number().default(100),

    /**
     * BBO 書き込みの最小変動幅 (bps = 0.01%)
     *
     * 中値がこの幅以上変動した場合のみ書き込み
     * ノイズ的な微小変動を無視
     *
     * ingestor 専用
     * デフォルト: 1bps
     */
    BBO_MIN_CHANGE_BPS: z.coerce.number().default(1),

    /**
     * latest_top テーブルへの upsert 間隔 (ミリ秒)
     *
     * 最新の板情報を定期的に更新
     * 他サービスが参照する際の鮮度を保証
     *
     * ingestor 専用
     * デフォルト: 1000ms
     */
    LATEST_TOP_UPSERT_INTERVAL_MS: z.coerce.number().default(1000),

    // =========================================================================
    // CLI Dashboard (TTY UI)
    // =========================================================================

    /**
     * CLI ダッシュボード表示の有効/無効
     *
     * true: ターミナルに TUI ダッシュボードを表示
     * false: 通常のログ出力のみ
     *
     * ingestor 専用
     * デフォルト: true
     */
    INGESTOR_DASHBOARD: z.coerce.boolean().default(true),

    /**
     * ダッシュボードの画面更新間隔 (ミリ秒)
     *
     * 小さいほど滑らかに更新されるが CPU 負荷が増加
     *
     * ingestor 専用
     * デフォルト: 250ms
     */
    INGESTOR_DASHBOARD_REFRESH_MS: z.coerce.number().default(250),

    /**
     * ダッシュボードのカラー表示無効化
     *
     * true: モノクロ出力（CI 環境等で使用）
     * false: カラー出力
     *
     * ingestor 専用
     * デフォルト: false
     */
    INGESTOR_DASHBOARD_NO_COLOR: z.coerce.boolean().default(false),

    /**
     * データの stale (古い) 判定閾値 (ミリ秒)
     *
     * 最終更新からこの時間が経過するとデータを stale として表示
     * WebSocket 切断検知等に使用
     *
     * ingestor 専用
     * デフォルト: 3000ms
     */
    INGESTOR_DASHBOARD_STALE_MS: z.coerce.number().default(3000),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
