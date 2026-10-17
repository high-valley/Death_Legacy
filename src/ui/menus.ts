// 戦闘以外の画面: タイトル / 納骨堂（出撃・祭壇・書庫・形見の棚）/ 確認 / レベルアップ / ポーズ / 設定 / リザルト。
// 画面を開くたびに作り直す（状態は MetaService と hub の選択だけが持つ）。
import type { Balance, RunMode } from "../data/types.ts";
import type { MetaService } from "../meta/metaService.ts";
import type { ActiveRun, GhostRecord, RunRecord } from "../meta/records.ts";
import { Platform } from "../platform.ts";
import { Settings } from "../settings.ts";
import { RunSim, type Card } from "../sim/runSim.ts";
import { fmt } from "../view/hud.ts";
import { button, h } from "./dom.ts";

export interface SortieRequest { ghostId: string; heirId: string; weapon: string; mode: RunMode; seed: number }

const RESULT_NAME: Record<string, string> = { player_death: "死亡", boss_cleared: "生還", retired: "リタイア" };

export class Menus {
  readonly root: HTMLElement;
  readonly meta: MetaService;
  readonly D: Balance;
  hub = { tab: "sortie", ghost: "", heir: "", weapon: "sword", mode: "short" as RunMode, seed: 0 };
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

  private ghostCard(g: GhostRecord, pressed: boolean, onPress: (() => void) | null, extra = ""): HTMLElement {
    const D = this.D, tr = this.meta.tier(g.tier_id);
    const wname = g.evolved ? D.evolutions[g.primary_weapon_id].name : D.weapons[g.primary_weapon_id].name;
    const cause = D.enemies[g.death_cause_id]?.name ?? "不明";
    const body = [
      h("span", { class: "t" }, `${tr.name} · 攻撃 ×${tr.mult}`),
      h("span", { class: "n" }, g.display_name),
      h("span", { class: "d" }, `生存 ${fmt(g.survival_seconds)} / ${wname} Lv${g.weapon_level}${g.passive_id ? ` / ${D.passives[g.passive_id].name} Lv${g.passive_level}` : ""}`),
      h("span", { class: "d" }, `撃破 ${g.kills} · 死因 ${cause}`),
      extra ? h("span", { class: "x" }, extra) : null,
    ];
    const style = `--tc:${tr.color}`;
    if (!onPress) return h("div", { class: "ghost", style }, ...body);
    return h("button", { class: "ghost", style, type: "button", "aria-pressed": String(pressed), onclick: onPress }, ...body);
  }

  private simpleCard(eyebrow: string, name: string, desc: string, pressed: boolean, onPress: (() => void) | null, color = "var(--candle)"): HTMLElement {
    const body = [h("span", { class: "t" }, eyebrow), h("span", { class: "n" }, name), h("span", { class: "d" }, desc)];
    const style = `--tc:${color}`;
    if (!onPress) return h("div", { class: "ghost", style }, ...body);
    return h("button", { class: "ghost", style, type: "button", "aria-pressed": String(pressed), onclick: onPress }, ...body);
  }

  // ---------------------------------------------------------------- title
  showTitle(active: ActiveRun | null, on: { hub: () => void; resume: () => void; abandon: () => void; settings: () => void }): void {
    const p = this.open("title");
    const S = this.meta.S;
    const row = h("div", { class: "row" });
    if (active) {
      const g = active.ghost_id ? this.meta.getGhost(active.ghost_id) : null;
      row.append(
        button(`中断したランを再開（${fmt(active.checkpoint?.t ?? 0)}${g ? `・${g.display_name}同行` : "・単独"}）`, on.resume, "primary"),
        button("放棄する（リタイア扱い）", on.abandon, "danger"),
      );
    } else {
      row.append(button(S.progress.runs > 0 ? `納骨堂へ（第${S.progress.generation + 1}代が出撃を待つ）` : "はじめる", on.hub, "primary"));
    }
    row.append(button("設定", on.settings));
    if (Platform.canQuit()) row.append(button("終了", () => Platform.quit()));
    p.append(
      h("div", { class: "eyebrow" }, `Prototype · Web · v${__VERSION__}`),
      h("h1", {}, "DEATH ", h("span", {}, "LEGACY")),
      h("p", {}, "今日の自分が、明日の仲間になる。死んだ主人公は亡霊として残り、次の出撃に一度だけ連れていける。連れていった亡霊は、そのランが終われば成仏する。"),
      row,
      h("p", { class: "note" }, this.touchMode
        ? "画面をドラッグで移動 / 攻撃は自動 / 右下で回避 / 右上でポーズ（横向き推奨）"
        : "WASD・矢印キーで移動 / 攻撃は自動 / Space 回避 / Esc・P ポーズ / 強化は クリック か 1・2・3 / F3 デバッグ"),
    );
    if (this.meta.repo.source === "backup") p.append(h("p", { class: "warn" }, "セーブが壊れていたため、バックアップから復元しました。"));
  }

