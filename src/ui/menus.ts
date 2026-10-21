// 戦闘以外の画面: タイトル / 納骨堂（出撃準備・祭壇の樹・霊廟・形見の棚）/ 確認 / レベルアップ / ポーズ / 設定 / リザルト。
// 画面を開くたびに作り直す（状態は MetaService と hub の選択だけが持つ）。
// 見た目は「暗い石と金の飾り枠」。肖像・背景は art/ に絵があれば使い、無ければ図形の仮表示（src/view/art.ts）。
import type { Balance, Facility, Lineage, RunMode, Tier } from "../data/types.ts";
import { gradeAt } from "../data/weapons.ts";
import type { MetaService } from "../meta/metaService.ts";
import type { ActiveRun, GhostMode, GhostPick, GhostRecord, RunRecord } from "../meta/records.ts";
import { Platform } from "../platform.ts";
import { Settings } from "../settings.ts";
import { RunSim, type Card } from "../sim/runSim.ts";
import { Art } from "../view/art.ts";
import { fmt } from "../view/hud.ts";
import { iconSvg } from "../view/icons.ts";
import { button, h } from "./dom.ts";
import { CHAPTERS, manualPage, type Chapter } from "./manual.ts";

export interface SortieRequest { ghosts: GhostPick[]; heirId: string; weapon: string; mode: RunMode; seed: number; lineage: string }

const RESULT_NAME: Record<string, string> = { player_death: "死亡", boss_cleared: "クリア", retired: "リタイア" };
const KANJI = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 代数を漢数字に */
export function kanjiNum(n: number): string {
  if (n < 10) return KANJI[n];
  if (n < 20) return "十" + (n % 10 ? KANJI[n % 10] : "");
  if (n < 100) return KANJI[Math.floor(n / 10)] + "十" + (n % 10 ? KANJI[n % 10] : "");
  return String(n);
}

/** 背景の絵（あれば） */
function backdrop(key: string): HTMLElement | null {
  const src = Art.file(key);
  return src ? h("div", { class: "backdrop", style: `background-image:url("${src}")` }) : null;
}

export class Menus {
  readonly root: HTMLElement;
  readonly meta: MetaService;
  readonly D: Balance;
  hub = { tab: "sortie" as string, ghosts: [] as GhostPick[], heir: "", weapon: "sword", mode: "long" as RunMode, seed: 0, lineage: "nameless", node: "" };
  touchMode = false;
  onSortie: (r: SortieRequest) => void = () => {};
  private hotkeys: HTMLButtonElement[] = [];

  constructor(root: HTMLElement, meta: MetaService) {
    this.root = root;
    this.meta = meta;
    this.D = meta.D;
    this.hub.seed = Math.floor(Math.random() * 1_000_000);
  }

  // ---------------------------------------------------------------- building blocks
  private open(cls = "", ovCls = ""): HTMLElement {
    this.hotkeys = [];
    const panel = h("div", { class: `panel ${cls}` });
    const ov = h("div", { class: `ov ${ovCls}` }, panel);
    this.root.replaceChildren(ov);
    this.root.hidden = false;
    return panel;
  }

  hideAll(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
    this.hotkeys = [];
  }

  pressHotkey(i: number): void {
    const b = this.hotkeys[i];
    if (b && !b.disabled) b.click();
  }

  /** 戦闘中の指がそのまま離れて誤タップしないよう、少しだけ押せない時間を作る */
  private guard(buttons: HTMLButtonElement[]): void {
    for (const b of buttons) b.disabled = true;
    setTimeout(() => { for (const b of buttons) b.disabled = false; }, 250);
  }

  /** 選べるカード（形見・家系など）。onPress が null なら表示だけ */
  private pick(parts: (Node | string | null)[], opts: { edge?: string; pressed?: boolean; onPress?: (() => void) | null; cls?: string }): HTMLElement {
    const style = opts.edge ? `--edge:${opts.edge}` : undefined;
    if (!opts.onPress) return h("div", { class: `pick ${opts.cls ?? ""}`, style }, ...parts);
    return h("button", { type: "button", class: `pick ${opts.cls ?? ""}`, style, "aria-pressed": String(!!opts.pressed), onclick: opts.onPress }, ...parts);
  }

  /** 枠の見出し（紋章＋題＋添え書き） */
  private frameHead(title: string, sub = "", icon = "ghost"): HTMLElement {
    return h("div", { class: "fhead" }, h("span", { class: "sigil" }, iconSvg(icon)), h("h3", {}, title), sub ? h("span", { class: "fsub" }, sub) : null);
  }

  /** 亡霊の紋（人の絵は使わない）: 等級の色の霊光と、生前の武器の紋 */
  portrait(g: GhostRecord | null, cls = ""): HTMLElement {
    if (!g) return h("div", { class: `portrait empty ${cls}` }, iconSvg("ghost", "icon ph"));
    const tr = this.meta.tier(g.tier_id);
    const el = h("div", { class: `portrait spirit ${cls}`, style: `--tc:${tr.color}` });
    el.append(iconSvg("ghost", "icon ph"), iconSvg(g.primary_weapon_id, "icon pw"));
    el.append(h("span", { class: "gen" }, kanjiNum(Number(/第(\d+)代/.exec(g.display_name)?.[1] ?? 0))));
    return el;
  }

  private rank(tr: Tier): HTMLElement {
    return h("span", { class: "rank", style: `--tc:${tr.color}` }, tr.rank);
  }

  private weaponLabel(g: GhostRecord): string {
    return gradeAt(this.D.weapons[g.primary_weapon_id], g.weapon_rank ?? 0, g.evolved, g.weapon_branch).name;
  }

  /** 亡霊の1行（記録庫・入れ替え・リザルト） */
  ghostCard(g: GhostRecord, pressed: boolean, onPress: (() => void) | null, note = ""): HTMLElement {
    const D = this.D, tr = this.meta.tier(g.tier_id);
    const body = [
      this.portrait(g),
      h("div", { class: "gbody" },
        h("div", { class: "gname" }, h("span", {}, g.display_name.replace(/^第\d+代・/, (m) => m)), this.rank(tr)),
        h("dl", { class: "gstats" },
          h("dt", {}, "生存時間"), h("dd", { class: "num" }, fmt(g.survival_seconds)),
          h("dt", {}, "メイン武器"), h("dd", {}, `${this.weaponLabel(g)} Lv${g.weapon_level}`),
          h("dt", {}, "パッシブ"), h("dd", {}, g.passive_id ? `${D.passives[g.passive_id].name} Lv${g.passive_level}` : "なし")),
        note ? h("span", { class: "note" }, note) : null),
      onPress ? h("span", { class: `chip ${pressed ? "on" : ""}` }, pressed ? "選択中" : "待機中") : null,
    ];
    const cls = `ghost-row${pressed ? " on" : ""}`;
    if (!onPress) return h("div", { class: cls, style: `--tc:${tr.color}` }, ...body);
    return h("button", { type: "button", class: cls, style: `--tc:${tr.color}`, "aria-pressed": String(pressed), onclick: onPress }, ...body);
  }

