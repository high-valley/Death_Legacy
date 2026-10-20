// ランをまたぐ要素をまとめて扱う。
//   亡霊の保管・入れ替え / 死亡した主人公から亡霊を作る / 供物と祭壇の樹 / 形見 / 亡霊の3択と穢れ・怨霊 /
//   出撃予約 → チェックポイント → ラン終了処理（冪等）
// 亡霊と形見の状態: stored → reserved（出撃中）→ consumed / 使用済み（喰らった亡霊は wraith → 祓うと purified、弔うと released）。異常終了しても reserved のまま残り、同じランを再開できる。
import type { Balance, Facility, FacilityStep, Lineage, RunMode, Tier, TreeEffect, TreeNode } from "../data/types.ts";
import { gradeAt } from "../data/weapons.ts";
import type { RunOpts } from "../sim/runSim.ts";
import type { ActiveRun, CardMods, FacilityBuff, GhostMode, GhostPick, GhostRecord, Heirloom, HeirOption, RunRecord, RunResult, SaveData, Snapshot, Summary } from "./records.ts";
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

  /** 出撃に選べる亡霊（施設に住んでいる亡霊は除く） */
  availableGhosts(): GhostRecord[] {
    return this.storedGhosts().filter((g) => !g.stationed_at);
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

  /** 亡霊になれるか（生存時間の最低ラインと未練の欠片）。なれない時は理由 */
  birthCheck(sm: Summary): "" | "time" | "fragments" {
    const B = this.D.ghost_birth;
    if (sm.t < sm.run_len * B.min_survival) return "time";
    if (sm.fragments < B.fragments) return "fragments";
    return "";
  }

  /** 生存時間 → 等級（余った欠片1つにつき1段上がる）、最も育った武器と代表パッシブを継承 */
  createGhost(sm: Summary): GhostRecord {
    const base = this.tierFor(sm.t, sm.run_len);
    const extra = Math.max(0, (sm.fragments ?? 0) - this.D.ghost_birth.fragments);
    const tr = this.D.tiers[Math.min(this.D.tiers.length - 1, this.D.tiers.indexOf(base) + extra)];
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
      display_name: `第${this.S.ghost_seq}代・${house}${gradeAt(this.D.weapons[wid], sm.rank?.[wid] ?? 0, !!sm.evolved[wid], sm.branch?.[wid]).name}の${tr.name}`,
      survival_seconds: Math.floor(sm.t), run_length: Math.floor(sm.run_len), tier_id: tr.id,
      primary_weapon_id: wid, weapon_level: wlv, weapon_rank: sm.rank?.[wid] ?? 0, evolved: !!sm.evolved[wid], weapon_branch: sm.branch?.[wid],
      passive_id: pid, passive_level: pid ? sm.passives[pid] ?? 0 : 0,
      kills: sm.kills, boss_kills: sm.boss_kills, death_cause_id: sm.death_cause || "unknown",
      stat_snapshot: {
        attack_mult: tr.mult * (1 + (this.D.passives.might.per / 100) * (pp.might ?? 0)) * (1 + (sm.wbonus[wid] ?? 0)),
        attack_speed: 1 + (this.D.passives.haste.per / 100) * (pp.haste ?? 0),
        area: 1 + (this.D.passives.area.per / 100) * (pp.area ?? 0),
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
      g.stationed_at = undefined;
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
    return o.type === "weapon" ? `出撃時から武器を Lv${o.level} で持つ（ダメージだけ。どの主人公でも）` : `出撃時から${this.itemName(o)}をLv${o.level}で持つ`;
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

  /** 建てた施設に払った供物（戻らない） */
  buildingsCost(): number {
    let n = 0;
    for (const f of this.D.facilities) if (this.S.buildings.includes(f.id)) n += f.cost;
    return n;
  }

  offeringsFree(): number {
    return this.S.offerings.earned - this.offeringsUsed() - this.buildingsCost();
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
      sigil_tier: this.treeTotal("sigil_tier"), curses: this.treeTotal("curses") > 0,
    };
  }

  /** 連れていける亡霊の数（祭壇の樹「双魂の契り」で増える） */
  ghostSlots(): number {
    const G = this.D.ghost_slots;
    return Math.min(G.max, G.base + this.treeTotal("ghost_slots"));
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
    g.stationed_at = undefined;
    this.S.progress.mourned_count += 1;
    this.S.offerings.earned += n;
    this.S.offerings.mourned += n;
    this.repo.write();
    return n;
  }

  /** 出撃中のランを作るための材料（出撃・再開・テストで共通） */
  runOpts(ar: ActiveRun): RunOpts {
    const picks = (ar.ghosts ?? []).map((p) => ({ p, g: this.getGhost(p.id) })).filter((x): x is { p: GhostPick; g: GhostRecord } => !!x.g);
    return {
      run_id: ar.run_id, seed: ar.seed, mode: ar.mode, weapon: ar.weapon, lineage: ar.lineage_id,
      ghosts: picks.filter((x) => x.p.mode === "bring").map((x) => x.g),
      devours: picks.filter((x) => x.p.mode === "devour").map((x) => ({ rec: x.g, ...this.devourPower(x.g) })),
      wraith: ar.wraith_id ? this.getGhost(ar.wraith_id) : null, taint_hp: this.taintHpBonus(),
      heirloom: ar.heirloom_id ? this.getHeir(ar.heirloom_id) : null, card_mods: this.cardMods(), checkpoint: ar.checkpoint,
      facility: ar.facility,
    };
  }

  // ================================================================ 拠点の施設（堂守の亡霊、ADR 023）
  facility(id: string): Facility | null {
    return this.D.facilities.find((f) => f.id === id) ?? null;
  }

  built(id: string): boolean {
    return this.S.buildings.includes(id);
  }

  /** 建てる条件の進み具合 */
  facilityProgress(f: Facility): { cur: number; need: number } {
    const u = f.unlock, need = u.count;
    const cur = u.type === "ghosts_born" ? this.S.ghost_seq : u.type === "vault" ? this.storedGhosts().length : this.S.progress.mourned_count;
    return { cur: Math.min(cur, need), need };
  }

  /** 建てられない理由（建てられる時は ""） */
  buildBlock(id: string): string {
    const f = this.facility(id);
    if (!f) return "存在しない施設";
    if (this.built(id)) return "建てた";
    const pr = this.facilityProgress(f);
    if (pr.cur < pr.need) {
      const what = f.unlock.type === "ghosts_born" ? "亡霊が生まれる" : f.unlock.type === "vault" ? "保管庫に亡霊がそろう" : "亡霊を弔う";
      return `${what}（${pr.cur}/${pr.need}）`;
    }
    if (this.offeringsFree() < f.cost) return "供物が足りない";
    return "";
  }

  /** 建てる（供物を払う。戻せない） */
  build(id: string): boolean {
    if (this.S.active_run || this.buildBlock(id) !== "") return false;
    this.S.buildings.push(id);
    this.repo.write();
    return true;
  }

  /** 施設に住んでいる亡霊 */
  residents(fid: string): GhostRecord[] {
    return this.S.ghosts.filter((g) => g.status === "stored" && g.stationed_at === fid);
  }

  /** 住まわせる（別の施設からの引っ越しも可）。満員・未建設・出撃中は不可 */
  station(ghostId: string, fid: string): boolean {
    const f = this.facility(fid), g = this.getGhost(ghostId);
    if (!f || !g || this.S.active_run || !this.built(fid) || f.slots <= 0 || g.status !== "stored") return false;
    if (g.stationed_at === fid) return true;
    if (this.residents(fid).length >= f.slots) return false;
    g.stationed_at = fid;
    this.repo.write();
    return true;
  }

  /** 施設から外す（保管庫へ戻る） */
  unstation(ghostId: string): boolean {
    const g = this.getGhost(ghostId);
    if (!g || !g.stationed_at || this.S.active_run) return false;
    g.stationed_at = undefined;
    this.repo.write();
    return true;
  }

  /** 供養塔に刻まれた力（建てていれば、弔った回数 every 回ごとに1つ） */
  memorialSteps(): FacilityStep[] {
    const f = this.D.facilities.find((x) => x.effect.steps);
    if (!f || !this.built(f.id)) return [];
    const st = f.effect.steps ?? [], every = f.effect.every ?? 1;
    return st.slice(0, Math.min(st.length, Math.floor(this.S.progress.mourned_count / every)));
  }

  /** いまの施設の効果（出撃時に active_run へ写す） */
  facilityBuff(): FacilityBuff {
    const out: FacilityBuff = { tags: [], ghost_atk: 0, hp: 0, offer: 0 };
    for (const f of this.D.facilities) {
      if (!this.built(f.id)) continue;
      for (const g of this.residents(f.id)) {
        if (f.effect.offer_per_mult) out.offer += this.tier(g.tier_id).mult * f.effect.offer_per_mult;
        if (f.effect.tag_points) {
          for (const t of this.D.weapons[g.primary_weapon_id]?.tags ?? []) for (let i = 0; i < f.effect.tag_points; i++) out.tags.push(t);
        }
      }
    }
    for (const st of this.memorialSteps()) { out.ghost_atk += st.ghost_atk ?? 0; out.hp += st.hp ?? 0; }
    return out;
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
  /** ghosts は亡霊1体の id（文字列）か、選んだ亡霊の一覧（最大 ghostSlots 体） */
  reserve(runId: string, seed: number, mode: RunMode, weapon: string, ghosts: string | GhostPick[], heirId: string, lineageId = "nameless", ghostMode: GhostMode = "bring"): boolean {
    if (this.S.active_run) return false;
    if (!this.lineageUnlocked(lineageId)) return false; // 未解放の家系では出撃できない
    const lin = this.lineage(lineageId);
    if (lin.weapon) weapon = lin.weapon;
    const picks: GhostPick[] = typeof ghosts === "string" ? (ghosts ? [{ id: ghosts, mode: ghostMode }] : []) : ghosts;
    if (picks.length > this.ghostSlots()) return false;
    if (new Set(picks.map((p) => p.id)).size !== picks.length) return false;
    const gs: GhostRecord[] = [];
    for (const p of picks) {
      const g = this.getGhost(p.id);
      if (!g || g.status !== "stored" || g.stationed_at) return false; // 出撃中・怨霊・成仏済み・施設に住んでいる亡霊は選べない
      gs.push(g);
    }
    let h: Heirloom | null = null;
    if (heirId) {
      h = this.getHeir(heirId);
      if (!h || h.status !== "stored") return false;
    }
    for (const g of gs) { g.status = "reserved"; g.reserved_by_run = runId; }
    if (h) { h.status = "reserved"; h.reserved_by_run = runId; }
    // 怨霊は一番古いものから1体ずつ現れる（再開しても同じ怨霊になるよう出撃時に決める）
    const wraith = this.wraiths()[0];
    this.S.active_run = {
      run_id: runId, seed, mode, weapon, heirloom_id: heirId, lineage_id: lin.id, started_at: now(), checkpoint: null,
      ghosts: picks, wraith_id: wraith ? wraith.ghost_id : "", facility: this.facilityBuff(),
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
      selected_ghost_id: sm.ghosts[0]?.id ?? "", player_build: { weapons: sm.weapons, passives: sm.passives }, player_level: sm.level,
      kills: sm.kills, boss_kills: sm.boss_kills, ended_at: ended, consumed_ghost: "", new_ghost_id: "", new_ghost_pending: false,
      used_heirloom: "", offerings: 0, generation: 0, lineage_id: sm.lineage_id, unlocked_lineages: [],
      ghost_mode: sm.ghosts.some((p) => p.mode === "devour") ? "devour" : "bring",
      companions: [], devoured_all: [], ghost_failed: "", fragments: sm.fragments,
    };
    // ① 連れていった亡霊は保管庫へ戻る（減らない）。喰らった亡霊だけが怨霊になる（穢れ +1）
    for (const p of sm.ghosts) {
      const g = this.getGhost(p.id);
      if (!g || g.status !== "reserved" || g.reserved_by_run !== sm.run_id) continue;
      g.reserved_by_run = undefined;
      if (p.mode === "devour") {
        g.status = "wraith";
        g.consumed_by_run = sm.run_id;
        g.consumed_at = ended;
        g.wraith_since = ended;
        out.devoured_all!.push(g.display_name);
        out.devoured = out.devoured || g.display_name;
      } else {
        g.status = "stored";
        out.companions!.push(g.display_name);
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
    // ② 死亡時、生存時間と未練の欠片が足りていれば新しい亡霊。満杯なら pending にして入れ替えを選ばせる（捨てない）
    const fail = res === "player_death" ? this.birthCheck(sm) : "";
    out.ghost_failed = fail;
    if (res === "player_death") s.progress.deaths += 1;
    if (res === "player_death" && fail === "") {
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
    }
    if (res === "boss_cleared") s.progress.clears += 1;
    s.progress.runs += 1;
    // 家系の解放条件の記録 → 解放判定
    if (sm.ghosts.some((p) => p.mode === "bring")) s.progress.companion_runs += 1;
    for (const id in sm.weapons) s.progress.best_weapon_level[id] = Math.max(s.progress.best_weapon_level[id] ?? 0, sm.weapons[id]);
    out.unlocked_lineages = this.checkUnlocks();
    // ③ 世代交代: 供物・形見の候補・世代数
    const of = D.offerings;
    const frac = Math.min(1, sm.t / sm.run_len);
    let offer = Math.floor(frac * 10) * of.per_tenth_survived + Math.floor(sm.kills / 100) * of.per_100_kills + (res === "boss_cleared" ? of.clear_bonus : 0);
    if (res === "retired") offer = Math.floor(offer * of.retire_rate);
    // 鎮魂堂: 住む亡霊の等級 × 生き延びた割合（リタイアでは増えない＝すぐ辞めて稼ぐことはできない）
    const ar = s.active_run && s.active_run.run_id === sm.run_id ? s.active_run : null;
    const fOffer = res === "retired" ? 0 : Math.round((ar?.facility?.offer ?? 0) * frac);
    out.facility_offer = fOffer;
    offer += purifyOffer + fOffer;
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
      const cap = D.shelf.max_level, wcap = D.shelf.weapon_max_level;
      const options: HeirOption[] = [
        ...Object.keys(sm.weapons).map((id): HeirOption => ({ type: "weapon", id, level: Math.min(wcap, Math.ceil(sm.weapons[id] / 2)) })),
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

  /** 中断したランを再開せずに放棄する（リタイア扱い: 連れていた亡霊は戻る・喰らった亡霊は怨霊・形見は消費、亡霊は生まれない） */
  abandonActive(): RunRecord | null {
    const ar = this.S.active_run;
    if (!ar) return null;
    const cp = ar.checkpoint;
    const sm: Summary = {
      run_id: ar.run_id, seed: ar.seed, mode: ar.mode, t: cp?.t ?? 0, run_len: this.D.run_length[ar.mode],
      main_weapon: ar.weapon, weapons: cp?.weapons ?? { [ar.weapon]: 1 }, passives: cp?.passives ?? {}, ppow: cp?.ppow ?? {},
      wbonus: cp?.wbonus ?? {}, evolved: cp?.evolved ?? {}, level: cp?.level ?? 1, kills: cp?.kills ?? 0,
      boss_kills: 0, death_cause: "", heirloom_id: ar.heirloom_id ?? "", lineage_id: ar.lineage_id ?? "nameless",
      ghosts: ar.ghosts ?? [], fragments: cp?.fragments ?? 0, branch: cp?.branch ?? {},
      wraith_id: ar.wraith_id ?? "", wraith_purified: cp?.wraith_dead ?? false,
    };
    return this.settle(sm, "retired");
  }
}
