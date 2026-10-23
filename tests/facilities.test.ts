// 拠点の施設（堂守の亡霊、ADR 023）
import assert from "node:assert/strict";
import { test } from "node:test";
import { uuid } from "../src/meta/metaService.ts";
import { RunSim } from "../src/sim/runSim.ts";
import { D, World } from "./helpers.ts";

/** 亡霊を n 体生まれさせ、供物を足しておく */
function withGhosts(n: number, offer = 50): World {
  const w = new World();
  for (let i = 0; i < n; i++) {
    w.die(w.sortie("", "short", ["sword", "fire", "bow"][i % 3]), 120);
  }
  w.repo.data.offerings.earned += offer;
  return w;
}

test("施設は条件を満たして供物を払うと建ち、戻せない（樹をほどいても戻らない）", () => {
  const w = new World();
  assert.match(w.meta.buildBlock("chinkon"), /亡霊が生まれる/);
  const v = withGhosts(1, 20);
  const free = v.meta.offeringsFree();
  assert.equal(v.meta.buildBlock("chinkon"), "");
  assert.ok(v.meta.build("chinkon"));
  assert.equal(v.meta.offeringsFree(), free - D.facilities.find((f) => f.id === "chinkon")!.cost);
  assert.ok(!v.meta.build("chinkon"), "2回は建たない");
  v.meta.resetTree();
  assert.equal(v.meta.offeringsFree(), free - 6, "樹をほどいても施設の分は戻らない");
  v.reload();
  assert.ok(v.meta.built("chinkon"), "セーブに残る");
});

test("住まわせた亡霊は連れていけず・喰らえず、保管庫の数には入る。外せばまた選べる", () => {
  const w = withGhosts(3);
  assert.ok(w.meta.build("armory"));
  const g = w.meta.storedGhosts()[0];
  assert.ok(w.meta.station(g.ghost_id, "armory"));
  assert.ok(!w.meta.station(w.meta.storedGhosts()[1].ghost_id, "armory"), "満員");
  assert.equal(w.meta.storedGhosts().length, 3);
  assert.equal(w.meta.availableGhosts().length, 2);
  assert.equal(w.sortie(g.ghost_id), null, "連れていけない");
  assert.equal(w.sortie(g.ghost_id, "short", "sword", 1, "nameless", "devour"), null, "喰らえない");
  assert.ok(w.meta.unstation(g.ghost_id));
  assert.ok(w.sortie(g.ghost_id) !== null);
});

test("出撃中は建てる・住まわせる・外すができない", () => {
  const w = withGhosts(3);
  w.meta.build("armory");
  const g = w.meta.storedGhosts()[0];
  w.sortie();
  assert.ok(!w.meta.station(g.ghost_id, "armory"));
  assert.ok(!w.meta.build("chinkon"));
});

test("武具の間: 住む亡霊の武器のタグが1点入り、出撃時に写すので再開しても変わらない", () => {
  const w = withGhosts(3);
  w.meta.build("armory");
  const fireGhost = w.meta.storedGhosts().find((g) => g.primary_weapon_id === "fire")!;
  w.meta.station(fireGhost.ghost_id, "armory");
  const r = w.sortie()!;
  assert.equal(r.tagPoints().fire, 1);
  w.repo.data.ghosts.find((g) => g.ghost_id === fireGhost.ghost_id)!.stationed_at = undefined;  // 途中で外れても
  assert.equal(w.resume().tagPoints().fire, 1, "出撃時の効果のまま");
});

test("鎮魂堂: 住む亡霊1体につき決まった供物×生き延びた割合で増え、リタイアでは増えない", () => {
  const w = withGhosts(1);
  w.meta.build("chinkon");
  const g = w.meta.storedGhosts()[0];
  w.meta.station(g.ghost_id, "chinkon");
  const r = w.sortie()!;
  const rec = w.die(r, 90);
  assert.equal(rec.facility_offer, Math.round(D.facilities.find((f) => f.id === "chinkon")!.effect.offer! * 0.5));
  const r2 = w.sortie()!;
  r2.t = 170; r2.end("retired");
  const rec2 = w.meta.settle(r2.summary(), "retired")!;
  assert.equal(rec2.facility_offer, 0, "すぐ辞めて稼ぐことはできない");
});

test("供養塔: 弔った回数5回ごとに力が刻まれる（建てていなければ効かない）", () => {
  const w = withGhosts(6);
  for (const g of w.meta.storedGhosts().slice(0, 5)) w.meta.mourn(g.ghost_id);
  assert.equal(w.repo.data.progress.mourned_count, 5);
  assert.equal(w.meta.memorialSteps().length, 0, "建てる前");
  assert.ok(w.meta.build("memorial"));
  assert.equal(w.meta.memorialSteps().length, 1);
  const before = new RunSim(D, { run_id: "x", seed: 1 }).ghostAtkMul();
  const r = w.sortie()!;
  assert.equal(r.facility.ghost_atk, 0.05);
  assert.ok(Math.abs(r.ghostAtkMul() - before * 1.05) < 1e-9, "亡霊の攻撃 +5% が戦闘に届く");
});

test("弔う・満杯の入れ替えで成仏した亡霊は施設から外れる", () => {
  const w = withGhosts(1);
  w.meta.build("chinkon");
  const g = w.meta.storedGhosts()[0];
  w.meta.station(g.ghost_id, "chinkon");
  w.meta.mourn(g.ghost_id);
  assert.equal(w.meta.residents("chinkon").length, 0);
  assert.equal(w.meta.getGhost(g.ghost_id)!.stationed_at, undefined);
});

test("v3 のセーブ: 施設は空、弔った回数は残っている記録から数える", () => {
  const w = new World();
  w.kv.setItem("test", JSON.stringify({
    schema_version: 3, ghosts: [{ ghost_id: uuid(), status: "released", consumed_at: "2026-10-01T00:00:00" }, { ghost_id: uuid(), status: "released" }],
    run_history: [], settled_runs: [], progress: { generation: 2 },
  }));
  w.reload();
  assert.equal(w.repo.data.schema_version, 7);
  assert.deepEqual(w.repo.data.buildings, []);
  assert.equal(w.repo.data.progress.mourned_count, 1);
});
