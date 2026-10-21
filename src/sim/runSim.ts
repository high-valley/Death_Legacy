// 1回のランの戦闘ロジック。DOM・描画・入力・セーブに依存しない。
// 固定ステップ(1/60秒)で進めるので、同じ seed＋同じ入力なら同じ結果になる。
// 表示や効果音への通知は events キュー、セーブへの受け渡しは summary() / snapshot()。
import { RngStreams } from "../core/rng.ts";
import { SpatialGrid, pushPair } from "../core/spatialGrid.ts";
import type { Balance, EnemyDef, Lineage, Rarity, RarityId, RunMode, SpawnMode } from "../data/types.ts";
import { gradeAt, rankCount, type Branch } from "../data/weapons.ts";
export { gradeAt, gradeIndex, weaponGrade } from "../data/weapons.ts";
import type { CardMods, FacilityBuff, GhostPick, GhostRecord, Heirloom, RunResult, Snapshot, Summary } from "../meta/records.ts";

export const STEP = 1 / 60;
const TAU = Math.PI * 2;

export class Foe {
  kind: string;
  def: EnemyDef;
  x = 0; y = 0;
  vx = 0; vy = 0;
  r: number;
  hp = 0;
  maxHp = 0;
  flash = 0;
  cd = 0;
  phase = 0;      // 突進・ボスの行動段階
  st = 0;
  dx = 0; dy = 0; // 突進の向き
  tx = 0; ty = 0; // ボスの叩きつけ地点
  slowT = 0;      // 氷: 遅くなっている残り時間
  slowMul = 1;
  freezeT = 0;    // 氷: 凍って動けない残り時間
  dead = false;
  constructor(kind: string, def: EnemyDef) {
    this.kind = kind;
    this.def = def;
    this.r = def.radius;
  }
}

export class Hero {
  x = 0; y = 0;
  r = 12;
  fx = 1; fy = 0;           // 向き
  dashT = 0;
  dashDx = 1; dashDy = 0;
  dashCd = 0;
  iframe = 0;
  flash = 0;
  cds: Record<string, number> = {};
}

export class Companion {
  rec: GhostRecord;       // 保管データのコピー（元データは触らない）
  x = -40; y = 20;
  cd = 0;
  echoCd = 0;             // 刻印「霊の共鳴」で主人公の武器を撃つ間隔
  phase = 0;
  slot = 0;               // 何体目か（並ぶ位置）
  constructor(rec: GhostRecord, slot = 0) {
    this.rec = rec;
    this.slot = slot;
    this.phase = slot * 2.1;
  }
}

/** 弾。斧は ret 秒たつと持ち主へ戻る（戻り始めで当たり判定を取り直す） */
export interface Shot {
  x: number; y: number; vx: number; vy: number; dmg: number; pierce: number; life: number; ghost: boolean; hit: Set<Foe>;
  rad: number; kind: "arrow" | "axe" | "ice"; ret?: number; spin?: number; owner?: { x: number; y: number };
  slow?: number; slowT?: number; freeze?: number;
}
export interface EShot { x: number; y: number; vx: number; vy: number; dmg: number; life: number; cause: string }
export interface Zone { x: number; y: number; r: number; dmg: number; life: number; tick: number; ghost: boolean }
export interface Gem { x: number; y: number; v: number; mag: boolean }

export type SimEvent =
  | { type: "fx"; kind: "arc"; x: number; y: number; a: number; r: number; arc: number; dur: number; ghost: boolean }
  | { type: "fx"; kind: "warn" | "boom"; x: number; y: number; r: number; dur: number }
  | { type: "fx"; kind: "poof"; x: number; y: number; dur: number; color: string }
  | { type: "fx"; kind: "thrust"; x: number; y: number; a: number; len: number; w: number; dur: number; ghost: boolean }
  | { type: "fx"; kind: "bolt"; pts: number[]; dur: number; ghost: boolean }
  | { type: "dmg"; x: number; y: number; v: number; big: boolean }
  | { type: "sfx"; name: string }
  | { type: "toast"; text: string }
  | { type: "shake"; amount: number };

export type CardKind = "weapon" | "rank" | "passive" | "lineage" | "heal" | "sigil" | "curse";
export interface Card { kind: CardKind; id: string; lv: number; rar: RarityId; branch?: Branch }
type Option = Omit<Card, "rar">;

export interface RunOpts {
  run_id?: string;
  seed?: number;
  mode?: RunMode;
  weapon?: string;
  lineage?: string;
  ghost?: GhostRecord | null;        // 1体だけ連れていく時の書き方（ghosts と同じ）
  ghosts?: GhostRecord[];           // 連れていく亡霊（最大2体）
  heirloom?: Heirloom | null;
  card_mods?: CardMods;
  checkpoint?: Snapshot | null;
  /** 喰らった亡霊（同行はしない。力だけを取り込む） */
  devour?: Devour | null;
  devours?: Devour[];
  /** このランに現れる怨霊 */
  wraith?: GhostRecord | null;
  /** 穢れによる敵HPの増分（0.12 = +12%） */
  taint_hp?: number;
  /** 拠点の施設の効果（武具の間のタグ・供養塔の力） */
  facility?: FacilityBuff;
}

export interface Devour { rec: GhostRecord; might: number; hp: number }

/** 配列から条件に合わないものを取り除く（新しい配列を作らない） */
function compact<T>(arr: T[], keep: (v: T) => boolean): void {
  let j = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (keep(v)) arr[j++] = v;
  }
  arr.length = j;
}

const angleDiff = (a: number, b: number): number => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
};

const SEP_MAX_R = 12; // これ以下の半径の敵は sepGrid で押し合い

/** 家系を使わない時の「何もない家系」（特性・弱点・専用カードなし） */
export function neutralLineage(D: Balance): Lineage {
  const b = D.lineages[0];
  return { ...b, weapon: null, mods: {}, card: { ...b.card, max: 0 }, unlock: null };
}

export class RunSim {
  readonly D: Balance;
  readonly run_id: string;
  readonly seed: number;
  readonly mode: RunMode;
  readonly runLen: number;
  readonly mainWeapon: string;
  readonly lineage: Lineage;
  lineageLv = 0;     // 家系の札の取得回数
  lpow = 0;          // 家系の札の効果量（レア度込み）
  heirloomId = "";
  solo: boolean;
  devours: Devour[] = [];
  /** 喰らった力の合計 */
  devourMight = 0;
  fragments = 0;                             // 未練の欠片
  branch: Record<string, Branch> = {};       // 武器ごとに選んだ道
  sigils: string[] = [];                     // 刻印
  curses: string[] = [];                     // 呪い
  private soulKills = 0;
  wraithRec: GhostRecord | null = null;
  wraith: Foe | null = null;
  wraithSpawned = false;
  wraithDead = false;
  taintHp = 0;
  facility: FacilityBuff = { tags: [], ghost_atk: 0, hp: 0, offer: 0 };
  cardMods: CardMods = { altar: 0, affinity: {}, seals: [] };

  t = 0;
  hp: number;
  maxHp: number;
  level = 1;
  xp = 0;
  pending = 0;
  weapons: Record<string, number> = {};
  passives: Record<string, number> = {};   // 取得回数（Lv）
  ppow: Record<string, number> = {};       // レア度込みの効果量
  wbonus: Record<string, number> = {};     // 武器ごとのダメージ加算
  evolved: Record<string, boolean> = {};
  rank: Record<string, number> = {};       // 武器ランク（0〜。進化は evolved）。レベル（weapons）とは別
  undyingUsed = false;                     // 刻印「不屈」を使ったか
  private regenT = 0;
  private gloryT = 0;                      // 刻印「狩人の誉れ」の攻撃速度アップの残り時間
  kills = 0;
  bossKills = 0;
  boss: Foe | null = null;
  bossSpawned = false;
  eliteIdx = 0;
  spawnAcc = 0;
  result: RunResult = "";
  deathCause = "";
  maxAlive = 0;
  lastCheckpoint = 0;
  updateMs = 0;
  /** ダメージ数字を出すか（描画側が決める。テストでは出さない） */
  showDamage = false;
  private dmgThisTick = 0;

  readonly hero = new Hero();
  ghosts: Companion[] = [];
  enemies: Foe[] = [];
  shots: Shot[] = [];
  eshots: EShot[] = [];
  zones: Zone[] = [];
  gems: Gem[] = [];
  events: SimEvent[] = [];
  readonly rng: RngStreams;
  readonly grid = new SpatialGrid<Foe>(64);
  private readonly sepGrid = new SpatialGrid<Foe>(SEP_MAX_R * 2);

