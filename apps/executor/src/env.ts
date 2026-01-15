/**
 * Executor Environment Configuration
 *
 * Requirements: 1.4
 * - Type-safe environment variables with Zod validation
 *
 * マーケットメイキング戦略を実行し、取引所に注文を発行するサービスの設定。
 * LLM からの提案パラメータを適用し、リアルタイムで戦略を調整します。
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
     * - DEBUG: 全ログ出力（注文詳細、tick 毎の状態等）
     *
     * .env.example の LOG_LEVEL を参照
     */
    LOG_LEVEL: z.enum(["ERROR", "WARN", "LOG", "INFO", "DEBUG"]).default("INFO"),

    /**
     * ログファイル出力ディレクトリ
     *
     * 相対パスの場合は executor ルートからの相対位置
     * reasoning ログや実行履歴を保存
     *
     * .env.example の LOG_DIR を参照
     * デフォルト: ./logs
     */
    LOG_DIR: z.string().default("./logs"),

    // =========================================================================
    // Application
    // =========================================================================

    /**
     * アプリケーション実行環境
     *
     * 有効値: development | test | production
     * - development: ローカル開発（詳細ログ、安全ガード緩和）
     * - test: テスト実行時
     * - production: 本番環境（最適化、厳格なリスク管理）
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
     * 注文の認証に使用
     *
     * .env.example の EXTENDED_API_KEY を参照
     */
    EXTENDED_API_KEY: z.string(),

    /**
     * Stark 署名用秘密鍵 (hex 形式)
     *
     * 例: 0x1234...abcd
     * 注文署名に使用。絶対に外部に公開しないこと
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
     * 注文発行時に必要
     *
     * .env.example の EXTENDED_VAULT_ID を参照
     */
    EXTENDED_VAULT_ID: z.coerce.number(),

    // =========================================================================
    // Executor Configuration
    // =========================================================================

    /**
     * メインループの tick 間隔 (ミリ秒)
     *
     * 戦略ロジックが実行される周期
     * 小さいほど反応が速いが CPU 負荷・API レート制限に注意
     *
     * .env.example の TICK_INTERVAL_MS を参照
     * デフォルト: 200ms
     */
    TICK_INTERVAL_MS: z.coerce.number().default(200),

    /**
     * 戦略状態の永続化間隔 (ミリ秒)
     *
     * ポジション、注文状態等を DB に保存する周期
     * 再起動時のリカバリに使用
     *
     * executor 専用
     * デフォルト: 10,000ms (10秒)
     */
    STATE_PERSIST_INTERVAL_MS: z.coerce.number().default(10_000),

    /**
     * イベントバッファのフラッシュ間隔 (ミリ秒)
     *
     * 約定・注文イベントを DB にバッチ書き込みする周期
     *
     * executor 専用
     * デフォルト: 1,000ms (1秒)
     */
    EVENT_FLUSH_INTERVAL_MS: z.coerce.number().default(1_000),

    // =========================================================================
    // Strategy Params Refresh
    // =========================================================================

    /**
     * 戦略パラメータの自動更新の有効/無効
     *
     * true: DB から定期的にパラメータを再読み込み
     * false: 起動時のパラメータを固定使用
     *
     * executor 専用
     * デフォルト: true
     */
    PARAMS_REFRESH_ENABLED: z.coerce.boolean().default(true),

    /**
     * 戦略パラメータの更新チェック間隔 (ミリ秒)
     *
     * DB から最新パラメータを取得する周期
     *
     * executor 専用
     * デフォルト: 5,000ms (5秒)
     */
    PARAMS_REFRESH_INTERVAL_MS: z.coerce.number().default(5_000),

    // =========================================================================
    // LLM Proposal Apply
    // =========================================================================

    /**
     * LLM 提案の自動適用の有効/無効
     *
     * true: llm-reflector からの提案を自動で戦略に反映
     * false: 提案を無視
     *
     * executor 専用
     * デフォルト: true
     */
    PROPOSAL_APPLY_ENABLED: z.coerce.boolean().default(true),

    /**
     * LLM 提案のポーリング間隔 (ミリ秒)
     *
     * 新しい提案があるか確認する周期
     *
     * executor 専用
     * デフォルト: 1,000ms (1秒)
     */
    PROPOSAL_APPLY_POLL_INTERVAL_MS: z.coerce.number().default(1_000),

    /**
     * 提案適用の境界時刻 (分)
     *
     * 指定分の境界（例: 1分なら 00秒）で提案を適用
     * 分析と適用のタイミングを同期
     *
     * executor 専用
     * デフォルト: 1分
     */
    PROPOSAL_APPLY_BOUNDARY_MINUTES: z.coerce.number().default(1),

    /**
     * 境界時刻からの猶予時間 (秒)
     *
     * 境界時刻からこの秒数以内の提案のみ適用
     * 古い提案の誤適用を防止
     *
     * executor 専用
     * デフォルト: 30秒
     */
    PROPOSAL_APPLY_BOUNDARY_GRACE_SECONDS: z.coerce.number().default(30),

    /**
     * 提案適用時のデータ鮮度閾値 (ミリ秒)
     *
     * マーケットデータがこの時間以上古い場合は適用をスキップ
     * stale データでの誤った判断を防止
     *
     * executor 専用
     * デフォルト: 10,000ms (10秒)
     */
    PROPOSAL_APPLY_DATA_STALE_MS: z.coerce.number().default(10_000),

    /**
     * 直近1時間の最大一時停止回数
     *
     * この回数を超えて pause 提案があった場合は無視
     * 過剰な停止によるチャンス損失を防止
     *
     * executor 専用
     * デフォルト: 20回
     */
    PROPOSAL_APPLY_MAX_PAUSE_COUNT_LAST_HOUR: z.coerce.number().default(20),

    /**
     * 提案適用の markout P50 下限 (bps)
     *
     * 10秒 markout の P50 がこの値を下回る場合は提案を拒否
     * パフォーマンス悪化時の変更を抑制
     * 非常に低い値（例: -1e9）で実質無効化
     *
     * executor 専用
     * デフォルト: -1e9 (無効)
     */
    PROPOSAL_APPLY_MIN_MARKOUT10S_P50_BPS: z.coerce.number().default(-1e9),

    // =========================================================================
    // CLI Dashboard (TTY UI)
    // =========================================================================

    /**
     * CLI ダッシュボード表示の有効/無効
     *
     * true: ターミナルに TUI ダッシュボードを表示
     * false: 通常のログ出力のみ
     *
     * executor 専用
     * デフォルト: true
     */
    EXECUTOR_DASHBOARD: z.coerce.boolean().default(true),

    /**
     * ダッシュボードの画面更新間隔 (ミリ秒)
     *
     * 小さいほど滑らかに更新されるが CPU 負荷が増加
     *
     * executor 専用
     * デフォルト: 250ms
     */
    EXECUTOR_DASHBOARD_REFRESH_MS: z.coerce.number().default(250),

    /**
     * ダッシュボードのカラー表示無効化
     *
     * true: モノクロ出力（CI 環境等で使用）
     * false: カラー出力
     *
     * executor 専用
     * デフォルト: false
     */
    EXECUTOR_DASHBOARD_NO_COLOR: z.coerce.boolean().default(false),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