  private houseCard(l: Lineage, pressed: boolean, onPress: () => void): HTMLElement {
    const open = this.meta.lineageUnlocked(l.id);
    if (!open) {
      const pr = this.meta.unlockProgress(l);
      return this.pick([
        h("span", { class: "tier" }, "未解放"),
        h("span", { class: "name" }, l.name),
        h("span", { class: "meta" }, l.unlock?.text ?? ""),
        pr ? h("div", { class: "bar" }, h("i", { style: `width:${(pr.cur / pr.need) * 100}%` })) : null,
        pr ? h("span", { class: "meta num" }, `${pr.cur} / ${pr.need}`) : null,
      ], { cls: "house locked" });
    }
    return this.pick([
      h("span", { class: "name" }, l.name),
      h("span", { class: "motto" }, l.motto),
      h("span", { class: "plus" }, l.trait),
      l.weakness !== "なし" ? h("span", { class: "minus" }, l.weakness) : null,
    ], { cls: "house", edge: "var(--gold)", pressed, onPress });
  }

  // ---------------------------------------------------------------- title
  showTitle(active: ActiveRun | null, on: { hub: () => void; resume: () => void; abandon: () => void; settings: () => void }): void {
    const p = this.open("title-screen", "ov-title");
    const S = this.meta.S;
    const item = (en: string, ja: string, fn: () => void, primary = false): HTMLButtonElement =>
      h("button", { type: "button", class: `menu-item${primary ? " primary" : ""}`, onclick: fn }, h("span", { class: "en" }, en), h("span", { class: "ja" }, ja), primary ? h("span", { class: "arrow" }, "→") : null);
    const menu = h("nav", { class: "title-menu" });
    if (active) {
      const gs = (active.ghosts ?? []).map((x) => this.meta.getGhost(x.id)).filter((g): g is GhostRecord => !!g);
      menu.append(item("Continue", `中断したランを再開（${fmt(active.checkpoint?.t ?? 0)}・${gs.length ? `${gs.map((g) => g.display_name.replace(/・.*$/, "")).join("・")}と` : "単独"}）`, on.resume, true),
        item("Abandon", "放棄する（リタイア扱い）", on.abandon));
    } else {
      menu.append(item(S.progress.runs > 0 ? "Continue" : "New Game", S.progress.runs > 0 ? `納骨堂へ・第${kanjiNum(S.progress.generation + 1)}代` : "はじめる", on.hub, true));
    }
    menu.append(item("Guide", "説明書", () => this.showManual(() => this.showTitle(active, on))));
    menu.append(item("Settings", "設定", on.settings));
    if (Platform.canQuit()) menu.append(item("Quit", "終了", () => Platform.quit()));
    const logoSrc = Art.file("logo");
    const scene = backdrop("title") ?? h("div", { class: "scene" }, h("i", { class: "moon" }), h("i", { class: "spire" }), h("i", { class: "graves" }), h("i", { class: "wisp" }));
    const parts: (Node | null)[] = [
      scene,
      h("div", { class: "title-left" },
        logoSrc ? h("img", { class: "logo-img", src: logoSrc, alt: "Death Legacy" }) : h("h1", { class: "logo" }, h("span", {}, "Death"), h("span", {}, "Legacy")),
        h("p", { class: "tagline" }, "今日の自分が、明日の仲間になる。"),
        menu,
        active ? h("p", { class: "small mute" }, "放棄すると、連れていた亡霊と形見は戻らない。") : null,
        h("p", { class: "help" }, this.touchMode
          ? "画面をドラッグで移動。攻撃は自動。右下で回避、右上でポーズ。横向きがおすすめ。"
          : "WASD・矢印キーで移動。攻撃は自動。Space で回避、Esc で一時停止、強化は 1・2・3 でも選べる。"),
        this.meta.repo.source === "backup" ? h("p", { class: "gold small" }, "セーブが壊れていたため、バックアップから復元した。") : null,
        h("p", { class: "ver" }, `試作版 ${__VERSION__}`)),
    ];
    for (const n of parts) if (n) p.append(n);
  }

  // ---------------------------------------------------------------- hub
  /** 選び直しで画面を作り直しても、スクロール位置は保つ（同じタブの時だけ） */
  private captureScroll(): Map<string, number> | null {
    const panel = this.root.querySelector<HTMLElement>(".panel[data-screen='hub']");
    if (!panel || panel.dataset.tab !== this.hub.tab) return null;
    const m = new Map<string, number>();
    const ov = this.root.querySelector<HTMLElement>(".ov");
    if (ov) m.set("ov", ov.scrollTop);
    this.root.querySelectorAll<HTMLElement>("[data-scroll]").forEach((el) => m.set(el.dataset.scroll!, el.scrollTop));
    return m;
  }

  private restoreScroll(m: Map<string, number> | null): void {
    if (!m) return;
    const ov = this.root.querySelector<HTMLElement>(".ov");
    if (ov) ov.scrollTop = m.get("ov") ?? 0;
    this.root.querySelectorAll<HTMLElement>("[data-scroll]").forEach((el) => { el.scrollTop = m.get(el.dataset.scroll!) ?? 0; });
  }

  showHub(onBack: () => void): void {
    const keep = this.captureScroll();
    const p = this.open("wide hub-panel", "ov-hub");
    p.dataset.screen = "hub";
    p.dataset.tab = this.hub.tab;
    const S = this.meta.S;
    const bd = backdrop("hub");
    if (bd) p.before(bd);
    const re = (): void => this.showHub(onBack);
    const tabs = h("div", { class: "tabs", role: "tablist" });
    for (const [id, name, ok] of [["sortie", "出撃準備", true], ["tree", "祭壇の樹", true], ["mausoleum", "霊廟", S.ghost_seq > 0 || S.buildings.length > 0], ["shelf", "形見の棚", this.meta.shelfUnlocked()]] as const) {
      tabs.append(h("button", { type: "button", role: "tab", "aria-selected": String(this.hub.tab === id), onclick: () => { this.hub.tab = id; re(); } },
        name, ok ? null : h("span", { class: "lock" }, "未解放")));
    }
    const taint = this.meta.taint();
    p.append(h("header", { class: "hub-head" },
      h("h2", {}, "納骨堂"),
      tabs,
      h("div", { class: "row purses" },
        taint > 0 ? h("span", { class: "purse taint" }, "穢れ", h("b", {}, String(taint))) : null,
        h("span", { class: "purse" }, "供物", h("b", {}, String(this.meta.offeringsFree())), `/ ${S.offerings.earned}`),
        button("説明書", () => this.showManual(re, this.hub.tab === "mausoleum" || this.hub.tab === "tree" || this.hub.tab === "shelf" ? "crypt" : "resonance"), "quiet"),
        button("タイトル", onBack, "quiet"))));
    if (this.hub.tab === "tree") this.hubTree(p, re);
    else if (this.hub.tab === "shelf") this.hubShelf(p);
    else if (this.hub.tab === "mausoleum") this.hubMausoleum(p, re);
    else this.hubSortie(p, re);
    this.restoreScroll(keep);
  }

  /** 亡霊の3択の説明（選んでいる亡霊に対して） */
  private riteText(g: GhostRecord, mode: GhostMode): string {
    if (mode === "devour") {
      const pw = this.meta.devourPower(g);
      return `力を取り込む。与ダメージ +${Math.round(pw.might * 100)}%・最大HP +${Math.round(pw.hp * 100)}%。喰らった亡霊は怨霊になり、のちのランで襲ってくる（穢れ +1）。`;
    }
    const W = this.D.weapons[g.primary_weapon_id];
    return `生前の${gradeAt(W, g.weapon_rank ?? 0, g.evolved, g.weapon_branch).name}で一緒に戦う。ランが終われば保管庫に戻る。`;
  }

  /** タグの小さな札（炎2 など） */
  private tagChip(tag: string, pts?: number): HTMLElement {
    const T = this.D.tags[tag];
    return h("span", { class: "tag", style: `--tg:${T.color}` }, T.name, pts !== undefined ? h("b", {}, String(pts)) : null);
  }