  constructor(D: Balance, o: RunOpts) {
    this.D = D;
    this.run_id = o.run_id ?? "";
    this.seed = o.seed ?? 1;
    this.mode = o.mode ?? "short";
    this.runLen = D.run_length[this.mode];
    this.lineage = D.lineages_enabled ? D.lineages.find((l) => l.id === o.lineage) ?? D.lineages[0] : neutralLineage(D);
    this.mainWeapon = this.lineage.weapon ?? o.weapon ?? "sword";
    if (o.card_mods) this.cardMods = o.card_mods;
    this.rng = new RngStreams(this.seed);
    this.hero.r = D.player.radius;
    if (o.facility) this.facility = structuredClone(o.facility);
    this.maxHp = Math.round(D.player.hp * (1 + (this.lineage.mods.max_hp ?? 0)) * (1 + this.facility.hp));
    this.hp = this.maxHp;
    this.weapons[this.mainWeapon] = 1;
    this.rank[this.mainWeapon] = 0;
    const gs = [...(o.ghosts ?? []), ...(o.ghost ? [o.ghost] : [])];
    gs.forEach((g, i) => this.ghosts.push(new Companion(structuredClone(g), i)));
    const dv = [...(o.devours ?? []), ...(o.devour ? [o.devour] : [])];
    let hpUp = 0;
    for (const d of dv) {
      this.devours.push({ rec: structuredClone(d.rec), might: d.might, hp: d.hp });
      this.devourMight += d.might;
      hpUp += d.hp;
    }
    if (hpUp > 0) {
      this.maxHp = Math.round(this.maxHp * (1 + hpUp));
      this.hp = this.maxHp;
    }
    this.solo = this.ghosts.length === 0 && this.devours.length === 0;
    if (o.wraith) this.wraithRec = structuredClone(o.wraith);
    this.taintHp = Math.max(0, o.taint_hp ?? 0);
    if (o.heirloom) {
      this.heirloomId = o.heirloom.heir_id;
      if (!o.checkpoint) this.applyHeirloom(o.heirloom);
    }
    if (o.checkpoint) this.restore(o.checkpoint);
  }

  private applyHeirloom(h: Heirloom): void {
    const cap = h.type === "weapon" ? this.D.weapon_max_level : this.D.passive_max_level;
    // 武器の形見はレベル（ダメージ）だけ。ランクはランクアップの札で上げる
    const lv = Math.min(cap, h.level + (this.lineage.mods.heir_level_bonus ?? 0));
    if (h.type === "weapon") {
      // 主人公は武器1種なので、武器の形見は「いまの武器のLv」になる
      this.weapons[this.mainWeapon] = Math.max(this.weapons[this.mainWeapon] ?? 0, lv);
    } else {
      this.passives[h.id] = lv;
      this.ppow[h.id] = lv;
      if (h.id === "vigor") {
        this.maxHp += this.D.passives.vigor.per * lv;
        this.hp = this.maxHp;
      }
    }
  }

  // ---------------------------------------------------------------- events
  private emit(e: SimEvent): void {
    this.events.push(e);
  }

  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ---------------------------------------------------------------- stats
  progress(): number { return Math.min(1, this.t / this.runLen); }
  /** 雑魚・精鋭の攻撃力は時間で上がる（冥王・怨霊は固定） */
  dmgScale(): number { return 1 + this.spawnMode().dmg_growth * this.growthT(); }
  /** モードごとの敵の伸び（長いモードほど主人公が育つので、大きく伸ばす） */
  spawnMode(): SpawnMode { return this.D.spawn.modes[this.mode]; }
  hpGrowth(): number { return this.spawnMode().hp_growth; }
  /** 伸び方の曲線（進み具合の curve 乗）。序盤はゆるやか・後半に急（最初は一人でも楽、後半は一人では厳しい） */
  growthT(): number { return Math.pow(this.progress(), this.spawnMode().curve); }
  xpNeed(): number { return this.D.xp.base + this.level * this.D.xp.per_level; }
  pw(id: string): number { return this.ppow[id] ?? 0; }
  /** パッシブの効果（1 = 100%）。数値は balance.json の per */
  pv(id: string): number { return ((this.D.passives[id]?.per ?? 0) / 100) * this.pw(id); }
  mightMul(): number { return (1 + this.pv("might")) * (1 + this.devourMight) * (1 + this.curseMod("might")); }
  hasteMul(): number { return 1 / ((1 + this.pv("haste")) * (1 + this.curseMod("haste")) * (this.gloryT > 0 ? 1.3 : 1)); }
  areaMul(): number { return Math.max(0.3, (1 + this.pv("area")) * (1 + this.curseMod("area"))); }
  passiveSlots(): number { return Math.max(1, this.D.passive_slots + this.curseMod("passive_slots")); }
  /** 次のランクアップに必要なレベル（もう上がらない時は 0） */
  rankNeed(id: string): number {
    if (this.evolved[id]) return 0;
    return this.D.rank_levels[this.rank[id] ?? 0] ?? 0;
  }
  /** ランクアップの札を出す時か */
  rankDue(id: string): boolean {
    const need = this.rankNeed(id);
    return need > 0 && (this.weapons[id] ?? 0) >= need;
  }

  /** 先頭の同行亡霊（1体目） */
  get ghost(): Companion | null { return this.ghosts[0] ?? null; }
  /** 先頭の喰らった亡霊 */
  get devour(): Devour | null { return this.devours[0] ?? null; }

  has(sigil: string): boolean { return this.sigils.includes(sigil); }

  curseMod(key: string): number {
    let v = 0;
    for (const id of this.curses) v += this.D.curses.find((c) => c.id === id)?.mods[key] ?? 0;
    return v;
  }

  // ---------------------------------------------------------------- tags / sets
  private tagCache: Record<string, number> | null = null;
  private modCache = new Map<string, Record<string, number>>();

  /** タグの点数: 主人公の武器 2 / 亡霊の武器 1（＋霊 1）/ タグ付きパッシブ 1Lvにつき 1 */
  tagPoints(): Record<string, number> {
    if (this.tagCache) return this.tagCache;
    const D = this.D, P = D.tag_points, out: Record<string, number> = {};
    const add = (t: string, n: number): void => { out[t] = (out[t] ?? 0) + n; };
    for (const t of D.weapons[this.mainWeapon].tags) add(t, P.hero_weapon);
    for (const g of this.ghosts) {
      for (const t of D.weapons[g.rec.primary_weapon_id]?.tags ?? []) add(t, P.ghost_weapon);
      add("spirit", P.ghost_spirit);
    }
    for (const id in this.passives) {
      const t = D.passives[id]?.tag;
      if (t) add(t, P.passive_level * this.passives[id]);
    }
    for (const t of this.facility.tags) if (t in D.tags) add(t, 1);   // 武具の間
    return (this.tagCache = out);
  }

  /** いま効いているセット効果（タグごと） */
  activeSets(): { tag: string; at: number; text: string }[] {
    const pts = this.tagPoints(), out: { tag: string; at: number; text: string }[] = [];
    for (const [t, def] of Object.entries(this.D.tags)) for (const st of def.sets) if ((pts[t] ?? 0) >= st.at) out.push({ tag: t, at: st.at, text: st.text });
    return out;
  }

  /** タグたちにかかるセット効果の合計 */
  setMods(tags: string[]): Record<string, number> {
    const key = tags.join(",");
    const c = this.modCache.get(key);
    if (c) return c;
    const pts = this.tagPoints(), out: Record<string, number> = {};
    for (const t of tags) {
      const def = this.D.tags[t];
      if (!def) continue;
      for (const st of def.sets) if ((pts[t] ?? 0) >= st.at) for (const k in st.mods) out[k] = (out[k] ?? 0) + st.mods[k];
    }
    // タグ付きパッシブの追加効果（燃える時間・遅くする時間・攻撃間隔・長さ）
    for (const id in this.passives) {
      const P = this.D.passives[id];
      if (P.mod && P.tag && tags.includes(P.tag)) out[P.mod] = (out[P.mod] ?? 0) + this.pv(id);
    }
    this.modCache.set(key, out);
    return out;
  }

  /** どのタグでもよいので、効いている特別な効果の合計（爆発・凍結時の追加ダメージなど） */
  anySet(key: string): number {
    return this.setMods(Object.keys(this.D.tags))[key] ?? 0;
  }

