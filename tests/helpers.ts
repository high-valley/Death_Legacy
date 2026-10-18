// テスト共通: データ読み込み・出撃・死亡・簡易ボット
import { readFileSync } from "node:fs";
import { loadBalance } from "../src/data/dataLoader.ts";
import type { Balance, RunMode } from "../src/data/types.ts";
import { MetaService, uuid } from "../src/meta/metaService.ts";
import type { GhostMode, RunRecord } from "../src/meta/records.ts";
import { MemoryKV, SaveRepository } from "../src/meta/saveRepository.ts";
import { RunSim, STEP } from "../src/sim/runSim.ts";

export const RAW_TEXT = readFileSync(new URL("../data/balance.json", import.meta.url), "utf8");
export const loaded = loadBalance(JSON.parse(RAW_TEXT));
export const D: Balance = loaded.D;

export class World {
  kv = new MemoryKV();
  repo = new SaveRepository(this.kv, "test");
  meta: MetaService;

  constructor() {
    this.repo.load();
    this.meta = new MetaService(this.repo, D);
  }

  /** アプリが落ちた想定: メモリを捨てて保存先から読み直す */
  reload(): void {
    this.repo = new SaveRepository(this.kv, "test");
    this.repo.load();
    this.meta = new MetaService(this.repo, D);
  }

  /** 出撃（予約まで含む）。失敗時は null */
  sortie(ghostId = "", heirId = "", mode: RunMode = "short", weapon = "sword", seed = 1, lineage = "nameless", ghostMode: GhostMode = "bring"): RunSim | null {
    const rid = uuid();
    if (!this.meta.reserve(rid, seed, mode, weapon, ghostId, heirId, lineage, ghostMode)) return null;
    return new RunSim(D, this.meta.runOpts(this.repo.data.active_run!));
  }

  /** 中断したランを再開する（アプリを開き直した想定） */
  resume(): RunSim {
    return new RunSim(D, this.meta.runOpts(this.repo.data.active_run!));
  }

  die(r: RunSim | null, at = -1): RunRecord {
    if (!r) throw new Error("出撃できていない");
    if (at >= 0) r.t = at;
    r.hp = 0;
    r.end("player_death");
    return this.meta.settle(r.summary(), "player_death")!;
  }
}

/** 簡易ボット: 近い敵から逃げ、弾をよけ、経験値を拾う */
export function botStep(r: RunSim): void {
  if (r.pending > 0) r.applyChoice(r.rollChoices()[0]);
  const h = r.hero;
  let mx = 0, my = 0;
  const norm = (x: number, y: number): [number, number] => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  const e = r.grid.nearest(h.x, h.y, 95);
  if (e) {
    [mx, my] = norm(h.x - e.x, h.y - e.y);
  } else if (r.gems.length > 0) {
    let best = r.gems[0];
    for (const g of r.gems) if (Math.hypot(g.x - h.x, g.y - h.y) < Math.hypot(best.x - h.x, best.y - h.y)) best = g;
    [mx, my] = norm(best.x - h.x, best.y - h.y);
  }
  for (const s of r.eshots) {
    const ox = h.x - s.x, oy = h.y - s.y;
    const l = Math.hypot(ox, oy);
    if (l < 90 && ox * s.vx + oy * s.vy > 0) {
      [mx, my] = norm(-s.vy, s.vx);
      if (l < 50) r.tryDash(mx, my);
      break;
    }
  }
  r.step(STEP, mx, my);
  r.drainEvents();
}
