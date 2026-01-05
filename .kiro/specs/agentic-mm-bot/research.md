# Research & Design Decisions

## Summary

- **Feature**: `agentic-mm-bot`
- **Discovery Scope**: Complex Integration（外部取引所/SDK、永続化、バックテストを跨ぐ。LLMはFuture Extension）
- **Key Findings**:
  - Extended は TypeScript の公式サンプルが公開されており、認証/署名（Stark鍵）や発注例をSDK前提で実装できる（adapter側で採用する）: [Extended TypeScript examples](https://raw.githubusercontent.com/x10xchange/examples/main/typescript/README.md)
  - SDK前提の環境変数（API_HOST/API_KEY/STARK_PRIVATE_KEY/VAULT_ID）が明記されているため、`packages/config` と `apps/*/env.ts` ではこの構成を SoT として扱う: [Extended TypeScript examples](https://raw.githubusercontent.com/x10xchange/examples/main/typescript/README.md)
  - MAINNET利用時は「ポジション/注文のキャンセル忘れ」に関する注意があるため、executorの異常時は **cancel_all を最優先**に設計し、運用Runbookにも反映する: [Extended TypeScript examples](https://raw.githubusercontent.com/x10xchange/examples/main/typescript/README.md)
  - MVPでは LLMワーカーをスコープ外とし、LLM関連は Future Extension として ports/schemas を保持する

## Research Log

### Extended の TypeScript SDK / 公式サンプルを adapter で採用できるか？

- **Context**: 「extendedの場合はclientはsdkが配布されているのでサンプルを使う」という要望に基づき、adapter実装の依存関係を確定する。
- **Sources Consulted**:
  - [Extended TypeScript examples](https://raw.githubusercontent.com/x10xchange/examples/main/typescript/README.md)
- **Findings**:
  - サンプルは `.env.local`（`.env.example`から作成）で `API_HOST`, `API_KEY`, `STARK_PRIVATE_KEY`, `VAULT_ID` を要求する
  - TESTNET/MINNET のAPI管理ページが提示されている（キー取得導線の確保）
  - MAINNETでは「注文/ポジションのキャンセル忘れ」を明確に警告している
  - WASM暗号モジュール（Rust）に関連する参照リポジトリが提示されている（署名周りのブラックボックス化を避けやすい）
- **Implications**:
  - `packages/adapters/extended` は「SDKをラップして Port を実装」する方針にする（REST/署名/丸め/リトライを抱き込む）
  - `packages/config` の共通envは `API_HOST/API_KEY/STARK_PRIVATE_KEY/VAULT_ID` を基準に設計し、`process.env`直参照禁止を徹底する
  - executor のフェイルセーフ（PAUSE→cancel_all）と監査ログは、運用上の必須要件として扱う

## Architecture Pattern Evaluation

| Option                        | Description                                      | Strengths                                     | Risks / Limitations               | Notes                                     |
| ----------------------------- | ------------------------------------------------ | --------------------------------------------- | --------------------------------- | ----------------------------------------- |
| Hexagonal（Ports & Adapters） | coreを純粋ロジックに固定し、I/Oをadapterに閉じる | テスト容易、実装分担が明確、venue差し替え可能 | adapterが肥大化しやすい           | steering（層境界/DI/Result）と整合        |
| Direct SDK-in-app             | apps が SDK を直接呼ぶ                           | 最短で動く                                    | 境界が崩れcoreにI/Oが侵入しやすい | MVPでも将来の差し替え耐性が低いので不採用 |

## Design Decisions

### Decision: Extended の client 実装は SDK 前提で adapter に閉じ込める

- **Context**: 実装速度と正確性（署名/認証/注文APIの変化追従）を両立したい。
- **Alternatives Considered**:
  1. SDK利用（adapter内） — 公式サンプルを根拠に依存を固定
  2. 自前HTTP/署名実装 — 依存を最小化するが、MVP速度/事故リスクが高い
- **Selected Approach**: `packages/adapters/extended` が SDK を採用し、`ExecutionPort`/`MarketDataPort` を実装する（appsはport越しに呼ぶ）。
- **Rationale**: SDKは環境変数、実行方法、注意事項（cancel忘れ）が明記されており、運用上の落とし穴も含めて設計に反映できる。
- **Trade-offs**: SDKの内部仕様変更に追従が必要になるが、portで隔離することで影響範囲を限定できる。
- **Follow-up**: 実装時に「レート制限」「post-only rejectの扱い」「必要なWS/RESTの範囲」をSDK/APIの実挙動で検証する。

### Decision: MVPでは LLMワーカーを省略し、拡張点として隔離する

- **Context**: MVPのスコープを「pure core + executor + repositories/gateways + extended adapter」に絞り、実装のブレと運用負荷を最小化したい。
- **Alternatives Considered**:
  1. MVPからLLMワーカーを含める — 改善ループまで揃うが初期のI/O/運用面の不確実性が増える
  2. MVPからLLMワーカーを除外 — 実装を一本道化でき、後付けで追加可能
- **Selected Approach**: `apps/llm-reflector` はMVPで実装しない。将来追加に備えて `ProposalPort` / `FileSinkPort` とDBスキーマは保持する。
- **Rationale**: executorのdecisionCycleを最短で安定稼働させることを優先し、LLMは安全ゲート/監査込みで後付けできる構造にする。
- **Trade-offs**: 初期は自動改善が無いが、fills_enriched/markoutにより手動改善・検証が可能。
- **Follow-up**: LLM導入時は `ParamGate` の運用ゲート（10.x）と推論ログの完全性（13.x）を必須とする。

### Decision: executor は WS中心（Hot path）とDB（Cold path）を分離する

- **Context**: executorが毎tick DB を読みに行く構造は、レイテンシと障害点が増え、実務上の運用コストも上がる（4.6, 4.10）。
- **Alternatives Considered**:
  1. tickごとに DB から latest*\* / md*\* を読む — 実装は単純だがレイテンシ/障害点が増える
  2. WS駆動で最新状態/短期窓をメモリ保持し、DBは記録/復旧に寄せる — 低レイテンシで自然
- **Selected Approach**: Hot path（MarketDataCache/FeatureEngine/OrderTracker/PositionTracker/StrategyRuntime）をメモリ上で維持し、DB書き込みは EventWriter で非同期化する。復旧用に `strategy_state` を定期保存する。
- **Rationale**: 「メモリ＝現在」「DB＝履歴/監査/復旧」に分離すると、同期モデルが単純になりバグ温床を避けやすい。
- **Trade-offs**: メモリ状態の復旧やprivate stream欠損時の整合が課題になるため、RESTフォールバックと定期スナップショット（strategy_state）を採用する（4.8, 4.11）。
- **Follow-up**: private stream の可用性、open orders/position の同期頻度、BBO間引きの設定（3.6）を実装時に検証する。

## Risks & Mitigations

- SDK/APIの仕様変更 — adapter層で集約し、coreは無変更に保つ
- MAINNETでの注文/ポジション残存 — executorのPAUSE時 cancel_all を最優先、運用メトリクスで監視
- 鍵管理（STARK_PRIVATE_KEY） — t3-envで必須化し、ログ出力禁止、最小権限運用

## References

- [Extended TypeScript examples](https://raw.githubusercontent.com/x10xchange/examples/main/typescript/README.md) — SDK前提の環境変数/実行方法/運用上の注意点がまとまっている
