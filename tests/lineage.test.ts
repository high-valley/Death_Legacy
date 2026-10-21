// フェーズ2: 家系の解放（無名・火守・墓守）
import assert from "node:assert/strict";
import { test } from "node:test";
import { SaveRepository } from "../src/meta/saveRepository.ts";
import { RunSim, STEP } from "../src/sim/runSim.ts";
import { D, World } from "./helpers.ts";

// 家系は 2026-10 に一旦なし（lineages_enabled: false）。仕組みは残っているので、このファイルだけ有効にして確かめる
(D as { lineages_enabled: boolean }).lineages_enabled = true;

test("新しいセーブでは無名だけが使え、未解放の家系では出撃できない", () => {
  const w = new World();
  assert.ok(w.meta.lineageUnlocked("nameless"));
  assert.ok(!w.meta.lineageUnlocked("firekeeper") && !w.meta.lineageUnlocked("gravekeeper"));
  assert.equal(w.sortie("", "", "short", "sword", 1, "firekeeper"), null);
  assert.equal(w.repo.data.active_run, null, "失敗した出撃で予約が残らない");
});

test("火守: 魔導書を Lv15 まで育てると解放され、魔導書固定・炎強化・HP減で出撃する", () => {
  const w = new World();
  const r = w.sortie("", "", "short", "fire", 1)!;
  r.weapons.fire = 14;
  const out1 = w.die(r, 60);
  assert.deepEqual(out1.unlocked_lineages, [], "Lv14では解放されない");
  w.meta.resolveHeirloom(-1);
  const r2 = w.sortie("", "", "short", "fire", 2)!;
  r2.weapons.fire = 15;
  const out2 = w.die(r2, 60);
  assert.deepEqual(out2.unlocked_lineages, ["firekeeper"]);
  assert.ok(w.meta.lineageUnlocked("firekeeper"));
  w.meta.resolveHeirloom(-1);
  const f = w.sortie("", "", "short", "sword", 3, "firekeeper")!;
  assert.equal(f.mainWeapon, "fire", "火守は魔導書で出撃（選んだ武器より優先）");
  assert.equal(f.maxHp, Math.round(D.player.hp * 0.8), "最大HP −20%");
  const n = new RunSim(D, { run_id: "n", seed: 3, mode: "short", weapon: "fire" });
  for (const s of [f, n]) {
    const e = s.spawnEnemy("chaser", 100);
    e.hp = 1e6;
    s.grid.rebuild(s.enemies);
    s.fireWeapon("fire", 1, 0, 0, 0, 1, 0, 1, 1, false, false);
  }
  assert.ok(f.zones[0].r > n.zones[0].r * 1.19 && f.zones[0].life > n.zones[0].life * 1.29, "炎の範囲・燃える時間が伸びる");
});

test("墓守: 亡霊を連れたランを3回終えると解放。亡霊の解放が1段階早く、単独の経験値ボーナスがない", () => {
  const w = new World();
  for (let i = 0; i < 4; i++) {
    w.die(w.sortie("", "", "short", "sword", 10 + i), 60);
    w.meta.resolveHeirloom(-1);
  }
  const outs = [];
  for (let i = 0; i < 3; i++) {
    const gid = w.meta.storedGhosts()[0].ghost_id;
    outs.push(w.die(w.sortie(gid, "", "short", "sword", 20 + i), 60));
    w.meta.resolveHeirloom(-1);
  }
  assert.deepEqual(outs[1].unlocked_lineages, []);
  assert.deepEqual(outs[2].unlocked_lineages, ["gravekeeper"], "3回目で解放");
  const gid = w.meta.storedGhosts()[0].ghost_id;
  const g = w.sortie(gid, "", "short", "bow", 30, "gravekeeper")!;
  assert.equal(g.ghostUnlock(), 0.5, "Lv1から解放率50%（無名は25%）");
  const solo = new RunSim(D, { run_id: "s", seed: 1, mode: "short", weapon: "sword", lineage: "gravekeeper" });
  solo.gems.push({ x: 0, y: 0, v: 1, mag: false });
  solo.step(STEP, 0, 0);
  assert.equal(solo.xp, 1, "墓守は単独でも経験値ボーナスなし");
});

