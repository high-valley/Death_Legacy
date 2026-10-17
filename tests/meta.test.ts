// 亡霊・供物・形見・セーブのテスト（仕様書 §11 の受け入れ条件＋フェーズ1）
import assert from "node:assert/strict";
import { test } from "node:test";
import { SaveRepository } from "../src/meta/saveRepository.ts";
import { STEP } from "../src/sim/runSim.ts";
import { RunSim } from "../src/sim/runSim.ts";
import { botStep, D, World } from "./helpers.ts";

test("t01 新規データで出撃 → レベルアップ → ボス → 敗北で亡霊が1体", () => {
  const w = new World();
  assert.equal(w.meta.storedGhosts().length, 0);
  const r = w.sortie("", "", "short", "sword", 11)!;
  assert.ok(r, "亡霊0体でも出撃できる");
  for (let i = 0; i < 60 * 40; i++) botStep(r);
  assert.ok(r.level >= 3 && r.kills > 20, `Lv${r.level} 撃破${r.kills}`);
  r.t = r.runLen;
  r.step(STEP, 0, 0);
  assert.ok(r.bossSpawned, "時間でボスが出る");
  const out = w.die(r);
  assert.ok(out.result === "player_death" && w.meta.storedGhosts().length === 1);
});

test("t02 生存時間で等級が決まる（10分ランの5分 = 英霊）", () => {
  const w = new World();
  const r = w.sortie("", "", "full", "bow", 12)!;
  r.weapons.bow = 3;
  w.die(r, 300);
  const g = w.meta.storedGhosts()[0];
  assert.ok(g.survival_seconds === 300 && g.tier_id === "hero" && g.primary_weapon_id === "bow", g.display_name);
});

test("t03 単独出撃では保管庫が変わらない", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "sword", 1), 60);
  const before = JSON.stringify(w.meta.storedGhosts());
  const r = w.sortie("", "", "short", "fire", 13)!;
  r.end("boss_cleared");
  w.meta.settle(r.summary(), "boss_cleared");
  assert.equal(JSON.stringify(w.meta.storedGhosts()), before);
});

test("t04 死亡しても同行亡霊は消費され、使用済みは選べない", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "sword", 1), 60);
  const gid = w.meta.storedGhosts()[0].ghost_id;
  const r = w.sortie(gid, "", "short", "sword", 14);
  assert.equal(w.meta.getGhost(gid)!.status, "reserved");
  w.die(r, 80);
  assert.equal(w.meta.getGhost(gid)!.status, "consumed");
  assert.ok(w.meta.storedGhosts().length === 1 && w.meta.storedGhosts()[0].ghost_id !== gid);
  assert.equal(w.sortie(gid), null);
});

test("t05 生還でも同行亡霊は消費、亡霊は生まれない", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "sword", 1), 60);
  const gid = w.meta.storedGhosts()[0].ghost_id;
  const r = w.sortie(gid, "", "short", "bow", 15)!;
  r.t = r.runLen + 1;
  r.spawnBoss();
  r.boss!.hp = 0;
  r.step(STEP, 0, 0);
  const out = w.meta.settle(r.summary(), "boss_cleared")!;
  assert.ok(r.result === "boss_cleared" && w.meta.getGhost(gid)!.status === "consumed" && out.new_ghost_id === "");
});

test("t06 亡霊は保管データのコピーで、生前の武器で攻撃する", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "fire", 1), 150);
  const g = w.meta.storedGhosts()[0];
  const r = w.sortie(g.ghost_id, "", "short", "sword", 16)!;
  assert.ok(r.ghost && r.ghost.rec.ghost_id === g.ghost_id);
  r.ghost.rec.display_name = "書き換え";
  assert.notEqual(w.meta.getGhost(g.ghost_id)!.display_name, "書き換え");
  let ghostHits = 0;
  for (let i = 0; i < 60 * 15; i++) {
    r.step(STEP, 0, 0);
    r.drainEvents();
    for (const z of r.zones) if (z.ghost) ghostHits++;
  }
  assert.ok(ghostHits > 0, "亡霊が炎魔法で攻撃する");
  assert.equal(r.ghostUnlock(), 0.25);
});

