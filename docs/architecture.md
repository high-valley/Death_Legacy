# アーキテクチャ（縦切りスライス＋フェーズ1 / TypeScript 版）

```mermaid
flowchart LR
  IR[InputRouter / TouchControls] -- 移動・回避・ポーズ --> M[main.ts 状態機械]
  M -- step(1/60) --> RS[RunSim 戦闘ロジック]
  RS -- events --> V[BattleView / Hud / Sfx]
  M -- reserve / checkpoint / settle --> MS[MetaService]
  MS --> SR[SaveRepository<br/>localStorage: save + .bak]
  M --> MN[Menus 納骨堂・結果（HTML）]
  MN -- 割り振り・入れ替え・形見選択 --> MS
  D[(data/balance.json)] --> DL[loadBalance 検証] --> RS & MS
```

## 状態遷移
```mermaid
stateDiagram-v2
  [*] --> title
  title --> hub: 納骨堂へ
  title --> play: 中断したランを再開
  title --> title: 放棄（リタイア扱いで settle）
  hub --> play: 出撃（reserve で予約を保存）
  play --> level: レベルアップ
  level --> play
  play --> pause: II / Esc / アプリが裏に回った
  pause --> play
  pause --> result: リタイア
  play --> result: 死亡 / 冥王撃破（settle）
  result --> hub: 亡霊の入れ替え・形見の選択が済んだら
```

## ループ
- `requestAnimationFrame` ごとに経過時間をためて、1/60秒ずつ `RunSim.step()` を回す（1フレーム最大4回。遅い端末では「ゆっくり」になり、追いつこうとして重くなる悪循環を防ぐ）。
- 描画はキャンバス1枚（戦場＋HUD＋タッチ操作）。画面の細かさは最大2倍。メニューは HTML をキャンバスの上に重ねる。

## 分け方のルール
- `src/sim` と `src/meta` は DOM・描画・入力を使わない（Node のテストでそのまま動く）。
- 戦闘からの通知は `events`（fx / sfx / toast / shake）。表示側は状態を読むだけ。
- 乱数は `RngStreams`（spawn / cards / misc）。用途を足す時は列を足す。
- 保存先は `KV`（localStorage と同じ形）。テストはメモリ、Steam 版ではファイルに差し替える。
