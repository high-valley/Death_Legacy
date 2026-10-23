# Death Legacy — Claude Code 向け引き継ぎメモ

このファイルは Claude Code が最初に読む。作業前に必ず目を通すこと。

## プロジェクト
- **呼び名**: オーナーとの会話ではカタカナの略称を使う。デモスワ = Demon Swarm、ライデ = Life Debt、デスレガ = Death Legacy（このリポジトリは「デスレガ」）。
- ヴァンサバ型アクション＋「死んだ（または生還した）主人公を亡霊として残し、次のランに連れていって一緒に育てる」ローグライト。本番は30分モード。
- 仕様書: `docs/specs/DEATH_LEGACY_GDD.md`。**[確定]の核は変えない**: 主人公育成が中心 / 同行は任意 / **亡霊は消費しない（最大10体）・亡霊になる条件は険しい**（ADR 021）/ **亡霊は等級・Lvを引き継がず、亡霊の札で一緒に育つ**（2026-10 オーナー判断で「生存時間で強くなる」から変更、ADR 025）。
- 姉妹作: `high-valley/demon_swarm`, `high-valley/life_debt`（2026-10 に同じ TypeScript 構成・同じCIへ移行済み）。コードは各リポジトリで独立。
- オーナーとのやり取りは**日本語**。報告は「何ができたか / 残っていること / 次にお願いしたいこと」を短く。専門用語はかみ砕く。

## 経緯と現在地（2026-10）
- 拠点画面の名前は「ホーム」（2026-10-22 オーナー判断で「納骨堂」から変更。コード・ドキュメントの古い記述は納骨堂のまま）。「第N代」の世代表示と形見もなくした（ADR 026）（亡霊の名前は「弓の亡霊」、同名は「・二」。内部の世代数 `progress.generation` はラン数として残す）。
- 単一HTMLのブラウザ試作で手触りを確認 → 世代交代まわりを拡張 → Godot 版を作成 → **iPhone のブラウザで重く遊べなかったため TypeScript（Canvas 2D）へ移行**（ADR 011, 012）。Godot 版は `godot-legacy` ブランチ。
- **実装済み（フェーズ1）**: MVP一式（3武器・6パッシブ・3敵種＋冥王・亡霊の生成/予約/消費・保管庫10体と入れ替え・セーブと中断復帰）＋ カードのレア度5段階（N/R/SR/UR/LR、LRは武器進化）＋ 供物（祭壇=レア率、書庫=縁・封印）＋ 形見。
- **実装済み（フェーズ2）**: 家系の解放（無名・火守・墓守。特性・弱点・専用カード・解放条件、ADR 013）＋ 画面のつくり直し（ADR 014）。
- **実装済み（フェーズ3）**: 亡霊の3択（連れていく / 喰らう / 弔う）・穢れ・怨霊（ADR 015）＋ 祭壇と書庫を「祭壇の樹」に統合（ADR 016）。
- **実装済み**: 武器の段階（7武器×4段階・槍と斧・魔導書は炎/氷/雷の3冊、ADR 017・019）＋ 画面イメージに寄せた作り直しと絵の差し替え口（ADR 018）。
- **絵はオーナーが用意する**（主人公7人の絵・背景。亡霊には人の絵を使わない、ADR 020）。`art/` に決まった名前で置くと自動で入る。一覧は `docs/art_assets.md`、生成プロンプト（ChatGPT 向け）は `docs/art_prompts.md`。チャットで画像をもらったら切り抜き・縮小（目安300KB以内）・webp 変換して、名前を付けて `art/` に置く（地面は継ぎ目なしに加工）。
- **実装済み（ADR 021）**: 亡霊は消費しない・最大2体同行・亡霊化は生存30%＋未練の欠片・主人公は武器1種・Lv3で武器の道を選ぶ・タグとセット効果・刻印・呪い。
- **実装済み（ADR 023）**: 拠点の施設「堂守の亡霊」（霊廟タブ。鎮魂堂・武具の間・供養塔。住む亡霊は連れていけない・施設は戻せない）。
- **実装済み（ADR 024）**: 武器のランク（武器が変わる）とレベル（ダメージ）を分けた・パッシブLv8・カード追加（パッシブ・呪い・刻印）・説明書・ランの後半ほど厳しい難度。
- **実装済み（ADR 025）**: 亡霊の作り直し（等級なし・亡霊の札・特技・クリア時も残せる・亡霊の守り）、家系を一旦なし（`lineages_enabled`）、30分モード（`long`）を本番に。
- **次**: オーナーと相談（施設の追加候補＝見張り塔・系譜の間は `docs/proposals/facilities.md`）
- 公開URL: https://high-valley.github.io/Death_Legacy/

