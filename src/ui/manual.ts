// 説明書（タイトル・納骨堂・一時停止から開く）。数値は balance.json から読むので、調整しても説明がずれない。
import type { Balance } from "../data/types.ts";
import { h } from "./dom.ts";

export const CHAPTERS = [
  ["basics", "遊び方"],
  ["resonance", "共鳴"],
  ["cards", "カード"],
  ["ghosts", "亡霊"],
  ["crypt", "ホーム"],
] as const;
export type Chapter = (typeof CHAPTERS)[number][0];

const pct = (v: number): string => `${Math.round(v * 100)}%`;

function sec(title: string, ...body: (Node | string | null)[]): HTMLElement {
  return h("section", { class: "man-sec" }, h("h3", {}, title), ...body);
}
function para(...t: (Node | string)[]): HTMLElement {
  return h("p", {}, ...t);
}
function list(items: (Node | string)[][]): HTMLElement {
  return h("ul", {}, ...items.map((x) => h("li", {}, ...x)));
}
function tag(D: Balance, id: string, n?: number): HTMLElement {
  const T = D.tags[id];
  return h("span", { class: "tag", style: `--tg:${T.color}` }, T.name, n !== undefined ? h("b", {}, String(n)) : null);
}

export function manualPage(D: Balance, ch: Chapter, touch: boolean): HTMLElement {
  const box = h("div", { class: "man-body" });
  const P = D.tag_points, B = D.ghost_birth;
  if (ch === "basics") {
    box.append(
      sec("目的", para(`敵の群れから逃げ回りながら生き延び、最後に現れる冥王を倒せばクリア。本番は${D.run_length.long / 60}分モード。短く遊べる${D.run_length.full / 60}分モードと、お試しの${D.run_length.short / 60}分モードもある。どのモードも後半ほど敵が急に強くなり、${D.run_length.long / 60}分モードは一人ではまず生き残れない。亡霊と共に挑むこと。`)),
      sec("操作", para(touch
        ? "画面をドラッグして移動。攻撃は自動。右下のボタンで回避（少しの間ダメージを受けない）、右上で一時停止。縦向き・横向きどちらでも遊べる。"
        : "WASD・矢印キーで移動。攻撃は自動。Space で回避（少しの間ダメージを受けない）、Esc で一時停止。強化カードは 1・2・3 キーでも選べる。")),
      sec("強くなる流れ", list([
        ["敵を倒すと経験値の粒が落ちる。拾ってレベルが上がると、カードを3枚から1枚選ぶ。"],
        ["主人公が使える武器は1種類。カードで武器そのものを育てるか、パッシブ（攻撃力・速度など）を取るかを選ぶ。"],
        ["序盤は一人でも楽に進めるが、時間がたつほど敵が硬く、痛くなる。後半は亡霊の助けや、共鳴（同じタグを集める）が効いてくる。"],
      ])),
      sec("死んだら", para(`倒れても終わりではない。条件を満たして倒れた主人公は「亡霊」になり、次のランに連れていける（「亡霊」の章）。ランを終えるたびに供物がもらえ、ホームで拠点を育てられる。`)),
    );
  } else if (ch === "resonance") {
    const ex = Object.keys(D.tags).find((t) => t === "slash") ?? Object.keys(D.tags)[0];
    box.append(
      sec("共鳴とは", para("武器やカードには「タグ」（属性のしるし）が付いている。同じタグの点数が 2・4・6 点に届くと、そのタグの「セット効果」が順に発動する。点数は戦闘中の左下と、レベルアップ画面に出ている。")),
      sec("点数の数え方", list([
        ["主人公の武器のタグ … ", h("b", {}, `${P.hero_weapon}点`), "（剣なら", tag(D, "slash"), "、炎の魔導書なら", tag(D, "fire"), "）"],
        ["連れていく亡霊1体ごと … 亡霊の武器のタグ ", h("b", {}, `${P.ghost_weapon}点`), "＋", tag(D, "spirit"), h("b", {}, ` ${P.ghost_spirit}点`)],
        ["タグ付きのパッシブ … ", h("b", {}, `1Lvにつき${P.passive_level}点`), "（例: 刃研ぎは", tag(D, "slash"), "。2Lvで1点）"],
        ["霊廟の「武具の間」に住む亡霊 … その亡霊の武器のタグ ", h("b", {}, "1点")],
      ]),
      para("一人で出撃した時は、主人公の武器のタグに合うパッシブだけがカードに出る。亡霊を連れていく・武具の間に住まわせると、別のタグのカードも出るようになる。")),
      sec("例", para("剣の主人公（", tag(D, ex, P.hero_weapon), "）が斧の亡霊（", tag(D, "slash", P.ghost_weapon), tag(D, "spirit", P.ghost_spirit), "）を連れて出撃 →", tag(D, ex, P.hero_weapon + P.ghost_weapon), "。刃研ぎを Lv2 まで育てれば", tag(D, ex, P.hero_weapon + P.ghost_weapon + P.passive_level * 2), "で、4点のセット効果まで発動する。")),
    );
    const t = h("div", { class: "man-sets" });
    for (const id of Object.keys(D.tags)) {
      const T = D.tags[id];
      t.append(h("div", { class: "man-set" }, tag(D, id), h("ul", {}, ...T.sets.map((s) => h("li", {}, h("b", {}, `${s.at}点`), "　", s.text)))));
    }
    box.append(sec("セット効果の一覧", t));
  } else if (ch === "cards") {
    const rl = D.rarities.map((r) => [h("b", { style: `color:${r.color}` }, r.name), `　武器は +${r.wlv} Lv${r.wbonus ? `・威力 +${pct(r.wbonus)}` : ""}、パッシブは効果 ×${r.pmul}`]);
    const rk = D.rank_levels;
    box.append(
      sec("レア度", para("カードの枠の色がレア度。高いほど一度に大きく強くなる。祭壇の樹で高いレア度が出やすくなる。"), list(rl)),
      sec("武器のレベルとランク", list([
        [h("b", {}, "レベル"), `　武器カードで上がる。上がるのはダメージだけ（最大 Lv${D.weapon_max_level}。最大の後もカードでダメージを上乗せできる）。`],
        [h("b", {}, "ランク"), `　武器が Lv${rk[0]}・Lv${rk[1]}・Lv${rk[2]} に届くと、次のレベルアップで「ランクアップ」の札が出る。取ると武器そのものが変わり、攻撃の形が変わる（剣なら 短剣 → ロングソード／レイピアの道を選ぶ → グレートソード／エストック → デュランダルに進化）。`],
      ])),
      sec("パッシブ", para(`主人公の能力を上げるカード。持てるのは ${D.passive_slots} 種類まで、それぞれ Lv${D.passive_max_level} まで。全部は育ちきらないので、どれを伸ばすかを選ぶ。タグ付きのものは1Lvにつき共鳴の点数 ${D.tag_points.passive_level} 点。`)),
      sec("刻印", para("まれに混ざる特別なカード（青緑の枠）。一度取るとそのラン中ずっと効く強い効果。祭壇の樹の書架を開くと種類が増える。")),
      sec("呪い", para("良いことと悪いことがセットになったカード（赤い枠）。祭壇の樹の「禁忌の頁」を開くと出るようになる。取るかどうかは自由。"),
        list(D.curses.map((c) => [h("b", {}, c.name), `　${c.desc}`]))),
      ...(D.lineages_enabled ? [sec("家系の札", para("家系（無名・火守・墓守など）ごとの専用カード。その家系で出撃した時だけ出る。"))] : []),
    );
  } else if (ch === "ghosts") {
    box.append(
      sec("亡霊として残す", list([
        ["冥王を倒して生還した時は、無条件で「英霊」として残せる。"],
        [`倒れた時は、ランの ${pct(B.min_survival)} 以上を生き延び、「未練の欠片」を ${B.fragments} つ以上持っていれば残せる（墓暴きを倒すと ${B.drops.elite ?? 0}・怨霊を倒すと ${B.drops.wraith ?? 0}）。`],
        ["どちらも「残す / 残さない」を選べる。"],
      ])),
      sec("亡霊は一緒に育つ", para(`亡霊は生前のレベルを引き継がない。連れていくと武器 Lv1 から始まり、レベルアップの3枚に「亡霊の札」（亡霊①・②と書かれた、武器の色の札）が混ざる。主人公と亡霊のどちらを伸ばすかを選ぶ。亡霊の武器が Lv${D.ghost_cards.rank_levels.join("・")} に届くと、亡霊のランクアップの札が必ず出る（武器が変わる）。亡霊の札が ${D.ghost_cards.dry_limit} 回続けて出なかった時は、次は必ず1枚出る。`),
        para(`亡霊の強さは、同じレベル・ランクの主人公の武器のおよそ ${pct(D.ghost_cards.base_mult)}。攻撃力・攻撃速度のパッシブは乗らないが、タグ付きのパッシブとセット効果は乗る。亡霊を育てるほど、そのタグの共鳴の点数も増える（ランク1つにつき +${D.tag_points.ghost_rank}）。`)),
      sec("特技", para("亡霊は、生前に一番育てたパッシブで決まる「特技」を1つ持つ。その亡霊にだけ効く小さな効果。"),
        list(Object.entries(D.ghost_traits).filter(([k]) => k !== "_").map(([k, t]) => [h("b", {}, D.passives[k]?.name ?? k), `　${t.text}`]).concat([[h("b", {}, "そのほか"), `　${D.ghost_traits._.text}`]]))),
      sec("連れていく / 喰らう / 弔う", list([
        [h("b", {}, "連れていく"), `　一緒に戦う。ランが終われば保管庫へ戻る（減らない）。一度に ${D.ghost_slots.base} 体、祭壇の樹で ${D.ghost_slots.max} 体まで。`],
        [h("b", {}, "喰らう"), "　同行はしないが、力を取り込んで主人公が強くなる。喰らった亡霊は怨霊になり、のちのランで襲ってくる。"],
        [h("b", {}, "弔う"), "　その場で成仏させて供物にする。戻せない。"],
      ])),
      sec("穢れと怨霊", para(`まだ祓っていない怨霊の数が「穢れ」。穢れ1つにつき敵のHPが +${pct(D.rites.wraith.enemy_hp_per_taint)}。怨霊はランの途中で現れ、倒すと祓える（供物 +${D.rites.wraith.purify_offerings}）。`)),
      sec("保管庫", para(`亡霊は ${D.vault_capacity} 体まで。満杯の時に新しい亡霊を残すなら、どれか1体を成仏させて入れ替える。`)),
    );
  } else {
    box.append(
      sec("祭壇の樹", para("供物を払って節を開き、拠点の力を育てる（レア度・縁と封印・亡霊の枠・刻印・呪いなど）。いつでも「ほどく」と払った供物が全部戻る。")),
      sec("霊廟（施設）", para("施設を供物で建て、保管庫の亡霊を住まわせる。住んでいる間はその亡霊を連れていけない。建てた施設は戻せない。"),
        list(D.facilities.map((f) => [h("b", {}, f.name), `　${f.desc}`]))),
      sec("供物", para(`生き延びた時間・倒した数・クリアで増える。リタイアすると半分になる。`)),
    );
  }
  return box;
}
