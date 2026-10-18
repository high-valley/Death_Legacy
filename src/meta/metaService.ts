// ランをまたぐ要素をまとめて扱う。
//   亡霊の保管・入れ替え / 死亡した主人公から亡霊を作る / 供物と祭壇の樹 / 形見 / 亡霊の3択と穢れ・怨霊 /
//   出撃予約 → チェックポイント → ラン終了処理（冪等）
// 亡霊と形見の状態: stored → reserved（出撃中）→ consumed / 使用済み（喰らった亡霊は wraith → 祓うと purified、弔うと released）。異常終了しても reserved のまま残り、同じランを再開できる。
import type { Balance, Lineage, RunMode, Tier, TreeEffect, TreeNode } from "../data/types.ts";
import type { RunOpts } from "../sim/runSim.ts";
import type { ActiveRun, CardMods, GhostMode, GhostRecord, Heirloom, HeirOption, RunRecord, RunResult, SaveData, Snapshot, Summary } from "./records.ts";
import type { SaveRepository } from "./saveRepository.ts";

export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().replace(/-/g, "");
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

const now = (): string => new Date().toISOString().slice(0, 19);

export class MetaService {
  readonly repo: SaveRepository;
  readonly D: Balance;

  constructor(repo: SaveRepository, D: Balance) {
    this.repo = repo;
    this.D = D;
  }

  get S(): SaveData {
    return this.repo.data;
  }

  // ================================================================ ghosts
  storedGhosts(): GhostRecord[] {
    return this.S.ghosts.filter((g) => g.status === "stored");
  }

  getGhost(id: string): GhostRecord | null {
    return this.S.ghosts.find((g) => g.ghost_id === id) ?? null;
  }

  tierFor(sec: number, runLen: number): Tier {
    const f = sec / runLen;
    let out = this.D.tiers[0];
    for (const x of this.D.tiers) if (f >= x.from - 1e-6) out = x;
    return out;
  }

  tier(id: string): Tier {
    return this.D.tiers.find((x) => x.id === id) ?? this.D.tiers[0];
  }

  /** 生存時間 → 等級、最も育った武器と代表パッシブを継承 */
  createGhost(sm: Summary): GhostRecord {
    const tr = this.tierFor(sm.t, sm.run_len);
    let wid = sm.main_weapon, wlv = -1;
    for (const id in sm.weapons) {
      const lv = sm.weapons[id];
      if (lv > wlv || (lv === wlv && id === sm.main_weapon)) {
        wid = id;
        wlv = lv;
      }
    }
    let pid = "", pbest = -1;
    for (const id in sm.ppow) {
      if (sm.ppow[id] > pbest) {
        pbest = sm.ppow[id];
        pid = id;
      }
    }
    this.S.ghost_seq += 1;
    const pp = sm.ppow;
    const lin = this.lineage(sm.lineage_id);
    const house = lin.id === this.D.lineages[0].id ? "" : `${lin.name}・`;
    return {
      ghost_id: uuid(), origin_run_id: sm.run_id, created_at: now(),
      display_name: `第${this.S.ghost_seq}代・${house}${this.D.weapons[wid].name}の${tr.name}`,
      survival_seconds: Math.floor(sm.t), run_length: Math.floor(sm.run_len), tier_id: tr.id,
      primary_weapon_id: wid, weapon_level: wlv, evolved: !!sm.evolved[wid],
      passive_id: pid, passive_level: pid ? sm.passives[pid] ?? 0 : 0,
      kills: sm.kills, boss_kills: sm.boss_kills, death_cause_id: sm.death_cause || "unknown",
      stat_snapshot: {
        attack_mult: tr.mult * (1 + 0.12 * (pp.might ?? 0)) * (1 + (sm.wbonus[wid] ?? 0)),
        attack_speed: 1 + 0.1 * (pp.haste ?? 0),
        area: 1 + 0.12 * (pp.area ?? 0),
      },
      data_version: this.D.data_version, lineage_id: lin.id, status: "stored",
    };
  }

  /** 保管庫が満杯の時の入れ替え。releaseId が新しい亡霊なら、新しい方を成仏させる */
  resolvePendingGhost(releaseId: string): boolean {
    const ng = this.S.pending_ghost;
    if (!ng) return false;
    if (releaseId === ng.ghost_id) {
      ng.status = "released";
    } else {
      const g = this.getGhost(releaseId);
      if (!g || g.status !== "stored") return false;
      g.status = "released";
      ng.status = "stored";
    }
    this.S.ghosts.push(ng);
    this.S.pending_ghost = null;
    this.repo.write();
    return true;
  }

