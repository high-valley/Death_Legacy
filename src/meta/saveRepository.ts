// セーブの読み書き。
//   書き込み: 一時領域に書く → 読み戻して検証 → 旧データを .bak に退避 → 本体へ置き換え
//   読み込み: 本体が壊れていれば .bak から復元
// ブラウザでは localStorage、テストではメモリ、将来の Steam 版（Electron）ではファイルに差し替える。
import { legacyWeapon } from "../data/weapons.ts";
import type { GhostRecord, SaveData, Snapshot } from "./records.ts";

/** 形見（2026-10-22 になくした）の古いデータの形。移行のためだけに使う */
interface OldHeir { type: "weapon" | "passive"; level: number; name?: string }
type OldSave = SaveData & { heirlooms?: OldHeir[]; pending_heirloom?: { options: OldHeir[] } | null; heir_seq?: number };

export const SCHEMA_VERSION = 7;

/** localStorage と同じ形の保存先 */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export class MemoryKV implements KV {
  readonly m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
}

export function freshSave(dataVersion = 1): SaveData {
  return {
    schema_version: SCHEMA_VERSION, data_version: dataVersion,
    ghost_seq: 0, ghosts: [], run_history: [], settled_runs: [],
    active_run: null, pending_ghost: null, pending_ghost_kind: "",
    progress: { clears: 0, deaths: 0, runs: 0, generation: 0, total_survival: 0, companion_runs: 0, best_weapon_level: {}, mourned_count: 0 },
    lineages: ["nameless"],
    offerings: { earned: 0, mourned: 0 }, tree: [], alloc: { affinity: {}, seals: [] },
    buildings: [],
  };
}

export function isValidSave(d: unknown): d is SaveData {
  if (typeof d !== "object" || d === null) return false;
  const o = d as Record<string, unknown>;
  return "schema_version" in o && Array.isArray(o.ghosts) && Array.isArray(o.run_history);
}

/** schema_version を上げる時は、ここに段階的な変換（v1 → v2 → …）を足す */
export function migrate(d: SaveData): SaveData {
  // v1 → v2: 祭壇（段階）と書庫（縁・封印に供物を払う）を「祭壇の樹」に統合。払っていた供物はすべて戻し、樹は何も開いていない状態にする
  if ((d.schema_version ?? 1) < 2) {
    d.tree = [];
    d.alloc = { affinity: {}, seals: [] };
  }
  // v5 → v6: 亡霊の等級をなくした（ADR 025）。名前の等級名を「亡霊」に、入れ替え待ちの亡霊は満杯の入れ替えとして扱う
  if ((d.schema_version ?? 1) < 6) {
    for (const g of [...(d.ghosts ?? []), ...(d.pending_ghost ? [d.pending_ghost] : [])]) {
      if (typeof g.display_name === "string") g.display_name = g.display_name.replace(/の(伝説の英霊|大英霊|英霊|戦霊|下級霊|残響)$/, "の亡霊");
    }
    if (d.pending_ghost && !d.pending_ghost_kind) d.pending_ghost_kind = "full";
  }
  // 世代（第N代）の表示はなくした（2026-10-22）。名前に残っている「第N代・」「第N代の」を外す（何度読み込んでも同じ結果）
  for (const g of [...(d.ghosts ?? []), ...(d.pending_ghost ? [d.pending_ghost] : [])]) {
    if (typeof g.display_name === "string") g.display_name = g.display_name.replace(/^第\d+代・/, "");
  }
  // v4 → v5: 武器のランクとレベルを分けた（ADR 024）。古い武器Lv（1〜5）→ ランク＋新しいレベル（1〜20）、パッシブLv（〜5）→ 〜8
  if ((d.schema_version ?? 1) < 5) migrateLevels(d);
  // v3 → v4: 施設。弔った回数は、残っている記録（弔うと consumed_at が付く）から数える
  const oldMourned = (d.schema_version ?? 1) < 4 ? (d.ghosts ?? []).filter((g) => g.status === "released" && !!g.consumed_at).length : -1;
  const base = freshSave() as unknown as Record<string, unknown>;
  const o = d as unknown as Record<string, unknown>;
  for (const k of Object.keys(base)) if (!(k in o)) o[k] = structuredClone(base[k]);
  for (const k of ["progress", "alloc", "offerings"] as const) {
    const b = base[k] as Record<string, unknown>, cur = o[k] as Record<string, unknown>;
    for (const kk of Object.keys(b)) if (!(kk in cur)) cur[kk] = structuredClone(b[kk]);
  }
  if (!Array.isArray(d.lineages) || d.lineages.length === 0) d.lineages = ["nameless"];
  if (d.active_run && !d.active_run.lineage_id) d.active_run.lineage_id = "nameless";
  // v2 → v3: 出撃中の亡霊を ghosts 配列に（亡霊は消費しない仕様に変わった。すでに消費済みのものはそのまま）
  if (d.active_run && !Array.isArray(d.active_run.ghosts)) {
    const old = d.active_run as unknown as { ghost_id?: string; ghost_mode?: "bring" | "devour" };
    d.active_run.ghosts = old.ghost_id ? [{ id: old.ghost_id, mode: old.ghost_mode ?? "bring" }] : [];
    delete old.ghost_id; delete old.ghost_mode;
  }
  if (!Array.isArray(d.tree)) d.tree = [];
  if (!Array.isArray(d.buildings)) d.buildings = [];
  if (oldMourned >= 0) d.progress.mourned_count = Math.max(d.progress.mourned_count ?? 0, oldMourned);
  // v6 → v7: 形見をなくした（2026-10-22）。古い形見・形見の候補は捨てる（出撃中のランの形見の効果は、もう反映しない）
  const od = d as OldSave;
  delete od.heirlooms; delete od.pending_heirloom; delete od.heir_seq;
  if (d.active_run) delete (d.active_run as unknown as Record<string, unknown>).heirloom_id;
  d.schema_version = SCHEMA_VERSION;
  return d;
}

