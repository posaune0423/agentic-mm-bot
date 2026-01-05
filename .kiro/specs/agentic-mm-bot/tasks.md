# Implementation Plan

- [x] 1. 環境・設定・共通基盤を整備する (P)
- [x] 1.1 (P) env を Zod で型安全に定義し、各 app の env.ts で環境変数を検証する
  - 共通env（DATABASE_URL / LOG_DIR / APP_ENV / EXCHANGE / SYMBOL）と、Extended用secretを含める
  - 起動時に必須値不足を検知し、わかりやすいエラーを返す
  - _Requirements: 1.4_
- [x] 1.2 (P) observability（logger/metrics）を最小構成で提供する
  - executor/ingestor/summarizer/backtest から同一のlogger/メトリクスAPIで利用できる
  - _Requirements: 2.2_

- [x] 2. DBスキーマ（Drizzle SoT）とmigrations（Postgres標準の物理最適化）を実装する
- [x] 2.1 `md_*` / `latest_*` / `ex_*` / `fills_enriched` / `strategy_params` / `strategy_state` をDrizzleで定義する
  - テーブル/型/制約（PK、必要なユニーク制約、FK最小）を揃える
  - _Requirements: 1.2, 2.4, 12.1, 12.4_
- [x] 2.2 Postgres標準の物理最適化を migrations SQL で適用する
  - `md_bbo` / `md_trade` / `md_price` の主要インデックス（exchange,symbol,ts DESC）を適用する
  - 必要に応じて、テーブル肥大化対策（VACUUM方針、将来のパーティショニング導入余地）を記述する（MVPでは適用しない）
  - _Requirements: 12.2, 12.3_
- [x] 2.3 `strategy_state` の定期保存を前提に、読み書きのクエリ/リポジトリを用意する
  - 復旧用の最新スナップショットを取得できる
  - _Requirements: 4.11, 12.4_

- [x] 3. core（純粋ロジック）を実装する (P)
- [x] 3.1 (P) StrategyState（NORMAL/DEFENSIVE/PAUSE）と遷移優先順位を純粋ロジックで定義する
  - HARD PAUSE 条件と、解除後にDEFENSIVEへ戻すルールを含める
  - _Requirements: 5.1, 5.2, 5.6_
- [x] 3.2 (P) Feature 定義（mid/spread/imbalance/vol/div/liqCount）と欠損時の防御ルールを確定する
  - 欠損/計算不能時は quote を出さない判断に寄与できる
  - _Requirements: 6.1, 6.6_
- [x] 3.3 (P) クォート計算（1レベルpost-only）を純粋ロジックで定義する
  - half_spread と inventory skew を用いたbid/askを生成できる
  - _Requirements: 7.2, 7.3, 7.4_
- [x] 3.4 (P) RiskPolicy（PAUSE優先）を純粋ロジックで定義する
  - data stale / mark-index乖離 / liqCount / inventory逸脱をトリガにできる
  - _Requirements: 8.1, 8.2_
- [x] 3.5 (P) core のユニットテストを整備する
  - state遷移、risk発火、クォート計算、PAUSE時のCANCEL_ALLのみを検証する
  - _Requirements: 14.1_

- [x] 4. Extended adapter（SDK前提）のI/O層を実装する (P)
- [x] 4.1 (P) public market data の購読（BBO/Trades/Mark/Index）と再接続戦略を実装する
  - 指数バックオフで再接続でき、seq破綻があれば復旧できる
  - _Requirements: 3.1, 3.4, 3.5_
- [x] 4.2 (P) 取引API（post-only発注/取消/キャンセルオール）を実装し、エラーをカテゴリ化する
  - post-only reject を検知し、次tickに委ねられる
  - _Requirements: 4.3, 7.6_
- [x] 4.3 (P) private stream（orders/fills/position）の購読を実装し、フォールバックとしてREST同期を提供する
  - open orders / position を秒オーダーで同期できる
  - _Requirements: 4.7, 4.8_

- [x] 5. ingestor（録画 + latest\_\* upsert）を実装する
- [x] 5.1 public stream から市場データを正規化して `md_*` にappendする
  - raw_json の保存を含め、監査/デバッグに使える
  - _Requirements: 3.1, 3.2_
- [x] 5.2 `latest_top` をupsertし続ける
  - executorの復旧や低コスト参照に使える
  - _Requirements: 3.3_
- [x] 5.3 `md_bbo` の間引き設定を実装する
  - 設定（時間間隔/条件/市場）により書き込み量を抑制できる
  - _Requirements: 3.6_

- [x] 6. executor（WS中心Runtime + スロットリング）を実装する
- [x] 6.1 MarketData/Order/Position をメモリ保持し、Snapshot/Features を生成できる
  - 低レイテンシの意思決定のために短期窓（1s/10s）を保持できる
  - _Requirements: 4.1, 4.2, 4.6_
- [x] 6.2 イベント駆動 + スロットリングで tick を制御する
  - WSイベント到着ごとに必ず発注しない
  - _Requirements: 4.9_
- [x] 6.3 core の判断結果を最小更新の実行計画へ変換し、発注/取消を実行する
  - refresh interval / stale cancel を考慮し、無駄cancelを抑制する
  - _Requirements: 7.7, 7.8_
- [x] 6.4 PAUSE時に必ず cancel_all を実行し、再開時はDEFENSIVEへ戻す
  - _Requirements: 4.5, 5.6, 7.5_
- [x] 6.5 hot path をブロックしない形でイベントログを永続化する
  - md/ex/decision を非同期バッチでappendできる
  - _Requirements: 4.10, 4.4_
- [x] 6.6 復旧用に strategy_state を定期保存し、起動時に復元できる
  - _Requirements: 4.11_

- [x] 7. summarizer（fills_enriched + markout + 集計）を実装する
- [x] 7.1 fillごとに `fills_enriched` を生成する
  - mid参照のmarkout（1s/10s/60s）と欠損時nullを扱える
  - _Requirements: 9.1, 9.2, 9.3_
- [x] 7.2 worst fills 抽出と最小集計（1分/1時間）を生成する
  - _Requirements: 9.6_

- [x] 8. backtest（録画replay + simulated execution）を実装する
- [x] 8.1 md\_\* をreplayし、同一coreロジックで意思決定を実行できる
  - tick間隔を設定できる
  - _Requirements: 11.1, 11.2_
- [x] 8.2 simulated execution（touch fill）で fill を生成し、指標を出力できる
  - fills/PAUSE/擬似markoutを出力する
  - _Requirements: 11.3, 11.4_

- [x] 9. 統合テストを整備する
- [x] 9.1 DB migrations と基本的なinsert/upsertが成立することを検証する
  - _Requirements: 12.3, 14.2_
- [x] 9.2 summarizer が fills_enriched を生成できることを検証する
  - _Requirements: 9.1, 14.2_
- [x] 9.3 executor が欠損時に quote しないことと、PAUSEで cancel_all が走ることを検証する
  - _Requirements: 6.6, 4.5, 14.3.2_

- [x] 10. Future Extension: LLM 改善ループ（将来拡張）
- [x] 10.1 llm-reflector が提案を生成してDBへ保存できる
  - _Requirements: 10.1, 10.2_
- [x] 10.2 executor が提案を検証し、適用/拒否の監査ログを残せる
  - _Requirements: 10.4, 10.5, 10.6_
- [x] 10.3 推論ログをファイルへ永続化し、DBで参照できる
  - _Requirements: 13.1, 13.4_