  // ================================================================ heirlooms
  storedHeirs(): Heirloom[] {
    return this.S.heirlooms.filter((h) => h.status === "stored");
  }

  getHeir(id: string): Heirloom | null {
    return this.S.heirlooms.find((h) => h.heir_id === id) ?? null;
  }

  private itemName(o: HeirOption): string {
    return o.type === "weapon" ? this.D.weapons[o.id].name : this.D.passives[o.id].name;
  }

  heirLabel(o: HeirOption): string {
    return `${this.itemName(o)} Lv${o.level}`;
  }

  heirEffect(o: HeirOption): string {
    return `出撃時から${this.itemName(o)}をLv${o.level}で持つ`;
  }

  /** index = 選んだ候補、-1 = 残さない */
  resolveHeirloom(index: number): void {
    const p = this.S.pending_heirloom;
    if (!p) return;
    if (index >= 0 && index < p.options.length) {
      const o = p.options[index];
      this.S.heir_seq += 1;
      this.S.heirlooms.push({
        heir_id: uuid(), name: `第${p.generation}代の形見・${this.heirLabel(o)}`, type: o.type, id: o.id,
        level: o.level, from_generation: p.generation, status: "stored",
      });
      const st = this.storedHeirs();
      if (st.length > this.D.shelf.capacity) {
        const old = st[0];
        this.S.heirlooms = this.S.heirlooms.filter((h) => h.heir_id !== old.heir_id);
      }
    }
    this.S.pending_heirloom = null;
    this.repo.write();
  }

  // ================================================================ offerings / 祭壇の樹
  /** 開いた節に払った供物の合計 */
  offeringsUsed(): number {
    let n = 0;
    for (const nd of this.D.tree) if (this.S.tree.includes(nd.id)) n += nd.cost;
    return n;
  }

  offeringsFree(): number {
    return this.S.offerings.earned - this.offeringsUsed();
  }

  treeNode(id: string): TreeNode | null {
    return this.D.tree.find((n) => n.id === id) ?? null;
  }

  /** 根（tree[0]）は最初から開いている */
  nodeOpen(id: string): boolean {
    return this.D.tree[0]?.id === id || this.S.tree.includes(id);
  }

  /** 開けない理由（開ける時は ""） */
  nodeBlock(id: string): string {
    const n = this.treeNode(id);
    if (!n) return "存在しない節";
    if (this.nodeOpen(id)) return "開いている";
    if (!n.parents.every((p) => this.nodeOpen(p))) return "手前の節を先に開く";
    if (n.req_survival && this.S.progress.total_survival < n.req_survival) return `累計の生存時間 ${Math.floor(n.req_survival / 60)}分で開ける`;
    if (this.offeringsFree() < n.cost) return "供物が足りない";
    return "";
  }

  openNode(id: string): boolean {
    if (this.nodeBlock(id) !== "") return false;
    this.S.tree.push(id);
    this.repo.write();
    return true;
  }

  /** 樹をほどく: 開いた節と縁・封印をすべて外し、供物を全額戻す */
  resetTree(): void {
    this.S.tree = [];
    this.S.alloc = { affinity: {}, seals: [] };
    this.repo.write();
  }

  /** 開いた節の効果の合計 */
  treeTotal(key: keyof TreeEffect): number {
    let v = 0;
    for (const n of this.D.tree) if (this.nodeOpen(n.id)) v += n.effect[key] ?? 0;
    return v;
  }

  affinityPoints(): number { return this.treeTotal("affinity_pts"); }
  sealSlots(): number { return this.treeTotal("seal_slots"); }

  affinityUsed(): number {
    let n = 0;
    for (const k in this.S.alloc.affinity) n += this.S.alloc.affinity[k];
    return n;
  }

  shelfUnlocked(): boolean {
    return this.S.progress.generation >= this.D.shelf.unlock_generation;
  }

  affinity(id: string): number {
    return this.S.alloc.affinity[id] ?? 0;
  }

  sealed(id: string): boolean {
    return this.S.alloc.seals.includes(id);
  }