export class SaveRepository {
  readonly kv: KV;
  readonly key: string;
  data: SaveData = freshSave();
  source: "fresh" | "main" | "backup" = "fresh";
  lastError = "";

  constructor(kv: KV, key = "death_legacy.save") {
    this.kv = kv;
    this.key = key;
  }

  load(): SaveData {
    this.source = "fresh";
    let found: SaveData | null = null;
    for (const k of [this.key, this.key + ".bak"]) {
      let text: string | null = null;
      try { text = this.kv.getItem(k); } catch { text = null; }
      if (text === null) continue;
      try {
        const v: unknown = JSON.parse(text);
        if (isValidSave(v)) {
          found = v;
          this.source = k === this.key ? "main" : "backup";
          break;
        }
      } catch { /* 壊れている → 次の候補 */ }
    }
    this.data = found ? migrate(found) : freshSave();
    return this.data;
  }

  write(): boolean {
    const text = JSON.stringify(this.data);
    const tmp = this.key + ".tmp";
    try {
      this.kv.setItem(tmp, text);
      if (this.kv.getItem(tmp) !== text) {
        this.lastError = "書き込み検証に失敗";
        return false;
      }
      const prev = this.kv.getItem(this.key);
      if (prev !== null) this.kv.setItem(this.key + ".bak", prev);
      this.kv.setItem(this.key, text);
      this.kv.removeItem(tmp);
      return true;
    } catch (e) {
      this.lastError = `保存に失敗: ${String(e)}`;   // 容量超過・プライベートブラウズなど
      return false;
    }
  }

  wipe(): void {
    this.data = freshSave();
    this.write();
  }
}

/** v4 → v5 のレベル読み替え（亡霊・形見・形見の候補・最高Lv・中断ラン） */
function migrateLevels(d: SaveData): void {
  const ghost = (g: GhostRecord | null | undefined): void => {
    if (!g || g.weapon_rank !== undefined) return;
    const x = legacyWeapon(g.weapon_level ?? 1);
    g.weapon_rank = x.rank;
    g.weapon_level = x.level;
    g.passive_level = Math.min(8, Math.round((g.passive_level ?? 0) * 1.6));
  };
  for (const g of d.ghosts ?? []) ghost(g);
  ghost(d.pending_ghost);
  const od = d as OldSave;
  const heir = (o: OldHeir): void => {
    o.level = o.type === "weapon" ? Math.min(10, legacyWeapon(o.level).level) : Math.min(5, Math.round(o.level * 1.6));
  };
  for (const h of od.heirlooms ?? []) {
    heir(h);
    if (h.name) h.name = h.name.replace(/Lv\d+$/, `Lv${h.level}`);   // 名前に入っている古いLvも直す
  }
  for (const o of od.pending_heirloom?.options ?? []) heir(o);
  const best = d.progress?.best_weapon_level ?? {};
  for (const k in best) best[k] = legacyWeapon(best[k]).level;
  const cp: Snapshot | null | undefined = d.active_run?.checkpoint;
  if (cp && !cp.rank) {
    cp.rank = {};
    for (const k in cp.weapons) {
      const x = legacyWeapon(cp.weapons[k]);
      cp.rank[k] = x.rank;
      cp.weapons[k] = x.level;
    }
    // パッシブは段階が細かくなった（1段の効果が約2/3）。強さが変わらないよう Lv と効果量を読み替える
    for (const k in cp.passives) cp.passives[k] = Math.min(8, Math.round(cp.passives[k] * 1.6));
    for (const k in cp.ppow) cp.ppow[k] = cp.ppow[k] * 1.5;
  }
}
