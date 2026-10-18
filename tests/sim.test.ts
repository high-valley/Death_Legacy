// 戦闘ロジックとデータのテスト
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBalance } from "../src/data/dataLoader.ts";
import { RunSim, STEP } from "../src/sim/runSim.ts";
import { followOrigin, JOY_RADIUS, stickVector } from "../src/input/stick.ts";
import { botStep, D, loaded, RAW_TEXT } from "./helpers.ts";

test("balance.json に検証エラーがない", () => {
  assert.deepEqual(loaded.errors, []);
});

test("壊れたデータ（進化欠落・レア度不足・ボス欠落）を検出する", () => {
  const raw = JSON.parse(RAW_TEXT);
  raw.weapons.bow.grades.pop();
  raw.rarities.pop();
  delete raw.enemies.boss;
  const { errors } = loadBalance(raw);
  assert.ok(errors.length >= 3, errors.join(" / "));
});

test("タッチ操作: 大きくスワイプした後でも、少し逆に動かすだけで向きが変わる", () => {
  let o = { x: 100, y: 100 };
  const p = { x: 100, y: 100 };
  for (let i = 0; i < 20; i++) { p.x += 10; o = followOrigin(o, p); }
  assert.ok(Math.hypot(p.x - o.x, p.y - o.y) <= JOY_RADIUS + 0.01, "中心が指に付いてこない");
  assert.ok(stickVector(o, p).x > 0.99, "右に全速で進まない");
  for (let i = 0; i < 7; i++) { p.x -= 10; o = followOrigin(o, p); }
  assert.ok(stickVector(o, p).x < 0, "70px戻しても左へ向かない");
});

test("押し合い: 重なった小さい敵は離れ、精鋭は小さい敵を押しのける", () => {
  const r = new RunSim(D, { run_id: "sep", seed: 3, mode: "full", weapon: "sword" });
  r.weapons = {};
  const a = r.spawnEnemy("chaser", 600), b = r.spawnEnemy("chaser", 600), e = r.spawnEnemy("elite", 600), c = r.spawnEnemy("chaser", 600);
  b.x = a.x + 4; b.y = a.y;
  c.x = e.x + 6; c.y = e.y;
  for (let i = 0; i < 10; i++) r.step(STEP, 0, 0);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 15, "小さい敵どうしが離れない");
  assert.ok(Math.hypot(e.x - c.x, e.y - c.y) > 20, "精鋭が押しのけない");
});

test("敵300体でも1ティックが軽い", () => {
  const r = new RunSim(D, { run_id: "load", seed: 3, mode: "full", weapon: "fire" });
  r.hp = 1e9; r.t = 300; r.weapons = { sword: 5, bow: 5, fire: 5 };
  for (let i = 0; i < 300; i++) { const e = r.spawnEnemy(["chaser", "charger", "shooter"][i % 3]); e.hp = 1e6; e.maxHp = 1e6; }
  r.spawnAcc = -1e9;
  for (let i = 0; i < 120; i++) { r.step(STEP, 0, 0); r.drainEvents(); }   // 温める
  const t0 = performance.now();
  for (let i = 0; i < 600; i++) { r.step(STEP, Math.cos(i * 0.01), Math.sin(i * 0.013)); r.drainEvents(); }
  const ms = (performance.now() - t0) / 600;
  console.log(`    load: ${ms.toFixed(2)} ms/tick（敵${r.enemies.length}体・3武器Lv5） 60FPSの予算は16.7ms`);
  assert.ok(r.enemies.length >= 300);
  assert.ok(ms < 4, `1ティック ${ms.toFixed(2)}ms`);
});

function countRarity(altar: number): Record<string, number> {
  const r = new RunSim(D, { run_id: "x", seed: 5, mode: "short", weapon: "sword", card_mods: { altar, affinity: {}, seals: [] } });
  const c: Record<string, number> = { N: 0, R: 0, SR: 0, UR: 0, LR: 0 };
  for (let i = 0; i < 20000; i++) c[r.rollRarity()]++;
  return c;
}

