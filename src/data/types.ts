// data/balance.json の型。バランス値はコードに書かず、すべてここから参照する。

export interface Tier { id: string; name: string; from: number; mult: number; rank: string; color: string }
/** 武器の段階（グレード）。lv 以上で持ち替え、evo はレジェンドレアで進化した最終段階。数値は武器の基本値への倍率 */
export interface WeaponGrade {
  branch?: "a" | "b";  // Lv3 で選ぶ道
  lv?: number; evo?: boolean; name: string; desc: string; cd: number; dmg: number;
  range?: number; arc?: number; dirs?: number; count?: number; pierce?: number; speed?: number;
  radius?: number; burn?: number; length?: number; width?: number; size?: number;
  freeze?: number;   // 氷: 凍らせる秒数
  chain?: number;    // 雷: 1筋で当たる敵の数
}
export interface Weapon {
  name: string; desc: string; cd: number; damage: number; per_level: number; grades: WeaponGrade[]; tags: string[];
  range?: number; speed?: number; radius?: number; burn?: number; tick?: number; length?: number; width?: number; size?: number;
  slow?: number; slow_time?: number;   // 氷: 移動速度の倍率と時間
  jump?: number;                       // 雷: 飛び移れる距離
}
export interface Passive { name: string; per: number; fmt: string; tag?: string }

/** タグ（属性）とセット効果。mods はそのタグの武器（霊は亡霊）にかかる */
export interface TagSet { at: number; text: string; mods: Record<string, number> }
export interface TagDef { name: string; color: string; sets: TagSet[] }
export interface Sigil { id: string; tier: number; name: string; desc: string; need?: string }
export interface Curse { id: string; name: string; desc: string; mods: Record<string, number> }
export interface Rarity { id: RarityId; name: string; weight: number; color: string; wlv: number; wbonus: number; pmul: number; evolve?: boolean }
export type RarityId = "N" | "R" | "SR" | "UR" | "LR";
export interface EnemyDef {
  name: string; hp: number; speed: number; radius: number; damage: number; xp: number;
  ai: "chase" | "charge" | "shoot" | "boss" | "wraith"; color: string;
  dash_speed?: number; range?: number; interval?: number; bullet_speed?: number; short_hp_mult?: number;
  slam?: { damage: number; radius: number; windup: number };
  nova?: { count: number; speed: number; damage: number };
  cycle?: number;
}

export interface LineageCard { id: string; name: string; max: number; per: number; fmt: string }
export type LineageUnlock =
  | { type: "weapon_level"; weapon: string; level: number; text: string }
  | { type: "companion_runs"; count: number; text: string };
export interface LineageMods {
  heir_level_bonus?: number; fire_area?: number; fire_burn?: number; max_hp?: number;
  ghost_unlock_step?: number; ghost_atk?: number; solo_xp?: number; speed?: number;
}
export interface Lineage {
  id: string; name: string; motto: string; trait: string; weakness: string;
  weapon: string | null; mods: LineageMods; card: LineageCard; unlock: LineageUnlock | null;
}

/** 祭壇の樹の節。effect の値は開いた節の分だけ足し合わせる */
export interface TreeEffect {
  altar?: number; affinity_pts?: number; seal_slots?: number; ghost_atk?: number;
  ghost_slots?: number; sigil_tier?: number; curses?: number;
  devour_bonus?: number; taint_resist?: number; mourn_bonus?: number;
}
export interface TreeNode {
  id: string; name: string; x: number; y: number; cost: number; parents: string[]; desc: string;
  req_survival?: number; effect: TreeEffect;
}
export interface Rites {
  devour: { might_per_mult: number; hp_per_mult: number };
  mourn: { base: number; per_mult: number };
  wraith: { at: number; hp_per_mult: number; short_hp_mult: number; purify_offerings: number; enemy_hp_per_taint: number };
}

export interface Balance {
  schema_version: number;
  data_version: number;
  run_length: Record<"full" | "short", number>;
  vault_capacity: number;
  solo_xp_bonus: number;
  tiers: Tier[];
  ghost_unlock: [number, number][];
  player: { weapon_mult: number; hp: number; speed: number; radius: number; dash_speed: number; dash_time: number; dash_cd: number; hit_iframe: number; pickup: number };
  xp: { base: number; per_level: number };
  weapons: Record<string, Weapon>;
  weapon_max_level: number;
  evolve_min_level: number;   // レジェンドレアで進化できる最低Lv
  sub_weapon_slots: number;
  passives: Record<string, Passive>;
  passive_slots: number;
  passive_max_level: number;
  rarities: Rarity[];
  maxed_weapon_bonus: Record<RarityId, number>;
  offerings: { per_tenth_survived: number; per_100_kills: number; clear_bonus: number; retire_rate: number };
  altar: { max: number; shift: Record<RarityId, number> };
  library: { affinity_step: number; affinity_max: number };
  tree: TreeNode[];
  rites: Rites;
  shelf: { unlock_generation: number; capacity: number; max_level: number };
  enemies: Record<string, EnemyDef>;
  spawn: {
    base_per_sec: number; per_progress: number; max_alive: number; hp_growth: number; shooter_from: number; charger_from: number;
    shooter_share: number; charger_share: number; elites_at: number[]; boss_phase_rate: number;
  };
  checkpoint_interval: number;
  lineages: Lineage[];
  tags: Record<string, TagDef>;
  tag_points: { hero_weapon: number; ghost_weapon: number; ghost_spirit: number; passive_level: number };
  sigils: Sigil[];
  sigil_chance: number;
  curses: Curse[];
  curse_chance: number;
  ghost_slots: { base: number; max: number };
  ghost_birth: { fragments: number; min_survival: number; drops: Record<string, number> };
}

export type RunMode = "full" | "short";
