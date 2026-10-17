# Death Legacy（仮）

今日の自分が、明日の仲間になる。
死んだ主人公が**亡霊**として残り、次の出撃に一度だけ連れていける、2D見下ろし型サバイバー・ローグライトの縦切りスライス（Godot 4.7 / GDScript）。

- 遊ぶ（Web版）: `https://high-valley.github.io/death_legacy/` ※ Pages 有効化後
- 仕様: `docs/specs/DEATH_LEGACY_GDD.md`（MVP）＋ 打ち合わせで追加したフェーズ1（レア度・供物・形見）
- 配信方針: GitHub Pages で確認 → 固まったら同じプロジェクトから Windows 版を書き出して Steam へ

## 遊び方

1. **納骨堂**で、単独で出るか、保管庫の亡霊を1体連れていくかを選ぶ（形見も1つ身につけられる）
2. 移動するだけで攻撃は自動。レベルアップごとに3択で強化（ノーマル〜レジェンドレアの5段階、レジェンドレアは武器進化）
3. 冥王を倒せば生還。死ぬと、生き延びた時間に応じた等級の**亡霊**が生まれる
4. 連れていった亡霊と形見は、勝っても負けてもそのランで消費される
5. ランを終えるたびに**供物**がもらえ、**祭壇**（レア率）と**書庫**（縁・封印）に割り振れる（いつでも戻せる）

| 操作 | キーボード | スマホ（横向き推奨） |
|---|---|---|
| 移動 | WASD / 矢印 | 画面をドラッグ |
| 攻撃 | 自動 | 自動 |
| 回避 | Space | 右下「回避」 |
| ポーズ | Esc / P | 右上「II」 |
| 強化の選択 | クリック / 1・2・3 | タップ |
| デバッグHUD | F3 | 設定画面 |

## 初回だけ必要な設定（GitHub Pages）

1. **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする
2. **Actions** タブで最新の「Build & Deploy」を **Re-run all jobs**

以降は `main` に push するたびに、フォント確認 → テスト → Web版を Pages に公開 → Windows版を Artifacts に保存。

## ローカルで動かす

1. [Godot 4.7.2](https://godotengine.org/download/archive/4.7.2-stable/)（標準版）で `project.godot` を開いて F5
2. テスト: `godot --headless --path . -s res://tests/run_tests.gd`

セーブはデスクトップでは OS のユーザーデータ領域、Web版ではブラウザ内に保存される（PCとスマホで保管庫は別）。

## フォルダ構成

```
data/balance.json   バランス値（等級・武器・レア度・供物・敵・出現）。数値調整はここだけ
scripts/
  sim/run_sim.gd    1回のランの戦闘ロジック（ノード非依存・テスト可能）
  meta/             SaveRepository（原子的書き込み・バックアップ）, MetaService（亡霊・供物・形見・ラン終了処理）
  input/ ui/ view/  入力層・タッチ操作・HUD・画面・描画
  main.gd           状態機械と配線
tests/              §11 受け入れ条件1〜10＋フェーズ1のテスト（CIで実行）
docs/               設計メモ・判断記録・マイルストーン・仕様書
```

## ライセンス

- フォント: Noto Sans CJK JP（SIL Open Font License 1.1）— `assets/fonts/LICENSE-NotoSansCJK.txt`
