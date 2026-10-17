# アーキテクチャ（縦切りスライス＋フェーズ1）

```mermaid
flowchart LR
  IR[InputRouter / TouchControls] -- 移動・回避・ポーズ --> M[Main 状態機械]
  M -- step(1/60) --> RS[RunSim 戦闘ロジック]
  RS -- events --> V[BattleView / Hud / Sfx]
  M -- reserve / checkpoint / settle --> MS[MetaService]
  MS --> SR[SaveRepository<br/>user://save.json + .bak]
  M --> MN[Menus 納骨堂・結果]
  MN -- 割り振り・入れ替え・形見選択 --> MS
  D[(data/balance.json)] --> DL[DataLoader 検証] --> RS & MS
```

## 状態遷移
```mermaid
stateDiagram-v2
  [*] --> TITLE
  TITLE --> HUB: 納骨堂へ
  TITLE --> PLAY: 中断したランを再開
  TITLE --> TITLE: 放棄（リタイア扱いで settle）
  HUB --> PLAY: 出撃（reserve で予約を保存）
  PLAY --> LEVEL: レベルアップ
  LEVEL --> PLAY
  PLAY --> PAUSE
  PAUSE --> PLAY
  PAUSE --> RESULT: リタイア
  PLAY --> RESULT: 死亡 / 冥王撃破（settle）
  RESULT --> HUB: 亡霊の入れ替え・形見の選択が済んだら
```

## 亡霊・形見のライフサイクル
```mermaid
stateDiagram-v2
  [*] --> stored: 死亡時に生成（満杯なら pending → 入れ替え）
  stored --> reserved: 出撃確定（その場で保存）
  reserved --> reserved: 異常終了（active_run が残る）
  reserved --> consumed: settle（死亡・生還・リタイア・放棄のどれでも）
  stored --> released: 満杯時の入れ替えで成仏
```

## ラン終了処理（`MetaService.settle`）の順番
1. `settled_runs` に run_id があれば何もしない（冪等）
2. 同行亡霊: reserved かつ同じ run なら consumed
3. 死亡時: 亡霊を生成（満杯なら pending）
4. 供物・世代数・累計生存時間を加算、使った形見を棚から外す、形見の候補を pending に
5. 履歴・処理済み記録・`active_run = null` を**1回の書き込み**で確定

## 性能
- 敵は `RefCounted` の軽量オブジェクト、近傍探索は `SpatialGrid`、描画は `BattleView._draw()` で一括
- 計測: テスト `t10_load_300`（敵300体・3武器Lv5で約2.5ms/tick）、ゲーム内の Settings →「負荷試験」（実機のFPS）、F3 デバッグHUD