  /** パッシブ・亡霊を直接書き換えた時（テストなど）はこれでタグの計算をやり直す */
  dirtyTags(): void {
    this.tagCache = null;
    this.modCache.clear();
  }

  /** タグ付きパッシブの倍率（例: 熾火の心臓 → 炎のダメージ） */
  private tagPassiveMul(tags: string[]): number {
    let m = 1;
    for (const id in this.passives) {
      const P = this.D.passives[id];
      if (P.tag && P.tag !== "spirit" && tags.includes(P.tag)) m *= 1 + (P.per / 100) * this.pw(id);
    }
    return m;
  }

  /** 亡霊の攻撃倍率（祭壇の樹・家系・霊媒・霊のセット） */
  ghostAtkMul(): number {
    const sp = this.setMods(["spirit"]);
    return (1 + this.mod("ghost_atk")) * (1 + (this.cardMods.ghost_atk ?? 0)) * (1 + this.facility.ghost_atk) * (1 + (this.D.passives.medium.per / 100) * this.pw("medium")) * (1 + (sp.ghost_atk ?? 0));
  }

  /** 亡霊の解放率。墓守は1段階早い */
  ghostUnlock(): number {
    const steps = this.D.ghost_unlock;
    let i = -1;
    for (let k = 0; k < steps.length; k++) if (this.level >= steps[k][0]) i = k;
    if (i < 0) return 0;
    return steps[Math.min(steps.length - 1, i + (this.lineage.mods.ghost_unlock_step ?? 0))][1];
  }

  mod(key: keyof Lineage["mods"]): number {
    return this.lineage.mods[key] ?? 0;
  }

  /** 家系の札の効果（%を割合で） */
  cardPower(): number {
    return (this.lineage.card.per / 100) * this.lpow;
  }

  weaponName(id: string): string {
    return gradeAt(this.D.weapons[id], this.rank[id] ?? 0, !!this.evolved[id], this.branch[id]).name;
  }

