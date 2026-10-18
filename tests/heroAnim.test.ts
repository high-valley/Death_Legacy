// 主人公の絵の動き（描画側だけの計算）
import assert from "node:assert/strict";
import { test } from "node:test";
import { HeroAnim } from "../src/view/heroAnim.ts";

const dt = 1 / 60;

test("立ち止まっている時は歩かず、ほぼ傾かない（息づかいだけ）", () => {
  const a = new HeroAnim();
  for (let i = 0; i < 60; i++) a.update(dt, 0, 0, 1);
  const p = a.pose();
  assert.ok(a.move < 0.05 && Math.abs(p.rot) < 0.01 && Math.abs(p.dy) < 0.5);
});

test("歩くと弾み、一定の間隔で足を着く（土ぼこりの合図）", () => {
  const a = new HeroAnim();
  let steps = 0, minDy = 0;
  for (let i = 0; i < 120; i++) {
    if (a.update(dt, i * 3.5, 0, 1)) steps++;
    minDy = Math.min(minDy, a.pose().dy);
  }
  assert.ok(a.move > 0.9, String(a.move));
  assert.ok(steps >= 6 && steps <= 14, String(steps));
  assert.ok(minDy < -3, "体が浮く");
  assert.equal(a.left, false);
  a.update(dt, 400, 0, -1);
  assert.equal(a.left, true, "左へ進めば左を向く");
});

test("剣を振ると、ためてから振る向きへ踏み込み、終われば元に戻る。回りは交互", () => {
  const a = new HeroAnim();
  a.update(dt, 0, 0, 1);
  a.attack(Math.PI);   // 左へ振る
  const side1 = a.side;
  assert.equal(a.left, true, "振る向きを向く");
  let minDx = 0, maxSwing = 0;
  for (let t = 0; t < HeroAnim.ATK + 0.05; t += dt) {
    a.update(dt, 0, 0, 1);
    const p = a.pose();
    minDx = Math.min(minDx, p.dx);
    maxSwing = Math.max(maxSwing, p.swing);
  }
  assert.ok(minDx < -8, "左へ踏み込む");
  assert.ok(maxSwing > 0.5, "残像が出る");
  assert.equal(a.atkT, -1);
  assert.ok(Math.abs(a.pose().dx) < 0.01, "元に戻る");
  a.attack(0);
  assert.equal(a.side, -side1);
  a.attack(0);   // 同じフレームの2本目（両方向の剣）は数えない
  assert.equal(a.side, -side1);
});

test("ワープ（再開など）は歩きに数えない", () => {
  const a = new HeroAnim();
  a.update(dt, 0, 0, 1);
  a.update(dt, 5000, 0, 1);
  assert.ok(a.move < 0.01);
});