  /** 出撃準備: 左＝亡霊の記録庫、中＝主人公・連れていく亡霊・支度、右＝これまでの軌跡 */
  private hubSortie(p: HTMLElement, re: () => void): void {
    const D = this.D, meta = this.meta, hub = this.hub, S = meta.S;
    if (!meta.lineageUnlocked(hub.lineage)) hub.lineage = D.lineages[0].id;
    const lin = meta.lineage(hub.lineage);
    const stored = meta.storedGhosts();
    const avail = meta.availableGhosts();
    const slots = meta.ghostSlots();
    hub.ghosts = hub.ghosts.filter((x) => avail.some((g) => g.ghost_id === x.id)).slice(0, slots);
    const heirs = meta.shelfUnlocked() ? meta.storedHeirs() : [];
    if (hub.heir && !heirs.some((x) => x.heir_id === hub.heir)) hub.heir = "";
    const weapon = lin.weapon ?? hub.weapon;
    const picks = hub.ghosts.map((x) => ({ ...x, g: meta.getGhost(x.id)! }));
    const wr = meta.wraiths();
    const gen = S.progress.generation + 1;
    const toggle = (id: string): void => {
      const i = hub.ghosts.findIndex((x) => x.id === id);
      if (i >= 0) hub.ghosts.splice(i, 1);
      else if (hub.ghosts.length < slots) hub.ghosts.push({ id, mode: "bring" });
      else if (slots === 1) hub.ghosts = [{ id, mode: "bring" }];
      re();
    };

    // ── 左: 亡霊の記録庫
    const list = h("div", { class: "ghost-list" });
    for (const g of avail) list.append(this.ghostCard(g, hub.ghosts.some((x) => x.id === g.ghost_id), () => toggle(g.ghost_id)));
    for (const g of stored) {
      if (!g.stationed_at) continue;
      const c = this.ghostCard(g, false, null, `${meta.facility(g.stationed_at)?.name ?? "施設"}の堂守（霊廟で外すと連れていける）`);
      c.classList.add("stationed");
      list.append(c);
    }
    if (stored.length === 0) list.append(h("div", { class: "empty" }, "まだ亡霊はいない。未練の欠片を集め、ランの3割以上を生き延びて倒れた者だけが亡霊になる。"));
    const archive = h("section", { class: "frame archive", "data-scroll": "archive" },
      this.frameHead("亡霊の記録庫", `${stored.length} / ${D.vault_capacity}`),
      h("p", { class: "flavor" }, `ここで眠るのは、かつてのあなたたち。連れていっても減らない。一度に${slots}体まで${slots < D.ghost_slots.max ? "（祭壇の樹「双魂の契り」で2体）" : ""}。`),
      list);

    // ── 中: 主人公・連れていく亡霊・支度
    const center = h("section", { class: "frame sortie", "data-scroll": "sortie" });
    center.append(this.frameHead(`第${kanjiNum(gen)}代の出撃`, D.lineages_enabled ? lin.name : "", "sword"));
    // 主人公（＝武器）を絵で選ぶ。武器は育つと持ち替える
    const heroes = h("div", { class: "heroes" });
    for (const id of Object.keys(D.weapons)) {
      const W = D.weapons[id], src = Art.hero(id), locked = !!lin.weapon && lin.weapon !== id;
      heroes.append(h("button", { type: "button", class: "hero-card", "aria-pressed": String(weapon === id), disabled: locked, onclick: () => { hub.weapon = id; re(); } },
        h("span", { class: "hp-img" }, src ? h("img", { src, alt: "", loading: "lazy" }) : iconSvg(id, "icon ph")),
        h("span", { class: "hn" }, iconSvg(id), W.name)));
    }
    const WS = D.weapons[weapon];
    const pa = WS.grades.filter((g) => !g.evo && g.branch === "a").map((g) => g.name).join(" → ");
    const pb = WS.grades.filter((g) => !g.evo && g.branch === "b").map((g) => g.name).join(" → ");
    center.append(h("div", { class: "section" },
      h("h4", {}, lin.weapon ? `主人公（${lin.name}は${WS.name}）` : "主人公　使える武器は1種類"),
      heroes,
      h("p", { class: "small hero-desc" }, h("b", {}, WS.name), `　${WS.desc}。`, this.tagChip(WS.tags[0])),
      h("p", { class: "small hero-desc" }, `ランク: ${WS.grades[0].name} → 武器Lv${D.rank_levels[0]}で道を選ぶ（${pa}／${pb}）→ Lv${D.rank_levels[D.rank_levels.length - 1]}で進化 ${WS.grades[WS.grades.length - 1].name}。レベルはダメージ`)));
    if (wr.length > 0) {
      center.append(h("div", { class: "notice taint" },
        h("b", {}, `穢れ ${wr.length}`),
        h("span", { class: "small" }, `敵のHP +${Math.round(meta.taintHpBonus() * 100)}%。ランの途中で怨霊「${wr[0].display_name}」が現れる。倒せば祓える（供物 +${D.rites.wraith.purify_offerings}・未練の欠片 +${D.ghost_birth.drops.wraith ?? 0}）。`)));
    }
    // 連れていく亡霊（最大 slots 体）
    const party = h("div", { class: "party" });
    for (let i = 0; i < slots; i++) {
      const x = picks[i];
      if (!x) {
        party.append(h("div", { class: "chosen solo" }, this.portrait(null, "big"),
          h("div", { class: "cbody" }, h("span", { class: "clabel" }, `${i + 1}体目`), h("span", { class: "cname" }, "空き"),
            h("p", { class: "small" }, i === 0 ? `記録庫から選ぶ。誰も連れていかなければ単独（経験値 +${Math.round(D.solo_xp_bonus * 100 * (1 + (lin.mods.solo_xp ?? 0)))}%）。` : "2体目も選べる。"))));
        continue;
      }
      const seg = h("div", { class: "seg rites" });
      for (const [id, name] of [["bring", "連れていく"], ["devour", "喰らう"]] as const) {
        seg.append(h("button", { type: "button", "aria-pressed": String(x.mode === id), onclick: () => { hub.ghosts[i].mode = id; re(); } }, name));
      }
      const n = meta.mournOfferings(x.g);
      seg.append(h("button", {
        type: "button", "aria-pressed": "false", onclick: () => this.showConfirm(`${x.g.display_name}を弔う`,
          `いますぐ成仏させ、供物 +${n} を得る。弔った亡霊は戻らない。`, () => { meta.mourn(x.id); hub.ghosts = hub.ghosts.filter((y) => y.id !== x.id); re(); }, re, "弔う"),
      }, `弔う（+${n}）`));
      party.append(h("div", { class: `chosen ${x.mode}` }, this.portrait(x.g, "big"),
        h("div", { class: "cbody" },
          h("span", { class: "clabel" }, x.mode === "devour" ? "喰らう亡霊" : `${i + 1}体目・連れていく`),
          h("span", { class: "cname" }, x.g.display_name),
          h("p", { class: "small" }, this.riteText(x.g, x.mode)),
          seg)));
    }
    center.append(h("div", { class: "section" }, h("h4", {}, `連れていく亡霊　${picks.length} / ${slots}`), party));
    // 共鳴の見込み（主人公の武器＋連れていく亡霊のタグ）
    const preview = new RunSim(D, { weapon, lineage: lin.id, ghosts: picks.filter((x) => x.mode === "bring").map((x) => x.g), facility: meta.facilityBuff() });
    const pts = preview.tagPoints(), sets = preview.activeSets();
    center.append(h("div", { class: "section resonance" },
      h("h4", {}, "共鳴　同じタグを集めるとセット効果（2・4・6）"),
      h("div", { class: "row" }, ...Object.keys(pts).map((t) => this.tagChip(t, pts[t]))),
      sets.length ? h("ul", { class: "sets" }, ...sets.map((st) => h("li", {}, this.tagChip(st.tag, st.at), st.text))) : h("p", { class: "small faint" }, "まだセット効果はない。レベルアップでタグ付きのパッシブを取ると伸ばせる。")));
    // 家系（使う時だけ）
    if (D.lineages_enabled) {
      const houses = h("div", { class: "picks houses" });
      for (const l of D.lineages) houses.append(this.houseCard(l, hub.lineage === l.id, () => { hub.lineage = l.id; re(); }));
      center.append(h("div", { class: "section" }, h("h4", {}, "家系"), houses));
    }
    // 形見
    if (meta.shelfUnlocked()) {
      const hg = h("div", { class: "picks" });
      hg.append(this.pick([h("span", { class: "name" }, "何も持たない"), h("span", { class: "meta" }, "形見は棚に残る")],
        { edge: "var(--faint)", pressed: hub.heir === "", onPress: () => { hub.heir = ""; re(); } }));
      for (const x of heirs) {
        const bonus = lin.mods.heir_level_bonus ?? 0;
        hg.append(this.pick([
          h("span", { class: "tier" }, `第${x.from_generation}代より`),
          h("span", { class: "name" }, x.name.replace(/^第\d+代の形見・/, "")),
          h("span", { class: "meta" }, meta.heirEffect(x) + (bonus ? `（${lin.name}なら +${bonus}Lv）` : "")),
        ], { edge: "var(--gold)", pressed: hub.heir === x.heir_id, onPress: () => { hub.heir = x.heir_id; re(); } }));
      }
      center.append(h("div", { class: "section" }, h("h4", {}, "形見　1つだけ・そのランで使い切り"), hg));
    }
    // ランの長さ
    const mseg = h("div", { class: "seg" });
    for (const [id, name] of [["long", "30分（本番）"], ["full", "10分"], ["short", "3分（お試し）"]] as const) {
      mseg.append(h("button", { type: "button", "aria-pressed": String(hub.mode === id), onclick: () => { hub.mode = id; re(); } }, name));
    }
    const seedIn = h("input", { id: "seedIn", inputmode: "numeric", value: String(hub.seed), size: 8, "aria-label": "seed" });
    seedIn.addEventListener("change", () => { const n = Number.parseInt(seedIn.value, 10); if (Number.isFinite(n)) hub.seed = n; });
    center.append(h("div", { class: "section" }, h("h4", {}, "ランの長さ"), h("div", { class: "row" }, mseg, h("label", { class: "row seed" }, "seed", seedIn))));

    // 出撃ボタン
    const hsel = hub.heir ? meta.getHeir(hub.heir) : null;
    const devours = picks.filter((x) => x.mode === "devour");
    const go = (withGhost: boolean): void => {
      const n = Number.parseInt(seedIn.value, 10);
      const seed = Number.isFinite(n) ? n : Math.floor(Math.random() * 1_000_000);
      hub.seed = Math.floor(Math.random() * 1_000_000);
      const gs = withGhost ? hub.ghosts.map((x) => ({ ...x })) : [];
      const req: SortieRequest = { ghosts: gs, heirId: hub.heir, weapon, mode: hub.mode, seed, lineage: hub.lineage };
      if (devours.length > 0 && withGhost) {
        this.showConfirm(`${devours.map((x) => x.g.display_name).join("と")}を喰らって出撃する`,
          "出撃した時点で喰らうことが確定する。喰らった亡霊は怨霊となり、次のランから襲ってくる。倒せば祓える。", () => this.onSortie(req), re);
      } else if (hsel) {
        this.showConfirm("形見を身につけて出撃する", "形見はこのランで使い切る。連れていく亡霊は、ランが終われば保管庫に戻る。", () => this.onSortie(req), re);
      } else {
        this.onSortie(req);
      }
    };
    const goRow = h("div", { class: "go-row" },
      h("button", { type: "button", class: "go solo", onclick: () => go(false) }, h("b", {}, "単独出撃"), h("small", {}, "亡霊なしで挑む")),
      h("button", { type: "button", class: `go with ${devours.length ? "devour" : "bring"}`, disabled: picks.length === 0, onclick: () => go(true) },
        h("b", {}, devours.length && devours.length === picks.length ? "喰らって出撃" : "亡霊と出撃"),
        h("small", {}, picks.length === 0 ? "記録庫から選ぶ" : devours.length ? "喰らった亡霊は怨霊になる" : "ランが終われば保管庫に戻る")));

    // ── 右: これまでの軌跡
    const trail = h("section", { class: "frame trail", "data-scroll": "trail" }, this.frameHead("これまでの軌跡", "", "clock"));
    const runs = S.run_history.slice(0, 12);
    if (runs.length === 0) trail.append(h("div", { class: "empty" }, "まだ記録はない。"));
    for (const r of runs) {
      const res = r.result === "boss_cleared" ? "clear" : r.result === "player_death" ? "dead" : "retired";
      const comp = r.companions?.length ? r.companions : r.consumed_ghost ? [r.consumed_ghost] : [];
      const who = r.devoured ? `${r.devoured}を喰らう` : comp.length ? `${comp.map((n) => n.replace(/^(第\d+代)・.*$/, "$1")).join("・")}と` : "単独";
      trail.append(h("div", { class: `trail-item ${res}` },
        h("div", { class: "tl" }, h("span", { class: "num" }, `#${String(r.generation).padStart(3, "0")}`), h("span", { class: "num t" }, fmt(r.duration_seconds))),
        h("div", { class: "tw" }, `Lv${r.player_level}・撃破${r.kills}`),
        h("div", { class: "tw small" }, who),
        h("span", { class: "res" }, RESULT_NAME[r.result] ?? "")));
    }

    p.append(h("div", { class: "sortie-grid" }, archive, h("div", { class: "center-col" }, center, goRow), trail));
  }

