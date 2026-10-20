// セーブに入るデータの形（戦闘ロジックとセーブの受け渡しに使う型）
import type { RunMode } from "../data/types.ts";

// wraith = 喰らわれて怨霊になった（穢れ1つ分）。祓うと purified
export type GhostStatus = "stored" | "reserved" | "consumed" | "released" | "pending" | "wraith" | "purified";
export type GhostMode = "bring" | "devour";
/** 出撃で選んだ亡霊（連れていく / 喰らう） */
export interface GhostPick { id: string; mode: GhostMode }

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
  weapon_branch?: "a" | "b";
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
  wraith_since?: string;
  stationed_at?: string;   // v4: 住んでいる施設（住んでいる間は連れていけない・喰らえない）
}

export interface HeirOption { type: "weapon" | "passive"; id: string; level: number }

export interface Heirloom extends HeirOption {
  heir_id: string;
  name: string;
  from_generation: number;
  status: "stored" | "reserved";
  reserved_by_run?: string;
}

/** 祭壇の樹から戦闘に渡す値 */
export interface CardMods {
  altar: number; affinity: Record<string, number>; seals: string[];
  ghost_atk?: number; devour_bonus?: number; taint_resist?: number;
  sigil_tier?: number; curses?: boolean;
}
/** 縁・封印の割り当て（樹で開いた枠の中で自由に付け外し） */
export interface Alloc { affinity: Record<string, number>; seals: string[] }

export type RunResult = "" | "player_death" | "boss_cleared" | "retired";

/** 中断復帰用（10秒ごとにセーブへ） */
export interface Snapshot {
  t: number; hp: number; max_hp: number; level: number; xp: number;
  weapons: Record<string, number>; passives: Record<string, number>; ppow: Record<string, number>;
  wbonus: Record<string, number>; evolved: Record<string, boolean>;
  kills: number; boss_kills: number; boss_spawned: boolean; elite_idx: number; spawn_acc: number;
  lineage_lv?: number; lpow?: number;
  wraith_spawned?: boolean; wraith_dead?: boolean;
  fragments?: number; branch?: Record<string, "a" | "b">; sigils?: string[]; curses?: string[];
}

/** ラン終了処理（MetaService.settle）に渡す要約 */
export interface Summary {
  run_id: string; seed: number; mode: RunMode; t: number; run_len: number; main_weapon: string;
  weapons: Record<string, number>; passives: Record<string, number>; ppow: Record<string, number>;
  wbonus: Record<string, number>; evolved: Record<string, boolean>;
  level: number; kills: number; boss_kills: number; death_cause: string; heirloom_id: string;
  lineage_id: string;
  ghosts: GhostPick[];
  fragments: number;
  branch: Record<string, "a" | "b">;
  wraith_id?: string; wraith_purified?: boolean;
}

export interface ActiveRun {
  run_id: string; seed: number; mode: RunMode; weapon: string; heirloom_id: string;
  lineage_id: string; started_at: string; checkpoint: Snapshot | null;
  ghosts: GhostPick[];      // v3: 最大2体（古いセーブの ghost_id / ghost_mode は migrate で移す）
  wraith_id?: string;       // このランに現れる怨霊（出撃時に決める）
  facility?: FacilityBuff;  // v4: 出撃時の施設の効果（再開しても変わらないよう出撃時に写す）
}

/** 施設から戦闘に渡す効果 */
export interface FacilityBuff { tags: string[]; ghost_atk: number; hp: number; offer: number }

export interface RunRecord {
  run_id: string; seed: number; mode: RunMode; duration_seconds: number; result: RunResult;
  selected_ghost_id: string; player_build: { weapons: Record<string, number>; passives: Record<string, number> };
  player_level: number; kills: number; boss_kills: number; ended_at: string;
  consumed_ghost: string; new_ghost_id: string; new_ghost?: string; new_ghost_pending: boolean;
  used_heirloom: string; offerings: number; generation: number;
  lineage_id: string; unlocked_lineages: string[];
  ghost_mode?: GhostMode; devoured?: string; purified?: string; wraith_escaped?: string;
  companions?: string[];                        // 一緒に戦って保管庫へ戻った亡霊
  devoured_all?: string[];
  ghost_failed?: "" | "time" | "fragments";     // 亡霊になれなかった理由
  fragments?: number;
  facility_offer?: number;                      // 鎮魂堂で増えた供物
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
    mourned_count: number;                       // v4: 弔った回数（供養塔）
  };
  lineages: string[];                            // 解放済みの家系
  offerings: { earned: number; mourned: number };   // mourned = 弔って得た分（earned に含む）
  tree: string[];                                     // 開いた節
  alloc: Alloc;
  heirlooms: Heirloom[];
  heir_seq: number;
  buildings: string[];                           // v4: 建てた施設（戻せない）
}
