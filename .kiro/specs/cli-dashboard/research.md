# Research & Design Decisions

## Summary

- **Feature**: `cli-dashboard`
- **Discovery Scope**: Extension
- **Key Findings**:
  - `apps/ingestor` / `apps/executor` には既に ANSI + alternate screen buffer を用いた TTY ダッシュボード実装が存在し、更新は `setInterval` で定期描画、表示データはメモリ上の最新スナップショット参照で成立している。
  - 通常ログの競合は、ダッシュボード有効時に `LOG_LEVEL=ERROR` として stdout を抑制し、エラーログのみ stderr に残す運用で概ね回避できる（logger は INFO/DEBUG を stdout、WARN/ERROR を stderr）。
  - 現実装は描画ごとに `clear + home` を行っており、端末や環境によってはちらつき要因になりうるため、差分描画（行単位更新）へ拡張するのが要件(4.1, 4.3)に適合する。

## Research Log

### 既存実装の統合点はどこか

- **Context**: 新機能ではなく既存プロセスにUIを組み込むため、どこにフックすべきかを確認する必要がある。
- **Sources Consulted**:
  - `apps/ingestor/src/services/cli-dashboard.ts`
  - `apps/executor/src/services/cli-dashboard.ts`
  - `apps/ingestor/src/main.ts`
  - `apps/executor/src/main.ts`
  - `packages/utils/src/logger.ts`
- **Findings**:
  - ingestor は WSイベントハンドラで `dashboard.onBbo/onTrade/onPrice/onFunding` を呼び、別途UI用メトリクス更新を1s周期で実施している。
  - executor は tick のデバッグフック（`onTickDebug`）で `TickDebug` を渡し、別途発注イベントや状態遷移を `pushEvent` で蓄積している。
  - どちらも alternate screen buffer を利用し、スクロールバックを汚さない設計になっている。
- **Implications**:
  - 設計は「アプリ側でスナップショットを作り、UIはそれを読むだけ」という境界を維持する（ホットパス非ブロッキング、4.4）。
  - 共通化対象は ANSI 制御、差分描画、装飾（色/太字/NO_COLOR）などの “TTY基盤”。

### ちらつき防止と滑らかさをどう担保するか

- **Context**: 要件(4.1)で「全消去→再描画の連続」を避けることが求められる。
- **Sources Consulted**:
  - 既存 `clear + home` 実装
  - 端末制御の一般的パターン（alternate screen, cursor move, erase line）
- **Findings**:
  - 行単位の差分更新（前フレーム行配列と比較し、変化行のみ `cursor position + erase line + write`）で、ちらつきと無駄な再描画を抑えられる。
  - 更新頻度は入力イベント頻度と切り離し、一定周期でレンダリングする方が安定する（4.2）。
- **Implications**:
  - “描画は throttled、データは随時更新” を原則に、UI側は最後に描画した内容を保持して diff を取る。

### 色/太字/NO_COLOR 等の装飾互換性

- **Context**: 要件(8.6)で、装飾非対応環境でも破綻しない必要がある。
- **Sources Consulted**:
  - 既存 `ANSI` 定数（dashboard実装）
  - `packages/utils/src/logger.ts`（色付きヘッダ）
- **Findings**:
  - `NO_COLOR` が設定されている場合は ANSI シーケンスを無効化すべき。
  - `process.stdout.isTTY` に加え、`TERM=dumb` 等の環境でも装飾を落とす必要がある。
- **Implications**:
  - “Style” 層を分離し、装飾ON/OFFを一箇所で制御する（ingestor/executor 共通）。

## Architecture Pattern Evaluation

| Option                                | Description                                    | Strengths                | Risks / Limitations                               | Notes                       |
| ------------------------------------- | ---------------------------------------------- | ------------------------ | ------------------------------------------------- | --------------------------- |
| 現行の各app内独自実装を継続           | ingestor/executor が別々に ANSI UI を持つ      | 変更範囲が局所           | 重複が増え、要件(4/5/8)の横断改善が二重作業になる | 既に重複が顕在化            |
| 共通TTY基盤を `packages/utils` に抽出 | `TTYScreen` / `TTYRenderer` / `Style` を共通化 | 重複排除、改善を横断適用 | 共有境界の設計が必要                              | 既存のutils運用と相性が良い |
| 外部TUIライブラリ導入                 | blessed/ink 等                                 | 豊富なウィジェット       | 依存追加・型/互換性調査が必要                     | 本設計では依存追加は避ける  |

## Design Decisions

### Decision: 依存追加をせず、差分描画の共通TTY基盤を導入する

- **Context**: 要件(4.1, 4.3, 8.5)を満たしつつ、既存実装を活かしたい。
- **Alternatives Considered**:
  1. 外部TUIライブラリ導入（blessed/ink等）
  2. 現行 `clear + home` を継続し、更新周期だけ調整
  3. 自前の差分描画（行単位更新）を導入
- **Selected Approach**: 3 を採用。alternate screen は維持し、`render(lines)` が前フレームとの差分だけを stdout に適用する。
- **Rationale**: 依存追加を避けつつ、ちらつき抑制・横揺れ抑制・余計な再描画抑制を同時に実現できる。
- **Trade-offs**: 端末制御の実装/テストが必要。レイアウト設計（行数固定、列幅固定）も併せて規律化する必要がある。
- **Follow-up**: 実装時に `NO_COLOR` / `TERM=dumb` / リダイレクト時フォールバックの挙動をテストで固定する。

### Decision: ログは “抑制” ではなく “ルーティングしてUI内に統合” する

- **Context**: 要件(9.5, 9.6)で「他のlogなども全てまとめて」「出力場所がかぶらない」ことが求められる。現行の `LOG_LEVEL=ERROR` は競合回避には有効だが、運用観測としては情報が欠落する。
- **Alternatives Considered**:
  1. UI有効時はログを抑制（現状）
  2. stdout/stderr をそのまま残し、UIは別領域に描く（衝突しやすい）
  3. logger の出力を “sink” に分離し、UI有効時は DashboardSink に送る
- **Selected Approach**: 3 を採用。UI有効時は `logger` が Console 出力せず、ログレコードを in-process のリングバッファへ送る（必要ならファイルへもtee）。
- **Rationale**: 画面競合を根絶しつつ、運用に必要なログ可視性を維持できる。
- **Trade-offs**: 既存 `packages/utils/logger` の拡張（sink対応）またはアプリ側のログ捕捉が必要。
- **Follow-up**: 実装では “UI描画はstdout専有、ログはUIに取り込み” を規約としてテストで固定する。

## Risks & Mitigations

- 差分描画が端末互換性で壊れるリスク — alternate screen + cursor move + erase line の最小セットに限定し、TTYでない場合は自動無効化（4.5）。
- ログがstdoutに出てUIを破壊するリスク — ダッシュボード有効時はINFO/DEBUGを抑制し、UIはstdout、ログはstderrに寄せる（5.1）。
- ログ統合により重要ログが見落とされるリスク — レベル別の色/太字＋フィルタ（ERROR/WARN強調）と、最新N件固定表示で視認性を担保（9.6, 8.4）。
- 更新頻度を上げすぎてCPUを消費するリスク — refresh interval を設定化し、UI側は diff で最小更新（4.2, 4.3）。

## References

- [NO_COLOR standard](https://no-color.org) — ANSI装飾無効化の慣習