  // ---------------------------------------------------------------- hub
  showHub(onBack: () => void): void {
    const p = this.open("hub");
    const S = this.meta.S;
    const re = (): void => this.showHub(onBack);
    p.append(h("div", { class: "row spread" },
      h("div", { class: "eyebrow" }, "納骨堂"),
      h("div", { class: "bal" }, `供物 ${this.meta.offeringsFree()} / ${S.offerings.earned}　第${S.progress.generation + 1}代`)));
    const tabs = h("div", { class: "tabs", role: "tablist" });
    for (const [id, name, ok] of [["sortie", "出撃", true], ["altar", "祭壇", true], ["library", "書庫", this.meta.libraryUnlocked()], ["shelf", "形見の棚", this.meta.shelfUnlocked()]] as const) {
      tabs.append(h("button", { type: "button", role: "tab", "aria-selected": String(this.hub.tab === id), onclick: () => { this.hub.tab = id; re(); } },
        name, ok ? null : h("span", { class: "lock" }, "未解放")));
    }
    p.append(tabs);
    if (this.hub.tab === "altar") this.hubAltar(p, re);
    else if (this.hub.tab === "library") this.hubLibrary(p, re);
    else if (this.hub.tab === "shelf") this.hubShelf(p);
    else this.hubSortie(p, re, onBack);
  }

