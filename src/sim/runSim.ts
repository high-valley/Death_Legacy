// 1回のランの戦闘ロジック。DOM・描画・入力・セーブに依存しない。
// 固定ステップ(1/60秒)で進めるので、同じ seed＋同じ入力なら同じ結果になる。
// 表示や効果音への通知は events キュー、セーブへの受け渡しは summary() / snapshot()。
import { RngStreams } from "../core/rng.ts";
import { SpatialGrid, pushPair } from "../core/spatialGrid.ts";
import type { Balance, EnemyDef, Lineage, Rarity, RarityId, RunMode } from "../data/types.ts";
import type { CardMods, GhostMode, GhostRecord, Heirloom, RunResult, Snapshot, Summary } from "../meta/records.ts";

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
  phase = 0;
  constructor(rec: GhostRecord) {
    this.rec = rec;
  }
}

export interface Shot { x: number; y: number; vx: number; vy: number; dmg: number; pierce: number; life: number; ghost: boolean; hit: Set<Foe> }
export interface EShot { x: number; y: number; vx: number; vy: number; dmg: number; life: number; cause: string }
export interface Zone { x: number; y: number; r: number; dmg: number; life: number; tick: number; ghost: boolean }
export interface Gem { x: number; y: number; v: number; mag: boolean }

export type SimEvent =
  | { type: "fx"; kind: "arc"; x: number; y: number; a: number; r: number; arc: number; dur: number; ghost: boolean }
  | { type: "fx"; kind: "warn" | "boom"; x: number; y: number; r: number; dur: number }
  | { type: "fx"; kind: "poof"; x: number; y: number; dur: number; color: string }
  | { type: "sfx"; name: string }
  | { type: "toast"; text: string }
  | { type: "shake"; amount: number };

export type CardKind = "weapon" | "passive" | "lineage" | "heal";
export interface Card { kind: CardKind; id: string; lv: number; rar: RarityId }
type Option = Omit<Card, "rar">;

export interface RunOpts {
  run_id?: string;
  seed?: number;
  mode?: RunMode;
  weapon?: string;
  lineage?: string;
  ghost?: GhostRecord | null;
  heirloom?: Heirloom | null;
  card_mods?: CardMods;
  checkpoint?: Snapshot | null;
  /** 喰らった亡霊（同行はしない。力だけを取り込む） */
  devour?: Devour | null;
  /** このランに現れる怨霊 */
  wraith?: GhostRecord | null;
  /** 穢れによる敵HPの増分（0.12 = +12%） */
  taint_hp?: number;
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
  ghostId = "";
  heirloomId = "";
  solo: boolean;
  ghostMode: GhostMode = "bring";
  devour: Devour | null = null;
  wraithRec: GhostRecord | null = null;
  wraith: Foe | null = null;
  wraithSpawned = false;
  wraithDead = false;
  taintHp = 0;
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

