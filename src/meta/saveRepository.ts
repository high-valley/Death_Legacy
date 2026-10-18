// セーブの読み書き。
//   書き込み: 一時領域に書く → 読み戻して検証 → 旧データを .bak に退避 → 本体へ置き換え
//   読み込み: 本体が壊れていれば .bak から復元
// ブラウザでは localStorage、テストではメモリ、将来の Steam 版（Electron）ではファイルに差し替える。
import type { SaveData } from "./records.ts";

export const SCHEMA_VERSION = 3;

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
    active_run: null, pending_ghost: null, pending_heirloom: null,
    progress: { clears: 0, deaths: 0, runs: 0, generation: 0, total_survival: 0, companion_runs: 0, best_weapon_level: {} },
    lineages: ["nameless"],
    offerings: { earned: 0, mourned: 0 }, tree: [], alloc: { affinity: {}, seals: [] },
    heirlooms: [], heir_seq: 0,
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
