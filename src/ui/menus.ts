// 戦闘以外の画面: タイトル / 納骨堂（出撃・祭壇・書庫・形見の棚）/ 確認 / レベルアップ / ポーズ / 設定 / リザルト。
// 画面を開くたびに作り直す（状態は MetaService と hub の選択だけが持つ）。
// 納骨堂は「左＝誰が行くか（家系・亡霊・形見）」「右＝出撃札（いまの選択のまとめと出撃ボタン）」の2列。
import type { Balance, Lineage, RunMode } from "../data/types.ts";
import type { MetaService } from "../meta/metaService.ts";
import type { ActiveRun, GhostRecord, RunRecord } from "../meta/records.ts";
import { Platform } from "../platform.ts";
import { Settings } from "../settings.ts";
import { RunSim, type Card } from "../sim/runSim.ts";
import { fmt } from "../view/hud.ts";
import { button, h } from "./dom.ts";

export interface SortieRequest { ghostId: string; heirId: string; weapon: string; mode: RunMode; seed: number; lineage: string }

const RESULT_NAME: Record<string, string> = { player_death: "死亡", boss_cleared: "生還", retired: "リタイア" };
const KANJI = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 代数を漢数字に（位牌の縦書き用） */
export function kanjiNum(n: number): string {
  if (n < 10) return KANJI[n];
  if (n < 20) return "十" + (n % 10 ? KANJI[n % 10] : "");
  if (n < 100) return KANJI[Math.floor(n / 10)] + "十" + (n % 10 ? KANJI[n % 10] : "");
  return String(n);
}