  private rarityBars(level: number): HTMLElement {
    const ws = RunSim.rarityWeights(this.D, level);
    const tot = ws.reduce((a, b) => a + b, 0);
    const box = h("div", { class: "dist" });
    this.D.rarities.forEach((r, i) => {
      const pct = (ws[i] / tot) * 100;
      box.append(h("div", { class: "r", style: `--rc:${r.color}` },
        h("span", { style: `color:${r.color}` }, r.name),
        h("div", { class: "track" }, h("i", { style: `width:${pct.toFixed(2)}%` })),
        h("span", { class: "v" }, `${pct.toFixed(1)}%`)));
    });
    return box;
  }

  // ---------------------------------------------------------------- 祭壇の樹
  private hubTree(p: HTMLElement, re: () => void): void {
    const D = this.D, meta = this.meta, hub = this.hub;
    if (!meta.treeNode(hub.node)) hub.node = D.tree[0].id;
    const cols = Math.max(...D.tree.map((n) => n.x)) + 1;
    const rows = Math.max(...D.tree.map((n) => n.y)) + 1;

    // 枝（親→子）を SVG の線で、節をグリッドに置く。座標は data の x, y
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${cols * 100} ${rows * 100}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    for (const n of D.tree) {
      for (const pid of n.parents) {
        const pn = meta.treeNode(pid)!;
        const path = document.createElementNS(NS, "path");
        const x1 = pn.x * 100 + 50, y1 = pn.y * 100 + 50, x2 = n.x * 100 + 50, y2 = n.y * 100 + 50;
        path.setAttribute("d", `M${x1} ${y1} C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`);
        path.setAttribute("class", meta.nodeOpen(n.id) ? "lit" : meta.nodeOpen(pid) ? "reach" : "");
        svg.append(path);
      }
    }
    const grid = h("div", { class: "tree-grid", style: `grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${rows},var(--tree-row))` });
    for (const n of D.tree) {
      const open = meta.nodeOpen(n.id), block = meta.nodeBlock(n.id);
      const reach = !open && n.parents.every((x) => meta.nodeOpen(x));
      const state = open ? "open" : block === "" ? "ready" : reach ? "reach" : "far";
      grid.append(h("button", {
        type: "button", class: `node ${state}${n.parents.length === 0 ? " root" : ""}`, "aria-pressed": String(hub.node === n.id),
        style: `grid-column:${n.x + 1};grid-row:${n.y + 1}`, onclick: () => { hub.node = n.id; re(); },
      }, h("span", { class: "nn" }, n.name), h("span", { class: "nc" }, open ? (n.parents.length ? "開いた" : "") : `供物 ${n.cost}`)));
    }
    const left = h("div", { class: "choose", "data-scroll": "tree" },
      h("div", { class: "tree" }, svg, grid),
      h("p", { class: "small faint legend" }, h("i", { class: "k open" }), "開いた", h("i", { class: "k ready" }), "開ける", h("i", { class: "k reach" }), "供物か条件が足りない", h("i", { class: "k far" }), "まだ先"));

    // 縁と封印（枠を開いた時だけ）
    const ap = meta.affinityPoints(), ss = meta.sealSlots();
    if (ap > 0 || ss > 0) {
      const L = D.library;
      const list = h("div", { class: "alloc" });
      const cards: [string, string, string][] = [
        ...Object.keys(D.weapons).map((id): [string, string, string] => [id, D.weapons[id].name, "武器"]),
        ...Object.keys(D.passives).map((id): [string, string, string] => [id, D.passives[id].name, "パッシブ"]),
      ];
      for (const [id, name, kind] of cards) {
        const af = meta.affinity(id), sealed = meta.sealed(id);
        list.append(h("div", { class: `r${sealed ? " sealed" : ""}` },
          h("div", { class: "nm" }, name, h("small", {}, `${kind}${af > 0 ? `　出やすさ ×${(1 + af * L.affinity_step).toFixed(2)}` : ""}${sealed ? "　封印中" : ""}`)),
          ap > 0 ? h("span", { class: "pips" }, "●".repeat(af) + "○".repeat(L.affinity_max - af)) : h("span"),
          ap > 0 ? button("−", () => { meta.allocAffinity(id, -1); re(); }, "", af <= 0) : h("span"),
          ap > 0 ? button("＋縁", () => { meta.allocAffinity(id, 1); re(); }, "", sealed || af >= L.affinity_max || meta.affinityUsed() >= ap) : h("span"),
          ss > 0 ? button(sealed ? "封印を解く" : "封印", () => { meta.toggleSeal(id); re(); }, "", !sealed && (meta.S.alloc.seals.length >= ss || af > 0)) : h("span")));
      }
      left.append(h("div", { class: "section" },
        h("h3", {}, `縁と封印　縁 ${meta.affinityUsed()} / ${ap}　封印 ${meta.S.alloc.seals.length} / ${ss}`),
        h("p", { class: "small" }, `縁を結んだカードはレベルアップで出やすくなる（1つにつき ×${1 + L.affinity_step}、1枚に最大${L.affinity_max}）。封印したカードは新しく取る候補から外れる。何度でも付け替えられる。`),
        list));
    }

    // 右: 選んだ節の札
    const n = meta.treeNode(hub.node)!;
    const open = meta.nodeOpen(n.id), block = meta.nodeBlock(n.id);
    const eff = meta.cardMods();
    const sum: [string, string][] = [
      ["レア度", `${eff.altar} / ${D.altar.max}`],
      ["縁", `${meta.affinityUsed()} / ${ap}`],
      ["封印", `${meta.S.alloc.seals.length} / ${ss}`],
      ["亡霊の攻撃", `+${Math.round((eff.ghost_atk ?? 0) * 100)}%`],
    ];
    if (eff.taint_resist) sum.push(["穢れの重さ", `−${Math.round(eff.taint_resist * 100)}%`]);
    const dl = h("dl", {});
    for (const [k, v] of sum) dl.append(h("dt", {}, k), h("dd", {}, v));
    const aside = h("aside", { class: "frame node-card" },
      h("div", { class: "nh" }, h("span", { class: "serif" }, n.name), h("span", { class: `state ${open ? "open" : ""}` }, open ? "開いた" : `供物 ${n.cost}`)),
      h("p", {}, n.desc),
      open ? null : button(block === "" ? `開く（供物 ${n.cost}）` : block, () => { if (meta.openNode(n.id)) re(); }, "primary", block !== ""),
      h("h3", {}, "いまの効果"), dl,
      h("h3", {}, "レベルアップのレア度"), this.rarityBars(eff.altar),
      meta.S.tree.length > 0 ? button("樹をほどく（供物を全部戻す）", () => this.showConfirm("樹をほどく", "開いた節と縁・封印をすべて外し、払った供物を全部戻す。あとで好きな枝に開き直せる。", () => { meta.resetTree(); re(); }, re, "ほどく"), "quiet") : null);
    p.append(h("div", { class: "hub tree-hub" }, left, aside));
  }