## 作業の進め方（2026-10-21 オーナーと合意）
- **大きめの機能は役割分担で進める**: 提案者（案を2〜3個）→ 仕様確認者（GDD の[確定]・設計のルール・スマホ負荷に照らしてふるい分け）→ **オーナーが案を選ぶ** → 実装 → レビュー担当（実装を見ていない別の担当がテスト・画面を確認）。仕様の変更・絵・遊んだ感想はオーナーの判断を待つ。
- 絵の組み込み・小さな修正・数値調整は役割分担しない（1人で進める方が速く安い）。

## よく使うコマンド
```bash
npm install            # 初回（この作業環境では npm に繋がらないので、ln -s /opt/npm-tools/node_modules node_modules で代用できる）
npm test               # 単体テスト 92件（Node 22.18+ が TypeScript をそのまま実行）
npm run typecheck      # tsc --noEmit
npm run build          # dist/ に書き出し
npm run dev            # http://localhost:8000
npm run bench          # 戦闘ロジックの速度（敵300体）
```
画面確認は Playwright（`/opt/pw-browsers/chromium`）で dist/ を開き、`globalThis.__dl`（Game）から状態を読める。
URL: `?demo`（見本データ・別保存先）`?fps` `?bench` `?lowres`。

## 設計のルール（崩さないこと）
- `src/sim`（戦闘）と `src/meta`（セーブ・亡霊）は DOM・描画・入力に依存しない。セーブとの受け渡しは `summary()` / `snapshot()` だけ。
- **亡霊の状態**: stored → reserved（`MetaService.reserve` で出撃確定の瞬間に保存）→ stored に戻る（`settle`）。形見は 2026-10-22 になくした（ADR 026）。喰らった亡霊は wraith（怨霊）→ 祓うと purified。弔うと released。古いセーブの consumed はそのまま。
- **亡霊**: 戦闘中の育ち（Lv・ランク）は `Companion` が持ち、中断セーブの `gstate` にだけ残す（保管データに書き戻さない）。新しい亡霊は `settle` で `pending_ghost`（kind=offer）→ `decideOffer`。
- **施設**: 住んでいる亡霊は `stationed_at`（状態は stored のまま）。効果は出撃時に `active_run.facility` へ写す。建てた施設は戻せない。
- **穢れ**は保存せず「wraith の数」から計算する。戦闘の材料は `MetaService.runOpts()` の1か所で作る。
- **`MetaService.settle` は冪等**（`settled_runs` で2回目以降は何もしない）。供物・亡霊生成・消費・世代数はすべてこの中で1回だけ。
- 異常終了: `active_run` と10秒ごとの `checkpoint` が残る。タイトルで「再開」か「放棄（リタイア扱い・消費）」を選ばせる。
- 戦闘中の亡霊は保管データの**コピー**（structuredClone）から作る。
- セーブは `SaveRepository`: 一時キー→検証→.bak退避→本体。読み込み失敗時は .bak。項目を足したら `migrate()` にも足し、`schema_version` を上げる時は段階変換を書く。
- 乱数は `RngStreams`（spawn / cards / misc / lineage / build / crit）。新しい用途で既存ストリームを使うと seed 再現性が壊れる。`Math.random` は描画の揺れ以外で使わない。
- バランス値は `data/balance.json`（祭壇の樹は `tree`、3択と怨霊は `rites`）。項目を足したら `src/data/types.ts` と `loadBalance()` の検証にも足す。
- TypeScript は「型を消すだけで動く」書き方にする（`enum`・引数プロパティ禁止、import は `.ts` 付き）。Node がそのまま実行するため。
- 武器はランク（`rank`、`gradeAt()`）とレベル（`weapons`、ダメージだけ）が別。ランクアップは `rank_levels` に届いた次のレベルアップで札が出る。アイコンは `src/view/icons.ts`（DOM・キャンバス共通）、絵は `src/view/art.ts`、主人公の動きは `src/view/heroAnim.ts`。
- 入力は `InputRouter` / `TouchControls` 経由。スティックは指に付いてくる（`src/input/stick.ts`、テストあり）。

## 負荷（スマホ）
- ループは1フレーム最大4ステップ、画面の細かさは最大2倍、画面外は描かない。敵は1体ずつ塗る（大きな1図形にまとめると重なりで遅くなった）。
- 毎ティックの処理を増やしたら `npm run bench` と `?bench` で確認。

## 既知の課題
- 難度（2026-10-22、ADR 025）: 簡易ボットで30分 一人 2/14・亡霊2体 7/14（雷・斧は一人でも時々クリア）。10分・3分は亡霊2体だと易しめ。人が遊んだ感想で `spawn.modes.*`（hp_growth・dmg_growth・ghost_guard・solo_xp）と `ghost_cards`（base_mult・lv_mult）を調整する。
- 仮アセット（絵はオーナーが用意中。効果音はコード生成）。
- Steam 版（Electron＋Steamworks）は未着手。入口は `src/platform.ts`。