export class Menus {
  readonly root: HTMLElement;
  readonly meta: MetaService;
  readonly D: Balance;
  hub = { tab: "sortie", ghost: "", heir: "", weapon: "sword", mode: "short" as RunMode, seed: 0, lineage: "nameless" };
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
  private open(cls = ""): HTMLElement {
    this.hotkeys = [];
    const panel = h("div", { class: `panel ${cls}` });
    const ov = h("div", { class: "ov" }, panel);
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

  /** 選べるカード（亡霊・形見・家系など）。onPress が null なら表示だけ */
  private pick(parts: (Node | string | null)[], opts: { edge?: string; pressed?: boolean; onPress?: (() => void) | null; cls?: string }): HTMLElement {
    const style = opts.edge ? `--edge:${opts.edge}` : undefined;
    if (!opts.onPress) return h("div", { class: `pick ${opts.cls ?? ""}`, style }, ...parts);
    return h("button", { type: "button", class: `pick ${opts.cls ?? ""}`, style, "aria-pressed": String(!!opts.pressed), onclick: opts.onPress }, ...parts);
  }

  ghostCard(g: GhostRecord, pressed: boolean, onPress: (() => void) | null, note = ""): HTMLElement {
    const D = this.D, tr = this.meta.tier(g.tier_id);
    const wname = g.evolved ? D.evolutions[g.primary_weapon_id].name : D.weapons[g.primary_weapon_id].name;
    const cause = D.enemies[g.death_cause_id]?.name ?? "不明";
    return this.pick([
      h("span", { class: "tier" }, `${tr.name}　攻撃×${tr.mult}`),
      h("span", { class: "name" }, g.display_name),
      h("span", { class: "meta" }, `${fmt(g.survival_seconds)} 生存 / ${wname} Lv${g.weapon_level}${g.passive_id ? ` / ${D.passives[g.passive_id].name} Lv${g.passive_level}` : ""}`),
      h("span", { class: "meta" }, `撃破 ${g.kills}　死因 ${cause}`),
      note ? h("span", { class: "note" }, note) : null,
    ], { edge: tr.color, pressed, onPress });
  }

  private houseCard(l: Lineage, pressed: boolean, onPress: () => void): HTMLElement {
    const open = this.meta.lineageUnlocked(l.id);
    if (!open) {
      const pr = this.meta.unlockProgress(l);
      return this.pick([
        h("span", { class: "tier" }, "未解放"),
        h("span", { class: "name" }, l.name),
        h("span", { class: "meta" }, l.unlock?.text ?? ""),
        pr ? h("span", { class: "meta num" }, `${pr.cur} / ${pr.need}`) : null,
        pr ? h("div", { class: "bar" }, h("i", { style: `width:${(pr.cur / pr.need) * 100}%` })) : null,
      ], { cls: "house locked" });
    }
    return this.pick([
      h("span", { class: "name" }, l.name),
      h("span", { class: "motto" }, l.motto),
      h("span", { class: "plus" }, l.trait),
      l.weakness !== "なし" ? h("span", { class: "minus" }, l.weakness) : null,
    ], { cls: "house", edge: "var(--candle)", pressed, onPress });
  }

  // ---------------------------------------------------------------- title
  showTitle(active: ActiveRun | null, on: { hub: () => void; resume: () => void; abandon: () => void; settings: () => void }): void {
    const p = this.open("title-screen");
    const S = this.meta.S;
    const row = h("div", { class: "row" });
    if (active) {
      const g = active.ghost_id ? this.meta.getGhost(active.ghost_id) : null;
      row.append(
        button(`中断したランを再開（${fmt(active.checkpoint?.t ?? 0)}・${g ? `${g.display_name}と` : "単独"}）`, on.resume, "primary"),
        button("放棄する", on.abandon, "danger"),
      );
    } else {
      row.append(button(S.progress.runs > 0 ? `納骨堂へ　第${S.progress.generation + 1}代` : "はじめる", on.hub, "primary"));
    }
    row.append(button("設定", on.settings, "quiet"));
    if (Platform.canQuit()) row.append(button("終了", () => Platform.quit(), "quiet"));
    const parts: (Node | null)[] = [
      h("h1", {}, "Death Legacy", h("span", { class: "sub" }, "死してなお、継ぐ")),
      h("p", { class: "lead" }, "今日の自分が、明日の仲間になる。死んだ主人公は亡霊として残り、次の出撃に一度だけ連れていける。連れていった亡霊は、そのランが終われば成仏する。"),
      row,
      active ? h("p", { class: "small" }, "放棄するとリタイア扱いになり、連れていた亡霊と形見は戻らない。") : null,
      h("p", { class: "help" }, this.touchMode
        ? "画面をドラッグで移動。攻撃は自動。右下で回避、右上でポーズ。横向きがおすすめ。"
        : "WASD・矢印キーで移動。攻撃は自動。Space で回避、Esc で一時停止、強化は 1・2・3 でも選べる。"),
      this.meta.repo.source === "backup" ? h("p", { class: "gold small" }, "セーブが壊れていたため、バックアップから復元した。") : null,
      h("p", { class: "ver" }, `試作版 ${__VERSION__}`),
    ];
    for (const n of parts) if (n) p.append(n);
  }

  // ---------------------------------------------------------------- hub
  showHub(onBack: () => void): void {
    const p = this.open("wide");
    const S = this.meta.S;
    const re = (): void => this.showHub(onBack);
    const tabs = h("div", { class: "tabs", role: "tablist" });
    for (const [id, name, ok] of [["sortie", "出撃", true], ["altar", "祭壇", true], ["library", "書庫", this.meta.libraryUnlocked()], ["shelf", "形見の棚", this.meta.shelfUnlocked()]] as const) {
      tabs.append(h("button", { type: "button", role: "tab", "aria-selected": String(this.hub.tab === id), onclick: () => { this.hub.tab = id; re(); } },
        name, ok ? null : h("span", { class: "lock" }, "未解放")));
    }
    p.append(h("div", { class: "spread" },
      h("h2", {}, "納骨堂"),
      h("div", { class: "row" },
        h("span", { class: "purse" }, "供物", h("b", {}, String(this.meta.offeringsFree())), `/ ${S.offerings.earned}`),
        button("タイトル", onBack, "quiet"))),
      tabs);
    if (this.hub.tab === "altar") this.hubAltar(p, re);
    else if (this.hub.tab === "library") this.hubLibrary(p, re);
    else if (this.hub.tab === "shelf") this.hubShelf(p);
    else this.hubSortie(p, re);
  }

  private hubSortie(p: HTMLElement, re: () => void): void {
    const D = this.D, meta = this.meta, hub = this.hub, S = meta.S;
    if (!meta.lineageUnlocked(hub.lineage)) hub.lineage = D.lineages[0].id;
    const lin = meta.lineage(hub.lineage);
    const stored = meta.storedGhosts();
    if (hub.ghost && !stored.some((g) => g.ghost_id === hub.ghost)) hub.ghost = "";
    const heirs = meta.shelfUnlocked() ? meta.storedHeirs() : [];
    if (hub.heir && !heirs.some((x) => x.heir_id === hub.heir)) hub.heir = "";
    const weapon = lin.weapon ?? hub.weapon;

    const choose = h("div", { class: "choose" });
    // 家系
    const houses = h("div", { class: "picks" });
    for (const l of D.lineages) houses.append(this.houseCard(l, hub.lineage === l.id, () => { hub.lineage = l.id; re(); }));
    choose.append(h("div", { class: "section" }, h("h3", {}, "家系"), houses));
    // 亡霊
    const vault = h("div", { class: "picks" });
    vault.append(this.pick([
      h("span", { class: "tier" }, "単独"),
      h("span", { class: "name" }, "誰も連れていかない"),
      h("span", { class: "meta" }, lin.mods.solo_xp === -1 ? "亡霊は温存される" : `亡霊は温存される。経験値 +${Math.round(D.solo_xp_bonus * 100)}%`),
    ], { edge: "var(--faint)", pressed: hub.ghost === "", onPress: () => { hub.ghost = ""; re(); } }));
    for (const g of stored) vault.append(this.ghostCard(g, hub.ghost === g.ghost_id, () => { hub.ghost = g.ghost_id; re(); }));
    choose.append(h("div", { class: "section" }, h("h3", {}, `亡霊　${stored.length} / ${D.vault_capacity}`), vault,
      stored.length === 0 ? h("div", { class: "empty" }, "まだ亡霊はいない。死ねば、その生き様が最初の亡霊になる。") : null));
    // 形見
    if (meta.shelfUnlocked()) {
      const hg = h("div", { class: "picks" });
      hg.append(this.pick([h("span", { class: "name" }, "何も持たない"), h("span", { class: "meta" }, "形見は棚に残る")],
        { edge: "var(--faint)", pressed: hub.heir === "", onPress: () => { hub.heir = ""; re(); } }));
      for (const x of heirs) {
        const bonus = lin.mods.heir_level_bonus ?? 0;
        hg.append(this.pick([
          h("span", { class: "tier" }, `第${x.from_generation}代より`),
          h("span", { class: "name" }, x.name),
          h("span", { class: "meta" }, meta.heirEffect(x) + (bonus ? `（${lin.name}なら +${bonus}Lv）` : "")),
        ], { edge: "var(--candle)", pressed: hub.heir === x.heir_id, onPress: () => { hub.heir = x.heir_id; re(); } }));
      }
      choose.append(h("div", { class: "section" }, h("h3", {}, "形見　1つだけ・そのランで使い切り"), hg));
    }
    // 武器・ラン設定
    const wseg = h("div", { class: "seg" });
    for (const id of Object.keys(D.weapons)) {
      const b = h("button", { type: "button", "aria-pressed": String(weapon === id), disabled: !!lin.weapon && lin.weapon !== id, onclick: () => { hub.weapon = id; re(); } }, D.weapons[id].name);
      wseg.append(b);
    }
    const mseg = h("div", { class: "seg" });
    for (const [id, name] of [["short", "3分でボス"], ["full", "10分"]] as const) {
      mseg.append(h("button", { type: "button", "aria-pressed": String(hub.mode === id), onclick: () => { hub.mode = id; re(); } }, name));
    }
    const seedIn = h("input", { id: "seedIn", inputmode: "numeric", value: String(hub.seed), size: 8, "aria-label": "seed" });
    choose.append(h("div", { class: "section opts" }, h("h3", {}, lin.weapon ? `初期武器（${lin.name}は${D.weapons[lin.weapon].name}）` : "初期武器"), wseg,
      h("h3", {}, "ランの長さ"), h("div", { class: "row" }, mseg, h("label", { class: "row" }, "seed", seedIn))));
    // 履歴
    if (S.run_history.length) {
      const hist = h("div", { class: "hist" });
      for (const r of S.run_history.slice(0, 6)) {
        hist.append(h("div", { class: r.result === "boss_cleared" ? "win" : "" },
          h("span", {}, r.ended_at.slice(5, 16).replace("T", " ")), h("span", {}, RESULT_NAME[r.result] ?? ""), h("span", {}, fmt(r.duration_seconds)),
          h("span", {}, `Lv${r.player_level}　撃破${r.kills}${r.consumed_ghost ? `　${r.consumed_ghost}と` : ""}`)));
      }
      choose.append(h("div", { class: "section" }, h("h3", {}, "これまでのラン"), hist));
    }

    // 出撃札
    const gsel = hub.ghost ? meta.getGhost(hub.ghost) : null;
    const hsel = hub.heir ? meta.getHeir(hub.heir) : null;
    const gen = S.progress.generation + 1;
    const go = (): void => {
      const n = Number.parseInt(seedIn.value, 10);
      const seed = Number.isFinite(n) ? n : Math.floor(Math.random() * 1_000_000);
      hub.seed = Math.floor(Math.random() * 1_000_000);
      const req: SortieRequest = { ghostId: hub.ghost, heirId: hub.heir, weapon, mode: hub.mode, seed, lineage: hub.lineage };
      if (gsel || hsel) {
        this.showConfirm(gsel ? `${gsel.display_name}を連れて出撃する` : "形見を身につけて出撃する",
          "出撃した時点で使用が確定し、ランが終わると（勝っても負けても）消える。途中でアプリを閉じても、次に開いた時に同じランから再開できる。",
          () => this.onSortie(req), re);
      } else {
        this.onSortie(req);
      }
    };
    const tablet = h("aside", { class: "tablet" },
      h("div", { class: "plate" },
        h("div", { class: "vertical" }, `第${kanjiNum(gen)}代`, h("br"), h("small", {}, lin.name)),
        h("dl", {},
          h("dt", {}, "武器"), h("dd", {}, D.weapons[weapon].name),
          h("dt", {}, "同行"), h("dd", { class: gsel ? "soul" : "" }, gsel ? gsel.display_name : "なし"),
          h("dt", {}, "形見"), h("dd", {}, hsel ? hsel.name.replace(/^第\d+代の形見・/, "") : "なし"),
          h("dt", {}, "ラン"), h("dd", {}, hub.mode === "short" ? "3分でボス" : "10分"))),
      h("p", { class: "warn" }, gsel ? h("b", {}, "連れていった亡霊は、このランの後に成仏する。") : "保管庫の亡霊は減らない。"),
      button("出撃", go, "primary"));
    p.append(h("div", { class: "hub" }, choose, tablet));
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

  private hubAltar(p: HTMLElement, re: () => void): void {
    const D = this.D, meta = this.meta, a = meta.S.alloc.altar;
    p.append(
      h("p", {}, "供物を捧げるほど、レベルアップで出るカードのレア度が上がる。捧げた供物はいつでも戻せる。"),
      h("div", { class: "stepper" },
        button("戻す", () => { meta.allocAltar(-1); re(); }, "", a <= 0),
        h("span", { class: "count" }, `${a}`, h("span", { class: "mute small" }, ` / ${D.altar.max}`)),
        button("捧げる", () => { meta.allocAltar(1); re(); }, "primary", a >= D.altar.max || meta.offeringsFree() < 1)),
      h("h3", {}, "いまの排出率"),
      this.rarityBars(a),
    );
  }

  private hubLibrary(p: HTMLElement, re: () => void): void {
    const L = this.D.library, meta = this.meta;
    if (!meta.libraryUnlocked()) {
      p.append(h("div", { class: "empty" }, `累計の生存時間が ${fmt(L.unlock_total_survival)} に達すると開く（いま ${fmt(meta.S.progress.total_survival)}）。`));
      return;
    }
    p.append(h("p", {}, `「縁」を結んだカードは出やすくなる（1つにつき ×${1 + L.affinity_step}、最大${L.affinity_max}）。「封印」したカードは新しく取る候補から外れる（供物${L.seal_cost}、最大${L.seal_max}枚）。どちらもいつでも戻せる。`),
      h("p", { class: "small mute" }, `封印 ${meta.S.alloc.seals.length} / ${L.seal_max}`));
    const list = h("div", { class: "alloc" });
    const cards: [string, string, string][] = [
      ...Object.keys(this.D.weapons).map((id): [string, string, string] => [id, this.D.weapons[id].name, "武器"]),
      ...Object.keys(this.D.passives).map((id): [string, string, string] => [id, this.D.passives[id].name, "パッシブ"]),
    ];
    for (const [id, name, kind] of cards) {
      const af = meta.affinity(id), sealed = meta.sealed(id);
      list.append(h("div", { class: `r${sealed ? " sealed" : ""}` },
        h("div", { class: "nm" }, name, h("small", {}, `${kind}${af > 0 ? `　出やすさ ×${(1 + af * L.affinity_step).toFixed(2)}` : ""}${sealed ? "　封印中" : ""}`)),
        h("span", { class: "pips" }, "●".repeat(af) + "○".repeat(L.affinity_max - af)),
        button("−", () => { meta.allocAffinity(id, -1); re(); }, "", af <= 0),
        button("＋縁", () => { meta.allocAffinity(id, 1); re(); }, "", sealed || af >= L.affinity_max || meta.offeringsFree() < 1),
        button(sealed ? "封印を解く" : "封印", () => { meta.toggleSeal(id); re(); }, "",
          !sealed && (meta.S.alloc.seals.length >= L.seal_max || meta.offeringsFree() < L.seal_cost || af > 0))));
    }
    p.append(list);
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
  showConfirm(title: string, body: string, onYes: () => void, onNo: () => void): void {
    const p = this.open("narrow");
    p.append(h("h2", {}, title), h("p", {}, body), h("div", { class: "row" }, button("出撃する", onYes, "primary"), button("戻る", onNo)));
  }

  showLevel(sim: RunSim, choices: Card[], onPick: (c: Card) => void): void {
    const p = this.open();
    p.append(h("div", { class: "spread" }, h("h2", {}, `レベル ${sim.level - sim.pending + 1}　強化を1つ選ぶ`)));
    const cards = h("div", { class: "cards" });
    choices.forEach((c, i) => {
      const R = sim.rarity(c.rar), d = sim.describe(c);
      const aff = sim.cardMods.affinity?.[c.id] ?? 0;
      const b = h("button", { type: "button", class: `card r-${c.rar}${c.kind === "lineage" ? " house-card" : ""}`, style: `--rc:${R.color}`, onclick: () => onPick(c) },
        this.touchMode ? null : h("span", { class: "key" }, String(i + 1)),
        h("span", { class: "rar" }, R.name + (aff > 0 ? `　縁${"●".repeat(aff)}` : "")),
        h("span", { class: "n" }, d.n),
        h("span", { class: "what" }, d.k),
        h("span", { class: "d" }, d.d));
      cards.append(b);
      this.hotkeys.push(b);
    });
    p.append(cards, h("p", { class: "build" }, sim.buildText()));
    this.guard(this.hotkeys);
  }

  showPause(sim: RunSim, on: { resume: () => void; settings: () => void; retire: () => void }): void {
    const p = this.open("narrow");
    let armed = false;
    const warn = h("p", { class: "danger small", hidden: true });
    p.append(h("h2", {}, "一時停止"), h("p", { class: "build" }, sim.buildText()),
      h("div", { class: "row" },
        button("続ける", on.resume, "primary"),
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
  showResult(sim: RunSim, out: RunRecord | null, onHub: () => void): void {
    const p = this.open();
    const meta = this.meta, S = meta.S;
    const title = { player_death: "倒れた。亡霊が生まれた", boss_cleared: "冥王を倒し、生還した", retired: "リタイアした", "": "" }[sim.result];
    p.append(h("h2", { class: sim.result === "boss_cleared" ? "win" : sim.result === "player_death" ? "lose" : "" }, title));
    const stats = h("div", { class: "stats" });
    for (const [k, v] of [["生存時間", fmt(sim.t)], ["レベル", String(sim.level)], ["撃破", String(sim.kills)], ["最大同時敵数", String(sim.maxAlive)], ["供物", out ? `+${out.offerings}` : "—"]]) {
      stats.append(h("div", {}, h("b", {}, v), h("span", {}, k)));
    }
    p.append(stats, h("p", { class: "build" }, sim.buildText()));
    for (const id of out?.unlocked_lineages ?? []) {
      const l = meta.lineage(id);
      p.append(h("div", { class: "notice" }, h("b", {}, `家系「${l.name}」が解放された`), h("span", { class: "small mute" }, `${l.motto}。次の出撃から選べる。`)));
    }
    if (out?.consumed_ghost) p.append(h("p", { class: "small" }, `${out.consumed_ghost}は成仏した。`));
    if (out?.used_heirloom) p.append(h("p", { class: "small" }, `形見「${out.used_heirloom}」を使い切った。`));
    if (sim.result === "player_death") {
      const nid = out?.new_ghost_id ?? "";
      const ng = S.pending_ghost && S.pending_ghost.ghost_id === nid ? S.pending_ghost : meta.getGhost(nid);
      if (ng) p.append(h("div", { class: "picks" }, this.ghostCard(ng, false, null, "新しく生まれた亡霊")));
    } else if (sim.result === "boss_cleared") {
      p.append(h("p", { class: "small" }, "生還したため亡霊は生まれない。供物にクリアの分が加わった。"));
    } else {
      p.append(h("p", { class: "small" }, "リタイアしたため亡霊も形見も残らない。"));
    }
    const done = (): void => this.showResult(sim, out, onHub);
    if (S.pending_ghost) {
      this.pendingGhostUi(p, done);
      return;
    }
    if (S.pending_heirloom) this.heirChoiceUi(p, done);
    p.append(h("div", { class: "row end" }, button("納骨堂へ", onHub, "primary", S.pending_heirloom !== null)));
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
    for (const x of meta.storedGhosts()) g.append(this.ghostCard(x, false, () => { meta.resolvePendingGhost(x.ghost_id); done(); }, "この亡霊を成仏させる"));
    p.append(g);
  }

  private heirChoiceUi(p: HTMLElement, done: () => void): void {
    const meta = this.meta, pend = meta.S.pending_heirloom!;
    const full = meta.storedHeirs().length >= this.D.shelf.capacity;
    p.append(h("div", { class: "notice" }, h("b", {}, `第${pend.generation}代の形見を1つ残す`),
      h("span", { class: "small mute" }, `次からの世代が1回だけ身につけて出撃できる（元の半分ほどの強さ、最大Lv${this.D.shelf.max_level}）。${full ? "棚がいっぱいなので、一番古い形見を手放す。" : ""}`)));
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
