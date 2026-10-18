// フェーズ3: 亡霊の3択（連れていく / 喰らう / 弔う）と穢れ・怨霊
import assert from "node:assert/strict";
import { test } from "node:test";
import { STEP } from "../src/sim/runSim.ts";
import { D, World } from "./helpers.ts";

/** 亡霊を1体作って id を返す（120秒生存 = 3分ランで英霊） */
function makeGhost(w: World, t = 120): string {
  const out = w.die(w.sortie(), t);
  w.meta.resolveHeirloom(-1);
  return out.new_ghost_id;
}

test("喰らう: 同行せず力を取り込み、ラン後に怨霊になる（穢れ +1）", () => {
  const w = new World();
  const gid = makeGhost(w);
  const g = w.meta.getGhost(gid)!;
  const base = w.sortie()!;
  w.meta.abandonActive();
  w.meta.resolveHeirloom(-1);
  const r = w.sortie(gid, "", "short", "sword", 2, "nameless", "devour")!;
  assert.equal(r.ghost, null, "喰らった亡霊は横にいない");
  assert.ok(r.devour && r.devour.rec.ghost_id === gid);
  assert.ok(!r.solo, "単独の経験値ボーナスはつかない");
  const pw = w.meta.devourPower(g);
  assert.ok(Math.abs(r.mightMul() - (1 + pw.might)) < 1e-9);
  assert.equal(r.maxHp, Math.round(base.maxHp * (1 + pw.hp)));
  const runs = w.repo.data.progress.companion_runs;
  const out = w.die(r, 30);
  assert.equal(out.devoured, g.display_name);
  assert.equal(w.meta.getGhost(gid)!.status, "wraith");
  assert.equal(w.meta.taint(), 1);
  assert.equal(w.repo.data.progress.companion_runs, runs, "喰らったランは「連れて出撃」に数えない");
  assert.ok(!w.meta.storedGhosts().some((x) => x.ghost_id === gid), "保管庫からは消える");
  // 終了処理をもう一度呼んでも二重にならない
  w.meta.settle(r.summary(), "player_death");
  assert.equal(w.meta.taint(), 1);
});

test("怨霊はランの途中で現れ、倒すと祓える（穢れ −1・供物）", () => {
  const w = new World();
  const gid = makeGhost(w);
  w.die(w.sortie(gid, "", "short", "sword", 2, "nameless", "devour"), 10);
  w.meta.resolveHeirloom(-1);
  const r = w.sortie("", "", "short", "sword", 3)!;
  assert.equal(w.repo.data.active_run!.wraith_id, gid, "出撃時に現れる怨霊が決まる");
  r.t = D.run_length.short * D.rites.wraith.at - STEP / 2;
  r.step(STEP, 0, 0);
  assert.ok(r.wraith && r.wraithSpawned, "予定の時間に現れる");
  assert.equal(r.wraith.def.color, w.meta.tier(w.meta.getGhost(gid)!.tier_id).color, "色は元の亡霊の等級");
  r.wraith.hp = 0;
  r.step(STEP, 0, 0);
  assert.ok(r.wraithDead && r.wraith === null);
  const earned = w.repo.data.offerings.earned;
  const out = w.die(r);
  assert.equal(out.purified, w.meta.getGhost(gid)!.display_name);
  assert.equal(w.meta.getGhost(gid)!.status, "purified");
  assert.equal(w.meta.taint(), 0);
  assert.ok(w.repo.data.offerings.earned - earned >= D.rites.wraith.purify_offerings);
});

test("怨霊を倒せなければ残り、次のランでまた現れる", () => {
  const w = new World();
  const gid = makeGhost(w);
  w.die(w.sortie(gid, "", "short", "sword", 2, "nameless", "devour"), 10);
  w.meta.resolveHeirloom(-1);
  const out = w.die(w.sortie("", "", "short", "sword", 3), 20);
  assert.equal(out.wraith_escaped, w.meta.getGhost(gid)!.display_name);
  assert.equal(w.meta.taint(), 1);
  w.meta.resolveHeirloom(-1);
  w.sortie("", "", "short", "sword", 4);
  assert.equal(w.repo.data.active_run!.wraith_id, gid);
});

test("穢れの分だけ敵が硬くなり、清めの塩で半分になる", () => {
  const w = new World();
  const gid = makeGhost(w);
  w.die(w.sortie(gid, "", "short", "sword", 2, "nameless", "devour"), 10);
  w.meta.resolveHeirloom(-1);
  const per = D.rites.wraith.enemy_hp_per_taint;
  assert.ok(Math.abs(w.meta.taintHpBonus() - per) < 1e-9);
  const r = w.sortie("", "", "short", "sword", 5)!;
  const e = r.spawnEnemy("chaser");
  assert.ok(Math.abs(e.maxHp - D.enemies.chaser.hp * (1 + per)) < 1e-9);
  w.meta.abandonActive();
  w.meta.resolveHeirloom(-1);
  w.repo.data.offerings.earned += 10;
  assert.ok(w.meta.openNode("pure1"));
  assert.ok(Math.abs(w.meta.taintHpBonus() - per * 0.5) < 1e-9);
});

test("弔う: その場で成仏して供物になり、もう選べない", () => {
  const w = new World();
  const gid = makeGhost(w);
  const g = w.meta.getGhost(gid)!;
  const n = w.meta.mournOfferings(g);
  assert.equal(n, Math.round(D.rites.mourn.base + D.rites.mourn.per_mult * w.meta.tier(g.tier_id).mult));
  const before = w.meta.offeringsFree();
  assert.equal(w.meta.mourn(gid), n);
  assert.equal(w.meta.offeringsFree(), before + n);
  assert.equal(w.meta.getGhost(gid)!.status, "released");
  assert.equal(w.meta.mourn(gid), 0, "2回は弔えない");
  assert.equal(w.sortie(gid), null, "弔った亡霊は連れていけない");
  assert.equal(w.meta.taint(), 0, "弔っても穢れは増えない");
});

test("中断から再開: 喰らった力・怨霊の状態が戻り、倒した怨霊は出直さない", () => {
  const w = new World();
  const a = makeGhost(w), b = makeGhost(w, 60);
  w.die(w.sortie(a, "", "short", "sword", 2, "nameless", "devour"), 10);
  w.meta.resolveHeirloom(-1);
  // 怨霊 a が出るランで、b を喰らって出撃
  const r = w.sortie(b, "", "short", "sword", 6, "nameless", "devour")!;
  r.t = D.run_length.short * 0.5;
  r.step(STEP, 0, 0);
  assert.ok(r.wraith);
  w.meta.checkpoint(r.run_id, r.snapshot());
  w.reload();
  const r2 = w.resume();
  assert.ok(r2.devour && r2.devour.rec.ghost_id === b, "喰らった力は再開後も");
  assert.ok(r2.wraith && !r2.wraithDead, "倒す前に中断した怨霊は出直す");
  r2.wraith.hp = 0;
  r2.step(STEP, 0, 0);
  w.meta.checkpoint(r2.run_id, r2.snapshot());
  w.reload();
  const r3 = w.resume();
  assert.ok(r3.wraithDead && r3.wraith === null, "倒した怨霊は出ない");
  // 放棄しても、倒した記録は残って祓える
  const out = w.meta.abandonActive()!;
  assert.equal(out.purified, w.meta.getGhost(a)!.display_name);
  assert.equal(w.meta.getGhost(b)!.status, "wraith", "放棄しても喰らった亡霊は怨霊になる");
  assert.equal(w.meta.taint(), 1);
});
