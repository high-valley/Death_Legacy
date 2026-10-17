# Death Legacy — Claude Code 向け引き継ぎメモ

このファイルは Claude Code が最初に読む。作業前に必ず目を通すこと。

## プロジェクト
- ヴァンサバ型アクション＋「死んだ主人公が亡霊になり、次のランに一度だけ連れていける」ローグライト。
- 仕様書: `docs/specs/DEATH_LEGACY_GDD.md`。**[確定]の核は変えない**: 主人公育成が中心 / 亡霊は生存時間で強くなる / 同行は任意 / 一度出撃した亡霊はそのラン後に永久消費。
- 姉妹作: `high-valley/demon_swarm`, `high-valley/life_debt`（同じ構成・同じCI）。コードは各リポジトリで独立。
- オーナーとのやり取りは**日本語**。報告は「何ができたか / 残っていること / 次にお願いしたいこと」を短く。

## 経緯と現在地（2026-10）
- 単一HTMLのブラウザ試作で手触りを確認 → 打ち合わせで世代交代まわりを拡張 → 同じ数値で Godot 版を作成。
- **実装済み（フェーズ1）**: MVP一式（3武器・6パッシブ・3敵種＋冥王・亡霊の生成/予約/消費・保管庫10体と入れ替え・セーブと中断復帰）＋ カードのレア度5段階（N/R/SR/UR/LR、LRは武器進化）＋ 供物（祭壇=レア率、書庫=縁・封印、割り振りはいつでも戻せる）＋ 形見（ラン終了時に1つ残し、次の世代が1つ装備して使い切り）。
- **次（オーナーと合意済みの順）**:
  - フェーズ2: 家系の解放（無名・火守・墓守の3つから。特性・弱点・専用カード、解放条件は実績や死に方）
  - フェーズ3: 亡霊の3択（連れていく / 喰らう / 弔う）、喰らうと「穢れ」→ 喰らった亡霊が「怨霊」として敵で出る → 倒すと浄化
  - 拠点（納骨堂）の施設が増えていく仕組み（オーナーが面白いと評価）
- 公開URL: https://high-valley.github.io/death_legacy/

## よく使うコマンド
```bash
godot --headless --path . --import
godot --headless --path . -s res://tests/run_tests.gd          # 29件。SCRIPT ERROR がログに出たらCIは失敗扱い
python3 tools/check_glyphs.py                                  # フォントに無い文字を検出（CIでも実行）
python3 tools/subset_font.py /path/to/NotoSansCJK-Regular.ttc  # 日本語フォント再生成
godot --path . -- --shot=out.png --screen=hub|altar|library|shelf|level|result [--touch] [--play] [--frames=N]
```

## 設計のルール（崩さないこと）
- `RunSim`（戦闘）はノード・描画・入力・セーブに依存しない。セーブとの受け渡しは `summary()` / `snapshot()` だけ。
- **亡霊・形見の状態**: stored → reserved（`MetaService.reserve` で出撃確定の瞬間に保存）→ consumed / 使用済み（`settle`）。
- **`MetaService.settle` は冪等**（`settled_runs` で2回目以降は何もしない）。供物・亡霊生成・消費・世代数はすべてこの中で1回だけ。
- 異常終了: `active_run` と10秒ごとの `checkpoint` が残る。タイトルで「再開」か「放棄（リタイア扱い・消費）」を選ばせる。
- 戦闘中の亡霊は保管データの**コピー**から作る（元データを直接編集しない）。
- セーブは `SaveRepository`: 一時ファイル→検証→.bak退避→置換。読み込み失敗時は .bak。項目を足したら `migrate()` にも足し、`schema_version` を上げる時は段階変換を書く。
- 乱数は `RngStreams`（spawn / cards / misc）。新しい用途で既存ストリームを使うと seed 再現性が壊れる。
- バランス値は `data/balance.json`。項目を足したら `DataLoader.validate()` にも検証を足す。
- 全画面 Control は `set_anchors_and_offsets_preset(PRESET_FULL_RECT)`。型推論 `:=` は Variant（辞書の値など）に使わない（Godot 4.7 ではエラー）。

## 既知の課題
- 自動ボットでは祭壇0でも6回中5回クリアできる（ブラウザ試作では2回）。人が遊んだ感想を聞いてから難度を調整する。
- 仮アセット（図形・コード生成の効果音）。
- Steam 連携は `scripts/autoload/platform.gd` の `steam_available()` を入口に（Web版では読み込まない）。