test("t07 終了処理を何度呼んでも重複しない", () => {
  const w = new World();
  const r = w.sortie("", "", "short", "sword", 17)!;
  r.t = 90; r.hp = 0; r.end("player_death");
  const a = w.meta.settle(r.summary(), "player_death")!;
  const snap = JSON.stringify(w.repo.data);
  w.meta.settle(r.summary(), "player_death");
  w.meta.settle(r.summary(), "boss_cleared");
  assert.equal(JSON.stringify(w.repo.data), snap);
  assert.ok(a.offerings > 0);
});

test("t08 異常終了しても同じランを途中から再開でき、亡霊は1回だけ消費", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "sword", 1), 60);
  const gid = w.meta.storedGhosts()[0].ghost_id;
  const r = w.sortie(gid, "", "short", "fire", 18)!;
  for (let i = 0; i < 60 * 12; i++) {
    botStep(r);
    if (r.checkpointDue()) w.meta.checkpoint(r.run_id, r.snapshot());
  }
  w.reload();
  const ar = w.repo.data.active_run!;
  assert.ok(ar.run_id === r.run_id && w.meta.getGhost(gid)!.status === "reserved");
  assert.equal(w.repo.data.ghosts.filter((g) => g.ghost_id === gid).length, 1, "亡霊は複製されない");
  const r2 = new RunSim(D, { run_id: ar.run_id, seed: ar.seed, mode: ar.mode, weapon: ar.weapon, ghost: w.meta.getGhost(ar.ghost_id), card_mods: w.meta.cardMods(), checkpoint: ar.checkpoint });
  assert.ok(r2.t >= 10 && r2.ghost && r2.ghost.rec.ghost_id === gid, `${r2.t}秒`);
  w.die(r2);
  assert.equal(w.meta.getGhost(gid)!.status, "consumed");
});

test("t08b 放棄はリタイア扱いで消費", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "sword", 1), 60);
  const gid = w.meta.storedGhosts()[0].ghost_id;
  w.sortie(gid, "", "short", "sword", 19);
  const out = w.meta.abandonActive()!;
  assert.ok(out.result === "retired" && w.meta.getGhost(gid)!.status === "consumed" && w.repo.data.active_run === null);
});

test("t09 保管庫が満杯なら pending、入れ替え後も10体", () => {
  const w = new World();
  for (let i = 0; i < 10; i++) {
    w.die(w.sortie("", "", "short", "sword", 100 + i), 30 + i);
    w.meta.resolveHeirloom(-1);
  }
  assert.equal(w.meta.storedGhosts().length, 10);
  const oldest = w.meta.storedGhosts()[0].ghost_id;
  const out = w.die(w.sortie("", "", "short", "bow", 200), 170);
  assert.ok(out.new_ghost_pending && w.repo.data.pending_ghost && w.meta.storedGhosts().length === 10);
  w.reload();
  assert.ok(w.repo.data.pending_ghost, "入れ替え前に落ちても pending は残る");
  const nid = w.repo.data.pending_ghost.ghost_id;
  assert.ok(w.meta.resolvePendingGhost(oldest));
  assert.ok(w.meta.storedGhosts().length === 10 && w.meta.getGhost(oldest)!.status === "released" && w.meta.getGhost(nid)!.status === "stored");
});

test("出撃中に同じ亡霊で二重出撃できない", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "sword", 1), 60);
  const gid = w.meta.storedGhosts()[0].ghost_id;
  assert.ok(w.sortie(gid));
  assert.equal(w.sortie(gid), null);
});

test("本体が壊れていたらバックアップから復元", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "sword", 1), 60);
  w.die(w.sortie("", "", "short", "sword", 2), 60);
  w.kv.setItem("test", "{broken");
  w.reload();
  assert.ok(w.repo.source === "backup" && w.repo.data.ghosts.length >= 1);
});

test("古いセーブに新項目を補う", () => {
  const w = new World();
  w.kv.setItem("test", JSON.stringify({ schema_version: 1, ghosts: [], run_history: [], settled_runs: [], progress: { clears: 0, deaths: 3, runs: 3 } }));
  const repo = new SaveRepository(w.kv, "test");
  const d = repo.load();
  assert.ok(d.offerings && Array.isArray(d.alloc.seals) && d.progress.generation === 0 && d.progress.deaths === 3);
});

