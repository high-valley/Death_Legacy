// ビルド要素: 進化の分岐・タグとセット効果・刻印・呪い
import assert from "node:assert/strict";
import { test } from "node:test";
import { weaponGrade } from "../src/data/weapons.ts";
import type { CardMods } from "../src/meta/records.ts";
import { RunSim, STEP } from "../src/sim/runSim.ts";
import { D } from "./helpers.ts";

const sim = (weapon: string, mods: Partial<CardMods> = {}, seed = 1): RunSim =>
  new RunSim(D, { run_id: "b", seed, mode: "short", weapon, card_mods: { altar: 0, affinity: {}, seals: [], ...mods } });

test("Lv3 に届くカードは道 a / b の2枚に分かれ、選んだ道で名前と攻撃が変わる", () => {
  const r = sim("sword");
  r.weapons.sword = 2;
  let pair: ReturnType<RunSim["rollChoices"]> = [];
  for (let i = 0; i < 300 && pair.length === 0; i++) {
    const cs = r.rollChoices();
    if (cs.some((c) => c.branch)) pair = cs;
  }
  assert.ok(pair.length > 0, "分岐の札が出る");
  assert.deepEqual(pair.filter((c) => c.branch).map((c) => c.branch), ["a", "b"]);
  const b = pair.find((c) => c.branch === "b")!;
  assert.match(r.describe(b).n, /短剣 → レイピア/);
  r.applyChoice(b);
  assert.equal(r.weaponName("sword"), "レイピア");
  r.weapons.sword = 5;
  assert.equal(r.weaponName("sword"), "エストック", "Lv5 も同じ道の先");
  assert.ok(r.weaponCd("sword", 3, false, "b") < r.weaponCd("sword", 3, false, "a"), "レイピアは速い");
  assert.equal(weaponGrade(D.weapons.fire, 5, false, "b").name, "メテオ");
  for (let i = 0; i < 100; i++) assert.ok(!r.rollChoices().some((c) => c.branch), "道を選んだ後は分かれない");
});

test("タグ: 主人公の武器2点、タグ付きパッシブ1Lvで1点。炎4でセット効果", () => {
  const r = sim("fire");
  assert.equal(r.tagPoints().fire, 2);
  assert.ok(r.activeSets().some((s) => s.tag === "fire" && s.at === 2));
  for (let i = 0; i < 2; i++) r.applyChoice({ kind: "passive", id: "ember", lv: i, rar: "N" });
  assert.equal(r.tagPoints().fire, 4);
  assert.ok((r.setMods(["fire"]).burn ?? 0) > 0, "炎4: 燃える時間が延びる");
  assert.equal(r.setMods(["slash"]).dmg ?? 0, 0, "他のタグには効かない");
});

test("炎6: 敵を倒すと時々爆発して周りを巻き込む", () => {
  const r = sim("fire", {}, 3);
  r.passives = { ember: 4 }; r.ppow = { ember: 4 };
  r.applyChoice({ kind: "passive", id: "ember", lv: 4, rar: "N" });
  assert.ok(r.anySet("explode") > 0);
  let booms = 0;
  for (let k = 0; k < 40; k++) {
    const e = r.spawnEnemy("chaser"); e.x = 0; e.y = 0; e.hp = 0;
    r.step(STEP, 0, 0);
    booms += r.drainEvents().filter((ev) => ev.type === "fx" && ev.kind === "boom").length;
  }
  assert.ok(booms > 2 && booms < 30, `爆発 ${booms} 回`);
});

test("雷4: 飛び移る数が増える", () => {
  const plain = sim("thunder"), set = sim("thunder");
  set.applyChoice({ kind: "passive", id: "volt", lv: 0, rar: "N" });
  set.applyChoice({ kind: "passive", id: "volt", lv: 1, rar: "N" });
  const hits = (r: RunSim): number => {
    const es = Array.from({ length: 8 }, (_, i) => { const e = r.spawnEnemy("chaser"); e.x = 60 + i * 90; e.y = 0; e.hp = e.maxHp = 9999; e.def = { ...e.def, speed: 0 }; return e; });
    r.grid.rebuild(r.enemies);
    r.fireWeapon("thunder", 1, 0, 0, 1, 0, 1, 1, false, false);
    return es.filter((e) => e.hp < e.maxHp).length;
  };
  assert.equal(hits(plain), 2);
  assert.equal(hits(set), 4);
});

test("刻印: 祭壇の樹の書架で出る種類が増え、取った刻印が効く", () => {
  const r0 = sim("sword", { sigil_tier: 0 });
  assert.deepEqual(r0.sigilPool().sort(), ["ember_step", "greed", "iron_vow", "soul_drain"]);
  assert.ok(!r0.sigilPool().includes("ghost_echo"), "亡霊がいない時は霊の共鳴は出ない");
  const r2 = sim("thunder", { sigil_tier: 2 });
  assert.ok(r2.sigilPool().includes("storm_heart") && r2.sigilPool().includes("executioner"));
  let seen = 0;
  for (let i = 0; i < 300; i++) if (r0.rollChoices().some((c) => c.kind === "sigil")) seen++;
  assert.ok(seen > 15 && seen < 100, `刻印が混ざる ${seen}/300`);
  // 鉄の誓い
  const a = sim("sword"), b = sim("sword");
  b.applyChoice({ kind: "sigil", id: "iron_vow", lv: 0, rar: "UR" });
  a.hurtPlayer(20, "x"); b.hurtPlayer(20, "x");
  assert.equal(a.maxHp - a.hp, 20);
  assert.equal(b.maxHp - b.hp, 15);
  // 残り火の歩み
  const c = sim("sword");
  c.applyChoice({ kind: "sigil", id: "ember_step", lv: 0, rar: "UR" });
  c.tryDash(1, 0);
  assert.equal(c.zones.length, 1);
});

test("呪い: 禁忌の頁を開くまで出ない。取ると強い効果と不利が両方つく", () => {
  const r = sim("sword");
  for (let i = 0; i < 200; i++) assert.ok(!r.rollChoices().some((c) => c.kind === "curse"));
  const c = sim("sword", { curses: true });
  let seen = 0;
  for (let i = 0; i < 300; i++) if (c.rollChoices().some((x) => x.kind === "curse")) seen++;
  assert.ok(seen > 15, `呪いが混ざる ${seen}/300`);
  const m0 = c.mightMul(), hp0 = c.maxHp;
  c.applyChoice({ kind: "curse", id: "blood_pact", lv: 0, rar: "SR" });
  assert.ok(Math.abs(c.mightMul() / m0 - 1.4) < 1e-9);
  assert.equal(c.maxHp, Math.round(hp0 * 0.7));
});

test("中断・再開しても道・刻印・呪い・欠片は保たれる", () => {
  const r = sim("spear");
  r.branch.spear = "b";
  r.applyChoice({ kind: "sigil", id: "greed", lv: 0, rar: "UR" });
  r.applyChoice({ kind: "curse", id: "glass", lv: 0, rar: "SR" });
  r.fragments = 3;
  const r2 = new RunSim(D, { run_id: "b", seed: 1, mode: "short", weapon: "spear", checkpoint: r.snapshot() });
  assert.ok(r2.branch.spear === "b" && r2.has("greed") && r2.curses.includes("glass") && r2.fragments === 3);
  r2.weapons.spear = 3;
  assert.equal(r2.weaponName("spear"), "トライデント");
});