  cardMods(): CardMods {
    const a = this.S.alloc;
    return {
      altar: Math.min(this.D.altar.max, this.treeTotal("altar")), affinity: { ...a.affinity }, seals: [...a.seals],
      ghost_atk: this.treeTotal("ghost_atk"), devour_bonus: this.treeTotal("devour_bonus"), taint_resist: Math.min(1, this.treeTotal("taint_resist")),
    };
  }

  /** 縁の付け外し（樹で開いた数の中で。供物はかからない） */
  allocAffinity(id: string, delta: number): boolean {
    const a = this.S.alloc;
    const nv = this.affinity(id) + delta;
    if (nv < 0 || nv > this.D.library.affinity_max) return false;
    if (delta > 0 && (this.sealed(id) || this.affinityUsed() + delta > this.affinityPoints())) return false;
    if (nv === 0) delete a.affinity[id];
    else a.affinity[id] = nv;
    this.repo.write();
    return true;
  }

  toggleSeal(id: string): boolean {
    const a = this.S.alloc;
    if (this.sealed(id)) {
      a.seals = a.seals.filter((s) => s !== id);
    } else {
      if (a.seals.length >= this.sealSlots() || this.affinity(id) > 0) return false;
      a.seals.push(id);
    }
    this.repo.write();
    return true;
  }

  // ================================================================ 亡霊の3択（連れていく / 喰らう / 弔う）と穢れ
  /** 怨霊（喰らわれた亡霊）。古い順 */
  wraiths(): GhostRecord[] {
    return this.S.ghosts.filter((g) => g.status === "wraith");
  }

  /** 穢れ = まだ祓っていない怨霊の数 */
  taint(): number {
    return this.wraiths().length;
  }

  /** 穢れで敵のHPが増える割合（清めの塩で軽くなる） */
  taintHpBonus(): number {
    return this.taint() * this.D.rites.wraith.enemy_hp_per_taint * (1 - Math.min(1, this.treeTotal("taint_resist")));
  }

  /** 喰らった時の力（与ダメージ・最大HPの増分） */
  devourPower(g: GhostRecord): { might: number; hp: number } {
    const R = this.D.rites.devour, m = this.tier(g.tier_id).mult * (1 + this.treeTotal("devour_bonus"));
    return { might: R.might_per_mult * m, hp: R.hp_per_mult * m };
  }

  mournOfferings(g: GhostRecord): number {
    const R = this.D.rites.mourn;
    return Math.round((R.base + R.per_mult * this.tier(g.tier_id).mult) * (1 + this.treeTotal("mourn_bonus")));
  }

  /** 弔う: その場で成仏させ、供物を得る。戻せない */
  mourn(ghostId: string): number {
    const g = this.getGhost(ghostId);
    if (!g || g.status !== "stored") return 0;
    const n = this.mournOfferings(g);
    g.status = "released";
    g.consumed_at = now();
    this.S.offerings.earned += n;
    this.S.offerings.mourned += n;
    this.repo.write();
    return n;
  }

  /** 出撃中のランを作るための材料（出撃・再開・テストで共通） */
  runOpts(ar: ActiveRun): RunOpts {
    const g = ar.ghost_id ? this.getGhost(ar.ghost_id) : null;
    const devour = ar.ghost_mode === "devour";
    return {
      run_id: ar.run_id, seed: ar.seed, mode: ar.mode, weapon: ar.weapon, lineage: ar.lineage_id,
      ghost: devour ? null : g, devour: devour && g ? { rec: g, ...this.devourPower(g) } : null,
      wraith: ar.wraith_id ? this.getGhost(ar.wraith_id) : null, taint_hp: this.taintHpBonus(),
      heirloom: ar.heirloom_id ? this.getHeir(ar.heirloom_id) : null, card_mods: this.cardMods(), checkpoint: ar.checkpoint,
    };
  }

  // ================================================================ lineages
  lineage(id: string): Lineage {
    return this.D.lineages.find((l) => l.id === id) ?? this.D.lineages[0];
  }

  lineageUnlocked(id: string): boolean {
    return this.D.lineages[0].id === id || this.S.lineages.includes(id);
  }

  /** 解放条件の進み具合（解放済み・条件なしは null） */
  unlockProgress(l: Lineage): { cur: number; need: number } | null {
    const u = l.unlock;
    if (!u) return null;
    const p = this.S.progress;
    if (u.type === "weapon_level") return { cur: Math.min(u.level, p.best_weapon_level[u.weapon] ?? 0), need: u.level };
    return { cur: Math.min(u.count, p.companion_runs), need: u.count };
  }