  private hubSortie(p: HTMLElement, re: () => void, onBack: () => void): void {
    const D = this.D, meta = this.meta, hub = this.hub;
    const stored = meta.storedGhosts();
    if (hub.ghost && !stored.some((g) => g.ghost_id === hub.ghost)) hub.ghost = "";
    const left = h("div", { class: "col" });
    const right = h("div", { class: "col" });
    p.append(h("div", { class: "grid2" }, left, right));

    left.append(h("h3", {}, `亡霊保管庫 ${stored.length} / ${D.vault_capacity}`));
    const vault = h("div", { class: "vault" });
    vault.append(this.simpleCard("単独出撃", "誰も連れていかない", `亡霊は温存される。経験値 +${Math.round(D.solo_xp_bonus * 100)}%`, hub.ghost === "", () => { hub.ghost = ""; re(); }));
    for (const g of stored) vault.append(this.ghostCard(g, hub.ghost === g.ghost_id, () => { hub.ghost = g.ghost_id; re(); }));
    left.append(vault);
    if (stored.length === 0) left.append(h("div", { class: "empty" }, "まだ亡霊はいない。死ねば、その生き様が最初の亡霊になる。"));
    if (meta.shelfUnlocked()) {
      const heirs = meta.storedHeirs();
      if (hub.heir && !heirs.some((x) => x.heir_id === hub.heir)) hub.heir = "";
      left.append(h("h3", {}, "形見（1つだけ身につけられる・そのランで使い切り）"));
      const hg = h("div", { class: "vault" });
      hg.append(this.simpleCard("形見", "何も持たない", "形見は棚に残る", hub.heir === "", () => { hub.heir = ""; re(); }));
      for (const x of heirs) hg.append(this.simpleCard(`第${x.from_generation}代より`, x.name, meta.heirEffect(x), hub.heir === x.heir_id, () => { hub.heir = x.heir_id; re(); }));
      left.append(hg);
    }

    right.append(h("h3", {}, "初期武器"));
    const wseg = h("div", { class: "seg" });
    for (const id of Object.keys(D.weapons)) wseg.append(h("button", { type: "button", "aria-pressed": String(hub.weapon === id), onclick: () => { hub.weapon = id; re(); } }, D.weapons[id].name));
    right.append(wseg, h("h3", {}, "ラン"));
    const mseg = h("div", { class: "seg" });
    for (const [id, name] of [["short", "短縮 3分でボス"], ["full", "仕様どおり 10分"]] as const) {
      mseg.append(h("button", { type: "button", "aria-pressed": String(hub.mode === id), onclick: () => { hub.mode = id; re(); } }, name));
    }
    right.append(mseg);
    const seedIn = h("input", { id: "seedIn", inputmode: "numeric", value: String(hub.seed), size: 10 });
    right.append(h("label", { for: "seedIn" }, "Seed", seedIn));
    const gsel = hub.ghost ? meta.getGhost(hub.ghost) : null;
    const hsel = hub.heir ? meta.getHeir(hub.heir) : null;
    right.append(h("div", { class: "warn" },
      gsel ? `${gsel.display_name} を連れていく。このランが終わると（勝っても負けても）成仏し、二度と選べない。` : "単独で出撃する。保管庫の亡霊は1体も減らない。",
      hsel ? h("br") : null, hsel ? `形見「${hsel.name}」を身につける（このランで使い切る）。` : null));
    const go = (): void => {
      const n = Number.parseInt(seedIn.value, 10);
      const seed = Number.isFinite(n) ? n : Math.floor(Math.random() * 1_000_000);
      hub.seed = Math.floor(Math.random() * 1_000_000);
      const req: SortieRequest = { ghostId: hub.ghost, heirId: hub.heir, weapon: hub.weapon, mode: hub.mode, seed };
      if (gsel || hsel) {
        this.showConfirm(`${gsel ? "亡霊を連れて" : "形見を身につけて"}出撃する`,
          "出撃した時点で使用予約され、ランが終わると消費される。途中でアプリを閉じても複製はされず、次に開いた時に同じランから再開できる。",
          () => this.onSortie(req), re);
      } else {
        this.onSortie(req);
      }
    };
    right.append(h("div", { class: "row" }, button("出撃する", go, "primary"), button("タイトル", onBack)));
    right.append(h("h3", {}, "ラン履歴"));
    const hist = h("div", { class: "hist" });
    for (const r of meta.S.run_history.slice(0, 8)) {
      hist.append(h("div", { class: r.result === "boss_cleared" ? "win" : r.result === "player_death" ? "lose" : "" },
        `${r.ended_at.slice(5, 16).replace("T", " ")}　${RESULT_NAME[r.result] ?? ""}　${fmt(r.duration_seconds)}　Lv${r.player_level}　撃破${r.kills}${r.consumed_ghost ? `　同行:${r.consumed_ghost}` : ""}`));
    }
    if (meta.S.run_history.length === 0) hist.append("まだ記録はない");
    right.append(hist);
  }

  private rarityBars(level: number): HTMLElement {
    const ws = RunSim.rarityWeights(this.D, level);
    const tot = ws.reduce((a, b) => a + b, 0);
    const box = h("div", { class: "dist" });
    this.D.rarities.forEach((r, i) => {
      const pct = (ws[i] / tot) * 100;
      box.append(h("div", { class: "r", style: `--rc:${r.color}` },
        h("span", { style: `color:${r.color}` }, `${r.id} ${r.name}`),
        h("div", { class: "bar" }, h("i", { style: `width:${pct.toFixed(2)}%` })),
        h("span", { class: "v" }, `${pct.toFixed(1)}%`)));
    });
    return box;
  }

