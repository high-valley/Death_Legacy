# Death Legacy — Claude Code 向け引き継ぎメモ

このファイルは Claude Code が最初に読む。作業前に必ず目を通すこと。

## プロジェクト
- **呼び名**: オーナーとの会話ではカタカナの略称を使う。デモスワ = Demon Swarm、ライデ = Life Debt、デスレガ = Death Legacy（このリポジトリは「デスレガ」）。
- ヴァンサバ型アクション＋「死んだ主人公が亡霊になり、次のランに一度だけ連れていける」ローグライト。
- 仕様書: `docs/specs/DEATH_LEGACY_GDD.md`。**[確定]の核は変えない**: 主人公育成が中心 / 亡霊は生存時間で強くなる / 同行は任意 / 一度出撃した亡霊はそのラン後に永久消費。
- 姉妹作: `high-valley/demon_swarm`, `high-valley/life_debt`（2026-10 に同じ TypeScript 構成・同じCIへ移行済み）。コードは各リポジトリで独立。
- オーナーとのやり取りは**日本語**。報告は「何ができたか / 残っていること / 次にお願いしたいこと」を短く。専門用語はかみ砕く。

## 経緯と現在地（2026-10）
- 単一HTMLのブラウザ試作で手触りを確認 → 世代交代まわりを拡張 → Godot 版を作成 → **iPhone のブラウザで重く遊べなかったため TypeScript（Canvas 2D）へ移行**（ADR 011, 012）。Godot 版は `godot-legacy` ブランチ。
- **実装済み（フェーズ1）**: MVP一式（3武器・6パッシブ・3敵種＋冥王・亡霊の生成/予約/消費・保管庫10体と入れ替え・セーブと中断復帰）＋ カードのレア度5段階（N/R/SR/UR/LR、LRは武器進化）＋ 供物（祭壇=レア率、書庫=縁・封印）＋ 形見。
- **実装済み（フェーズ2）**: 家系の解放（無名・火守・墓守。特性・弱点・専用カード・解放条件、ADR 013）＋ 画面のつくり直し（ADR 014）。
- **実装済み（フェーズ3）**: 亡霊の3択（連れていく / 喰らう / 弔う）・穢れ・怨霊（ADR 015）＋ 祭壇と書庫を「祭壇の樹」に統合（ADR 016）。
- **実装済み**: 武器の段階（5武器×4段階・槍と斧、ADR 017）＋ 画面イメージに寄せた作り直しと絵の差し替え口（ADR 018）。
- **絵はオーナーが用意する**（肖像・背景）。`art/` に決まった名前で置くと自動で入る。一覧は `docs/art_assets.md`。チャットで画像をもらったら名前を付けて `art/` に置く。
- **次（オーナーと合意済みの順）**:
  - 拠点（納骨堂）の施設が増えていく仕組み
- 公開URL: https://high-valley.github.io/Death_Legacy/

## よく使うコマンド
```bash
npm install            # 初回（この作業環境では npm に繋がらないので、ln -s /opt/npm-tools/node_modules node_modules で代用できる）
npm test               # 単体テスト 56件（Node 22.18+ が TypeScript をそのまま実行）
npm run typecheck      # tsc --noEmit
npm run build          # dist/ に書き出し
npm run dev            # http://localhost:8000
npm run bench          # 戦闘ロジックの速度（敵300体）
```
画面確認は Playwright（`/opt/pw-browsers/chromium`）で dist/ を開き、`globalThis.__dl`（Game）から状態を読める。
URL: `?demo`（見本データ・別保存先）`?fps` `?bench` `?lowres`。

## 設計のルール（崩さないこと）
- `src/sim`（戦闘）と `src/meta`（セーブ・亡霊）は DOM・描画・入力に依存しない。セーブとの受け渡しは `summary()` / `snapshot()` だけ。
- **亡霊・形見の状態**: stored → reserved（`MetaService.reserve` で出撃確定の瞬間に保存）→ consumed / 使用済み（`settle`）。喰らった亡霊は wraith（怨霊）→ 祓うと purified。弔うと released。
- **穢れ**は保存せず「wraith の数」から計算する。戦闘の材料は `MetaService.runOpts()` の1か所で作る。
- **`MetaService.settle` は冪等**（`settled_runs` で2回目以降は何もしない）。供物・亡霊生成・消費・世代数はすべてこの中で1回だけ。
- 異常終了: `active_run` と10秒ごとの `checkpoint` が残る。タイトルで「再開」か「放棄（リタイア扱い・消費）」を選ばせる。
- 戦闘中の亡霊は保管データの**コピー**（structuredClone）から作る。
- セーブは `SaveRepository`: 一時キー→検証→.bak退避→本体。読み込み失敗時は .bak。項目を足したら `migrate()` にも足し、`schema_version` を上げる時は段階変換を書く。
- 乱数は `RngStreams`（spawn / cards / misc / lineage）。新しい用途で既存ストリームを使うと seed 再現性が壊れる。`Math.random` は描画の揺れ以外で使わない。
- バランス値は `data/balance.json`（祭壇の樹は `tree`、3択と怨霊は `rites`）。項目を足したら `src/data/types.ts` と `loadBalance()` の検証にも足す。
- TypeScript は「型を消すだけで動く」書き方にする（`enum`・引数プロパティ禁止、import は `.ts` 付き）。Node がそのまま実行するため。
- 武器の段階は `src/data/weapons.ts` の `weaponGrade()`。アイコンは `src/view/icons.ts`（DOM・キャンバス共通）、絵は `src/view/art.ts`。
- 入力は `InputRouter` / `TouchControls` 経由。スティックは指に付いてくる（`src/input/stick.ts`、テストあり）。

## 負荷（スマホ）
- ループは1フレーム最大4ステップ、画面の細かさは最大2倍、画面外は描かない。敵は1体ずつ塗る（大きな1図形にまとめると重なりで遅くなった）。
- 毎ティックの処理を増やしたら `npm run bench` と `?bench` で確認。

## 既知の課題
- 自動ボットでは祭壇0で6回中3回クリア。人が遊んだ感想を聞いてから難度を調整する。
- 仮アセット（絵はオーナーが用意中。効果音はコード生成）。
- Steam 版（Electron＋Steamworks）は未着手。入口は `src/platform.ts`。
