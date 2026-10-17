// data/balance.json の型。バランス値はコードに書かず、すべてここから参照する。

export interface Tier { id: string; name: string; from: number; mult: number; color: string }
export interface Weapon { name: string; desc: string; cd: number; damage: number; range?: number; arc?: number; speed?: number; radius?: number; burn?: number; tick?: number }
export interface Passive { name: string; per: number; fmt: string }
export interface Rarity { id: RarityId; name: string; weight: number; color: string; wlv: number; wbonus: number; pmul: number; evolve?: boolean }
export type RarityId = "N" | "R" | "SR" | "UR" | "LR";
export interface EnemyDef {
  name: string; hp: number; speed: number; radius: number; damage: number; xp: number;
  ai: "chase" | "charge" | "shoot" | "boss"; color: string;
  dash_speed?: number; range?: number; interval?: number; bullet_speed?: number; short_hp_mult?: number;
  slam?: { damage: number; radius: number; windup: number };
  nova?: { count: number; speed: number; damage: number };
  cycle?: number;
}

export interface Balance {
  schema_version: number;
  data_version: number;
  run_length: Record<"full" | "short", number>;
  vault_capacity: number;
  solo_xp_bonus: number;
  tiers: Tier[];
  ghost_unlock: [number, number][];
  player: { hp: number; speed: number; radius: number; dash_speed: number; dash_time: number; dash_cd: number; hit_iframe: number; pickup: number };
  xp: { base: number; per_level: number };
  weapons: Record<string, Weapon>;
  weapon_max_level: number;
  sub_weapon_slots: number;
  passives: Record<string, Passive>;
  passive_slots: number;
  passive_max_level: number;
  rarities: Rarity[];
  maxed_weapon_bonus: Record<RarityId, number>;
  evolutions: Record<string, { name: string; desc: string }>;
  offerings: { per_tenth_survived: number; per_100_kills: number; clear_bonus: number; retire_rate: number };
  altar: { max: number; shift: Record<RarityId, number> };
  library: { unlock_total_survival: number; affinity_step: number; affinity_max: number; seal_cost: number; seal_max: number };
  shelf: { unlock_generation: number; capacity: number; max_level: number };
  enemies: Record<string, EnemyDef>;
  spawn: {
    base_per_sec: number; per_progress: number; max_alive: number; hp_growth: number; shooter_from: number; charger_from: number;
    shooter_share: number; charger_share: number; elites_at: number[]; boss_phase_rate: number;
  };
  checkpoint_interval: number;
}

export type RunMode = "full" | "short";
