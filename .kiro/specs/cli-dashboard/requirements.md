# Requirements Document

## Introduction

本仕様は、`apps/ingestor` と `apps/executor` の稼働状況を **CLI上でリアルタイムに可視化**し、運用担当者が「現在どのデータを取得しているか」「どの銘柄に対して、どんな価格・サイズで注文が出ているか」「ポジションやモードがどうなっているか」を即座に把握できるようにするための要件を定義する。

特に、他のログ出力と競合して画面がチカチカ（スクロール・崩れ・再描画乱れ）しないこと、リアルタイムデータを **滑らかに表示し続ける** ことを非交渉の要件とする。

## Requirements

### Requirement 1: ミッション・スコープ（何を可視化するか）

**Objective:** As a 運用担当者, I want ingestor/executor の稼働状態と市場・注文・ポジションの要点を1画面で把握したい, so that 異常検知と状況把握を最短で行える

#### Acceptance Criteria

- **1.1** The system shall `apps/ingestor` と `apps/executor` の双方でCLIダッシュボードを有効化できる（少なくとも片方だけでも起動可能）。
- **1.2** The system shall ダッシュボードが表示対象とする最小単位を (exchange, symbol) とする（例：`BTC-USD`）。
- **1.3** The system shall 運用上重要な「最新状態（latest）」を優先し、履歴の全量表示（大量スクロール）を目的としない。
- **1.4** The system shall 表示対象が不足している場合（例：未接続/未購読/データ未到達）に、欠損を明示する（N/A、stale、disconnected 等）。

### Requirement 2: ingestor ダッシュボード表示要件（取得データの可視化）

**Objective:** As a 運用担当者, I want ingestor が現在どのデータを取得しているかを確認したい, so that データ欠損や遅延を即座に検知できる

#### Acceptance Criteria

- **2.1** The system shall ingestor の接続状態（connected / reconnecting / disconnected）と、最終受信時刻（last message age）を表示する。
- **2.2** The system shall 取得中のデータ種別（少なくとも BBO / Trades / Mark / Index）と、各ストリームの最終更新時刻を表示する。
- **2.3** The system shall 対象シンボルごとに BBO（best bid/ask の価格とサイズ、mid）を表示する。
- **2.4** The system shall 対象シンボルごとに mark / index（存在する場合）を表示する。
- **2.5** The system shall ingestion の健全性指標として、受信レート（msg/s など）およびスロットリング/間引きの状態（有効/無効、主要パラメータ）を表示できる。
- **2.6** If データが一定時間更新されない場合, the system shall stale として強調表示する（閾値は設定可能）。

### Requirement 3: executor ダッシュボード表示要件（注文・ポジション・モードの可視化）

**Objective:** As a 運用担当者, I want executor が何の銘柄にどんな価格で注文を入れているかを確認したい, so that 期待どおりにMMが稼働しているか判断できる

#### Acceptance Criteria

- **3.1** The system shall executor の戦略状態（少なくとも `NORMAL` / `DEFENSIVE` / `PAUSE`）と、その遷移理由（直近の理由）を表示する。
- **3.2** The system shall 対象シンボルごとに、現在のクォート意図（bid/ask の目標価格・サイズ、post-only 前提）を表示する。
- **3.3** The system shall 対象シンボルごとに、アクティブ注文（open/working）を表示する（少なくとも side, price, size, order id/client id, age）。
- **3.4** The system shall 対象シンボルごとに、ポジション（数量、平均建値/entry、未実現PnLが取得できる場合）を表示する。
- **3.5** The system shall 直近の約定（fills）と直近の注文イベント（place/cancel/ack/reject 等）を少数（例：直近5件）だけ表示できる。
- **3.6** If PAUSE中の場合, the system shall 「板を出していない」ことが一目で分かる表示（CANCEL_ALL 実行済み/実行中、または quoting disabled）を行う。

### Requirement 4: リアルタイム表示品質（滑らかさ・ちらつき防止）

**Objective:** As a 運用担当者, I want 画面がチカチカせず滑らかに更新されてほしい, so that 長時間監視しても読みやすくストレスがない

#### Acceptance Criteria