  readonly hero = new Hero();
  ghost: Companion | null = null;
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
    this.lineage = D.lineages.find((l) => l.id === o.lineage) ?? D.lineages[0];
    this.mainWeapon = this.lineage.weapon ?? o.weapon ?? "sword";
    if (o.card_mods) this.cardMods = o.card_mods;
    this.rng = new RngStreams(this.seed);
    this.hero.r = D.player.radius;
    this.maxHp = Math.round(D.player.hp * (1 + (this.lineage.mods.max_hp ?? 0)));
    this.hp = this.maxHp;
    this.weapons[this.mainWeapon] = 1;
    if (o.ghost) {
      this.ghost = new Companion(structuredClone(o.ghost));
      this.ghostId = o.ghost.ghost_id;
    }
    if (o.devour && !this.ghost) {
      this.devour = { rec: structuredClone(o.devour.rec), might: o.devour.might, hp: o.devour.hp };
      this.ghostId = o.devour.rec.ghost_id;
      this.ghostMode = "devour";
      this.maxHp = Math.round(this.maxHp * (1 + this.devour.hp));
      this.hp = this.maxHp;
    }
    this.solo = this.ghost === null && this.devour === null;
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
    const lv = Math.min(cap, h.level + (this.lineage.mods.heir_level_bonus ?? 0));
    if (h.type === "weapon") {
      this.weapons[h.id] = Math.max(this.weapons[h.id] ?? 0, lv);
    } else {
      this.passives[h.id] = lv;
      this.ppow[h.id] = lv;
      if (h.id === "vigor") {
        this.maxHp += 20 * lv;
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
  xpNeed(): number { return this.D.xp.base + this.level * this.D.xp.per_level; }
  pw(id: string): number { return this.ppow[id] ?? 0; }
  mightMul(): number { return (1 + 0.12 * this.pw("might")) * (1 + (this.devour?.might ?? 0)); }
  hasteMul(): number { return 1 / (1 + 0.1 * this.pw("haste")); }
  areaMul(): number { return 1 + 0.12 * this.pw("area"); }

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
    return this.evolved[id] ? this.D.evolutions[id].name : this.D.weapons[id].name;
  }

  // ---------------------------------------------------------------- weapons
  /** プレイヤーと亡霊が同じ武器コードを使う */
  fireWeapon(id: string, lv: number, ox: number, oy: number, fx: number, fy: number, dmgMul: number, area: number, isGhost: boolean, evo: boolean): boolean {
    const W = this.D.weapons[id];
    const tgt = this.grid.nearest(ox, oy, 520);
    if (id === "sword") {
      let dx = fx, dy = fy;
      if (tgt) {
        const l = Math.hypot(tgt.x - ox, tgt.y - oy) || 1;
        dx = (tgt.x - ox) / l; dy = (tgt.y - oy) / l;
      }
      const reach = (W.range ?? 90) * area * (1 + 0.1 * (lv - 1)) * (evo ? 1.3 : 1);
      const dmg = W.damage * dmgMul * (1 + 0.25 * (lv - 1));
      const arc = evo ? TAU + 0.01 : (W.arc ?? 1.9);
      const dirs = evo || lv < 3 ? [1] : [1, -1];
      for (const s of dirs) {
        const a0 = Math.atan2(dy * s, dx * s);
        const list = this.grid.query(ox, oy, reach + 30);
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (e.dead || Math.hypot(e.x - ox, e.y - oy) > reach + e.r) continue;
          if (Math.abs(angleDiff(a0, Math.atan2(e.y - oy, e.x - ox))) < arc / 2) this.hurt(e, dmg);
        }
        this.emit({ type: "fx", kind: "arc", x: ox, y: oy, a: a0, r: reach, arc: Math.min(arc, TAU), dur: 0.18, ghost: isGhost });
      }
    } else if (id === "bow") {
      if (!tgt) return false;
      const n = 1 + Math.floor((lv - 1) / 2) + (evo ? 3 : 0);
      const dmg = W.damage * dmgMul * (1 + 0.2 * (lv - 1));
      const base = Math.atan2(tgt.y - oy, tgt.x - ox);
      const sp = W.speed ?? 560;
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * 0.16;
        this.shots.push({ x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg, pierce: evo ? 3 : lv >= 4 ? 2 : 0, life: 1, ghost: isGhost, hit: new Set() });
      }
    } else if (id === "fire") {
      if (!tgt) return false;
      const n = evo ? 3 : lv >= 4 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const at = i === 0 || this.enemies.length === 0 ? tgt : this.enemies[this.rng.misc.randi(this.enemies.length)];
        const fa = isGhost ? 0 : this.mod("fire_area"), fb = isGhost ? 0 : this.mod("fire_burn");
        this.zones.push({
          x: at.x, y: at.y, r: (W.radius ?? 68) * area * (1 + 0.08 * (lv - 1)) * (evo ? 1.4 : 1) * (1 + fa),
          dmg: W.damage * dmgMul * (1 + 0.3 * (lv - 1)), life: (W.burn ?? 2.6) * (evo ? 1.5 : 1) * (1 + fb), tick: 0, ghost: isGhost,
        });
      }
    }
    return true;
  }

  private hurt(e: Foe, d: number): void {
    if (e.dead) return;
    e.hp -= d;
    e.flash = 0.07;
    if (this.rng.misc.randf() < 0.08) this.emit({ type: "sfx", name: "hit" });
  }

  hurtPlayer(d: number, cause: string): void {
    if (this.result !== "" || this.hero.iframe > 0) return;
    this.hp -= d;
    this.hero.iframe = this.D.player.hit_iframe;
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
    h.dashCd = this.D.player.dash_cd;
    h.iframe = Math.max(h.iframe, this.D.player.dash_time + 0.08);
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
    let scale = (1 + this.D.spawn.hp_growth * this.progress()) * (1 + this.taintHp);
    if (kind === "boss") scale = this.mode === "short" ? (def.short_hp_mult ?? 1) : 1;
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
    e.maxHp = (base.hp + W.hp_per_mult * tier.mult) * (this.mode === "short" ? W.short_hp_mult : 1);
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
    if (this.eliteIdx < S.elites_at.length && p >= S.elites_at[this.eliteIdx]) {
      this.spawnEnemy("elite");
      this.eliteIdx++;
      this.emit({ type: "toast", text: "墓暴きが来る" });
    }
    this.spawnAcc += dt * (S.base_per_sec + S.per_progress * p) * (this.bossSpawned ? S.boss_phase_rate : 1);
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
    const ml = Math.hypot(mx, my);
    let ux = 0, uy = 0;
    if (ml > 0.01) {
      // 倒し具合にかかわらず常に全速（少しでも倒せば即座にその向きへ全速で動く）
      ux = mx / ml; uy = my / ml;
      h.fx = ux; h.fy = uy;
    }
    const speed = D.player.speed * (1 + 0.08 * this.pw("swift")) * (1 + this.mod("speed"));
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
          const ok = this.fireWeapon(id, lv, h.x, h.y, h.fx, h.fy, this.mightMul() * (1 + (this.wbonus[id] ?? 0)) * grit, this.areaMul(), false, !!this.evolved[id]);
          h.cds[id] = ok ? D.weapons[id].cd * this.hasteMul() * (1 - 0.06 * (lv - 1)) : 0.2;
        }
      }
      if (this.ghost) this.ghostUpdate(dt);
    }

    for (const s of this.shots) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      const list = this.grid.query(s.x, s.y, 30);
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (s.life <= 0 || e.dead || s.hit.has(e)) continue;
        if (Math.hypot(e.x - s.x, e.y - s.y) < e.r + 4) {
          this.hurt(e, s.dmg);
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

    const pick = D.player.pickup * (1 + 0.25 * this.pw("magnet"));
    const xpMul = this.solo ? 1 + D.solo_xp_bonus * (1 + this.mod("solo_xp")) : 1;
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

  private ghostUpdate(dt: number): void {
    const g = this.ghost!, h = this.hero;
    g.phase += dt;
    const tx = h.x - h.fx * 46 + Math.cos(g.phase) * 14;
    const ty = h.y - h.fy * 46 + Math.sin(g.phase * 1.3) * 10;
    const k = Math.min(1, dt * 5);
    g.x += (tx - g.x) * k;
    g.y += (ty - g.y) * k;
    g.cd -= dt;
    if (g.cd <= 0) {
      const r = g.rec, s = r.stat_snapshot, wid = r.primary_weapon_id, lv = r.weapon_level;
      const ok = this.fireWeapon(wid, lv, g.x, g.y, 1, 0, s.attack_mult * this.ghostUnlock() * (1 + this.mod("ghost_atk")) * (1 + (this.cardMods.ghost_atk ?? 0)), s.area, true, !!r.evolved);
      // 鎮魂の鐘: 亡霊の攻撃間隔が短くなる
      const bell = this.lineage.card.id === "bell" ? Math.max(0.4, 1 - this.cardPower()) : 1;
      g.cd = ok ? (this.D.weapons[wid].cd / s.attack_speed) * (1 - 0.06 * (lv - 1)) * bell : 0.25;
    }
  }

  private enemyUpdate(e: Foe, dt: number): void {
    const h = this.hero;
    const ox = h.x - e.x, oy = h.y - e.y;
    const d = Math.max(Math.hypot(ox, oy), 0.001);
    const ux = ox / d, uy = oy / d;
    const def = e.def;
    const sp = def.speed;
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
          this.eshots.push({ x: e.x, y: e.y, vx: ux * bs, vy: uy * bs, dmg: def.damage, life: 2.2, cause: "shooter" });
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
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    if (d < e.r + h.r) this.hurtPlayer(def.damage, e.kind);
  }

  // ---------------------------------------------------------------- cards
  cardPool(): Option[] {
    const D = this.D;
    const opts: Option[] = [];
    let subs = 0;
    for (const w in this.weapons) if (w !== this.mainWeapon) subs++;
    const seals = this.cardMods.seals ?? [];
    for (const id in D.weapons) {
      const lv = this.weapons[id] ?? 0;
      if (lv > 0 && (lv < D.weapon_max_level || !this.evolved[id])) opts.push({ kind: "weapon", id, lv });
      else if (lv === 0 && subs < D.sub_weapon_slots && !seals.includes(id)) opts.push({ kind: "weapon", id, lv: 0 }); // 封印は新規取得だけを止める
    }
    const nPass = Object.keys(this.passives).length;
    for (const id in D.passives) {
      const lv = this.passives[id] ?? 0;
      if (lv > 0 && lv < D.passive_max_level) opts.push({ kind: "passive", id, lv });
      else if (lv === 0 && nPass < D.passive_slots && !seals.includes(id)) opts.push({ kind: "passive", id, lv: 0 });
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

  /** 3択。書庫の「縁」で出やすさ、祭壇の段階でレア度の重みが変わる */
  rollChoices(): Card[] {
    const opts = this.cardPool();
    const out: Card[] = [];
    const aff = this.cardMods.affinity ?? {};
    const step = this.D.library.affinity_step;
    while (out.length < 3 && opts.length > 0) {
      const ws = opts.map((o) => 1 + (aff[o.id] ?? 0) * step);
      const total = ws.reduce((a, b) => a + b, 0);
      let r = this.rng.cards.randf() * total;
      let idx = 0;
      for (let i = 0; i < ws.length; i++) {
        idx = i;
        r -= ws[i];
        if (r <= 0) break;
      }
      const o = opts.splice(idx, 1)[0];
      let rar = this.rollRarity();
      if (rar === "LR" && o.kind === "weapon" && (o.lv === 0 || this.evolved[o.id])) rar = "UR"; // 進化は所持武器だけ
      out.push({ ...o, rar });
    }
    if (out.length === 0) out.push({ kind: "heal", id: "", lv: 0, rar: "N" });
    return out;
  }

  rarity(id: RarityId): Rarity {
    return this.D.rarities.find((r) => r.id === id) ?? this.D.rarities[0];
  }

  describe(c: Card): { k: string; n: string; d: string } {
    const D = this.D, R = this.rarity(c.rar);
    if (c.kind === "weapon") {
      const W = D.weapons[c.id], lv = c.lv, maxlv = D.weapon_max_level;
      if (R.evolve && lv > 0 && !this.evolved[c.id]) {
        const E = D.evolutions[c.id];
        return { k: `武器進化 Lv${lv} → ${Math.min(maxlv, lv + 1)}`, n: `${W.name} → ${E.name}`, d: E.desc };
      }
      if (lv >= maxlv) return { k: "武器 最大Lv", n: W.name, d: `${W.name}のダメージ +${Math.round(D.maxed_weapon_bonus[c.rar] * 100)}%` };
      const to = Math.min(maxlv, lv + R.wlv);
      const head = lv > 0 ? `武器 Lv${lv} → ${to}` : c.id === this.mainWeapon ? "メイン武器" : `サブ武器を追加（Lv${to}）`;
      const extra = R.wbonus > 0 ? `\nさらに${W.name}のダメージ +${Math.round(R.wbonus * 100)}%` : "";
      return { k: head, n: W.name, d: (lv > 0 ? weaponLevelText(c.id, to) : W.desc) + extra };
    }
    if (c.kind === "lineage") {
      const L = this.lineage.card;
      return { k: c.lv > 0 ? `${this.lineage.name}の札 Lv${c.lv} → ${c.lv + 1}` : `${this.lineage.name}の札`, n: L.name, d: L.fmt.replace("{v}", String(Math.round(L.per * R.pmul))) };
    }
    if (c.kind === "passive") {
      const P = D.passives[c.id];
      const head = c.lv > 0 ? `パッシブ Lv${c.lv} → ${c.lv + 1}` : "パッシブを追加";
      return { k: head, n: P.name, d: P.fmt.replace("{v}", String(Math.round(P.per * R.pmul))) };
    }
    return { k: "全強化済み", n: "回復", d: "HP +30" };
  }

  applyChoice(c: Card): void {
    const D = this.D, R = this.rarity(c.rar ?? "N"), maxlv = D.weapon_max_level;
    if (c.kind === "weapon") {
      const lv = this.weapons[c.id] ?? 0;
      if (R.evolve && lv > 0 && !this.evolved[c.id]) {
        this.evolved[c.id] = true;
        this.weapons[c.id] = Math.min(maxlv, lv + 1);
      } else if (lv >= maxlv) {
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
        const add = Math.round(20 * R.pmul);
        this.maxHp += add;
        this.hp = Math.min(this.maxHp, this.hp + add);
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
      return `${this.weaponName(id)}${id === this.mainWeapon ? "(メイン)" : ""} Lv${this.weapons[id]}${b > 0 ? ` +${Math.round(b * 100)}%` : ""}`;
    });
    const p = Object.keys(this.passives).map((id) => `${D.passives[id].name} Lv${this.passives[id]}`);
    const l = this.lineageLv > 0 ? `　/　${this.lineage.card.name} Lv${this.lineageLv}` : "";
    return `武器: ${w.join("・")}　/　パッシブ(${p.length}/${D.passive_slots}): ${p.length ? p.join("・") : "なし"}${l}`;
  }

  // ---------------------------------------------------------------- save bridge
  snapshot(): Snapshot {
    return {
      t: this.t, hp: this.hp, max_hp: this.maxHp, level: this.level, xp: this.xp,
      weapons: { ...this.weapons }, passives: { ...this.passives }, ppow: { ...this.ppow }, wbonus: { ...this.wbonus }, evolved: { ...this.evolved },
      kills: this.kills, boss_kills: this.bossKills, boss_spawned: this.bossSpawned, elite_idx: this.eliteIdx, spawn_acc: this.spawnAcc,
      lineage_lv: this.lineageLv, lpow: this.lpow,
      wraith_spawned: this.wraithSpawned, wraith_dead: this.wraithDead,
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

  summary(): Summary {
    return {
      run_id: this.run_id, seed: this.seed, mode: this.mode, t: this.t, run_len: this.runLen, main_weapon: this.mainWeapon,
      weapons: { ...this.weapons }, passives: { ...this.passives }, ppow: { ...this.ppow }, wbonus: { ...this.wbonus }, evolved: { ...this.evolved },
      level: this.level, kills: this.kills, boss_kills: this.bossKills, death_cause: this.deathCause, ghost_id: this.ghostId, heirloom_id: this.heirloomId,
      lineage_id: this.lineage.id, ghost_mode: this.ghostMode,
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

function weaponLevelText(id: string, lv: number): string {
  if (id === "sword") return lv === 3 ? "前後同時に斬る" : "ダメージ・範囲・速度アップ";
  if (id === "bow") return lv === 4 ? "矢が貫通する" : lv % 2 === 1 ? "矢が1本増える" : "ダメージ・速度アップ";
  return lv === 4 ? "炎が2か所に落ちる" : "ダメージ・範囲アップ";
}