test("祭壇で高レア率が上がる", () => {
  const c0 = countRarity(0), c10 = countRarity(10);
  console.log(`    rarity LR ${(c0.LR / 200).toFixed(1)}% → ${(c10.LR / 200).toFixed(1)}%,  N ${(c0.N / 200).toFixed(0)}% → ${(c10.N / 200).toFixed(0)}%`);
  assert.ok(c10.LR > c0.LR * 3 && c10.N < c0.N * 0.5);
});

test("LRで所持武器が進化し、進化済みの武器にLRは出ない", () => {
  const r = new RunSim(D, { run_id: "x", seed: 1, mode: "short", weapon: "sword" });
  r.weapons.sword = 3;
  r.pending = 1;
  r.applyChoice({ kind: "weapon", id: "sword", lv: 3, rar: "LR" });
  assert.ok(r.evolved.sword && r.weapons.sword === 4 && r.weaponName("sword") === "デュランダル");
  for (let i = 0; i < 200; i++) for (const c of r.rollChoices()) assert.ok(!(c.kind === "weapon" && c.id === "sword" && c.rar === "LR"));
});

test("レア度でパッシブ効果・武器Lvが変わる", () => {
  const r = new RunSim(D, { run_id: "x", seed: 1, mode: "short", weapon: "sword" });
  r.applyChoice({ kind: "passive", id: "might", lv: 0, rar: "UR" });
  r.applyChoice({ kind: "weapon", id: "bow", lv: 0, rar: "SR" });
  assert.ok(r.passives.might === 1 && Math.abs(r.ppow.might - 2.5) < 1e-9, "URパッシブは効果2.5倍");
  assert.ok(r.weapons.bow === 2 && Math.abs(r.wbonus.bow - 0.1) < 1e-9, "SR武器はLv+2・ダメージ+10%");
});

test("封印したカードは新規取得の候補に出ない", () => {
  const r = new RunSim(D, { run_id: "x", seed: 1, mode: "short", weapon: "sword", card_mods: { altar: 0, affinity: {}, seals: ["swift"] } });
  const ids = r.cardPool().map((o) => o.id);
  assert.ok(!ids.includes("swift") && ids.includes("might"));
  assert.deepEqual(r.cardPool().filter((o) => o.kind === "weapon").map((o) => o.id), ["sword"], "武器カードは主人公の武器だけ");
});

test("縁で出現率が上がる", () => {
  const rate = (af: Record<string, number>): number => {
    let n = 0;
    for (let i = 0; i < 2000; i++) {
      const r = new RunSim(D, { run_id: "x", seed: 1000 + i, mode: "short", weapon: "sword", card_mods: { altar: 0, affinity: af, seals: [] } });
      if (r.rollChoices().some((c) => c.id === "haste")) n++;
    }
    return n / 2000;
  };
  const f0 = rate({}), f4 = rate({ haste: 4 });
  console.log(`    affinity haste: ${(f0 * 100).toFixed(0)}% → ${(f4 * 100).toFixed(0)}%`);
  assert.ok(f4 > f0 * 1.2);
});

test("同seed・同入力で結果が一致する", () => {
  const digests: string[] = [];
  for (let k = 0; k < 2; k++) {
    const r = new RunSim(D, { run_id: "d", seed: 77, mode: "short", weapon: "bow", card_mods: { altar: 3, affinity: { fire: 2 }, seals: [] } });
    for (let i = 0; i < 60 * 50; i++) botStep(r);
    digests.push(`${r.kills}|${r.level}|${r.enemies.length}|${r.hp.toFixed(2)}|${JSON.stringify(r.weapons)}`);
  }
  assert.equal(digests[0], digests[1]);
});

test("ボットの手応え（参考値）", () => {
  const lines: string[] = [];
  for (const altar of [0, 10]) {
    let clears = 0;
    for (const s of [1, 2, 3, 5, 6, 7]) {
      const r = new RunSim(D, { run_id: "b", seed: s, mode: "short", weapon: ["sword", "bow", "fire"][s % 3], card_mods: { altar, affinity: {}, seals: [] } });
      for (let i = 0; r.result === "" && i < 60 * 400; i++) botStep(r);
      if (r.result === "boss_cleared") clears++;
    }
    lines.push(`祭壇${altar}: ${clears}/6 クリア`);
  }
  console.log(`    bot: ${lines.join(", ")}`);
});