  // ---------------------------------------------------------------- weapons
  /** プレイヤーと亡霊が同じ武器コードを使う。武器ごとの形は段階（グレード）の数値で決まる */
  fireWeapon(id: string, lv: number, rank: number, ox: number, oy: number, fx: number, fy: number, dmgMul: number, area: number, isGhost: boolean, evo: boolean,
    branch: Branch | "" = "", owner: { x: number; y: number } | null = null): boolean {
    const W = this.D.weapons[id];
    const g = gradeAt(W, rank, evo, branch);
    const m = this.setMods(W.tags);   // セット効果（同じタグの武器なら主人公・亡霊どちらにも効く）
    area *= 1 + (m.area ?? 0);
    const tgt = this.grid.nearest(ox, oy, 520);
    let dmg = W.damage * dmgMul * g.dmg * (1 + W.per_level * (lv - 1)) * (1 + (m.dmg ?? 0)) * this.tagPassiveMul(W.tags);
    // 会心（主人公の攻撃だけ。1回の攻撃ごとに判定）
    if (!isGhost && this.pw("crit") > 0 && this.rng.crit.randf() < this.pv("crit")) dmg *= this.D.crit_mult;
    // 狙う向き（敵がいなければ向いている方）
    let dx = fx, dy = fy;
    if (tgt) {
      const l = Math.hypot(tgt.x - ox, tgt.y - oy) || 1;
      dx = (tgt.x - ox) / l; dy = (tgt.y - oy) / l;
    }
    const a0 = Math.atan2(dy, dx);
    if (id === "sword") {
      const reach = (W.range ?? 90) * area * (g.range ?? 1);
      const arc = g.arc ?? 1.9;
      const dirs = g.dirs ?? 1;
      for (let k = 0; k < dirs; k++) {
        const a = a0 + k * Math.PI;
        const list = this.grid.query(ox, oy, reach + 30);
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (e.dead || Math.hypot(e.x - ox, e.y - oy) > reach + e.r) continue;
          if (arc >= TAU || Math.abs(angleDiff(a, Math.atan2(e.y - oy, e.x - ox))) < arc / 2) this.hurt(e, dmg);
        }
        this.emit({ type: "fx", kind: "arc", x: ox, y: oy, a, r: reach, arc: Math.min(arc, TAU), dur: 0.18, ghost: isGhost });
      }
    } else if (id === "bow") {
      if (!tgt) return false;
      const n = (g.count ?? 1) + (m.count ?? 0);
      const sp = (W.speed ?? 560) * (g.speed ?? 1);
      for (let i = 0; i < n; i++) {
        const a = a0 + (i - (n - 1) / 2) * (n > 3 ? 0.12 : 0.16);
        this.shots.push({ x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg, pierce: (g.pierce ?? 0) + (m.pierce ?? 0), life: 1, ghost: isGhost, hit: new Set(), rad: 4, kind: "arrow" });
      }
    } else if (id === "fire") {
      if (!tgt) return false;
      const n = g.count ?? 1;
      const fa = isGhost ? 0 : this.mod("fire_area"), fb = isGhost ? 0 : this.mod("fire_burn");
      for (let i = 0; i < n; i++) {
        const at = i === 0 || this.enemies.length === 0 ? tgt : this.enemies[this.rng.misc.randi(this.enemies.length)];
        this.zones.push({
          x: at.x, y: at.y, r: (W.radius ?? 68) * area * (g.radius ?? 1) * (1 + fa),
          dmg, life: (W.burn ?? 2.6) * (g.burn ?? 1) * (1 + fb) * (1 + (m.burn ?? 0)), tick: 0, ghost: isGhost,
        });
      }
    } else if (id === "ice") {
      // 氷の刃: 当たった敵を遅くする（段階が上がると一瞬凍らせる）
      if (!tgt) return false;
      const n = g.count ?? 1;
      const sp = W.speed ?? 430;
      const spread = n >= 8 ? TAU / n : 0.22;
      for (let i = 0; i < n; i++) {
        const a = n >= 8 ? a0 + i * spread : a0 + (i - (n - 1) / 2) * spread;
        this.shots.push({
          x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg, pierce: g.pierce ?? 0, life: 1.1, ghost: isGhost, hit: new Set(),
          rad: 6, kind: "ice", slow: W.slow ?? 0.5, slowT: (W.slow_time ?? 1.5) * (1 + (m.slow_t ?? 0)), freeze: (g.freeze ?? 0) + (m.freeze ?? 0),
        });
      }
    } else if (id === "thunder") {
      // 雷: 近い敵に落ち、そこから近くの敵へ次々に飛び移る（1回ごとに少し弱まる）
      if (!tgt) return false;
      const range = (W.range ?? 340) * area, jump = (W.jump ?? 150) * area;
      const storm = this.has("storm_heart");
      const bolts = g.count ?? 1, chain = (g.chain ?? 2) + (m.chain ?? 0) + (storm ? 1 : 0);
      const decay = m.nodecay || storm ? 1 : 0.85;
      const struck = new Set<Foe>();
      for (let b = 0; b < bolts; b++) {
        let cur: Foe | null = b === 0 ? tgt : null;
        if (!cur) {
          const list = this.grid.query(ox, oy, range);
          const cand = list.filter((e) => !e.dead && !struck.has(e) && Math.hypot(e.x - ox, e.y - oy) < range);
          if (cand.length === 0) break;
          cur = cand[this.rng.misc.randi(cand.length)];
        }
        const pts = [ox, oy];
        let d = dmg;
        for (let k = 0; k < chain && cur; k++) {
          struck.add(cur);
          this.hurt(cur, d);
          pts.push(cur.x, cur.y);
          d *= decay;
          const from: Foe = cur;
          let best: Foe | null = null, bd = jump;
          const list = this.grid.query(from.x, from.y, jump);
          for (let i = 0; i < list.length; i++) {
            const e = list[i];
            if (e.dead || struck.has(e)) continue;
            const dd = Math.hypot(e.x - from.x, e.y - from.y);
            if (dd < bd) { bd = dd; best = e; }
          }
          cur = best;
        }
        this.emit({ type: "fx", kind: "bolt", pts, dur: 0.22, ghost: isGhost });
      }
    } else if (id === "spear") {
      // 突き: 線分の上にいる敵をすべて貫く
      if (!tgt) return false;
      const len = (W.length ?? 120) * (g.length ?? 1) * area * (1 + (m.length ?? 0));
      const hw = (W.width ?? 16) * (g.width ?? 1) / 2;
      const dirs = g.dirs ?? 1;
      for (let k = 0; k < dirs; k++) {
        const a = dirs === 2 ? a0 + k * Math.PI : dirs === 3 ? a0 + (k - 1) * 0.5 : a0;
        const ux = Math.cos(a), uy = Math.sin(a);
        const list = this.grid.query(ox + ux * len / 2, oy + uy * len / 2, len / 2 + 30);
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (e.dead) continue;
          const px = e.x - ox, py = e.y - oy;
          const along = px * ux + py * uy;
          if (along < -e.r || along > len + e.r) continue;
          if (Math.abs(px * uy - py * ux) < hw + e.r) this.hurt(e, dmg);
        }
        this.emit({ type: "fx", kind: "thrust", x: ox, y: oy, a, len, w: hw * 2, dur: 0.16, ghost: isGhost });
      }
    } else if (id === "axe") {
      // 投げ斧: 飛んでいって戻ってくる。行きと帰りで1回ずつ当たる
      if (!tgt) return false;
      const n = g.count ?? 1;
      const sp = (W.speed ?? 380) * (g.range ?? 1);
      const back = owner ?? this.hero;
      for (let i = 0; i < n; i++) {
        const a = n >= 4 ? a0 + (i * TAU) / n : a0 + (i - (n - 1) / 2) * 0.5;
        this.shots.push({
          x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg, pierce: 999, life: 1.6, ghost: isGhost, hit: new Set(),
          rad: (W.size ?? 10) * (g.size ?? 1) * area, kind: "axe", ret: 0.8, spin: 0, owner: back,
        });
      }
    }
    return true;
  }

  /** 武器の攻撃間隔（ランクで決まる。セット効果とパッシブの短縮は合計 cd_cut_max まで） */
  weaponCd(id: string, rank: number, evo: boolean, branch: Branch | "" = ""): number {
    const W = this.D.weapons[id];
    return W.cd * gradeAt(W, rank, evo, branch).cd * (1 - Math.min(this.D.cd_cut_max, this.setMods(W.tags).cd ?? 0));
  }

  /** 氷: 遅くする・凍らせる。ボスと怨霊は凍らず、遅くなるのも半分 */
  private chill(e: Foe, mul: number, t: number, freeze: number): void {
    const big = e.kind === "boss" || e.kind === "wraith";
    e.slowMul = big ? 1 - (1 - mul) / 2 : mul;
    e.slowT = Math.max(e.slowT, t);
    if (!big && freeze > 0) e.freezeT = Math.max(e.freezeT, freeze);
  }

  private hurt(e: Foe, d: number): void {
    if (e.dead) return;
    if (e.freezeT > 0) d *= 1 + this.anySet("shatter");                       // 氷6: 凍った敵に追加ダメージ
    if ((e.freezeT > 0 || e.slowT > 0) && this.has("frost_thorn")) d *= 1.3;  // 刻印: 霜の棘
    if (e.kind === "elite" || e.kind === "boss" || e.kind === "wraith") d *= 1 + this.pv("hunter");   // 狩人の勘
    e.hp -= d;
    // 刻印: 処刑人（雑魚だけ）
    if (e.hp > 0 && e.hp < e.maxHp * 0.15 && this.has("executioner") && e.kind !== "boss" && e.kind !== "wraith" && e.kind !== "elite") e.hp = 0;
    e.flash = 0.07;
    if (this.showDamage && this.dmgThisTick < 12) {
      this.dmgThisTick++;
      this.emit({ type: "dmg", x: e.x, y: e.y - e.r, v: Math.round(d), big: d >= 40 });
    }
    if (this.rng.misc.randf() < 0.08) this.emit({ type: "sfx", name: "hit" });
  }

  hurtPlayer(d: number, cause: string): void {
    if (this.result !== "" || this.hero.iframe > 0) return;
    // 受けるダメージの軽減は掛け合わせても guard_floor（4割）より下がらない
    d *= Math.max(this.D.guard_floor, (1 + this.curseMod("dmg_taken")) * (this.has("iron_vow") ? 0.75 : 1) * (1 - this.pv("guard")));
    this.hp -= d;
    this.hero.iframe = this.D.player.hit_iframe;
    if (this.hp <= 0 && this.has("undying") && !this.undyingUsed) {   // 刻印: 不屈
      this.undyingUsed = true;
      this.hp = 1;
      this.hero.iframe = Math.max(this.hero.iframe, 1.5);
      this.emit({ type: "toast", text: "不屈: 倒れずに踏みとどまった" });
    }
    this.hero.flash = 0.15;
    this.deathCause = cause;
    this.emit({ type: "sfx", name: "hurt" });
    this.emit({ type: "shake", amount: 4 });
    if (this.hp <= 0) {
      this.hp = 0;
      this.end("player_death");
    }
  }

  end(res: Exclude<RunResult, "">): void {
    if (this.result === "") this.result = res;
  }

  tryDash(mx: number, my: number): boolean {
    const h = this.hero;
    if (h.dashCd > 0 || this.result !== "") return false;
    const l = Math.hypot(mx, my);
    if (l > 0.01) { h.dashDx = mx / l; h.dashDy = my / l; } else { h.dashDx = h.fx; h.dashDy = h.fy; }
    h.dashT = this.D.player.dash_time;
    h.dashCd = this.D.player.dash_cd * (1 + this.curseMod("dash_cd"));
    h.iframe = Math.max(h.iframe, this.D.player.dash_time + 0.08);
    if (this.has("ember_step")) {   // 刻印: 残り火の歩み
      const F = this.D.weapons.fire;
      this.zones.push({ x: h.x, y: h.y, r: 55, dmg: F.damage * this.mightMul(), life: 3, tick: 0, ghost: false });
    }
    this.emit({ type: "sfx", name: "dash" });
    return true;
  }

  // ---------------------------------------------------------------- spawning
  spawnEnemy(kind: string, dist = -1): Foe {
    const def = this.D.enemies[kind];
    const a = this.rng.spawn.randf() * TAU;
    const d = dist > 0 ? dist : 760 + this.rng.spawn.randf() * 80;
    const e = new Foe(kind, def);
    e.x = this.hero.x + Math.cos(a) * d;
    e.y = this.hero.y + Math.sin(a) * d;
    let scale = (1 + this.hpGrowth() * this.growthT()) * (1 + this.taintHp) * (1 + this.curseMod("enemy_hp"));
    if (kind === "boss") scale = this.spawnMode().boss_hp;
    e.maxHp = def.hp * scale;
    e.hp = e.maxHp;
    e.cd = this.rng.spawn.randf() * 2;
    this.enemies.push(e);
    return e;
  }

  spawnBoss(): void {
    this.boss = this.spawnEnemy("boss", 700);
    this.bossSpawned = true;
    this.emit({ type: "toast", text: "冥王が現れた。倒せば生還できる" });
    this.emit({ type: "sfx", name: "boss" });
  }

  /** 喰らった亡霊が怨霊になって襲ってくる。等級が高いほど硬い */
  spawnWraith(): void {
    const rec = this.wraithRec!, W = this.D.rites.wraith;
    const tier = this.D.tiers.find((x) => x.id === rec.tier_id) ?? this.D.tiers[0];
    const base = this.D.enemies.wraith;
    const def = { ...base, name: `怨霊・${rec.display_name}`, color: tier.color };
    const e = new Foe("wraith", def);
    const a = this.rng.spawn.randf() * TAU;
    e.x = this.hero.x + Math.cos(a) * 640;
    e.y = this.hero.y + Math.sin(a) * 640;
    e.maxHp = (base.hp + W.hp_per_mult * tier.mult) * this.spawnMode().wraith_hp;
    e.hp = e.maxHp;
    e.cd = 1.5;
    this.enemies.push(e);
    this.wraith = e;
    this.wraithSpawned = true;
    this.emit({ type: "toast", text: `怨霊「${rec.display_name}」が現れた` });
    this.emit({ type: "sfx", name: "boss" });
  }

  private spawning(dt: number): void {
    const S = this.D.spawn;
    const p = this.progress();
    if (!this.bossSpawned && this.t >= this.runLen) this.spawnBoss();
    if (this.wraithRec && !this.wraithSpawned && p >= this.D.rites.wraith.at) this.spawnWraith();
    if (this.eliteIdx < this.spawnMode().elites_at.length && p >= this.spawnMode().elites_at[this.eliteIdx]) {
      this.spawnEnemy("elite");
      this.eliteIdx++;
      this.emit({ type: "toast", text: "墓暴きが来る" });
    }
    this.spawnAcc += dt * (S.base_per_sec + S.per_progress * p) * (this.bossSpawned ? S.boss_phase_rate : 1) * (1 + this.curseMod("spawn_rate"));
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      if (this.enemies.length >= S.max_alive) continue;
      const r = this.rng.spawn.randf();
      let kind = "chaser";
      if (p > S.charger_from && r < S.charger_share) kind = "charger";
      else if (p > S.shooter_from && r > 1 - S.shooter_share) kind = "shooter";
      this.spawnEnemy(kind);
    }
  }

  // ---------------------------------------------------------------- tick
  step(dt: number, mx: number, my: number): void {
    const t0 = performance.now();
    const D = this.D, h = this.hero;
    this.t += dt;
    this.dmgThisTick = 0;
    const ml = Math.hypot(mx, my);
    let ux = 0, uy = 0;
    if (ml > 0.01) {
      // 倒し具合にかかわらず常に全速（少しでも倒せば即座にその向きへ全速で動く）
      ux = mx / ml; uy = my / ml;
      h.fx = ux; h.fy = uy;
    }
    const speed = D.player.speed * (1 + this.pv("swift")) * (1 + this.mod("speed")) * (1 + this.curseMod("speed")) * (this.has("iron_vow") ? 0.92 : 1);
    if (h.dashT > 0) {
      h.dashT -= dt;
      h.x += h.dashDx * D.player.dash_speed * dt;
      h.y += h.dashDy * D.player.dash_speed * dt;
    } else {
      h.x += ux * speed * dt;
      h.y += uy * speed * dt;
    }
    h.dashCd = Math.max(0, h.dashCd - dt);
    h.iframe = Math.max(0, h.iframe - dt);
    h.flash -= dt;
    this.grid.rebuild(this.enemies);

    if (this.result === "") {
      for (const id in this.weapons) {
        h.cds[id] = (h.cds[id] ?? 0) - dt;
        if (h.cds[id] <= 0) {
          const lv = this.weapons[id];
          // 無名の意地: HPが3割以下の時に与ダメージが上がる
          const grit = this.lineage.card.id === "grit" && this.hp <= this.maxHp * 0.3 ? 1 + this.cardPower() : 1;
          const rk = this.rank[id] ?? 0;
          const ok = this.fireWeapon(id, lv, rk, h.x, h.y, h.fx, h.fy, this.mightMul() * (1 + (this.wbonus[id] ?? 0)) * grit * D.player.weapon_mult, this.areaMul(), false, !!this.evolved[id], this.branch[id] ?? "");
          h.cds[id] = ok ? this.weaponCd(id, rk, !!this.evolved[id], this.branch[id] ?? "") * this.hasteMul() : 0.2;
        }
      }
      // 灯火の命: 10秒ごとに回復 / 血の渇き: 毎秒HPが減る（最大HPの30%で止まる。被弾扱いにしない）
      this.regenT += dt;
      if (this.regenT >= 10) {
        this.regenT -= 10;
        if (this.pw("regen") > 0) this.hp = Math.min(this.maxHp, this.hp + (D.passives.regen?.per ?? 0) * this.pw("regen"));
      }
      const drain = this.curseMod("hp_drain");
      if (drain > 0 && this.hp > this.maxHp * 0.3) this.hp = Math.max(this.maxHp * 0.3, this.hp - drain * dt);
      this.gloryT = Math.max(0, this.gloryT - dt);
      for (const g of this.ghosts) this.ghostUpdate(g, dt);
    }

    for (const s of this.shots) {
      if (s.kind === "axe" && s.owner) {
        // 行き: 減速しながら進む → 帰り: 持ち主へ向かう（戻ったら消える）
        s.spin = (s.spin ?? 0) + dt * 14;
        const prevRet = s.ret ?? 0;
        s.ret = prevRet - dt;
        if (s.ret > 0) {
          s.vx *= 1 - 1.6 * dt; s.vy *= 1 - 1.6 * dt;
        } else {
          if (prevRet > 0) s.hit.clear();
          const ox = s.owner.x - s.x, oy = s.owner.y - s.y, d = Math.hypot(ox, oy) || 1;
          const sp = Math.min(620, Math.hypot(s.vx, s.vy) + 900 * dt);
          s.vx = (ox / d) * sp; s.vy = (oy / d) * sp;
          if (d < 18) s.life = 0;
        }
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      const list = this.grid.query(s.x, s.y, 30 + s.rad);
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (s.life <= 0 || e.dead || s.hit.has(e)) continue;
        if (Math.hypot(e.x - s.x, e.y - s.y) < e.r + s.rad) {
          this.hurt(e, s.dmg);
          if (s.kind === "ice") this.chill(e, s.slow ?? 0.5, s.slowT ?? 1.5, s.freeze ?? 0);
          s.hit.add(e);
          s.pierce--;
          if (s.pierce < 0) s.life = 0;
        }
      }
    }
    compact(this.shots, (s) => s.life > 0);
    const tick = D.weapons.fire.tick ?? 0.4;
    for (const z of this.zones) {
      z.life -= dt;
      z.tick -= dt;
      if (z.tick <= 0) {
        z.tick = tick;
        const list = this.grid.query(z.x, z.y, z.r + 20);
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) this.hurt(e, z.dmg);
        }
      }
    }
    compact(this.zones, (z) => z.life > 0);

    for (const e of this.enemies) {
      if (e.dead || e.hp > 0) continue;
      e.dead = true;
      this.kills++;
      if (e.def.xp > 0) this.gems.push({ x: e.x, y: e.y, v: e.def.xp, mag: false });
      // 未練の欠片（精鋭・怨霊が落とす。死んだ時に足りていれば亡霊になれる）
      const frag = D.ghost_birth.drops[e.kind] ?? 0;
      if (frag > 0) {
        this.fragments += frag;
        this.emit({ type: "toast", text: `未練の欠片 +${frag}（${this.fragments} / ${D.ghost_birth.fragments}）` });
      }
      // 刻印: 狩人の誉れ
      if ((e.kind === "elite" || e.kind === "wraith") && this.has("hunt_glory")) {
        this.hp = Math.min(this.maxHp, this.hp + 20);
        this.gloryT = 5;
      }
      // 刻印: 吸魂
      if (this.has("soul_drain") && ++this.soulKills % 20 === 0) this.hp = Math.min(this.maxHp, this.hp + 5);
      // 炎6: 25% で爆発
      if (this.anySet("explode") > 0 && e !== this.boss && this.rng.build.randf() < 0.25) {
        const R = 55, dmgB = D.weapons.fire.damage * 2.5 * this.mightMul();
        const list = this.grid.query(e.x, e.y, R + 20);
        for (let i = 0; i < list.length; i++) if (!list[i].dead && Math.hypot(list[i].x - e.x, list[i].y - e.y) < R + list[i].r) this.hurt(list[i], dmgB);
        this.emit({ type: "fx", kind: "boom", x: e.x, y: e.y, r: R, dur: 0.25 });
      }
      if (e === this.boss) {
        this.bossKills++;
        this.end("boss_cleared");
      }
      if (e === this.wraith) {
        this.wraithDead = true;
        this.wraith = null;
        this.emit({ type: "toast", text: "怨霊を祓った。穢れが1つ消える" });
        this.emit({ type: "sfx", name: "ghost" });
      }
      this.emit({ type: "fx", kind: "poof", x: e.x, y: e.y, dur: 0.3, color: e.def.color });
      // 送り火: 倒した場所に小さな炎が残る
      if (this.lineage.card.id === "okuribi" && this.lpow > 0 && this.rng.lineage.randf() < Math.min(0.6, this.cardPower())) {
        const F = D.weapons.fire;
        this.zones.push({ x: e.x, y: e.y, r: 45, dmg: F.damage * this.mightMul() * 0.8, life: 1.5, tick: 0, ghost: false });
      }
    }
    compact(this.enemies, (e) => !e.dead);
    if (this.result === "") this.spawning(dt);

    for (const e of this.enemies) this.enemyUpdate(e, dt);
    // 押し合い: 小さい敵どうしは細かいグリッドで各組1回、大きい敵（精鋭・冥王）は近傍探索で
    this.sepGrid.rebuild(this.enemies);
    this.sepGrid.separate(0.25);
    for (const a of this.enemies) {
      if (a.r <= SEP_MAX_R) continue;
      const list = this.grid.query(a.x, a.y, a.r + 24);   // grid はティック冒頭の位置のまま（探索半径に余裕がある）
      for (let i = 0; i < list.length; i++) if (list[i] !== a) pushPair(a, list[i], 0.25);
    }
    for (const s of this.eshots) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (Math.hypot(s.x - h.x, s.y - h.y) < h.r + 4) {
        this.hurtPlayer(s.dmg, s.cause);
        s.life = 0;
      }
    }
    compact(this.eshots, (s) => s.life > 0);

    const greed = this.has("greed");
    const pick = D.player.pickup * (1 + this.pv("magnet")) * (greed ? 1.5 : 1) * Math.max(0.3, 1 + this.curseMod("pickup"));
    const xpMul = (this.solo ? 1 + D.solo_xp_bonus * (1 + this.mod("solo_xp")) : 1) * (1 + this.curseMod("xp")) * (greed ? 1.25 : 1);
    let picked = false;
    compact(this.gems, (g) => {
      const ox = h.x - g.x, oy = h.y - g.y;
      const d = Math.hypot(ox, oy);
      if (d < h.r + 8) {
        this.xp += g.v * xpMul;
        picked = true;
        return false;
      }
      if (d < pick || g.mag) {
        g.mag = true;
        const sp = Math.max(240, 520 - d) * dt / d;
        g.x += ox * sp;
        g.y += oy * sp;
      }
      return true;
    });
    if (picked) this.emit({ type: "sfx", name: "xp" });
    if (this.gems.length > 600) this.gems.splice(0, this.gems.length - 600);
    while (this.xp >= this.xpNeed()) {
      this.xp -= this.xpNeed();
      this.level++;
      this.pending++;
    }
    this.maxAlive = Math.max(this.maxAlive, this.enemies.length);
    this.updateMs = this.updateMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  /** 同行する亡霊: 主人公の後ろ（2体なら左右）について、生前の武器で戦う */
  private ghostUpdate(g: Companion, dt: number): void {
    const h = this.hero;
    g.phase += dt;
    const side = this.ghosts.length > 1 ? (g.slot === 0 ? 1 : -1) : 0;
    const tx = h.x - h.fx * 46 - h.fy * 30 * side + Math.cos(g.phase) * 14;
    const ty = h.y - h.fy * 46 + h.fx * 30 * side + Math.sin(g.phase * 1.3) * 10;
    const k = Math.min(1, dt * 5);
    g.x += (tx - g.x) * k;
    g.y += (ty - g.y) * k;
    const sp = this.setMods(["spirit"]);
    const unlock = sp.ghost_full ? 1 : this.ghostUnlock();
    // 鎮魂の鐘・霊4: 亡霊の攻撃間隔が短くなる
    const bell = (this.lineage.card.id === "bell" ? Math.max(0.4, 1 - this.cardPower()) : 1) * (1 - (sp.ghost_cd ?? 0));
    g.cd -= dt;
    if (g.cd <= 0) {
      const r = g.rec, s = r.stat_snapshot, wid = r.primary_weapon_id, lv = r.weapon_level, rk = r.weapon_rank ?? 0, br = r.weapon_branch ?? "";
      const ok = this.fireWeapon(wid, lv, rk, g.x, g.y, 1, 0, s.attack_mult * unlock * this.ghostAtkMul(), s.area, true, !!r.evolved, br, g);
      g.cd = ok ? (this.weaponCd(wid, rk, !!r.evolved, br) / s.attack_speed) * bell : 0.25;
    }
    // 刻印: 霊の共鳴（主人公の武器を40%の威力で一緒に撃つ）
    if (this.has("ghost_echo")) {
      g.echoCd -= dt;
      if (g.echoCd <= 0) {
        const id = this.mainWeapon, lv = this.weapons[id], rk = this.rank[id] ?? 0;
        const ok = this.fireWeapon(id, lv, rk, g.x, g.y, h.fx, h.fy, this.mightMul() * 0.4, this.areaMul(), true, !!this.evolved[id], this.branch[id] ?? "", g);
        g.echoCd = ok ? this.weaponCd(id, rk, !!this.evolved[id], this.branch[id] ?? "") * this.hasteMul() * 1.2 : 0.3;
      }
    }
  }

  private enemyUpdate(e: Foe, dt: number): void {
    const h = this.hero;
    const ox = h.x - e.x, oy = h.y - e.y;
    const d = Math.max(Math.hypot(ox, oy), 0.001);
    const ux = ox / d, uy = oy / d;
    const def = e.def;
    const sp = def.speed * (1 + this.curseMod("enemy_speed"));
    e.flash -= dt;
    e.cd -= dt;
    switch (def.ai) {
      case "chase":
        e.vx = ux * sp; e.vy = uy * sp;
        break;
      case "charge":
        if (e.phase === 0) {
          e.vx = ux * sp; e.vy = uy * sp;
          if (d < 260 && e.cd <= 0) {
            e.phase = 1; e.st = 0.6; e.dx = ux; e.dy = uy;
          }
        } else if (e.phase === 1) {
          e.vx = 0; e.vy = 0;
          e.st -= dt;
          if (e.st <= 0) { e.phase = 2; e.st = 0.5; }
        } else {
          e.vx = e.dx * (def.dash_speed ?? 380); e.vy = e.dy * (def.dash_speed ?? 380);
          e.st -= dt;
          if (e.st <= 0) { e.phase = 0; e.cd = 2.5; }
        }
        break;
      case "shoot": {
        const range = def.range ?? 270;
        const want = d > range ? 1 : d < range - 70 ? -1 : 0;
        e.vx = ux * sp * want; e.vy = uy * sp * want;
        if (d < range + 40 && e.cd <= 0) {
          e.cd = def.interval ?? 2.6;
          const bs = def.bullet_speed ?? 190;
          this.eshots.push({ x: e.x, y: e.y, vx: ux * bs, vy: uy * bs, dmg: def.damage * this.dmgScale(), life: 2.2, cause: "shooter" });
        }
        break;
      }
      case "wraith": {
        // 間合いを保ちながら3方向に呪いを撃つ
        const range = def.range ?? 230;
        const want = d > range ? 1 : d < range - 90 ? -0.6 : 0.25;
        e.vx = ux * sp * want - uy * sp * 0.4; e.vy = uy * sp * want + ux * sp * 0.4;
        if (d < range + 80 && e.cd <= 0) {
          e.cd = def.interval ?? 2.2;
          const bs = def.bullet_speed ?? 200, a0 = Math.atan2(uy, ux);
          for (const k of [-0.28, 0, 0.28]) this.eshots.push({ x: e.x, y: e.y, vx: Math.cos(a0 + k) * bs, vy: Math.sin(a0 + k) * bs, dmg: def.damage, life: 2.4, cause: "wraith" });
        }
        break;
      }
      case "boss": {
        e.vx = ux * sp; e.vy = uy * sp;
        const slam = def.slam!;
        if (e.phase === 0 && e.cd <= 0) {
          e.phase = 1; e.st = slam.windup; e.tx = h.x; e.ty = h.y;
          this.emit({ type: "fx", kind: "warn", x: h.x, y: h.y, r: slam.radius, dur: slam.windup });
        } else if (e.phase === 1) {
          e.st -= dt;
          if (e.st <= 0) {
            if (Math.hypot(h.x - e.tx, h.y - e.ty) < slam.radius + h.r) this.hurtPlayer(slam.damage, "boss");
            this.emit({ type: "fx", kind: "boom", x: e.tx, y: e.ty, r: slam.radius, dur: 0.35 });
            this.emit({ type: "shake", amount: 6 });
            e.phase = 2; e.st = 1.2;
          }
        } else if (e.phase === 2) {
          e.st -= dt;
          if (e.st <= 0) {
            const nova = def.nova!;
            for (let k = 0; k < nova.count; k++) {
              const a = (k / nova.count) * TAU + this.t;
              this.eshots.push({ x: e.x, y: e.y, vx: Math.cos(a) * nova.speed, vy: Math.sin(a) * nova.speed, dmg: nova.damage, life: 3.5, cause: "boss" });
            }
            e.phase = 0; e.cd = def.cycle ?? 3.2;
          }
        }
        break;
      }
    }
    let k = 1;
    if (e.freezeT > 0) { e.freezeT -= dt; k = 0; }
    else if (e.slowT > 0) { e.slowT -= dt; k = e.slowMul; }
    e.x += e.vx * dt * k;
    e.y += e.vy * dt * k;
    if (d < e.r + h.r) this.hurtPlayer(def.damage * (e.kind === "boss" || e.kind === "wraith" ? 1 : this.dmgScale()), e.kind);
  }

  // ---------------------------------------------------------------- cards
  /** レベルアップの候補。主人公は武器1種なので武器カードは自分の武器だけ */
  cardPool(): Option[] {
    const D = this.D;
    const opts: Option[] = [];
    const seals = this.cardMods.seals ?? [];
    const id0 = this.mainWeapon, lv0 = this.weapons[id0] ?? 0;
    opts.push({ kind: "weapon", id: id0, lv: lv0 });   // 最大Lvでも出る（ダメージの上乗せ）
    const nPass = Object.keys(this.passives).length;
    const pts = this.tagPoints();
    for (const id in D.passives) {
      const lv = this.passives[id] ?? 0;
      const tag = D.passives[id].tag;
      if (lv > 0 && lv < D.passive_max_level) opts.push({ kind: "passive", id, lv });
      // タグ付きのパッシブは、ビルドにそのタグがある時だけ（剣の主人公に「炎」は出さない。亡霊・武具の間で入ったタグは出る）。封印は新規取得だけを止める
      else if (lv === 0 && nPass < this.passiveSlots() && !seals.includes(id) && (!tag || (pts[tag] ?? 0) > 0)) opts.push({ kind: "passive", id, lv: 0 });
    }
    // 家系の札（その家系で出撃した時だけ）。パッシブの枠は使わない
    if (this.lineageLv < this.lineage.card.max) opts.push({ kind: "lineage", id: this.lineage.card.id, lv: this.lineageLv });
    return opts;
  }

  static rarityWeights(D: Balance, altar: number): number[] {
    return D.rarities.map((r) => Math.max(r.id === "N" ? 1 : 0.1, r.weight + D.altar.shift[r.id] * altar));
  }

  rollRarity(): RarityId {
    const ws = RunSim.rarityWeights(this.D, this.cardMods.altar ?? 0);
    const total = ws.reduce((a, b) => a + b, 0);
    let r = this.rng.cards.randf() * total;
    for (let i = 0; i < ws.length; i++) {
      r -= ws[i];
      if (r <= 0) return this.D.rarities[i].id;
    }
    return "N";
  }

  /** まだ取っていない刻印のうち、いま出せるもの（祭壇の樹の書架で増える） */
  sigilPool(): string[] {
    const tier = this.cardMods.sigil_tier ?? 0, pts = this.tagPoints();
    return this.D.sigils.filter((sg) => sg.tier <= tier && !this.sigils.includes(sg.id)
      && (!sg.need || (sg.need === "ghost" ? this.ghosts.length > 0 : (pts[sg.need] ?? 0) > 0))).map((sg) => sg.id);
  }

  /**
   * 3択。書庫の「縁」とビルドに合うタグで出やすさ、祭壇の段階でレア度の重みが変わる。
   * 武器が道を選ぶLvに届く時は、道 a / b の2枚に分かれる。まれに刻印・呪い（解放後）が混ざる。
   */
  rollChoices(): Card[] {
    const D = this.D;
    const opts = this.cardPool();
    let out: Card[] = [];
    const aff = this.cardMods.affinity ?? {};
    const step = D.library.affinity_step;
    const pts = this.tagPoints();
    while (out.length < 3 && opts.length > 0) {
      const ws = opts.map((o) => {
        const t = o.kind === "passive" ? D.passives[o.id].tag : undefined;
        return (1 + (aff[o.id] ?? 0) * step) * (t && (pts[t] ?? 0) > 0 ? 2 : 1) * (o.kind === "weapon" ? D.weapon_card_weight : 1);
      });
      const total = ws.reduce((a, b) => a + b, 0);
      let r = this.rng.cards.randf() * total;
      let idx = 0;
      for (let i = 0; i < ws.length; i++) {
        idx = i;
        r -= ws[i];
        if (r <= 0) break;
      }
      const o = opts.splice(idx, 1)[0];
      out.push({ ...o, rar: this.rollRarity() });
    }
    // ランクアップ: 武器が rank_levels のLvに届いていれば、次のレベルアップで必ず出す（最初は道 a / b の2枚）
    const id0 = this.mainWeapon;
    if (this.rankDue(id0)) {
      const rk = this.rank[id0] ?? 0, lv0 = this.weapons[id0] ?? 0;
      const rc: Card[] = rk === 0 && !this.branch[id0]
        ? [{ kind: "rank", id: id0, lv: lv0, rar: "UR", branch: "a" }, { kind: "rank", id: id0, lv: lv0, rar: "UR", branch: "b" }]
        : [{ kind: "rank", id: id0, lv: lv0, rar: rk + 1 >= rankCount(D.weapons[id0]) ? "LR" : "UR" }];
      out = [...rc, ...out].slice(0, 3);
    }
    // 刻印・呪い（3枚の時だけ、最後の札と入れ替える）
    if (out.length === 3 && !out.some((c) => c.kind === "rank")) {
      const sp = this.sigilPool();
      if (sp.length > 0 && this.rng.build.randf() < D.sigil_chance) {
        out[2] = { kind: "sigil", id: sp[this.rng.build.randi(sp.length)], lv: 0, rar: "UR" };
      }
      const few = Object.keys(this.passives).length <= 3;
      const cp = D.curses.filter((c) => !this.curses.includes(c.id) && (c.need !== "few_passives" || few));
      if (this.cardMods.curses && cp.length > 0 && this.rng.build.randf() < D.curse_chance) {
        out[1] = { kind: "curse", id: cp[this.rng.build.randi(cp.length)].id, lv: 0, rar: "SR" };
      }
    }
    if (out.length === 0) out.push({ kind: "heal", id: "", lv: 0, rar: "N" });
    return out;
  }

  rarity(id: RarityId): Rarity {
    return this.D.rarities.find((r) => r.id === id) ?? this.D.rarities[0];
  }

  /** カードのタグ（表示用） */
  cardTag(c: Card): string {
    if (c.kind === "weapon" || c.kind === "rank") return this.D.weapons[c.id].tags[0] ?? "";
    if (c.kind === "passive") return this.D.passives[c.id].tag ?? "";
    return "";
  }

  describe(c: Card): { k: string; n: string; d: string } {
    const D = this.D, R = this.rarity(c.rar);
    if (c.kind === "weapon") {
      const W = D.weapons[c.id], lv = c.lv, maxlv = D.weapon_max_level;
      const cur = gradeAt(W, this.rank[c.id] ?? 0, !!this.evolved[c.id], this.branch[c.id] ?? "");
      if (lv >= maxlv) return { k: "武器 最大Lv", n: cur.name, d: `${cur.name}のダメージ +${Math.round(D.maxed_weapon_bonus[c.rar] * 100)}%` };
      const to = Math.min(maxlv, lv + R.wlv);
      const extra = R.wbonus > 0 ? `\nさらにダメージ +${Math.round(R.wbonus * 100)}%` : "";
      const need = this.rankNeed(c.id);
      const hint = need > lv ? (to >= need ? "\n次のレベルアップでランクアップ" : `\nLv${need}でランクアップ`) : "";
      return { k: `武器 Lv${lv} → ${to}`, n: cur.name, d: `ダメージ +${Math.round(W.per_level * (to - lv) * 100)}%` + extra + hint };
    }
    if (c.kind === "rank") {
      const W = D.weapons[c.id], rk = this.rank[c.id] ?? 0, br = this.branch[c.id] ?? "";
      const cur = gradeAt(W, rk, false, br);
      if (rk + 1 >= rankCount(W)) {
        const E = W.grades[W.grades.length - 1];
        return { k: "ランクアップ・進化", n: `${cur.name} → ${E.name}`, d: E.desc };
      }
      if (c.branch) {
        const next = gradeAt(W, rk + 1, false, c.branch), end = gradeAt(W, rankCount(W) - 1, false, c.branch);
        return { k: "ランクアップ・道を選ぶ", n: `${cur.name} → ${next.name}`, d: `${next.desc}${end !== next ? `\nこの先: ${end.name}` : ""}` };
      }
      const next = gradeAt(W, rk + 1, false, br);
      return { k: "ランクアップ", n: `${cur.name} → ${next.name}`, d: next.desc };
    }
    if (c.kind === "lineage") {
      const L = this.lineage.card;
      return { k: c.lv > 0 ? `${this.lineage.name}の札 Lv${c.lv} → ${c.lv + 1}` : `${this.lineage.name}の札`, n: L.name, d: L.fmt.replace("{v}", String(Math.round(L.per * R.pmul))) };
    }
    if (c.kind === "passive") {
      const P = D.passives[c.id];
      const head = c.lv > 0 ? `パッシブ Lv${c.lv} → ${c.lv + 1}` : "パッシブを追加";
      const tag = P.tag ? `\n${D.tags[P.tag].name}のタグ +${D.tag_points.passive_level}` : "";
      return { k: head, n: P.name, d: P.fmt.replace("{v}", String(Math.round(P.per * R.pmul))) + tag };
    }
    if (c.kind === "sigil") {
      const sg = D.sigils.find((x) => x.id === c.id)!;
      return { k: "刻印　ランの終わりまで続く", n: sg.name, d: sg.desc };
    }
    if (c.kind === "curse") {
      const cu = D.curses.find((x) => x.id === c.id)!;
      return { k: "呪い　強い効果と不利の両方", n: cu.name, d: cu.desc };
    }
    return { k: "全強化済み", n: "回復", d: "HP +30" };
  }

  applyChoice(c: Card): void {
    const D = this.D, R = this.rarity(c.rar ?? "N"), maxlv = D.weapon_max_level;
    if (c.kind === "rank") {
      const rk = this.rank[c.id] ?? 0;
      if (c.branch && !this.branch[c.id]) this.branch[c.id] = c.branch;
      if (rk + 1 >= rankCount(D.weapons[c.id])) this.evolved[c.id] = true;
      else this.rank[c.id] = rk + 1;
      this.emit({ type: "toast", text: `${this.weaponName(c.id)}に持ち替えた` });
    } else if (c.kind === "weapon") {
      const lv = this.weapons[c.id] ?? 0;
      if (lv >= maxlv) {
        this.wbonus[c.id] = (this.wbonus[c.id] ?? 0) + D.maxed_weapon_bonus[c.rar];
      } else {
        this.weapons[c.id] = Math.min(maxlv, lv + R.wlv);
        if (R.wbonus > 0) this.wbonus[c.id] = (this.wbonus[c.id] ?? 0) + R.wbonus;
      }
    } else if (c.kind === "lineage") {
      this.lineageLv++;
      this.lpow += R.pmul;
    } else if (c.kind === "passive") {
      this.passives[c.id] = (this.passives[c.id] ?? 0) + 1;
      this.ppow[c.id] = this.pw(c.id) + R.pmul;
      if (c.id === "vigor") {
        const add = Math.round(D.passives.vigor.per * R.pmul);
        this.maxHp += add;
        this.hp = Math.min(this.maxHp, this.hp + add);
      }
      this.dirtyTags();
    } else if (c.kind === "sigil") {
      if (!this.sigils.includes(c.id)) this.sigils.push(c.id);
    } else if (c.kind === "curse") {
      if (!this.curses.includes(c.id)) {
        this.curses.push(c.id);
        // 取った時に1回だけ効くもの（再開時は snapshot の値をそのまま使うので二重にならない）
        const cm = D.curses.find((x) => x.id === c.id)?.mods ?? {};
        if (cm.max_hp) {
          this.maxHp = Math.max(1, Math.round(this.maxHp * (1 + cm.max_hp)));
          this.hp = Math.min(this.hp, this.maxHp);
        }
        if (cm.weapon_lv) this.weapons[this.mainWeapon] = Math.min(maxlv, (this.weapons[this.mainWeapon] ?? 1) + cm.weapon_lv);
      }
    } else {
      this.hp = Math.min(this.maxHp, this.hp + 30);
    }
    this.pending = Math.max(0, this.pending - 1);
  }

  buildText(): string {
    const D = this.D;
    const w = Object.keys(this.weapons).map((id) => {
      const b = this.wbonus[id] ?? 0;
      return `${this.weaponName(id)} Lv${this.weapons[id]}${b > 0 ? ` +${Math.round(b * 100)}%` : ""}`;
    });
    const p = Object.keys(this.passives).map((id) => `${D.passives[id].name} Lv${this.passives[id]}`);
    const l = this.lineageLv > 0 ? `　/　${this.lineage.card.name} Lv${this.lineageLv}` : "";
    const sg = this.sigils.length ? `　/　刻印: ${this.sigils.map((id) => D.sigils.find((x) => x.id === id)?.name).join("・")}` : "";
    return `武器: ${w.join("・")}　/　パッシブ(${p.length}/${D.passive_slots}): ${p.length ? p.join("・") : "なし"}${l}${sg}`;
  }

  // ---------------------------------------------------------------- save bridge
  snapshot(): Snapshot {
    return {
      t: this.t, hp: this.hp, max_hp: this.maxHp, level: this.level, xp: this.xp,
      weapons: { ...this.weapons }, passives: { ...this.passives }, ppow: { ...this.ppow }, wbonus: { ...this.wbonus }, evolved: { ...this.evolved },
      kills: this.kills, boss_kills: this.bossKills, boss_spawned: this.bossSpawned, elite_idx: this.eliteIdx, spawn_acc: this.spawnAcc,
      lineage_lv: this.lineageLv, lpow: this.lpow,
      wraith_spawned: this.wraithSpawned, wraith_dead: this.wraithDead,
      fragments: this.fragments, branch: { ...this.branch }, sigils: [...this.sigils], curses: [...this.curses],
      rank: { ...this.rank }, undying_used: this.undyingUsed,
    };
  }

  restore(c: Snapshot): void {
    this.t = c.t;
    this.hp = c.hp;
    this.maxHp = c.max_hp;
    this.level = c.level;
    this.xp = c.xp;
    this.weapons = { ...c.weapons };
    this.passives = { ...c.passives };
    this.ppow = { ...c.ppow };
    this.wbonus = { ...c.wbonus };
    this.evolved = { ...c.evolved };
    this.kills = c.kills;
    this.bossKills = c.boss_kills;
    this.eliteIdx = c.elite_idx;
    this.spawnAcc = c.spawn_acc;
    this.lineageLv = c.lineage_lv ?? 0;
    this.lpow = c.lpow ?? 0;
    this.fragments = c.fragments ?? 0;
    this.branch = { ...(c.branch ?? {}) };
    this.sigils = [...(c.sigils ?? [])];
    this.curses = [...(c.curses ?? [])];
    this.rank = { ...(c.rank ?? { [this.mainWeapon]: 0 }) };
    this.undyingUsed = !!c.undying_used;
    this.dirtyTags();
    this.lastCheckpoint = this.t;
    this.rng.advance(Math.floor(this.t * 3)); // 乱数列を経過時間ぶん進めて、同じ seed の流れに乗せる
    if (c.boss_spawned) this.spawnBoss();
    this.wraithDead = !!c.wraith_dead;
    if (c.wraith_spawned) {
      if (this.wraithDead || !this.wraithRec) this.wraithSpawned = true;
      else this.spawnWraith();   // 倒しきる前に中断した時は、満タンで出直す
    }
    this.emit({ type: "toast", text: "中断したランを再開した" });
  }

  /** 出撃で選んだ亡霊（連れていく / 喰らう） */
  picks(): GhostPick[] {
    return [
      ...this.ghosts.map((g): GhostPick => ({ id: g.rec.ghost_id, mode: "bring" })),
      ...this.devours.map((d): GhostPick => ({ id: d.rec.ghost_id, mode: "devour" })),
    ];
  }

  summary(): Summary {
    return {
      run_id: this.run_id, seed: this.seed, mode: this.mode, t: this.t, run_len: this.runLen, main_weapon: this.mainWeapon,
      weapons: { ...this.weapons }, passives: { ...this.passives }, ppow: { ...this.ppow }, wbonus: { ...this.wbonus }, evolved: { ...this.evolved },
      level: this.level, kills: this.kills, boss_kills: this.bossKills, death_cause: this.deathCause, heirloom_id: this.heirloomId,
      lineage_id: this.lineage.id, ghosts: this.picks(), fragments: this.fragments, branch: { ...this.branch }, rank: { ...this.rank },
      wraith_id: this.wraithRec?.ghost_id ?? "", wraith_purified: this.wraithDead,
    };
  }

  checkpointDue(): boolean {
    if (this.result === "" && this.t - this.lastCheckpoint >= this.D.checkpoint_interval) {
      this.lastCheckpoint = this.t;
      return true;
    }
    return false;
  }
}