test("供物: 生存6/10 + 撃破200 = 8、世代が1進む", () => {
  const w = new World();
  const r = w.sortie("", "", "short", "bow", 21)!;
  r.kills = 250;
  const out = w.die(r, 120);
  assert.ok(out.offerings === 8 && w.repo.data.offerings.earned === 8, String(out.offerings));
  assert.equal(w.repo.data.progress.generation, 1);
});

test("供物の割り振りの上限", () => {
  const w = new World();
  w.repo.data.offerings.earned = 5;
  w.repo.data.progress.total_survival = 9999;
  assert.ok(w.meta.allocAltar(3));
  assert.ok(w.meta.allocAffinity("fire", 2));
  assert.ok(!w.meta.allocAltar(1), "供物が足りなければ捧げられない");
  assert.ok(!w.meta.toggleSeal("bow"), "封印は供物2が必要");
  assert.ok(w.meta.allocAltar(-3) && w.meta.toggleSeal("bow"), "戻した供物で封印できる");
  assert.ok(!w.meta.allocAffinity("bow", 1), "封印中のカードに縁は結べない");
  assert.ok(w.meta.offeringsFree() >= 0);
});

test("形見: 候補 → 棚 → 身につけて出撃 → 使い切り", () => {
  const w = new World();
  const r = w.sortie("", "", "short", "bow", 22)!;
  r.passives = { haste: 3 };
  r.ppow = { haste: 3 };
  w.die(r, 100);
  const p = w.repo.data.pending_heirloom;
  assert.ok(p && p.options.length === 2);
  w.meta.resolveHeirloom(1);
  const h = w.meta.storedHeirs()[0];
  assert.ok(h.type === "passive" && h.id === "haste" && h.level === 2, h.name);
  const r2 = w.sortie("", h.heir_id, "short", "sword", 23)!;
  assert.ok(w.meta.getHeir(h.heir_id)!.status === "reserved" && r2.passives.haste === 2);
  w.die(r2, 50);
  assert.equal(w.meta.getHeir(h.heir_id), null);
});

test("形見: 異常終了後も reserved、再開しても持っていて、1回だけ使い切る", () => {
  const w = new World();
  w.die(w.sortie("", "", "short", "fire", 24), 100);
  w.meta.resolveHeirloom(0);
  const hid = w.meta.storedHeirs()[0].heir_id;
  const r2 = w.sortie("", hid, "short", "sword", 25)!;
  for (let i = 0; i < 60 * 11; i++) {
    botStep(r2);
    if (r2.checkpointDue()) w.meta.checkpoint(r2.run_id, r2.snapshot());
  }
  w.reload();
  assert.equal(w.meta.getHeir(hid)!.status, "reserved");
  const ar = w.repo.data.active_run!;
  const r3 = new RunSim(D, { run_id: ar.run_id, seed: ar.seed, mode: ar.mode, weapon: ar.weapon, heirloom: w.meta.getHeir(ar.heirloom_id), card_mods: w.meta.cardMods(), checkpoint: ar.checkpoint });
  assert.ok((r3.weapons.fire ?? 0) >= 1);
  w.die(r3);
  assert.equal(w.meta.getHeir(hid), null);
});

test("形見の棚は5つまで（古いものから手放す）", () => {
  const w = new World();
  for (let i = 0; i < 7; i++) {
    w.die(w.sortie("", "", "short", "fire", 30 + i), 30);
    w.meta.resolveHeirloom(0);
  }
  assert.equal(w.meta.storedHeirs().length, D.shelf.capacity);
});

test("リタイアは供物半分・形見と亡霊なし", () => {
  const w = new World();
  const r = w.sortie("", "", "short", "sword", 50)!;
  r.t = 90;
  r.end("retired");
  const out = w.meta.settle(r.summary(), "retired")!;
  assert.ok(out.offerings === 2 && w.repo.data.pending_heirloom === null && out.new_ghost_id === "");
});