- **4.1** The system shall 画面全消去→再描画の連続でちらつく表示を行わない（差分更新、またはTUIフレームワーク相当の安定描画）。
- **4.2** The system shall 更新頻度を制御できる（例：100–1000msの範囲で設定可能）かつ、入力イベントが多くても描画はスロットリングされる。
- **4.3** The system shall 同一値が連続する場合に無駄な再描画を抑制する（値の変化に応じた更新）。
- **4.4** The system shall 描画処理がホットパス（意思決定/受信処理）をブロックしない（描画は非同期キュー/スナップショット参照など）。
- **4.5** The system shall TTYでない環境（CI、ログ収集、リダイレクト）ではダッシュボードを自動的に無効化し、通常ログへフォールバックする。

### Requirement 5: 他ログとの共存（競合・画面崩れの防止）

**Objective:** As a 運用担当者, I want 通常ログとダッシュボードが競合せず表示が崩れないようにしたい, so that 重要なログも可視性を失わない

#### Acceptance Criteria

- **5.1** The system shall ダッシュボード表示中に、通常ログがダッシュボード領域を破壊しない（ログ出力の分離、またはUIがログを専用領域に取り込む）。
- **5.2** The system shall 重大ログ（error/warn）はダッシュボードから参照できる（例：直近N件、またはログファイルパス表示）。
- **5.3** The system shall ダッシュボードの開始/終了で端末状態を復帰できる（終了時に画面が壊れない）。

### Requirement 6: 操作性（UX）と安全な停止

**Objective:** As a 運用担当者, I want 監視しながら最低限の操作ができる, so that 状況に応じて素早く確認/終了できる

#### Acceptance Criteria

- **6.1** The system shall ダッシュボードを明示的に有効/無効化できる（CLIフラグまたは環境変数など）。
- **6.2** The system shall キーバインドで終了できる（例：`q`）またはSIGINT（Ctrl+C）で安全に終了できる。
- **6.3** The system shall 複数シンボルを扱う場合、表示対象の絞り込み（symbol filter）またはページング/タブ等で可読性を維持する。

### Requirement 7: テスト要件と受入条件（Acceptance Criteria）

**Objective:** As a 開発者, I want CLIダッシュボードの表示品質とログ共存が自動テストで担保されてほしい, so that 変更で監視性が壊れない

#### Acceptance Criteria

- **7.1** The system shall ダッシュボードの表示モデル（スナップショット生成、差分計算、スロットリング）が unit test 可能な構造である。
- **7.2** The system shall 「ログがUIを破壊しない」ことを検証できる最小の統合テスト（疑似ログ多発時でも描画が安定）を提供できる。
- **7.3** The system shall 受入条件として、ingestor/executor を同時に稼働させても画面がチカチカせず、少なくとも10分間、最新状態（BBO/注文/ポジション）が更新され続けること。

### Requirement 8: 見やすさ・装飾（色/太字）とレイアウトの美しさ

**Objective:** As a 運用担当者, I want 重要情報が色や太字で直感的に強調され、綺麗に整列した状態でリアルタイム表示されてほしい, so that 一瞬で状況判断でき監視疲れが減る

#### Acceptance Criteria

- **8.1** The system shall 重要度に応じた視覚的階層を持つ（例：ヘッダー/セクション境界、ラベルは薄色、値は太字、警告/エラーは強調色）。
- **8.2** The system shall 主要ステータスを色で区別する（例：connected=green、reconnecting=yellow、disconnected=red、PAUSE=red、DEFENSIVE=yellow、NORMAL=green）。
- **8.3** The system shall side を色で区別する（例：BID/BUY=green、ASK/SELL=red）かつ、色だけに依存せずテキスト（BUY/SELL 等）でも判別可能にする。
- **8.4** The system shall stale/遅延や異常（data stale、reject、WS再接続など）を強調表示する（色、太字、アイコン/ラベル等）。
- **8.5** The system shall レイアウトが更新のたびに横揺れしない（列幅の固定、数値の桁揃え、単位表記の統一など）。
- **8.6** The system shall 端末が色/装飾に対応しない場合や `NO_COLOR` が設定されている場合、装飾を無効化しつつ可読性を維持する（プレーンテキストでも破綻しない）。
