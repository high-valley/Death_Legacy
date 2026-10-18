// 戦場の描画。RunSim の状態を読むだけ（書き換えない）。仮アセットなので図形で描く。
// スマホでも軽く描けるように: 画面外は描かない / 同じ色の敵は続けて描く。
import type { RunSim, SimEvent } from "../sim/runSim.ts";
import { C } from "./theme.ts";

type Fx = Extract<SimEvent, { type: "fx" }> & { t: number };

export class BattleView {
  fx: Fx[] = [];
  shake = 0;
  zoom = 1;
  private buckets = new Map<string, number[]>();   // 色 → [x, y, r, x, y, r, ...]

  addFx(e: Extract<SimEvent, { type: "fx" }>): void {
    if (this.fx.length < 260) this.fx.push({ ...e, t: 0 });
  }

  addShake(a: number): void {
    this.shake = Math.min(12, this.shake + a);
  }

  clear(): void {
    this.fx.length = 0;
    this.shake = 0;
  }

  update(dt: number): void {
    this.shake *= Math.pow(0.85, dt * 60);
    let j = 0;
    for (const f of this.fx) {
      f.t += dt;
      if (f.t < f.dur) this.fx[j++] = f;
    }
    this.fx.length = j;
  }

  draw(ctx: CanvasRenderingContext2D, sim: RunSim, W: number, H: number, touch: boolean): void {
    const h = sim.hero;
    const z = (this.zoom = touch ? Math.min(W, H) / 520 : Math.min(W / 1280, H / 720) * 1.05);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    ctx.save();
    ctx.translate(W / 2 + sx, H / 2 + sy);
    ctx.scale(z, z);
    ctx.translate(-h.x, -h.y);
    const hw = W / 2 / z + 40, hh = H / 2 / z + 40;
    const x0 = h.x - hw, x1 = h.x + hw, y0 = h.y - hh, y1 = h.y + hh;
    const vis = (x: number, y: number, r: number): boolean => x + r > x0 && x - r < x1 && y + r > y0 && y - r < y1;

    // 地面: 格子と墓標（座標から決まる飾り）
    ctx.strokeStyle = "#151b22";
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    const g = 96;
    for (let x = Math.floor(x0 / g) * g; x < x1; x += g) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = Math.floor(y0 / g) * g; y < y1; y += g) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    ctx.fillStyle = "#1c232c";
    ctx.beginPath();
    for (let x = Math.floor(x0 / 288) * 288; x < x1; x += 288) {
      for (let y = Math.floor(y0 / 288) * 288; y < y1; y += 288) {
        const hh2 = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
        if (hh2 % 3) continue;
        const ox = hh2 % 200, oy = (hh2 >>> 8) % 200;
        ctx.rect(x + ox, y + oy, 14, 20);
        ctx.rect(x + ox - 4, y + oy + 4, 22, 5);
      }
    }
    ctx.fill();