  /** 条件を満たした家系を解放し、新しく解放した id を返す */
  private checkUnlocks(): string[] {
    const out: string[] = [];
    for (const l of this.D.lineages) {
      if (this.lineageUnlocked(l.id)) continue;
      const pr = this.unlockProgress(l);
      if (pr && pr.cur >= pr.need) {
        this.S.lineages.push(l.id);
        out.push(l.id);
      }
    }
    return out;
  }

  // ================================================================ sortie / settlement
  /** 出撃確定の瞬間に保存。亡霊・形見は reserved になり、異常終了しても複製されない */
  reserve(runId: string, seed: number, mode: RunMode, weapon: string, ghostId: string, heirId: string, lineageId = "nameless", ghostMode: GhostMode = "bring"): boolean {
    if (this.S.active_run) return false;
    if (!this.lineageUnlocked(lineageId)) return false; // 未解放の家系では出撃できない
    const lin = this.lineage(lineageId);
    if (lin.weapon) weapon = lin.weapon;
    let g: GhostRecord | null = null, h: Heirloom | null = null;
    if (ghostId) {
      g = this.getGhost(ghostId);
      if (!g || g.status !== "stored") return false; // 使用済み・重複選択を拒否
    }
    if (heirId) {
      h = this.getHeir(heirId);
      if (!h || h.status !== "stored") return false;
    }
    if (g) { g.status = "reserved"; g.reserved_by_run = runId; }
    if (h) { h.status = "reserved"; h.reserved_by_run = runId; }
    // 怨霊は一番古いものから1体ずつ現れる（再開しても同じ怨霊になるよう出撃時に決める）
    const wraith = this.wraiths()[0];
    this.S.active_run = {
      run_id: runId, seed, mode, weapon, ghost_id: ghostId, heirloom_id: heirId, lineage_id: lin.id, started_at: now(), checkpoint: null,
      ghost_mode: g ? ghostMode : "bring", wraith_id: wraith ? wraith.ghost_id : "",
    };
    this.repo.write();
    return true;
  }

  checkpoint(runId: string, snap: Snapshot): void {
    const ar = this.S.active_run;
    if (!ar || ar.run_id !== runId) return;
    ar.checkpoint = snap;
    this.repo.write();
  }

