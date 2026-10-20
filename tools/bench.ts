// 戦闘ロジックの速度計測（敵300体が主人公に群がる最悪ケース）。
//   node tools/bench.ts
import { readFileSync } from "node:fs";
import { loadBalance } from "../src/data/dataLoader.ts";
import { RunSim, STEP } from "../src/sim/runSim.ts";

const { D } = loadBalance(JSON.parse(readFileSync(new URL("../data/balance.json", import.meta.url), "utf8")));
const s = new RunSim(D, { run_id: "bench", seed: 1, mode: "full", weapon: "fire" });
s.hp = 1e9;
s.maxHp = 1e9;
s.t = 300;
s.weapons = { sword: 10, bow: 10, fire: 10 };
s.rank = { sword: 2, bow: 2, fire: 2 };   // 重い形（最上位のランク）で測る
for (let i = 0; i < 300; i++) {
  const e = s.spawnEnemy(["chaser", "charger", "shooter"][i % 3]);
  e.hp = 1e6;
  e.maxHp = 1e6;
}
s.spawnAcc = -1e9;
let t0 = performance.now(), worst = 0;
for (let i = 0; i < 1200; i++) {
  const a = performance.now();
  s.step(STEP, Math.cos(i * 0.01), Math.sin(i * 0.013));
  s.drainEvents();
  worst = Math.max(worst, performance.now() - a);
  if (i % 300 === 299) {
    console.log(`tick ${i + 1}: avg ${((performance.now() - t0) / 300).toFixed(2)} ms, enemies ${s.enemies.length}`);
    t0 = performance.now();
  }
}
console.log(`worst ${worst.toFixed(2)} ms`);