    // 炎
    ctx.lineWidth = 1.5;
    for (const zn of sim.zones) {
      if (!vis(zn.x, zn.y, zn.r)) continue;
      ctx.fillStyle = zn.ghost ? "rgba(143,240,224,.13)" : "rgba(240,120,60,.16)";
      ctx.beginPath(); ctx.arc(zn.x, zn.y, zn.r, 0, 7); ctx.fill();
      ctx.strokeStyle = zn.ghost ? "rgba(143,240,224,.4)" : "rgba(240,150,80,.45)";
      ctx.stroke();
    }
    // ボスの叩きつけ予告
    for (const f of this.fx) {
      if (f.kind !== "warn") continue;
      const k = f.t / f.dur;
      ctx.fillStyle = `rgba(226,85,90,${0.1 + 0.22 * k})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * k, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(226,85,90,.75)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.stroke();
    }
    // 経験値
    ctx.fillStyle = C.candle;
    ctx.beginPath();
    for (const gm of sim.gems) if (vis(gm.x, gm.y, 4)) ctx.rect(gm.x - 3, gm.y - 3, 6, 6);
    ctx.fill();

    // 敵: 色ごとに並べて描く（塗り色の切り替えを減らす。重なりの多い大きな1図形にするとかえって遅い）
    for (const b of this.buckets.values()) b.length = 0;
    for (const e of sim.enemies) {
      if (!vis(e.x, e.y, e.r)) continue;
      const col = e.flash > 0 ? "#ffffff" : e.def.color;
      let b = this.buckets.get(col);
      if (!b) { b = []; this.buckets.set(col, b); }
      b.push(e.x, e.y, e.r);
    }
    for (const [col, b] of this.buckets) {
      if (b.length === 0) continue;
      ctx.fillStyle = col;
      for (let i = 0; i < b.length; i += 3) {
        ctx.beginPath();
        ctx.arc(b[i], b[i + 1], b[i + 2], 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 敵の付属表示（突進の予告線、精鋭・ボスの印）
    ctx.lineWidth = 1.5;
    for (const e of sim.enemies) {
      if (e.kind === "charger" && e.phase === 1) {
        ctx.strokeStyle = C.blood;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + e.dx * 120, e.y + e.dy * 120); ctx.stroke();
      } else if ((e.kind === "boss" || e.kind === "elite") && vis(e.x, e.y, e.r)) {
        ctx.strokeStyle = C.night; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 0.55, 0, 7); ctx.stroke();
        ctx.lineWidth = 1.5;
      } else if (e.kind === "wraith" && vis(e.x, e.y, e.r + 12)) {
        // 怨霊: 揺らぐ二重の輪（色は元の亡霊の等級）
        const wob = Math.sin(sim.t * 5) * 3;
        ctx.strokeStyle = C.taint; ctx.lineWidth = 2;
        ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 6 + wob, 0, 7); ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 13 - wob, 0, 7); ctx.stroke();
        ctx.globalAlpha = 1; ctx.lineWidth = 1.5;
      }
    }

    if (sim.ghost) this.drawGhost(ctx, sim);
    // 主人公
    const blink = h.iframe > 0 && Math.floor(sim.t * 30) % 2 === 0;
    ctx.globalAlpha = blink ? 0.4 : 1;
    ctx.fillStyle = h.flash > 0 ? "#ffffff" : C.bone;
    ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, 7); ctx.fill();
    ctx.fillStyle = C.candle;
    ctx.beginPath(); ctx.arc(h.x + h.fx * 6, h.y + h.fy * 6, 3.5, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;

    // 矢
    ctx.lineWidth = 2;
    for (const ghost of [false, true]) {
      ctx.strokeStyle = ghost ? C.soul : "#f2e3b3";
      ctx.beginPath();
      for (const s of sim.shots) {
        if (s.ghost !== ghost) continue;
        ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.02, s.y - s.vy * 0.02);
      }
      ctx.stroke();
    }
    // 敵弾
    for (const boss of [false, true]) {
      ctx.fillStyle = boss ? "#ff8a8e" : "#b9a6ff";
      ctx.beginPath();
      for (const s of sim.eshots) {
        if ((s.cause === "boss") !== boss || !vis(s.x, s.y, 5)) continue;
        ctx.moveTo(s.x + 4.5, s.y); ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    // 演出
    for (const f of this.fx) {
      const k = f.t / f.dur;
      if (f.kind === "arc") {
        ctx.strokeStyle = f.ghost ? `rgba(143,240,224,${1 - k})` : `rgba(232,239,233,${1 - k})`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.75 + 0.25 * k), f.a - f.arc / 2, f.a + f.arc / 2); ctx.stroke();
      } else if (f.kind === "boom") {
        ctx.strokeStyle = `rgba(255,140,120,${1 - k})`;
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.stroke();
      } else if (f.kind === "poof") {
        if (!vis(f.x, f.y, 20)) continue;
        ctx.globalAlpha = (1 - k) * 0.5;
        ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.arc(f.x, f.y, 5 + 12 * k, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
    ctx.lineWidth = 1;
  }

  private drawGhost(ctx: CanvasRenderingContext2D, sim: RunSim): void {
    const g = sim.ghost!;
    const tier = sim.D.tiers.find((t) => t.id === g.rec.tier_id) ?? sim.D.tiers[0];
    ctx.globalAlpha = 0.45 + 0.25 * sim.ghostUnlock();
    ctx.fillStyle = "#d9fff8";
    ctx.beginPath();
    ctx.arc(g.x, g.y - 4, 11, Math.PI, 0);
    ctx.lineTo(g.x + 11, g.y + 10);
    for (let i = 0; i < 4; i++) ctx.lineTo(g.x + 11 - (i + 0.5) * 5.5, g.y + (i % 2 ? 10 : 5));
    ctx.lineTo(g.x - 11, g.y + 10);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = tier.color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