  /** 同じ run_id で何度呼んでも1回分しか処理しない */
  settle(sm: Summary, res: Exclude<RunResult, "">): RunRecord | null {
    const s = this.S, D = this.D;
    if (s.settled_runs.includes(sm.run_id)) return s.run_history.find((h) => h.run_id === sm.run_id) ?? null;
    const ended = now();
    const out: RunRecord = {
      run_id: sm.run_id, seed: sm.seed, mode: sm.mode, duration_seconds: Math.floor(sm.t), result: res,
      selected_ghost_id: sm.ghost_id, player_build: { weapons: sm.weapons, passives: sm.passives }, player_level: sm.level,
      kills: sm.kills, boss_kills: sm.boss_kills, ended_at: ended, consumed_ghost: "", new_ghost_id: "", new_ghost_pending: false,
      used_heirloom: "", offerings: 0, generation: 0, lineage_id: sm.lineage_id, unlocked_lineages: [],
      ghost_mode: sm.ghost_mode ?? "bring",
    };
    const devour = sm.ghost_mode === "devour";
    // ① 同行亡霊は結果にかかわらず消費。喰らった亡霊は怨霊になる（穢れ +1）
    if (sm.ghost_id) {
      const g = this.getGhost(sm.ghost_id);
      if (g && g.status === "reserved" && g.reserved_by_run === sm.run_id) {
        g.consumed_by_run = sm.run_id;
        g.consumed_at = ended;
        if (devour) {
          g.status = "wraith";
          g.wraith_since = ended;
          out.devoured = g.display_name;
        } else {
          g.status = "consumed";
          out.consumed_ghost = g.display_name;
        }
      }
    }
    // 怨霊を倒していれば祓う（穢れ −1・供物）。倒せなければ残る
    let purifyOffer = 0;
    if (sm.wraith_id) {
      const w = this.getGhost(sm.wraith_id);
      if (w && w.status === "wraith") {
        if (sm.wraith_purified) {
          w.status = "purified";
          out.purified = w.display_name;
          purifyOffer = D.rites.wraith.purify_offerings;
        } else {
          out.wraith_escaped = w.display_name;
        }
      }
    }
    // ② 死亡時だけ新しい亡霊。満杯なら pending にして入れ替えを選ばせる（捨てない）
    if (res === "player_death") {
      const ng = this.createGhost(sm);
      if (this.storedGhosts().length < D.vault_capacity) {
        s.ghosts.push(ng);
      } else {
        ng.status = "pending";
        s.pending_ghost = ng;
        out.new_ghost_pending = true;
      }
      out.new_ghost_id = ng.ghost_id;
      out.new_ghost = ng.display_name;
      s.progress.deaths += 1;
    }
    if (res === "boss_cleared") s.progress.clears += 1;
    s.progress.runs += 1;
    // 家系の解放条件の記録 → 解放判定
    if (sm.ghost_id && !devour) s.progress.companion_runs += 1;
    for (const id in sm.weapons) s.progress.best_weapon_level[id] = Math.max(s.progress.best_weapon_level[id] ?? 0, sm.weapons[id]);
    out.unlocked_lineages = this.checkUnlocks();
    // ③ 世代交代: 供物・形見の候補・世代数
    const of = D.offerings;
    const frac = Math.min(1, sm.t / sm.run_len);
    let offer = Math.floor(frac * 10) * of.per_tenth_survived + Math.floor(sm.kills / 100) * of.per_100_kills + (res === "boss_cleared" ? of.clear_bonus : 0);
    if (res === "retired") offer = Math.floor(offer * of.retire_rate);
    offer += purifyOffer;
    s.offerings.earned += offer;
    out.offerings = offer;
    s.progress.generation += 1;
    s.progress.total_survival += Math.floor(sm.t);
    out.generation = s.progress.generation;
    if (sm.heirloom_id) {
      const h = this.getHeir(sm.heirloom_id);
      if (h && h.status === "reserved" && h.reserved_by_run === sm.run_id) {
        out.used_heirloom = h.name;
        s.heirlooms = s.heirlooms.filter((x) => x.heir_id !== h.heir_id);
      }
    }
    if (res !== "retired") {
      const cap = D.shelf.max_level;
      const options: HeirOption[] = [
        ...Object.keys(sm.weapons).map((id): HeirOption => ({ type: "weapon", id, level: Math.min(cap, Math.ceil(sm.weapons[id] / 2)) })),
        ...Object.keys(sm.passives).map((id): HeirOption => ({ type: "passive", id, level: Math.min(cap, Math.ceil(sm.passives[id] / 2)) })),
      ];
      s.pending_heirloom = { run_id: sm.run_id, generation: s.progress.generation, options };
    }
    // ④ 履歴・処理済み記録・出撃中フラグの解除を同じ書き込みで確定
    s.run_history.unshift(out);
    s.run_history = s.run_history.slice(0, 30);
    s.settled_runs.push(sm.run_id);
    s.settled_runs = s.settled_runs.slice(-100);
    s.active_run = null;
    const gone = s.ghosts.filter((g) => g.status === "consumed" || g.status === "released" || g.status === "purified");
    if (gone.length > 30) {
      const drop = new Set(gone.slice(0, gone.length - 30).map((g) => g.ghost_id));
      s.ghosts = s.ghosts.filter((g) => !drop.has(g.ghost_id));
    }
    this.repo.write();
    return out;
  }

  /** 中断したランを再開せずに放棄する（リタイア扱い: 同行亡霊・形見は消費、亡霊は生まれない） */
  abandonActive(): RunRecord | null {
    const ar = this.S.active_run;
    if (!ar) return null;
    const cp = ar.checkpoint;
    const sm: Summary = {
      run_id: ar.run_id, seed: ar.seed, mode: ar.mode, t: cp?.t ?? 0, run_len: this.D.run_length[ar.mode],
      main_weapon: ar.weapon, weapons: cp?.weapons ?? { [ar.weapon]: 1 }, passives: cp?.passives ?? {}, ppow: cp?.ppow ?? {},
      wbonus: cp?.wbonus ?? {}, evolved: cp?.evolved ?? {}, level: cp?.level ?? 1, kills: cp?.kills ?? 0,
      boss_kills: 0, death_cause: "", ghost_id: ar.ghost_id, heirloom_id: ar.heirloom_id ?? "", lineage_id: ar.lineage_id ?? "nameless",
      ghost_mode: ar.ghost_mode ?? "bring", wraith_id: ar.wraith_id ?? "", wraith_purified: cp?.wraith_dead ?? false,
    };
    return this.settle(sm, "retired");
  }
}