  /** 霊廟: 施設を建て、保管中の亡霊を住まわせる（住んでいる間は連れていけない） */
  private hubMausoleum(p: HTMLElement, re: () => void): void {
    const D = this.D, meta = this.meta;
    const fb = meta.facilityBuff();
    const eff: string[] = [];
    const tagN: Record<string, number> = {};
    for (const t of fb.tags) tagN[t] = (tagN[t] ?? 0) + 1;
    if (fb.offer > 0) eff.push(`ランの供物 最大 +${Math.round(fb.offer)}`);
    if (fb.ghost_atk > 0) eff.push(`亡霊の攻撃 +${Math.round(fb.ghost_atk * 100)}%`);
    if (fb.hp > 0) eff.push(`最大HP +${Math.round(fb.hp * 100)}%`);
    p.append(h("div", { class: "maus-intro" },
      h("p", {}, "保管庫の亡霊を施設に住まわせると、拠点で力を貸してくれる。住んでいる間は出撃に連れていけない（外せばまた連れていける）。建てた施設は戻せない。"),
      h("div", { class: "row maus-eff" }, h("h4", {}, "いまの効果"),
        ...Object.keys(tagN).map((t) => this.tagChip(t, tagN[t])),
        ...(eff.length || Object.keys(tagN).length ? eff.map((x) => h("span", { class: "chip on" }, x)) : [h("span", { class: "small faint" }, "なし")]))));
    const grid = h("div", { class: "maus-grid" });
    for (const f of D.facilities) grid.append(this.facilityCard(f, re));
    p.append(grid);
  }

