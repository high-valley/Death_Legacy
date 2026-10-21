// 戦場の描画。RunSim の状態を読むだけ（書き換えない）。仮アセットなので図形で描く。
// スマホでも軽く描けるように: 画面外は描かない / 同じ色の敵は続けて描く。
import type { Companion, RunSim, SimEvent } from "../sim/runSim.ts";
import { Art } from "./art.ts";
import { HeroAnim } from "./heroAnim.ts";
import { C, SERIF } from "./theme.ts";

type Fx = Extract<SimEvent, { type: "fx" }> & { t: number; side?: number };
interface Dust { x: number; y: number; vx: number; t: number }
interface Dmg { x: number; y: number; v: number; big: boolean; t: number }

const ease = (x: number): number => 1 - (1 - x) * (1 - x);

export class BattleView {
  fx: Fx[] = [];
  shake = 0;
  zoom = 1;
  private buckets = new Map<string, number[]>();   // 色 → [x, y, r, x, y, r, ...]
  dmgs: Dmg[] = [];
  private groundSrc = Art.file("ground");
  private groundPat: CanvasPattern | null = null;
  anim = new HeroAnim();
  private dust: Dust[] = [];

  /** ダメージ数字（多すぎる時は古いものから捨てる） */
  addDmg(e: { x: number; y: number; v: number; big: boolean }): void {
    if (this.dmgs.length >= 60) this.dmgs.shift();
    this.dmgs.push({ x: e.x + (Math.random() - 0.5) * 10, y: e.y, v: e.v, big: e.big, t: 0 });
  }

  addFx(e: Extract<SimEvent, { type: "fx" }>): void {
    if (this.fx.length >= 260) return;
    if (e.kind === "arc") {
      // 斬撃は描画側で少し長めに見せ、振る回りを交互にする。主人公の剣なら体も振る
      if (!e.ghost) this.anim.attack(e.a);
      this.fx.push({ ...e, dur: Math.max(e.dur, 0.28), t: 0, side: e.ghost ? (Math.sin(e.a * 7) > 0 ? 1 : -1) : this.anim.side });
      return;
    }
    this.fx.push({ ...e, t: 0 });
  }

  addShake(a: number): void {
    this.shake = Math.min(12, this.shake + a);
  }

  clear(): void {
    this.fx.length = 0;
    this.dmgs.length = 0;
    this.dust.length = 0;
    this.anim = new HeroAnim();
    this.shake = 0;
  }

