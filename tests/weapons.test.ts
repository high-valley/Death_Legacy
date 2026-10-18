// 武器の段階（グレード）と、槍・斧
import assert from "node:assert/strict";
import { test } from "node:test";
import { gradeIndex, weaponGrade } from "../src/data/weapons.ts";
import { Foe, RunSim, STEP } from "../src/sim/runSim.ts";
import { botStep, D } from "./helpers.ts";

const sim = (weapon: string, seed = 1): RunSim => new RunSim(D, { run_id: "w", seed, mode: "short", weapon });

/** 敵を1体、指定の場所に置く（動かないよう速度0） */
function place(r: RunSim, x: number, y: number, hp = 9999): Foe {
  const e = r.spawnEnemy("chaser");
  e.x = x; e.y = y; e.hp = hp; e.maxHp = hp;
  e.def = { ...e.def, speed: 0, damage: 0 };
  return e;
}

test("剣は Lv で 短剣 → ロングソード → グレートソード、進化でデュランダル", () => {
  const W = D.weapons.sword;
  assert.deepEqual([1, 2, 3, 4, 5].map((lv) => weaponGrade(W, lv, false).name), ["短剣", "短剣", "ロングソード", "ロングソード", "グレートソード"]);
  assert.equal(weaponGrade(W, 4, true).name, "デュランダル");
  assert.equal(gradeIndex(W, 5, true), 3);
});

test("どの武器も4段階で、名前が重ならない", () => {
  const names = new Set<string>();
  for (const id of Object.keys(D.weapons)) {
    assert.equal(D.weapons[id].grades.length, 4, id);
    for (const g of D.weapons[id].grades) {
      assert.ok(!names.has(g.name), g.name);
      names.add(g.name);
    }
  }
  assert.ok(["spear", "axe"].every((id) => id in D.weapons), "槍と斧がある");
});

test("持ち替えになるカードは、次の段階の名前を見せる", () => {
  const r = sim("sword");
  r.weapons.sword = 2;
  const d = r.describe({ kind: "weapon", id: "sword", lv: 2, rar: "N" });
  assert.equal(d.n, "短剣 → ロングソード");
  r.applyChoice({ kind: "weapon", id: "sword", lv: 2, rar: "N" });
  assert.equal(r.weaponName("sword"), "ロングソード");
});

test("育っていない武器（Lv3未満）にはレジェンドレアの進化が出ない", () => {
  const r = sim("sword", 9);
  r.cardMods = { altar: 10, affinity: { sword: 4 }, seals: [] };
  for (let i = 0; i < 400; i++) for (const c of r.rollChoices()) assert.ok(!(c.kind === "weapon" && c.id === "sword" && c.rar === "LR"));
  r.weapons.sword = 3;
  let lr = 0;
  for (let i = 0; i < 400; i++) for (const c of r.rollChoices()) if (c.kind === "weapon" && c.id === "sword" && c.rar === "LR") lr++;
  assert.ok(lr > 0, "Lv3 からは進化が出る");
});

test("槍: 一直線上の敵をまとめて貫き、横の敵には当たらない", () => {
  const r = sim("spear");
  const a = place(r, 60, 0), b = place(r, 100, 0), side = place(r, 0, 80);
  r.grid.rebuild(r.enemies);
  r.fireWeapon("spear", 1, 0, 0, 1, 0, 1, 1, false, false);
  assert.ok(a.hp < a.maxHp && b.hp < b.maxHp, "並んだ2体に当たる");
  assert.equal(side.hp, side.maxHp, "横の敵には当たらない");
  assert.ok(r.drainEvents().some((e) => e.type === "fx" && e.kind === "thrust"));
});

test("ハルバードは前後、グングニルは三方を突く", () => {
  const r = sim("spear");
  const front = place(r, 80, 0), back = place(r, -80, 0);
  r.grid.rebuild(r.enemies);
  r.fireWeapon("spear", 5, 0, 0, 1, 0, 1, 1, false, false);
  assert.ok(front.hp < front.maxHp && back.hp < back.maxHp);
  r.drainEvents();
  r.fireWeapon("spear", 5, 0, 0, 1, 0, 1, 1, false, true);
  assert.equal(r.drainEvents().filter((e) => e.type === "fx" && e.kind === "thrust").length, 3);
});

test("斧: 飛んでいって戻ってくる。行きと帰りで2回当たる", () => {
  const r = sim("axe");
  const e = place(r, 120, 0);
  r.grid.rebuild(r.enemies);
  r.fireWeapon("axe", 1, 0, 0, 1, 0, 1, 1, false, false);
  assert.equal(r.shots.length, 1);
  const s = r.shots[0];
  let hits = 0, prev = e.hp, farthest = 0;
  for (let i = 0; i < 200 && r.shots.length > 0; i++) {
    r.step(STEP, 0, 0);
    farthest = Math.max(farthest, s.x);
    if (e.hp < prev) { hits++; prev = e.hp; }
  }
  assert.equal(r.shots.length, 0, "主人公のところへ戻って消える");
  assert.ok(farthest > 140, "敵より遠くまで飛ぶ");
  assert.equal(hits, 2);
});

test("ラブリュスは4方向へ投げる", () => {
  const r = sim("axe");
  place(r, 100, 0);
  r.grid.rebuild(r.enemies);
  r.fireWeapon("axe", 5, 0, 0, 1, 0, 1, 1, false, true);
  assert.equal(r.shots.length, 4);
});

test("新しい武器でも最後まで遊べる（簡易ボットで落ちない・攻撃が当たる）", () => {
  for (const w of ["spear", "axe"]) {
    const r = sim(w, 21);
    for (let i = 0; i < 60 * 90 && r.result === ""; i++) botStep(r);
    assert.ok(r.kills > 30, `${w}: 撃破 ${r.kills}`);
  }
});

test("ダメージ数字は描画側が頼んだ時だけ、1ティック12個まで", () => {
  const r = sim("sword");
  for (let i = 0; i < 30; i++) place(r, 20 + (i % 5), (i % 3) - 1);
  r.grid.rebuild(r.enemies);
  r.fireWeapon("sword", 1, 0, 0, 1, 0, 1, 1, false, false);
  assert.equal(r.drainEvents().filter((e) => e.type === "dmg").length, 0);
  r.showDamage = true;
  r.hero.cds.sword = 0;
  r.step(STEP, 0, 0);
  const n = r.drainEvents().filter((e) => e.type === "dmg").length;
  assert.ok(n > 0 && n <= 12, String(n));
});
