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

test("どの武器も Lv1 → Lv3（道2つ）→ Lv5（道2つ）→ 進化 の6段階で、名前が重ならない", () => {
  const names = new Set<string>();
  for (const id of Object.keys(D.weapons)) {
    assert.equal(D.weapons[id].grades.length, 6, id);
    for (const g of D.weapons[id].grades) {
      assert.ok(!names.has(g.name), g.name);
      names.add(g.name);
    }
  }
  assert.ok(["spear", "axe"].every((id) => id in D.weapons), "槍と斧がある");
});

test("武器の名前はランクで決まり、レベルを上げても持ち替えない", () => {
  const r = sim("sword");
  r.weapons.sword = 9;
  assert.equal(r.weaponName("sword"), "短剣");
  r.rank.sword = 1; r.branch.sword = "a";
  assert.equal(r.weaponName("sword"), "ロングソード");
});

test("槍: 一直線上の敵をまとめて貫き、横の敵には当たらない", () => {
  const r = sim("spear");
  const a = place(r, 60, 0), b = place(r, 100, 0), side = place(r, 0, 80);
  r.grid.rebuild(r.enemies);
  r.fireWeapon("spear", 1, 0, 0, 0, 1, 0, 1, 1, false, false);
  assert.ok(a.hp < a.maxHp && b.hp < b.maxHp, "並んだ2体に当たる");
  assert.equal(side.hp, side.maxHp, "横の敵には当たらない");
  assert.ok(r.drainEvents().some((e) => e.type === "fx" && e.kind === "thrust"));
});

test("ハルバードは前後、グングニルは三方を突く", () => {
  const r = sim("spear");
  const front = place(r, 80, 0), back = place(r, -80, 0);
  r.grid.rebuild(r.enemies);
  r.fireWeapon("spear", 1, 2, 0, 0, 1, 0, 1, 1, false, false);
  assert.ok(front.hp < front.maxHp && back.hp < back.maxHp);
  r.drainEvents();
  r.fireWeapon("spear", 1, 2, 0, 0, 1, 0, 1, 1, false, true);
  assert.equal(r.drainEvents().filter((e) => e.type === "fx" && e.kind === "thrust").length, 3);
});

test("斧: 飛んでいって戻ってくる。行きと帰りで2回当たる", () => {
  const r = sim("axe");
  const e = place(r, 120, 0);
  r.grid.rebuild(r.enemies);
  r.fireWeapon("axe", 1, 0, 0, 0, 1, 0, 1, 1, false, false);
  r.hero.cds.axe = 999;   // 主人公が次の斧を投げないように
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
  r.fireWeapon("axe", 1, 2, 0, 0, 1, 0, 1, 1, false, true);
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
  r.fireWeapon("sword", 1, 0, 0, 0, 1, 0, 1, 1, false, false);
  assert.equal(r.drainEvents().filter((e) => e.type === "dmg").length, 0);
  r.showDamage = true;
  r.hero.cds.sword = 0;
  r.step(STEP, 0, 0);
  const n = r.drainEvents().filter((e) => e.type === "dmg").length;
  assert.ok(n > 0 && n <= 12, String(n));
});

test("魔導書は炎・氷・雷の3冊に分かれ、それぞれ4段階", () => {
  for (const id of ["fire", "ice", "thunder"]) {
    assert.ok(D.weapons[id].name.endsWith("の魔導書"), id);
    assert.equal(D.weapons[id].grades.length, 6);
  }
  assert.equal(weaponGrade(D.weapons.fire, 5, true).name, "エクスプロージョン");
  assert.equal(weaponGrade(D.weapons.ice, 5, true).name, "アブソリュートゼロ");
  assert.equal(weaponGrade(D.weapons.thunder, 3, false).name, "ライトニング");
});

test("氷: 当たった敵が遅くなり、氷河の魔導書なら一瞬凍る。冥王は凍らない", () => {
  const r = sim("ice");
  const e = place(r, 60, 0);
  e.def = { ...e.def, speed: 100 };
  r.grid.rebuild(r.enemies);
  r.fireWeapon("ice", 1, 0, 0, 0, 1, 0, 1, 1, false, false);
  for (let i = 0; i < 12 && e.slowT === 0; i++) r.step(STEP, 0, 0);
  assert.ok(e.slowT > 0 && e.freezeT === 0, "Lv1 は遅くなるだけ");
  const r2 = sim("ice");
  const f = place(r2, 60, 0);
  r2.grid.rebuild(r2.enemies);
  r2.fireWeapon("ice", 1, 2, 0, 0, 1, 0, 1, 1, false, false);
  for (let i = 0; i < 12 && f.freezeT === 0; i++) r2.step(STEP, 0, 0);
  assert.ok(f.freezeT > 0, "Lv5 は凍る");
  const x0 = f.x;
  r2.step(STEP, 0, 0);
  assert.equal(f.x, x0, "凍っている間は動かない");
  const r3 = sim("ice");
  const b = r3.spawnEnemy("boss", 60);
  b.x = 60; b.y = 0;
  r3.grid.rebuild(r3.enemies);
  r3.fireWeapon("ice", 1, 2, 0, 0, 1, 0, 1, 1, false, false);
  for (let i = 0; i < 12; i++) r3.step(STEP, 0, 0);
  assert.ok(b.freezeT === 0 && b.slowT > 0 && b.slowMul > D.weapons.ice.slow!, "冥王は凍らず、遅くなるのも弱い");
});

test("雷: 近くの敵へ段階の数だけ飛び移り、届かない敵には当たらない", () => {
  const r = sim("thunder");
  const chain = [place(r, 80, 0), place(r, 180, 0), place(r, 280, 0), place(r, 380, 0), place(r, 480, 0)];
  const far = place(r, 1200, 0);
  r.grid.rebuild(r.enemies);
  r.fireWeapon("thunder", 1, 0, 0, 0, 1, 0, 1, 1, false, false);
  assert.equal(chain.filter((e) => e.hp < e.maxHp).length, 2, "稲妻の書は2体");
  for (const e of chain) e.hp = e.maxHp;
  r.fireWeapon("thunder", 1, 1, 0, 0, 1, 0, 1, 1, false, false);
  assert.equal(chain.filter((e) => e.hp < e.maxHp).length, 4, "雷の魔導書は4体");
  assert.equal(far.hp, far.maxHp);
  const hit = chain.map((e) => e.maxHp - e.hp);
  assert.ok(hit[1] < hit[0], "飛び移るたびに少し弱まる");
});

test("氷と雷でも最後まで遊べる（簡易ボット）", () => {
  for (const w of ["ice", "thunder"]) {
    const r = sim(w, 23);
    for (let i = 0; i < 60 * 90 && r.result === ""; i++) botStep(r);
    assert.ok(r.kills > 30, `${w}: 撃破 ${r.kills}`);
  }
});

test("最初からランクアップのLv以上なら、最初のレベルアップでランクアップの札が出る", () => {
  const r = sim("sword", 5);
  r.weapons.sword = D.rank_levels[0] + 1;
  assert.ok(r.rollChoices().some((c) => c.kind === "rank" && !!c.branch), "道を選ぶ札が出る");
});