  /** 施設1つの板（建てる前・建てた後） */
  private facilityCard(f: Facility, re: () => void): HTMLElement {
    const meta = this.meta, built = meta.built(f.id);
    const card = h("section", { class: `frame facility${built ? " built" : ""}` }, this.frameHead(f.name, built ? "建立済み" : f.cost > 0 ? `供物 ${f.cost}` : "無料", f.icon));
    card.append(h("p", { class: "small" }, f.desc));
    if (!built) {
      const why = meta.buildBlock(f.id);
      card.append(why === ""
        ? button(f.cost > 0 ? `建てる（供物 ${f.cost}）` : "建てる", () => this.showConfirm(`${f.name}を建てる`, `供物 ${f.cost} を払って建てる。建てた施設は戻せない（祭壇の樹をほどいても供物は戻らない）。`, () => { meta.build(f.id); re(); }, re, "建てる"), "primary")
        : h("p", { class: "small lockline" }, iconSvg("clock", "icon"), why));
      return card;
    }
    if (f.effect.steps) {
      const every = f.effect.every ?? 1, n = meta.S.progress.mourned_count, got = meta.memorialSteps();
      const ul = h("ul", { class: "steps" });
      f.effect.steps.forEach((st, i) => ul.append(h("li", { class: i < got.length ? "on" : "" }, `${(i + 1) * every}回　${st.text}`)));
      card.append(h("p", { class: "small" }, `弔った回数 `, h("b", { class: "num gold" }, String(n))), ul);
      return card;
    }
    const res = meta.residents(f.id);
    const seats = h("div", { class: "seats" });
    for (const g of res) {
      seats.append(h("div", { class: "seat" }, this.ghostCard(g, false, null, this.residentEffect(f, g.ghost_id)),
        button("外す", () => { meta.unstation(g.ghost_id); re(); }, "quiet")));
    }
    for (let i = res.length; i < f.slots; i++) seats.append(h("div", { class: "seat empty-seat small faint" }, "空いている台座"));
    card.append(seats);
    if (res.length < f.slots) {
      const cand = meta.storedGhosts().filter((g) => g.stationed_at !== f.id);
      const pick = h("div", { class: "cands" });
      for (const g of cand) {
        const tr = meta.tier(g.tier_id);
        pick.append(h("button", { type: "button", class: "cand", style: `--tc:${tr.color}`, onclick: () => { meta.station(g.ghost_id, f.id); re(); } },
          this.rank(tr), h("span", { class: "cn" }, g.display_name), h("span", { class: "ce small" }, this.residentEffect(f, g.ghost_id)),
          g.stationed_at ? h("span", { class: "small faint" }, `${meta.facility(g.stationed_at)?.name}から移す`) : null));
      }
      if (cand.length === 0) pick.append(h("p", { class: "small faint" }, "住まわせられる亡霊がいない。"));
      card.append(h("h4", {}, "住まわせる亡霊を選ぶ"), pick);
    }
    return card;
  }

  /** その亡霊を住まわせた時の効果の説明 */
  private residentEffect(f: Facility, ghostId: string): string {
    const g = this.meta.getGhost(ghostId);
    if (!g) return "";
    if (f.effect.offer_per_mult) return `供物 最大 +${Math.round(this.meta.tier(g.tier_id).mult * f.effect.offer_per_mult)}（生き延びた割合を掛ける）`;
    if (f.effect.tag_points) return (this.D.weapons[g.primary_weapon_id]?.tags ?? []).map((t) => `${this.D.tags[t].name} +${f.effect.tag_points}`).join("・");
    return "";
  }

  private hubShelf(p: HTMLElement): void {
    const meta = this.meta;
    if (!meta.shelfUnlocked()) {
      p.append(h("div", { class: "empty" }, "最初のランを終えると開く。"));
      return;
    }
    const st = meta.storedHeirs();
    p.append(h("p", {}, `ランを終えるたび（死亡・生還）に、主人公の武器かパッシブを1つ形見として残せる。出撃時に1つだけ身につけられ、そのランで使い切る。棚は${this.D.shelf.capacity}つまでで、あふれた時は一番古い形見から手放す。`));
    const g = h("div", { class: "picks" });
    for (const x of st) g.append(this.pick([h("span", { class: "tier" }, `第${x.from_generation}代より`), h("span", { class: "name" }, x.name), h("span", { class: "meta" }, meta.heirEffect(x))], { edge: "var(--candle)" }));
    p.append(h("h3", {}, `棚　${st.length} / ${this.D.shelf.capacity}`), g);
    if (st.length === 0) p.append(h("div", { class: "empty" }, "まだ形見はない。"));
  }

  // ---------------------------------------------------------------- confirm / level / pause / settings
  showConfirm(title: string, body: string, onYes: () => void, onNo: () => void, yes = "出撃する"): void {
    const p = this.open("narrow");
    p.append(h("h2", {}, title), h("p", {}, body), h("div", { class: "row" }, button(yes, onYes, "primary"), button("戻る", onNo)));
  }

  /** カードのアイコン名 */
  private cardIcon(c: Card): string {
    if (c.kind === "heal") return "heal";
    if (c.kind === "sigil") return "might";
    if (c.kind === "curse") return "ghost";
    return c.id;
  }

  /** いまの持ち物とセット効果（レベルアップ・ポーズの右側） */
  private buildList(sim: RunSim): HTMLElement {
    const D = sim.D;
    const ul = h("ul", { class: "build-list" });
    for (const id of Object.keys(sim.weapons)) {
      const b = sim.wbonus[id] ?? 0;
      ul.append(h("li", { class: "w" }, iconSvg(id), h("span", { class: "bn" }, sim.weaponName(id), h("small", {}, `Lv${sim.weapons[id]}${b > 0 ? `・+${Math.round(b * 100)}%` : ""}`))));
    }
    for (const g of sim.ghosts) ul.append(h("li", { class: "g" }, iconSvg(g.rec.primary_weapon_id), h("span", { class: "bn" }, g.rec.display_name.replace(/^(第\d+代)・.*$/, "$1の亡霊"), h("small", {}, gradeAt(D.weapons[g.rec.primary_weapon_id], g.rec.weapon_rank ?? 0, g.rec.evolved, g.rec.weapon_branch).name))));
    for (const id of Object.keys(sim.passives)) ul.append(h("li", {}, iconSvg(id), h("span", { class: "bn" }, D.passives[id].name, h("small", {}, `Lv${sim.passives[id]}`))));
    if (sim.lineageLv > 0) ul.append(h("li", { class: "l" }, iconSvg(sim.lineage.card.id), h("span", { class: "bn" }, sim.lineage.card.name, h("small", {}, `Lv${sim.lineageLv}`))));
    for (const id of sim.sigils) ul.append(h("li", { class: "s" }, iconSvg("might"), h("span", { class: "bn" }, D.sigils.find((x) => x.id === id)?.name ?? id, h("small", {}, "刻印"))));
    for (const id of sim.curses) ul.append(h("li", { class: "c" }, iconSvg("ghost"), h("span", { class: "bn" }, D.curses.find((x) => x.id === id)?.name ?? id, h("small", {}, "呪い"))));
    const pts = sim.tagPoints(), sets = sim.activeSets();
    return h("aside", { class: "frame build-side" }, h("h4", {}, "現在のビルド"), ul,
      h("p", { class: "small faint" }, `パッシブ ${Object.keys(sim.passives).length} / ${sim.passiveSlots()}`),
      h("h4", {}, "共鳴"),
      h("div", { class: "row tags" }, ...Object.keys(pts).map((t) => this.tagChip(t, pts[t]))),
      sets.length ? h("ul", { class: "sets" }, ...sets.map((st) => h("li", {}, this.tagChip(st.tag, st.at), st.text))) : h("p", { class: "small faint" }, "同じタグを2つ集めるとセット効果"));
  }