  private hubAltar(p: HTMLElement, re: () => void): void {
    const D = this.D, meta = this.meta, a = meta.S.alloc.altar;
    p.append(
      h("h2", {}, "祭壇"),
      h("p", {}, "供物を捧げるほど、レベルアップで出るカードのレア度が上がる。捧げた供物はいつでも戻せる。"),
      h("div", { class: "bal" }, `祭壇 ${a} / ${D.altar.max}　残りの供物 ${meta.offeringsFree()}`),
      h("div", { class: "row" },
        button("− 戻す", () => { meta.allocAltar(-1); re(); }, "", a <= 0),
        button("＋ 捧げる（供物1）", () => { meta.allocAltar(1); re(); }, "", a >= D.altar.max || meta.offeringsFree() < 1)),
      h("h3", {}, "いまの排出率"),
      this.rarityBars(a),
    );
  }

  private hubLibrary(p: HTMLElement, re: () => void): void {
    const L = this.D.library, meta = this.meta;
    p.append(h("h2", {}, "書庫"));
    if (!meta.libraryUnlocked()) {
      p.append(h("p", {}, `累計の生存時間が ${fmt(L.unlock_total_survival)} に達すると解放される（いま ${fmt(meta.S.progress.total_survival)}）。`));
      return;
    }
    p.append(
      h("p", {}, `「縁」を結んだカードは出やすくなる（1つにつき ×${1 + L.affinity_step}、最大${L.affinity_max}）。「封印」したカードは新しく取得する候補から外れる（供物${L.seal_cost}、最大${L.seal_max}枚）。いつでも戻せる。`),
      h("div", { class: "bal" }, `残りの供物 ${meta.offeringsFree()}　封印 ${meta.S.alloc.seals.length} / ${L.seal_max}`),
    );
    const list = h("div", { class: "alloc" });
    const cards: [string, string, string][] = [
      ...Object.keys(this.D.weapons).map((id): [string, string, string] => [id, this.D.weapons[id].name, "武器"]),
      ...Object.keys(this.D.passives).map((id): [string, string, string] => [id, this.D.passives[id].name, "パッシブ"]),
    ];
    for (const [id, name, kind] of cards) {
      const af = meta.affinity(id), sealed = meta.sealed(id);
      list.append(h("div", { class: `r${sealed ? " sealed" : ""}` },
        h("div", { class: "nm" }, name, h("small", {}, `${kind}${af > 0 ? ` · 出やすさ ×${(1 + af * L.affinity_step).toFixed(2)}` : ""}${sealed ? " · 封印中" : ""}`)),
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
    p.append(h("h2", {}, "形見の棚"));
    if (!meta.shelfUnlocked()) {
      p.append(h("p", {}, "最初のランを終えると解放される。"));
      return;
    }
    const st = meta.storedHeirs();
    p.append(h("p", {}, `${st.length} / ${this.D.shelf.capacity}　ランを終えるたび（死亡・生還）に、主人公の武器かパッシブを1つ形見として残せる。出撃時に1つだけ身につけられ、そのランで使い切る。棚が満杯の時は一番古い形見が手放される。`));
    const g = h("div", { class: "vault" });
    for (const x of st) g.append(this.simpleCard(`第${x.from_generation}代より`, x.name, meta.heirEffect(x), false, null));
    p.append(g);
    if (st.length === 0) p.append(h("div", { class: "empty" }, "まだ形見はない。"));
  }

  // ---------------------------------------------------------------- confirm / level / pause / settings
  showConfirm(title: string, body: string, onYes: () => void, onNo: () => void): void {
    const p = this.open();
    p.append(h("div", { class: "eyebrow" }, "確認"), h("h2", {}, title), h("p", {}, body),
      h("div", { class: "row" }, button("出撃する", onYes, "primary"), button("戻る", onNo)));
  }

  showLevel(sim: RunSim, choices: Card[], onPick: (c: Card) => void): void {
    const p = this.open("level");
    p.append(h("div", { class: "eyebrow" }, `Level ${sim.level - sim.pending + 1}`), h("h2", {}, "強化を1つ選ぶ"));
    const cards = h("div", { class: "cards" });
    choices.forEach((c, i) => {
      const R = sim.rarity(c.rar), d = sim.describe(c);
      const aff = sim.cardMods.affinity?.[c.id] ?? 0;
      const b = h("button", { type: "button", class: `card r-${c.rar}`, style: `--rc:${R.color}`, onclick: () => onPick(c) },
        h("span", { class: "k" }, h("span", { class: "rar" }, R.id), ` ${R.name}${aff > 0 ? ` · 縁${"●".repeat(aff)}` : ""}`),
        h("span", { class: "k" }, `${this.touchMode ? "" : `[${i + 1}] `}${d.k}`),
        h("span", { class: "n", style: c.rar !== "N" ? `color:${R.color}` : "" }, d.n),
        h("span", { class: "d" }, d.d));
      cards.append(b);
      this.hotkeys.push(b);
    });
    p.append(cards, h("p", { class: "note" }, sim.buildText()));
    // 戦闘中の指がそのまま離れて誤タップしないよう、少しだけ押せない時間を作る
    for (const b of this.hotkeys) b.disabled = true;
    setTimeout(() => { for (const b of this.hotkeys) b.disabled = false; }, 250);
  }

  showPause(sim: RunSim, on: { resume: () => void; settings: () => void; retire: () => void }): void {
    const p = this.open();
    let armed = false;
    const warn = h("div", { class: "warn", hidden: true });
    p.append(h("h2", {}, "ポーズ中"), h("p", {}, sim.buildText()),
      h("div", { class: "row" },
        button("再開", on.resume, "primary"),
        button("設定", on.settings),
        button("リタイア", () => {
          if (!armed) {
            armed = true;
            warn.hidden = false;
            warn.textContent = `リタイアすると亡霊も形見も生まれない${sim.ghost ? "。同行中の亡霊は成仏する" : ""}。もう一度押すとリタイアする。`;
            return;
          }
          on.retire();
        }, "danger")),
      warn);
  }

  showSettings(on: { back: () => void; volume: (v: number) => void; loadTest: () => void; wipe: () => void }, loadText = ""): void {
    const p = this.open();
    let armed = false;
    const vol = h("input", { id: "volIn", type: "range", min: 0, max: 100, step: 5, value: Math.round(Settings.volume * 100) });
    vol.addEventListener("input", () => on.volume(Number(vol.value) / 100));
    const shake = h("input", { id: "shakeIn", type: "checkbox", checked: Settings.shake });
    const dbg = h("input", { id: "dbgIn", type: "checkbox", checked: Settings.debugHud });
    const wl = h("span", { class: "note" });
    p.append(
      h("h2", {}, "設定"),
      h("label", { for: "volIn" }, "音量", vol),
      h("label", { class: "check" }, shake, "被弾時の画面揺れ"),
      h("label", { class: "check" }, dbg, "デバッグ表示（FPS・敵数・更新時間・seed）"),
      h("div", { class: "row" }, button("負荷試験（敵300体・10秒）", on.loadTest), h("span", { class: "note" }, loadText)),
      h("div", { class: "row" }, button("セーブを消去", () => {
        if (!armed) {
          armed = true;
          wl.textContent = "亡霊・形見・供物・履歴がすべて消える。もう一度押すと消去する。";
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
    const p = this.open("result");
    const meta = this.meta, S = meta.S;
    const title = { player_death: "死亡：亡霊が生まれた", boss_cleared: "生還：冥王を倒した", retired: "リタイア", "": "" }[sim.result];
    p.append(h("div", { class: "eyebrow" }, "Run result"), h("h2", { class: sim.result === "boss_cleared" ? "win" : "lose" }, title));
    const stats = h("div", { class: "stats" });
    for (const [k, v] of [["生存時間", fmt(sim.t)], ["到達レベル", String(sim.level)], ["撃破数", String(sim.kills)], ["最大同時敵数", String(sim.maxAlive)], ["seed", String(sim.seed)]]) {
      stats.append(h("div", {}, h("b", {}, v), h("span", {}, k)));
    }
    p.append(stats, h("p", { class: "note" }, `使用武器: ${sim.buildText()}`));
    if (out) {
      p.append(h("div", { class: "bal" }, `供物 +${out.offerings}（合計 ${S.offerings.earned}）　第${out.generation}代の記録が残った。`));
      if (out.used_heirloom) p.append(h("p", {}, `形見「${out.used_heirloom}」を使い切った。`));
      if (out.consumed_ghost) p.append(h("p", {}, `同行した ${out.consumed_ghost} は成仏した。`));
    }
    if (sim.result === "player_death") {
      const nid = out?.new_ghost_id ?? "";
      const ng = S.pending_ghost && S.pending_ghost.ghost_id === nid ? S.pending_ghost : meta.getGhost(nid);
      if (ng) p.append(h("div", { class: "vault" }, this.ghostCard(ng, false, null, "新しく生まれた亡霊")));
    } else if (sim.result === "boss_cleared") {
      p.append(h("p", {}, "生還したため亡霊は生まれない。クリア記録と供物のボーナスが残った。"));
    } else {
      p.append(h("p", {}, "リタイアしたため亡霊も形見も生まれない。"));
    }
    const done = (): void => this.showResult(sim, out, onHub);
    if (S.pending_ghost) {
      this.pendingGhostUi(p, done);
      return;
    }
    if (S.pending_heirloom) this.heirChoiceUi(p, done);
    p.append(h("div", { class: "row" }, button("納骨堂へ", onHub, "primary", S.pending_heirloom !== null)));
  }

  showPending(onDone: () => void): void {
    const S = this.meta.S;
    if (S.pending_ghost) {
      const p = this.open("result");
      p.append(h("h2", { class: "lose" }, "保管庫が満杯"));
      this.pendingGhostUi(p, () => this.showPending(onDone));
    } else if (S.pending_heirloom) {
      const p = this.open("result");
      p.append(h("h2", {}, "形見を残す"));
      this.heirChoiceUi(p, () => this.showPending(onDone));
    } else {
      onDone();
    }
  }

  private pendingGhostUi(p: HTMLElement, done: () => void): void {
    const meta = this.meta, ng = meta.S.pending_ghost!;
    p.append(h("div", { class: "warn" }, `保管庫は${this.D.vault_capacity}体まで。新しい亡霊を残すには、どれか1体を成仏させる。成仏させる亡霊を選ぶ。`));
    const g = h("div", { class: "vault" });
    g.append(this.ghostCard(ng, true, () => { meta.resolvePendingGhost(ng.ghost_id); done(); }, "新しい亡霊をそのまま成仏させる"));
    for (const x of meta.storedGhosts()) g.append(this.ghostCard(x, false, () => { meta.resolvePendingGhost(x.ghost_id); done(); }, "この亡霊を成仏させて入れ替え"));
    p.append(g);
  }

  private heirChoiceUi(p: HTMLElement, done: () => void): void {
    const meta = this.meta, pend = meta.S.pending_heirloom!;
    const full = meta.storedHeirs().length >= this.D.shelf.capacity;
    p.append(h("h3", {}, `第${pend.generation}代の形見を1つ選ぶ`),
      h("p", {}, `選んだものは形見の棚に置かれ、次からの世代が1回だけ身につけて出撃できる（効果は元の半分ほど、最大Lv${this.D.shelf.max_level}）。${full ? "棚が満杯なので、一番古い形見が手放される。" : ""}`));
    const g = h("div", { class: "vault" });
    pend.options.forEach((o, i) => {
      const card = this.simpleCard(o.type === "weapon" ? "武器" : "パッシブ", meta.heirLabel(o), meta.heirEffect(o), false, () => { meta.resolveHeirloom(i); done(); });
      g.append(card);
      if (i < 3 && card instanceof HTMLButtonElement) this.hotkeys.push(card);
    });
    g.append(this.simpleCard("選ばない", "何も残さない", "棚は変わらない", false, () => { meta.resolveHeirloom(-1); done(); }, "var(--edge)"));
    p.append(g);
  }
}