test("家系の札はその家系の時だけ候補に出て、効果が働く（送り火）", () => {
  const n = new RunSim(D, { run_id: "x", seed: 1, mode: "short", weapon: "sword" });
  assert.ok(n.cardPool().some((o) => o.kind === "lineage" && o.id === "grit"), "無名には無名の意地");
  assert.ok(!n.cardPool().some((o) => o.id === "okuribi"));
  const f = new RunSim(D, { run_id: "x", seed: 5, mode: "short", weapon: "fire", lineage: "firekeeper" });
  for (let i = 0; i < 3; i++) f.applyChoice({ kind: "lineage", id: "okuribi", lv: i, rar: "LR" });
  assert.ok(!f.cardPool().some((o) => o.kind === "lineage"), "最大Lvになったら候補から消える");
  f.weapons = {};
  for (let i = 0; i < 40; i++) {
    const e = f.spawnEnemy("chaser", 300 + i);
    e.hp = 0;
  }
  f.step(STEP, 0, 0);
  assert.ok(f.zones.length >= 10, `倒した場所に炎が残る (${f.zones.length})`);
  assert.match(f.describe({ kind: "lineage", id: "okuribi", lv: 0, rar: "N" }).d, /10%/);
});

test("無名は形見が1Lv強くなる。亡霊の名前に家系が入る", () => {
  const w = new World();
  const r = w.sortie("", "", "short", "bow", 40)!;
  r.weapons.bow = 4;
  w.die(r, 100);
  w.meta.resolveHeirloom(0);
  const h = w.meta.storedHeirs()[0];
  assert.equal(h.level, 2);
  const r2 = w.sortie("", h.heir_id, "short", "sword", 41)!;
  assert.equal(r2.weapons.sword, 3, "形見 Lv2 + 無名の効果 1（主人公の武器に乗る）");
  w.repo.data.lineages.push("firekeeper");
  w.die(r2, 60);
  w.meta.resolveHeirloom(-1);
  const f = w.sortie("", "", "short", "fire", 42, "firekeeper")!;
  w.die(f, 60);
  const names = w.meta.storedGhosts().map((g) => g.display_name);
  assert.ok(names.some((n) => n.includes("火守・")), names.join(" / "));
  assert.ok(names.some((n) => !n.includes("・無名")), "無名は名前に入れない");
});

test("中断・再開しても家系と家系の札は保たれる", () => {
  const w = new World();
  w.repo.data.lineages.push("firekeeper");
  const f = w.sortie("", "", "short", "fire", 50, "firekeeper")!;
  f.applyChoice({ kind: "lineage", id: "okuribi", lv: 0, rar: "SR" });
  f.t = 30;
  w.meta.checkpoint(f.run_id, f.snapshot());
  w.reload();
  const ar = w.repo.data.active_run!;
  assert.equal(ar.lineage_id, "firekeeper");
  const r2 = new RunSim(D, { run_id: ar.run_id, seed: ar.seed, mode: ar.mode, weapon: ar.weapon, lineage: ar.lineage_id, card_mods: w.meta.cardMods(), checkpoint: ar.checkpoint });
  assert.ok(r2.lineage.id === "firekeeper" && r2.lineageLv === 1 && r2.lpow === 2);
});

test("家系導入前のセーブを読んでも無名が使える", () => {
  const w = new World();
  w.kv.setItem("test", JSON.stringify({ schema_version: 1, ghosts: [], run_history: [], settled_runs: [], progress: { clears: 0, deaths: 2, runs: 2 },
    active_run: { run_id: "a", seed: 1, mode: "short", weapon: "bow", ghost_id: "", heirloom_id: "", started_at: "", checkpoint: null } }));
  const d = new SaveRepository(w.kv, "test").load();
  assert.deepEqual(d.lineages, ["nameless"]);
  assert.equal(d.progress.companion_runs, 0);
  assert.deepEqual(d.progress.best_weapon_level, {});
  assert.equal(d.active_run!.lineage_id, "nameless");
});