  update(dt: number, sim: RunSim | null = null): void {
    if (sim) {
      const h = sim.hero;
      if (this.anim.update(dt, h.x, h.y, h.fx) && this.dust.length < 24) {
        const back = this.anim.left ? 1 : -1;
        this.dust.push({ x: h.x + back * 4, y: h.y + h.r * 1.1, vx: back * (14 + Math.random() * 10), t: 0 });
      }
    }
    let q = 0;
    for (const d of this.dust) {
      d.t += dt; d.x += d.vx * dt;
      if (d.t < 0.45) this.dust[q++] = d;
    }
    this.dust.length = q;
    this.shake *= Math.pow(0.85, dt * 60);
    let j = 0;
    for (const f of this.fx) {
      f.t += dt;
      if (f.t < f.dur) this.fx[j++] = f;
    }
    this.fx.length = j;
    let k = 0;
    for (const d of this.dmgs) {
      d.t += dt;
      if (d.t < 0.7) this.dmgs[k++] = d;
    }
    this.dmgs.length = k;
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

    // 地面: 絵（art/ground）があれば敷き詰める。無ければ格子と墓標（座標から決まる飾り）
    if (this.groundSrc && !this.groundPat) {
      const im = Art.image(this.groundSrc);
      if (im) this.groundPat = ctx.createPattern(im, "repeat");
    }
    if (this.groundPat) {
      ctx.fillStyle = this.groundPat;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = "rgba(8,10,14,.35)";
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    } else this.drawFloor(ctx, x0, x1, y0, y1, z);

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

    // 敵: 絵（art/sprite_enemy_<種類>）があれば絵、無ければ色ごとに並べて丸を描く
    for (const b of this.buckets.values()) b.length = 0;
    for (const e of sim.enemies) {
      if (!vis(e.x, e.y, e.r)) continue;
      const im = this.enemyFrame(e.kind, e, sim.t);
      if (im) {
        this.drawSprite(ctx, im, e.x, e.y - e.r * 0.3, e.r * (e.kind === "chaser" || e.kind === "shooter" ? 4.6 : e.kind === "charger" ? 3.6 : 3.2), h.x < e.x);
        if (e.flash > 0 || e.freezeT > 0 || e.slowT > 0) {
          ctx.globalAlpha = e.flash > 0 ? 0.55 : 0.35;
          ctx.fillStyle = e.flash > 0 ? "#ffffff" : "#9fdcff";
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 7); ctx.fill();
          ctx.globalAlpha = 1;
        }
        continue;
      }
      const col = e.flash > 0 ? "#ffffff" : e.freezeT > 0 ? "#cdeeff" : e.slowT > 0 ? "#7fb2cf" : e.def.color;
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
      } else if ((e.kind === "boss" || e.kind === "elite") && vis(e.x, e.y, e.r) && !this.sprite(`sprite_enemy_${e.kind}`)) {
        ctx.strokeStyle = C.night; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 0.55, 0, 7); ctx.stroke();
        ctx.lineWidth = 1.5;
      } else if (e.kind === "wraith" && vis(e.x, e.y, e.r + 12) && !this.sprite("sprite_enemy_wraith")) {
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

    for (const g of sim.ghosts) this.drawGhost(ctx, sim, g);
    // 主人公（art/sprite_hero_<武器> があれば絵。左右の向きは移動方向で反転）
    const blink = h.iframe > 0 && Math.floor(sim.t * 30) % 2 === 0;
    ctx.globalAlpha = blink ? 0.4 : 1;
    const him = this.heroFrame(sim.mainWeapon);
    if (him) {
      this.drawHero(ctx, sim, him);
    } else {
      ctx.fillStyle = h.flash > 0 ? "#ffffff" : C.bone;
      ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, 7); ctx.fill();
      ctx.fillStyle = C.candle;
      ctx.beginPath(); ctx.arc(h.x + h.fx * 6, h.y + h.fy * 6, 3.5, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 矢
    ctx.lineWidth = 2;
    for (const ghost of [false, true]) {
      ctx.strokeStyle = ghost ? C.soul : "#f2e3b3";
      ctx.beginPath();
      for (const s of sim.shots) {
        if (s.ghost !== ghost || s.kind !== "arrow") continue;
        ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.02, s.y - s.vy * 0.02);
      }
      ctx.stroke();
    }
    // 氷の刃（進む向きにとがった菱形）
    ctx.fillStyle = "#bfe9ff";
    for (const s of sim.shots) {
      if (s.kind !== "ice" || !vis(s.x, s.y, 10)) continue;
      const l = Math.hypot(s.vx, s.vy) || 1, ux = s.vx / l, uy = s.vy / l;
      ctx.beginPath();
      ctx.moveTo(s.x + ux * 10, s.y + uy * 10);
      ctx.lineTo(s.x - uy * 3.5, s.y + ux * 3.5);
      ctx.lineTo(s.x - ux * 7, s.y - uy * 7);
      ctx.lineTo(s.x + uy * 3.5, s.y - ux * 3.5);
      ctx.closePath(); ctx.fill();
    }
    // 投げ斧（回転する刃）
    for (const s of sim.shots) {
      if (s.kind !== "axe" || !vis(s.x, s.y, s.rad + 4)) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.spin ?? 0);
      ctx.fillStyle = s.ghost ? C.soul : "#d9d2c0";
      ctx.beginPath();
      ctx.moveTo(-s.rad * 0.2, -s.rad); ctx.quadraticCurveTo(s.rad * 1.1, -s.rad * 0.9, s.rad * 0.9, 0);
      ctx.quadraticCurveTo(s.rad * 1.1, s.rad * 0.9, -s.rad * 0.2, s.rad); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = s.ghost ? C.soul : "#7a5a36"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-s.rad * 1.2, 0); ctx.lineTo(s.rad * 0.4, 0); ctx.stroke();
      ctx.restore();
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
        if (vis(f.x, f.y, f.r * 1.1)) this.drawSlash(ctx, f, !f.ghost && !!sim.evolved.sword);
      } else if (f.kind === "thrust") {
        // 槍の突き: 細く伸びる光
        const ux = Math.cos(f.a), uy = Math.sin(f.a), reach = f.len * Math.min(1, k * 2.5);
        ctx.strokeStyle = f.ghost ? `rgba(143,240,224,${1 - k})` : `rgba(240,226,190,${1 - k})`;
        ctx.lineWidth = f.w * (1 - k * 0.6);
        ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(f.x + ux * 10, f.y + uy * 10); ctx.lineTo(f.x + ux * reach, f.y + uy * reach); ctx.stroke();
        ctx.lineCap = "butt";
      } else if (f.kind === "bolt") {
        // 雷: ジグザグの線（毎フレーム少し揺らす）
        ctx.strokeStyle = f.ghost ? `rgba(143,240,224,${1 - k})` : `rgba(214,196,255,${1 - k})`;
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath();
        ctx.moveTo(f.pts[0], f.pts[1]);
        for (let i = 2; i < f.pts.length; i += 2) {
          const px = f.pts[i - 2], py = f.pts[i - 1], qx = f.pts[i], qy = f.pts[i + 1];
          const mx = (px + qx) / 2 + (Math.random() - 0.5) * 18, my = (py + qy) / 2 + (Math.random() - 0.5) * 18;
          ctx.lineTo(mx, my); ctx.lineTo(qx, qy);
        }
        ctx.stroke();
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
    // ダメージ数字
    if (this.dmgs.length) {
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,.7)";
      for (const d of this.dmgs) {
        if (!vis(d.x, d.y, 20)) continue;
        const k = d.t / 0.7;
        ctx.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
        ctx.font = `700 ${d.big ? 17 : 13}px ${SERIF}`;
        const y = d.y - 8 - k * 22;
        ctx.strokeText(String(d.v), d.x, y);
        ctx.fillStyle = d.big ? "#ffb35c" : "#f3eee2";
        ctx.fillText(String(d.v), d.x, y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    }
    ctx.restore();
    ctx.lineWidth = 1;
  }

  private drawFloor(ctx: CanvasRenderingContext2D, x0: number, x1: number, y0: number, y1: number, z: number): void {
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
  }

  private sprites = new Map<string, string | null>();
  private frameKeys = new Map<string, string[]>();
  private silCache = new WeakMap<HTMLImageElement, HTMLCanvasElement>();

  /** コマ絵の名前一覧（base_1, base_2 … と続く分だけ。無ければ空） */
  private frames(base: string): string[] {
    let list = this.frameKeys.get(base);
    if (!list) {
      list = [];
      for (let i = 1; i <= 12 && Art.file(`${base}_${i}`); i++) list.push(`${base}_${i}`);
      this.frameKeys.set(base, list);
    }
    return list;
  }

  /** 今のコマ: 振り中は _attack_N、歩き中は _walk_N、無ければ1枚絵 */
  private heroFrame(weapon: string): HTMLImageElement | null {
    const base = `sprite_hero_${weapon}`, a = this.anim;
    if (a.atkT >= 0) {
      const f = this.frames(`${base}_attack`);
      if (f.length) {
        const im = this.sprite(f[Math.min(f.length - 1, Math.floor((a.atkT / HeroAnim.ATK) * f.length))]);
        if (im) return im;
      }
    }
    if (a.move > 0.3) {
      const f = this.frames(`${base}_walk`);
      if (f.length) {
        const im = this.sprite(f[Math.floor(a.walkPh / (Math.PI / 2)) % f.length]);
        if (im) return im;
      }
    }
    return this.sprite(base);
  }

  private enemyPhase = new WeakMap<object, number>();
  /** 敵の絵（歩きのコマ絵があれば交互に。描画だけの揺れなので Math.random でよい） */
  private enemyFrame(kind: string, e: object, t: number): HTMLImageElement | null {
    const f = this.frames(`sprite_enemy_${kind}_walk`);
    if (f.length) {
      let ph = this.enemyPhase.get(e);
      if (ph === undefined) { ph = Math.random() * 10; this.enemyPhase.set(e, ph); }
      const im = this.sprite(f[Math.floor(t * 4 + ph) % f.length]);
      if (im) return im;
    }
    return this.sprite(`sprite_enemy_${kind}`);
  }

  /** 白い影絵（被弾の点滅用。絵ごとに1回だけ作る） */
  private silhouette(im: HTMLImageElement): HTMLCanvasElement | null {
    let c = this.silCache.get(im);
    if (!c && typeof document !== "undefined" && im.naturalWidth > 0) {
      c = document.createElement("canvas");
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext("2d");
      if (!g) return null;
      g.drawImage(im, 0, 0);
      g.globalCompositeOperation = "source-in";
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      this.silCache.set(im, c);
    }
    return c ?? null;
  }

  /** 主人公の絵を、足元を軸にして弾ませ・傾け・踏み込ませて描く */
  private drawHero(ctx: CanvasRenderingContext2D, sim: RunSim, im: HTMLImageElement): void {
    const h = sim.hero, a = this.anim, P = a.pose();
    // コマ絵は台紙に余白があるので少し大きく描く
    const size = h.r * (this.frames(`sprite_hero_${sim.mainWeapon}_walk`).length ? 5 : 4.2), w = (size * im.naturalWidth) / im.naturalHeight;
    const footY = h.y + h.r * 1.1;
    // 土ぼこり
    for (const d of this.dust) {
      const k = d.t / 0.45;
      ctx.fillStyle = `rgba(170,160,140,${0.28 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(d.x, d.y - k * 4, 2.5 + k * 5, 0, 7); ctx.fill();
    }
    // 影（跳ねている時は小さく）
    const lift = Math.min(1, -P.dy / 10);
    ctx.fillStyle = `rgba(0,0,0,${0.35 - 0.12 * lift})`;
    ctx.beginPath(); ctx.ellipse(h.x + P.dx * 0.5, footY, h.r * 1.2 * (1 - 0.2 * lift), h.r * 0.45, 0, 0, 7); ctx.fill();
    const put = (p: typeof P, img: CanvasImageSource): void => {
      ctx.save();
      ctx.translate(h.x + p.dx, footY + p.dy);
      ctx.rotate(p.rot);
      ctx.scale(p.sx * (a.left ? -1 : 1), p.sy);
      ctx.drawImage(img, -w / 2, -size + h.r * 0.4, w, size);
      ctx.restore();
    };
    // 振り抜きの残像
    if (P.swing > 0.05) {
      const base = ctx.globalAlpha;
      for (const back of [0.06, 0.03]) {
        ctx.globalAlpha = base * P.swing * (back > 0.04 ? 0.18 : 0.3);
        put(a.pose(back), im);
      }
      ctx.globalAlpha = base;
    }
    put(P, im);
    if (h.flash > 0) {
      const sil = this.silhouette(im);
      if (sil) {
        const base = ctx.globalAlpha;
        ctx.globalAlpha = base * 0.65;
        put(P, sil);
        ctx.globalAlpha = base;
      }
    }
  }

  /** 三日月形の斬撃。先端が太く、振った跡が細くなって消える */
  private drawSlash(ctx: CanvasRenderingContext2D, f: Extract<Fx, { kind: "arc" }>, gold: boolean): void {
    const k = f.t / f.dur, side = f.side ?? 1;
    const full = f.arc >= 6.2;
    const span = full ? Math.PI * 2 : f.arc;
    const start = f.a - side * span / 2;
    const head = start + side * span * ease(Math.min(1, k / 0.42));
    const tail = start + side * span * ease(Math.max(0, (k - 0.22) / 0.78));
    const fade = k < 0.42 ? 1 : 1 - (k - 0.42) / 0.58;
    if (Math.abs(head - tail) < 0.02 || fade <= 0) return;
    const R = f.r * (0.92 + 0.08 * Math.min(1, k * 3));
    const pal = f.ghost ? ["143,240,224", "200,255,245"] : gold ? ["255,180,60", "255,240,190"] : ["225,40,60", "255,200,185"];
    const shape = (outer: number, thick: number): void => {
      const N = 18;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const u = i / N, ang = tail + (head - tail) * u;
        ctx.lineTo(f.x + Math.cos(ang) * R * outer, f.y + Math.sin(ang) * R * outer);
      }
      for (let i = N; i >= 0; i--) {
        const u = i / N, ang = tail + (head - tail) * u;
        const rr = R * (outer - thick * u * u);
        ctx.lineTo(f.x + Math.cos(ang) * rr, f.y + Math.sin(ang) * rr);
      }
      ctx.closePath();
    };
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(${pal[0]},${0.42 * fade})`;
    shape(1.06, 0.72); ctx.fill();
    ctx.fillStyle = `rgba(${pal[0]},${0.3 * fade})`;
    shape(1.0, 0.45); ctx.fill();
    ctx.fillStyle = `rgba(${pal[1]},${0.65 * fade})`;
    shape(1.0, 0.2); ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.9 * fade})`;
    shape(1.0, 0.06); ctx.fill();
    // 先端の火花（描画だけの揺れなので Math.random でよい）
    if (k < 0.5) {
      const hx = f.x + Math.cos(head) * R, hy = f.y + Math.sin(head) * R;
      ctx.strokeStyle = `rgba(${pal[1]},${0.9 * fade})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const ang = head + side * Math.PI / 2 + (Math.random() - 0.5) * 1.6, l = 6 + Math.random() * 10;
        ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(ang) * l, hy + Math.sin(ang) * l);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = prev;
  }

  /** art/ の絵（読み込み前・無い時は null） */
  private sprite(key: string): HTMLImageElement | null {
    let src = this.sprites.get(key);
    if (src === undefined) { src = Art.file(key); this.sprites.set(key, src); }
    return src ? Art.image(src) : null;
  }

  /** 縦横比を保って、高さ size で中央に描く。flip で左右反転 */
  private drawSprite(ctx: CanvasRenderingContext2D, im: HTMLImageElement, x: number, y: number, size: number, flip: boolean): void {
    const w = (size * im.naturalWidth) / im.naturalHeight;
    if (flip) {
      ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1);
      ctx.drawImage(im, -w / 2, -size / 2, w, size);
      ctx.restore();
    } else {
      ctx.drawImage(im, x - w / 2, y - size / 2, w, size);
    }
  }

  private drawGhost(ctx: CanvasRenderingContext2D, sim: RunSim, g: Companion): void {
    const tg = sim.D.weapons[g.rec.primary_weapon_id]?.tags[0];
    const tier = { color: (tg && sim.D.tags[tg]?.color) || "#7fe3dc" };   // 亡霊の色は武器のタグの色
    const grow = Math.min(1, (g.rank + (g.evolved ? 1 : 0)) / 3);       // 育つほど濃く
    const gim = this.sprite(`sprite_ghost_${g.rec.primary_weapon_id}`) ?? this.sprite("sprite_ghost");
    if (gim) {
      // 亡霊は半透明に、武器の色の光をまとわせる
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.3 * grow;
      ctx.shadowColor = tier.color; ctx.shadowBlur = 14;
      this.drawSprite(ctx, gim, g.x, g.y - 6, 40 + Math.sin(g.phase * 2) * 1.5, sim.hero.x < g.x);
      ctx.restore();
      return;
    }
    ctx.globalAlpha = 0.45 + 0.25 * grow;
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
