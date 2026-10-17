// セーブに入るデータの形（戦闘ロジックとセーブの受け渡しに使う型）
import type { RunMode } from "../data/types.ts";

export type GhostStatus = "stored" | "reserved" | "consumed" | "released" | "pending";

export interface GhostRecord {
  ghost_id: string;
  origin_run_id: string;
  created_at: string;
  display_name: string;
  survival_seconds: number;
  run_length: number;
  tier_id: string;
  primary_weapon_id: string;
  weapon_level: number;
  evolved: boolean;
  passive_id: string;
  passive_level: number;
  kills: number;
  boss_kills: number;
  death_cause_id: string;
  stat_snapshot: { attack_mult: number; attack_speed: number; area: number };
  data_version: number;
  lineage_id?: string;
  status: GhostStatus;
  reserved_by_run?: string;
  consumed_by_run?: string;
  consumed_at?: string;
}

export interface HeirOption { type: "weapon" | "passive"; id: string; level: number }

export interface Heirloom extends HeirOption {
  heir_id: string;
  name: string;
  from_generation: number;
  status: "stored" | "reserved";
  reserved_by_run?: string;
}

export interface CardMods { altar: number; affinity: Record<string, number>; seals: string[] }

export type RunResult = "" | "player_death" | "boss_cleared" | "retired";

/** 中断復帰用（10秒ごとにセーブへ） */
export interface Snapshot {
  t: number; hp: number; max_hp: number; level: number; xp: number;
  weapons: Record<string, number>; passives: Record<string, number>; ppow: Record<string, number>;
  wbonus: Record<string, number>; evolved: Record<string, boolean>;
  kills: number; boss_kills: number; boss_spawned: boolean; elite_idx: number; spawn_acc: number;
  lineage_lv?: number; lpow?: number;
}

/** ラン終了処理（MetaService.settle）に渡す要約 */
export interface Summary {
  run_id: string; seed: number; mode: RunMode; t: number; run_len: number; main_weapon: string;
  weapons: Record<string, number>; passives: Record<string, number>; ppow: Record<string, number>;
  wbonus: Record<string, number>; evolved: Record<string, boolean>;
  level: number; kills: number; boss_kills: number; death_cause: string; ghost_id: string; heirloom_id: string;
  lineage_id: string;
}

export interface ActiveRun {
  run_id: string; seed: number; mode: RunMode; weapon: string; ghost_id: string; heirloom_id: string;
  lineage_id: string; started_at: string; checkpoint: Snapshot | null;
}

export interface RunRecord {
  run_id: string; seed: number; mode: RunMode; duration_seconds: number; result: RunResult;
  selected_ghost_id: string; player_build: { weapons: Record<string, number>; passives: Record<string, number> };
  player_level: number; kills: number; boss_kills: number; ended_at: string;
  consumed_ghost: string; new_ghost_id: string; new_ghost?: string; new_ghost_pending: boolean;
  used_heirloom: string; offerings: number; generation: number;
  lineage_id: string; unlocked_lineages: string[];
}

export interface SaveData {
  schema_version: number;
  data_version: number;
  ghost_seq: number;
  ghosts: GhostRecord[];
  run_history: RunRecord[];
  settled_runs: string[];
  active_run: ActiveRun | null;
  pending_ghost: GhostRecord | null;
  pending_heirloom: { run_id: string; generation: number; options: HeirOption[] } | null;
  progress: {
    clears: number; deaths: number; runs: number; generation: number; total_survival: number;
    companion_runs: number;                      // 亡霊を連れて出撃して終えたラン数（墓守の解放条件）
    best_weapon_level: Record<string, number>;   // 武器ごとの最高Lv（火守の解放条件）
  };
  lineages: string[];                            // 解放済みの家系
  offerings: { earned: number };
  alloc: CardMods;
  heirlooms: Heirloom[];
  heir_seq: number;
}