  showLevel(sim: RunSim, choices: Card[], onPick: (c: Card) => void): void {
    const p = this.open("level-panel", "ov-level");
    const cards = h("div", { class: "lv-cards" });
    choices.forEach((c, i) => {
      const R = sim.rarity(c.rar), d = sim.describe(c);
      const aff = sim.cardMods.affinity?.[c.id] ?? 0;
      const tag = sim.cardTag(c);
      const special = c.kind === "sigil" ? " sigil-card" : c.kind === "curse" ? " curse-card" : c.branch ? ` branch-card br-${c.branch}` : c.kind === "rank" ? " branch-card rank-card" : c.kind === "lineage" ? " house-card" : "";
      const color = c.kind === "sigil" ? "#7fe3dc" : c.kind === "curse" ? "#d65a5e" : R.color;
      const ribbon = c.kind === "sigil" ? "刻印" : c.kind === "curse" ? "呪い" : c.branch ? `ランクアップ・道${c.branch === "a" ? "一" : "二"}` : c.kind === "rank" ? (c.rar === "LR" ? "進化" : "ランクアップ") : R.name;
      const b = h("button", { type: "button", class: `lv-card r-${c.rar}${special}`, style: `--rc:${color}`, onclick: () => onPick(c) },
        this.touchMode ? null : h("span", { class: "key" }, String(i + 1)),
        tag ? h("span", { class: "ctag" }, this.tagChip(tag)) : null,
        h("span", { class: "gem" }, iconSvg(this.cardIcon(c))),
        h("span", { class: "n" }, d.n),
        h("span", { class: "what" }, d.k),
        h("span", { class: "d" }, d.d),
        aff > 0 ? h("span", { class: "aff" }, `縁 ${"●".repeat(aff)}`) : null,
        h("span", { class: "ribbon" }, ribbon));
      cards.append(b);
      this.hotkeys.push(b);
    });
    const branchNow = choices.some((c) => c.branch);
    const rankNow = choices.some((c) => c.kind === "rank");
    p.append(
      h("header", { class: "lv-head" }, h("h2", {}, branchNow ? "武器の道を選ぶ" : rankNow ? "武器のランクアップ" : "レベルアップ"),
        h("p", {}, branchNow ? "ここで選んだ道は、このランの最後まで続く" : rankNow ? "武器が持ち替わり、攻撃の形が変わる（取らなければ次のレベルアップでまた出る）" : `レベル ${sim.level - sim.pending + 1}　新たな力を選択してください`)),
      h("div", { class: "lv-body" }, cards, this.buildList(sim)));
    if (!this.touchMode) p.append(h("p", { class: "keys" }, h("kbd", {}, "1"), h("kbd", {}, "2"), h("kbd", {}, "3"), " で選択"));
    this.guard(this.hotkeys);
  }

  showPause(sim: RunSim, on: { resume: () => void; settings: () => void; retire: () => void }): void {
    const p = this.open("narrow");
    let armed = false;
    const warn = h("p", { class: "danger small", hidden: true });
    p.append(h("h2", {}, "一時停止"), this.buildList(sim),
      h("div", { class: "row" },
        button("続ける", on.resume, "primary"),
        button("説明書", () => this.showManual(() => this.showPause(sim, on), "resonance")),
        button("設定", on.settings),
        button("リタイア", () => {
          if (!armed) {
            armed = true;
            warn.hidden = false;
            warn.textContent = `リタイアすると亡霊も形見も残らない${sim.ghost ? "。連れている亡霊は成仏する" : ""}。もう一度押すとリタイアする。`;
            return;
          }
          on.retire();
        }, "danger")),
      warn);
  }

  /** 説明書（章ごとのタブ） */
  showManual(back: () => void, ch: Chapter = "basics"): void {
    const p = this.open("wide manual", "ov-manual");
    p.dataset.screen = "manual";
    const tabs = h("div", { class: "tabs", role: "tablist" });
    for (const [id, name] of CHAPTERS) {
      tabs.append(h("button", { type: "button", role: "tab", "aria-selected": String(ch === id), onclick: () => this.showManual(back, id) }, name));
    }
    p.append(h("header", { class: "hub-head" }, h("h2", {}, "説明書"), tabs, h("div", { class: "row purses" }, button("閉じる", back, "primary"))),
      manualPage(this.D, ch, this.touchMode));
  }

  showSettings(on: { back: () => void; volume: (v: number) => void; loadTest: () => void; wipe: () => void }, loadText = ""): void {
    const p = this.open("narrow");
    let armed = false;
    const vol = h("input", { id: "volIn", type: "range", min: 0, max: 100, step: 5, value: Math.round(Settings.volume * 100) });
    vol.addEventListener("input", () => on.volume(Number(vol.value) / 100));
    const shake = h("input", { id: "shakeIn", type: "checkbox", checked: Settings.shake });
    const dbg = h("input", { id: "dbgIn", type: "checkbox", checked: Settings.debugHud });
    const wl = h("span", { class: "small danger" });
    p.append(
      h("h2", {}, "設定"),
      h("label", { for: "volIn" }, "音量", vol),
      h("label", { class: "check" }, shake, "被弾した時に画面を揺らす"),
      h("label", { class: "check" }, dbg, "FPS などの計測値を表示する"),
      h("div", { class: "row" }, button("負荷試験（敵300体・10秒）", on.loadTest), h("span", { class: "small mute" }, loadText)),
      h("div", { class: "row" }, button("セーブを消去", () => {
        if (!armed) {
          armed = true;
          wl.textContent = "亡霊・形見・供物・家系・履歴がすべて消える。もう一度押すと消去する。";
          return;
        }
        on.wipe();
        wl.textContent = "消去した";
      }, "danger"), wl),
      h("div", { class: "row" }, button("戻る", () => {
        Settings.volume = Number(vol.value) / 100;
        Settings.shake = shake.checked;
        Settings.debugHud = dbg.checked;
        Settings.save();
        on.back();
      }, "primary")),
    );
  }

