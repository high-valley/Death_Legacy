// ビルド要素: 進化の分岐・タグとセット効果・刻印・呪い
import assert from "node:assert/strict";
import { test } from "node:test";
import { gradeAt } from "../src/data/weapons.ts";
import type { CardMods } from "../src/meta/records.ts";
import { RunSim, STEP } from "../src/sim/runSim.ts";
import { D } from "./helpers.ts";

const sim = (weapon: string, mods: Partial<CardMods> = {}, seed = 1): RunSim =>
  new RunSim(D, { run_id: "b", seed, mode: "short", weapon, card_mods: { altar: 0, affinity: {}, seals: [], ...mods } });

test("武器が Lv5 に届くと、次のレベルアップでランクアップの札（道 a / b）が出て、選んだ道で名前と攻撃が変わる", () => {
  const r = sim("sword");
  r.weapons.sword = 4;
  assert.ok(!r.rollChoices().some((c) => c.kind === "rank"), "Lv4 ではまだ出ない");
  r.weapons.sword = 5;
  const pair = r.rollChoices();
  assert.deepEqual(pair.filter((c) => c.kind === "rank").map((c) => c.branch), ["a", "b"], "必ず出る");
  const b = pair.find((c) => c.branch === "b")!;
  assert.match(r.describe(b).n, /短剣 → レイピア/);
  r.applyChoice(b);
  assert.equal(r.weaponName("sword"), "レイピア");
  assert.equal(r.weapons.sword, 5, "ランクアップでレベルは変わらない");
  r.weapons.sword = 9;
  assert.ok(!r.rollChoices().some((c) => c.kind === "rank"), "次は Lv10");
  r.weapons.sword = 10;
  const next = r.rollChoices().filter((c) => c.kind === "rank");
  assert.equal(next.length, 1);
  r.applyChoice(next[0]);
  assert.equal(r.weaponName("sword"), "エストック", "同じ道の先");
  assert.ok(r.weaponCd("sword", 1, false, "b") < r.weaponCd("sword", 1, false, "a"), "レイピアは速い");
  assert.equal(gradeAt(D.weapons.fire, 2, false, "b").name, "メテオ");
  r.weapons.sword = 15;
  const evo = r.rollChoices().filter((c) => c.kind === "rank");
  assert.equal(evo[0].rar, "LR");
  r.applyChoice(evo[0]);
  assert.ok(r.evolved.sword && r.weaponName("sword") === "デュランダル");
  for (let i = 0; i < 50; i++) assert.ok(!r.rollChoices().some((c) => c.kind === "rank"), "進化の後は出ない");
});

test("武器カードはレベル（ダメージ）だけを上げ、ランクは変えない", () => {
  const r = sim("spear");
  const d0 = r.describe({ kind: "weapon", id: "spear", lv: 1, rar: "N" });
  assert.match(d0.d, /ダメージ/);
  r.applyChoice({ kind: "weapon", id: "spear", lv: 1, rar: "UR" });
  assert.equal(r.weapons.spear, 1 + D.rarities.find((x) => x.id === "UR")!.wlv);
  assert.equal(r.weaponName("spear"), "ショートスピア");
});

test("タグ: 主人公の武器2点、タグ付きパッシブ1Lvで0.5点。炎4でセット効果", () => {
  const r = sim("fire");
  assert.equal(r.tagPoints().fire, 2);
  assert.ok(r.activeSets().some((s) => s.tag === "fire" && s.at === 2));
  for (let i = 0; i < 4; i++) r.applyChoice({ kind: "passive", id: "ember", lv: i, rar: "N" });
  assert.equal(r.tagPoints().fire, 4);
  assert.ok((r.setMods(["fire"]).burn ?? 0) > 0, "炎4: 燃える時間が延びる");
  assert.equal(r.setMods(["slash"]).dmg ?? 0, 0, "他のタグには効かない");
});

test("炎6: 敵を倒すと時々爆発して周りを巻き込む", () => {
  const r = sim("fire", {}, 3);
  r.passives = { ember: 4, kindle: 3 }; r.ppow = { ember: 4, kindle: 3 };
  r.applyChoice({ kind: "passive", id: "kindle", lv: 3, rar: "N" });
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
  for (let i = 0; i < 4; i++) set.applyChoice({ kind: "passive", id: "volt", lv: i, rar: "N" });
  const hits = (r: RunSim): number => {
    const es = Array.from({ length: 8 }, (_, i) => { const e = r.spawnEnemy("chaser"); e.x = 60 + i * 90; e.y = 0; e.hp = e.maxHp = 9999; e.def = { ...e.def, speed: 0 }; return e; });
    r.grid.rebuild(r.enemies);
    r.fireWeapon("thunder", 1, 0, 0, 0, 1, 0, 1, 1, false, false);
    return es.filter((e) => e.hp < e.maxHp).length;
  };
  assert.equal(hits(plain), 2);
  assert.equal(hits(set), 4);
});