  // ---------------------------------------------------------------- result / pending
  showResult(sim: RunSim, out: RunRecord | null, onHub: () => void, onTitle: () => void = onHub): void {
    const meta = this.meta, S = meta.S, D = this.D;
    const res = sim.result;
    const p = this.open(`result-panel ${res}`, "ov-result");
    const bd = backdrop(res === "boss_cleared" ? "result_clear" : "result_death");
    if (bd) p.before(bd);
    const head = {
      player_death: ["YOU DIED", out?.new_ghost_id ? "しかし、あなたの戦いは無駄ではなかった。新たな亡霊が、ここに刻まれる。" : "未練なき魂は、亡霊として留まれなかった。"],
      boss_cleared: ["SURVIVED", "冥王を討ち、生還した。供物にクリアの分が加わる。"],
      retired: ["RETIRED", "撤退した。亡霊も形見も残らない。"],
      "": ["", ""],
    }[res];
    p.append(h("header", { class: "res-head" }, h("h1", {}, head[0]), h("p", {}, head[1])));

    // 左: 記録 / 右: 新しい亡霊
    const rows: [string, string][] = [
      ["生存時間", fmt(sim.t)], ["撃破数", sim.kills.toLocaleString()], ["ボス撃破数", String(sim.bossKills)], ["到達レベル", String(sim.level)],
      ["使用武器", sim.weaponName(sim.mainWeapon)], ["未練の欠片", `${sim.fragments} / ${D.ghost_birth.fragments}`], ...(D.lineages_enabled ? [["家系", sim.lineage.name] as [string, string]] : []), ["獲得した供物", out ? `+${out.offerings}${out.facility_offer ? `（鎮魂堂 +${out.facility_offer}）` : ""}` : "—"],
    ];
    const tbl = h("dl", { class: "res-stats" });
    for (const [k, v] of rows) tbl.append(h("dt", {}, k), h("dd", { class: "num" }, v));
    const right = h("section", { class: "frame newborn" });
    if (res === "player_death") {
      const nid = out?.new_ghost_id ?? "";
      const ng = S.pending_ghost && S.pending_ghost.ghost_id === nid ? S.pending_ghost : meta.getGhost(nid);
      if (ng) {
        const tr = meta.tier(ng.tier_id);
        right.append(h("h4", {}, "新たな亡霊が生まれました"),
          h("div", { class: "nb" }, this.portrait(ng, "big"),
            h("div", {},
              h("div", { class: "gname" }, h("span", {}, ng.display_name), this.rank(tr)),
              h("dl", { class: "gstats" },
                h("dt", {}, "等級"), h("dd", { style: `color:${tr.color}` }, tr.name),
                h("dt", {}, "生存時間"), h("dd", { class: "num" }, fmt(ng.survival_seconds)),
                h("dt", {}, "攻撃補正"), h("dd", {}, `×${ng.stat_snapshot.attack_mult.toFixed(2)}`),
                h("dt", {}, "継承武器"), h("dd", {}, `${this.weaponLabel(ng)} Lv${ng.weapon_level}`)))));
      } else {
        const B = D.ghost_birth;
        right.append(h("h4", {}, "亡霊になれなかった"),
          h("div", { class: "nb" }, this.portrait(null, "big"),
            h("div", {},
              h("p", { class: "small" }, out?.ghost_failed === "time"
                ? `生き延びた時間が短すぎた。亡霊になるには、ランの${Math.round(B.min_survival * 100)}%（${fmt(sim.runLen * B.min_survival)}）以上を生き延びる必要がある。`
                : `未練が足りなかった（未練の欠片 ${sim.fragments} / ${B.fragments}）。欠片は墓暴きや怨霊を倒すと手に入る。`),
              h("p", { class: "small faint" }, "その魂は、静かに消えた。"))));
      }
    } else {
      right.append(h("h4", {}, res === "boss_cleared" ? "生還" : "リタイア"),
        h("p", { class: "small" }, res === "boss_cleared" ? "生還したため亡霊は生まれない。" : "リタイアしたため亡霊も形見も残らない。"));
    }
    p.append(h("div", { class: "res-grid" }, h("section", { class: "frame" }, tbl), right));

    // 連れていった亡霊の行方・知らせ
    const comp = sim.ghosts.map((g) => g.rec), dv = sim.devours.map((d) => d.rec);
    if (comp.length || dv.length) {
      const sec = h("section", { class: "frame fate" }, h("h4", {}, "連れて行った亡霊"));
      for (const g of comp) sec.append(h("div", { class: "fate-row" }, this.portrait(g, "small"), h("span", { class: "gname" }, g.display_name),
        h("span", { class: "chip" }, "帰還"), h("span", { class: "small mute" }, "共に戦い、記録庫へ戻った。")));
      for (const g of dv) sec.append(h("div", { class: "fate-row" }, this.portrait(g, "small"), h("span", { class: "gname" }, g.display_name),
        h("span", { class: "chip taint" }, "怨霊化"), h("span", { class: "small mute" }, "喰らわれ、怨霊となって次からのランで襲ってくる。")));
      p.append(sec);
    }
    for (const id of out?.unlocked_lineages ?? []) {
      const l = meta.lineage(id);
      p.append(h("div", { class: "notice" }, h("b", {}, `家系「${l.name}」が解放された`), h("span", { class: "small mute" }, `${l.motto}。次の出撃から選べる。`)));
    }
    if (out?.purified) p.append(h("div", { class: "notice soul" }, h("b", {}, "怨霊を祓った"), h("span", { class: "small mute" }, `${out.purified}は鎮まった。穢れが1つ消え、供物 +${D.rites.wraith.purify_offerings}。`)));
    else if (out?.wraith_escaped) p.append(h("p", { class: "small taint" }, `怨霊「${out.wraith_escaped}」は祓えなかった。次のランでまた現れる。`));
    if (out?.used_heirloom) p.append(h("p", { class: "small mute" }, `形見「${out.used_heirloom}」を使い切った。`));

    const done = (): void => this.showResult(sim, out, onHub, onTitle);
    if (S.pending_ghost) {
      this.pendingGhostUi(p, done);
      return;
    }
    if (S.pending_heirloom) this.heirChoiceUi(p, done);
    const blocked = S.pending_heirloom !== null;
    p.append(h("div", { class: "res-buttons" },
      button("タイトルに戻る", onTitle, "frame-btn", blocked),
      button("もう一度挑戦する", onHub, "primary", blocked)));
  }

  showPending(onDone: () => void): void {
    const S = this.meta.S;
    if (S.pending_ghost) {
      const p = this.open();
      p.append(h("h2", { class: "lose" }, "保管庫がいっぱい"));
      this.pendingGhostUi(p, () => this.showPending(onDone));
    } else if (S.pending_heirloom) {
      const p = this.open();
      p.append(h("h2", {}, "形見を残す"));
      this.heirChoiceUi(p, () => this.showPending(onDone));
    } else {
      onDone();
    }
  }

  private pendingGhostUi(p: HTMLElement, done: () => void): void {
    const meta = this.meta, ng = meta.S.pending_ghost!;
    p.append(h("div", { class: "notice soul" }, h("b", {}, "成仏させる亡霊を1体選ぶ"), h("span", { class: "small mute" }, `保管庫は${this.D.vault_capacity}体まで。新しい亡霊を残すなら、ほかの1体を成仏させる。`)));
    const g = h("div", { class: "picks" });
    g.append(this.ghostCard(ng, true, () => { meta.resolvePendingGhost(ng.ghost_id); done(); }, "新しい亡霊を成仏させる"));
    for (const x of meta.storedGhosts()) {
      const fac = x.stationed_at ? meta.facility(x.stationed_at)?.name : "";
      g.append(this.ghostCard(x, false, () => { meta.resolvePendingGhost(x.ghost_id); done(); }, fac ? `${fac}の堂守。成仏させると施設の効果も消える` : "この亡霊を成仏させる"));
    }
    p.append(g);
  }

  private heirChoiceUi(p: HTMLElement, done: () => void): void {
    const meta = this.meta, pend = meta.S.pending_heirloom!;
    const full = meta.storedHeirs().length >= this.D.shelf.capacity;
    p.append(h("div", { class: "notice" }, h("b", {}, `第${pend.generation}代の形見を1つ残す`),
      h("span", { class: "small mute" }, `次からの世代が1回だけ身につけて出撃できる（元の半分ほどの強さ。武器は最大Lv${this.D.shelf.weapon_max_level}・パッシブは最大Lv${this.D.shelf.max_level}）。${full ? "棚がいっぱいなので、一番古い形見を手放す。" : ""}`)));
    const g = h("div", { class: "picks" });
    pend.options.forEach((o, i) => {
      const card = this.pick([h("span", { class: "tier" }, o.type === "weapon" ? "武器" : "パッシブ"), h("span", { class: "name" }, meta.heirLabel(o)), h("span", { class: "meta" }, meta.heirEffect(o))],
        { edge: "var(--candle)", onPress: () => { meta.resolveHeirloom(i); done(); } });
      g.append(card);
      if (i < 3 && card instanceof HTMLButtonElement) this.hotkeys.push(card);
    });
    g.append(this.pick([h("span", { class: "name" }, "何も残さない"), h("span", { class: "meta" }, "棚は変わらない")], { edge: "var(--faint)", onPress: () => { meta.resolveHeirloom(-1); done(); } }));
    p.append(g);
  }
}