test("刻印: 祭壇の樹の書架で出る種類が増え、取った刻印が効く", () => {
  const r0 = sim("sword", { sigil_tier: 0 });
  assert.deepEqual(r0.sigilPool().sort(), ["ember_step", "greed", "iron_vow", "soul_drain", "undying"]);
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
  r.rank.spear = 1;
  const r3 = new RunSim(D, { run_id: "b", seed: 1, mode: "short", weapon: "spear", checkpoint: r.snapshot() });
  assert.equal(r3.weaponName("spear"), "トライデント", "ランクも保たれる");
});

test("一人で出撃した時、主人公の武器と関係ない属性のパッシブは候補に出ない", () => {
  const r = new RunSim(D, { run_id: "solo", seed: 3, mode: "short", weapon: "sword" });
  const ids = r.cardPool().filter((o) => o.kind === "passive").map((o) => o.id);
  assert.ok(ids.includes("edge"), "斬撃（剣）は出る");
  for (const x of ["ember", "frost", "volt", "point", "hawk", "medium"]) assert.ok(!ids.includes(x), `${x} は出ない`);
  assert.ok(ids.includes("might"), "属性のないパッシブは出る");
});

test("新しいパッシブ: 会心・被ダメ軽減（下限あり）・回復・特効・攻撃間隔の短縮（上限あり）", () => {
  const g = sim("sword");
  g.passives = { guard: 8 }; g.ppow = { guard: 24 };
  g.applyChoice({ kind: "curse", id: "shell", lv: 0, rar: "SR" });
  g.applyChoice({ kind: "sigil", id: "iron_vow", lv: 0, rar: "UR" });
  g.hurtPlayer(100, "x");
  assert.equal(g.maxHp - g.hp, 100 * D.guard_floor, "受けるダメージは4割より下がらない");
  const t = sim("sword");
  t.passives = { tempo: 8 }; t.ppow = { tempo: 30 };
  t.dirtyTags();
  const base = sim("sword").weaponCd("sword", 0, false);
  assert.ok(Math.abs(t.weaponCd("sword", 0, false) - base * (1 - D.cd_cut_max)) < 1e-9, "攻撃間隔の短縮は上限まで");
  const h = sim("sword");
  h.passives = { regen: 1 }; h.ppow = { regen: 1 };
  h.hp = 50;
  for (let i = 0; i < 60 * 10 + 1; i++) h.step(STEP, 0, 0);
  assert.ok(h.hp >= 50 + D.passives.regen.per - 1e-9, "10秒で回復");
});

test("新しい呪い: 血の渇きは30%で止まり、早熟はパッシブが少ない時だけ出て武器Lvがすぐ上がる", () => {
  const r = sim("sword");
  r.applyChoice({ kind: "curse", id: "thirst", lv: 0, rar: "SR" });
  for (let i = 0; i < 60 * 200; i++) { r.step(STEP, 0, 0); if (r.result !== "") break; r.enemies.length = 0; r.eshots.length = 0; }
  assert.ok(r.hp >= r.maxHp * 0.3 - 1e-9, `HP ${r.hp}`);
  const p = sim("sword", { curses: true });
  p.passives = { might: 1, haste: 1, swift: 1, area: 1 };
  for (let i = 0; i < 300; i++) assert.ok(!p.rollChoices().some((c) => c.id === "precocious"), "パッシブ4つ以上では出ない");
  const q = sim("sword");
  q.applyChoice({ kind: "curse", id: "precocious", lv: 0, rar: "SR" });
  assert.equal(q.weapons.sword, 5);
  assert.equal(q.passiveSlots(), D.passive_slots - 2);
  const q2 = new RunSim(D, { run_id: "b", seed: 1, mode: "short", weapon: "sword", checkpoint: q.snapshot() });
  assert.equal(q2.weapons.sword, 5, "再開で二重に上がらない");
});

test("刻印: 不屈は1回だけ HP1 で耐え、再開しても使った印は残る", () => {
  const r = sim("sword");
  r.applyChoice({ kind: "sigil", id: "undying", lv: 0, rar: "UR" });
  r.hurtPlayer(9999, "x");
  assert.ok(r.hp === 1 && r.result === "");
  const r2 = new RunSim(D, { run_id: "b", seed: 1, mode: "short", weapon: "sword", checkpoint: r.snapshot() });
  r2.hero.iframe = 0;
  r2.hurtPlayer(9999, "x");
  assert.equal(r2.result, "player_death");
});
