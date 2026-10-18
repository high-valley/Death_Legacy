// 主人公の絵の動き。1枚絵を「弾む・傾く・踏み込む」で動かす（描画側だけの状態。シミュレーションには影響しない）。
// コマ絵（sprite_hero_<武器>_walk_N / _attack_N）がある時も、この動きを重ねて使う。

export interface Pose {
  dx: number; dy: number;   // 足元からのずれ
  rot: number;              // 傾き（ラジアン、時計回りが正）
  sx: number; sy: number;   // 伸び縮み
  swing: number;            // 振り抜きの強さ 0〜1（残像の濃さ）
}

const ease = (x: number): number => 1 - (1 - x) * (1 - x);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export class HeroAnim {
  static readonly ATK = 0.3;      // 1回の振りの長さ（秒）
  static readonly STRIDE = 0.06;  // 1px 進むごとの歩きの位相

  t = 0;
  walkPh = 0;
  move = 0;          // 0〜1（歩きの強さ、なめらかに変える）
  left = false;
  atkT = -1;         // 振り始めからの時間（-1 = 振っていない）
  atkA = 0;          // 振る向き
  side = 1;          // 振る回り（交互に変える）
  private lx = NaN;
  private ly = NaN;

  /** 毎フレーム。足を着いた瞬間なら true（土ぼこりを出す合図） */
  update(dt: number, x: number, y: number, faceX: number): boolean {
    this.t += dt;
    let d = Number.isNaN(this.lx) ? 0 : Math.hypot(x - this.lx, y - this.ly);
    if (d > 200) d = 0;   // 再開・ワープは歩きに数えない
    this.lx = x; this.ly = y;
    const speed = dt > 0 ? d / dt : 0;
    const target = clamp01(speed / 110);
    this.move += (target - this.move) * Math.min(1, dt * 12);
    const before = Math.floor(this.walkPh / Math.PI);
    this.walkPh += d * HeroAnim.STRIDE;
    if (this.atkT >= 0) {
      this.atkT += dt;
      if (this.atkT >= HeroAnim.ATK) this.atkT = -1;
    }
    if (this.atkT >= 0) this.left = Math.cos(this.atkA) < 0;
    else if (Math.abs(faceX) > 0.2) this.left = faceX < 0;
    return this.move > 0.5 && Math.floor(this.walkPh / Math.PI) !== before;
  }

  /** 剣を振った（同じフレームに2回来たら1回だけ） */
  attack(a: number): void {
    if (this.atkT >= 0 && this.atkT < 0.05) return;
    this.atkT = 0;
    this.atkA = a;
    this.side = -this.side;
    this.left = Math.cos(a) < 0;
  }

  /** 今の姿勢。atBack 秒だけ前の振りの姿勢も出せる（残像用） */
  pose(atBack = 0): Pose {
    const w = this.move;
    const s = Math.sin(this.walkPh);
    const breathe = Math.sin(this.t * 2.6) * (1 - w);
    const face = this.left ? -1 : 1;
    const p: Pose = {
      dx: 0,
      dy: -Math.abs(s) * 4 * w,
      rot: s * 0.07 * w + 0.07 * w * face,
      sx: 1 - 0.035 * Math.cos(2 * this.walkPh) * w - 0.01 * breathe,
      sy: 1 + 0.05 * Math.cos(2 * this.walkPh) * w + 0.02 * breathe,
      swing: 0,
    };
    const at = this.atkT - atBack;
    if (this.atkT >= 0 && at >= 0) {
      const k = at / HeroAnim.ATK;
      const dir = Math.cos(this.atkA) < 0 ? -1 : 1;
      const ux = Math.cos(this.atkA), uy = Math.sin(this.atkA);
      let lean = 0, lunge = 0;
      if (k < 0.3) {              // 構え: 少し引いてためる
        const e = ease(k / 0.3);
        lean = -0.24 * e; lunge = -4 * e;
        p.sy *= 1 - 0.06 * e; p.sx *= 1 + 0.04 * e;
      } else if (k < 0.55) {      // 振り抜き: 一気に前へ
        const e = ease((k - 0.3) / 0.25);
        lean = -0.24 + 0.56 * e; lunge = -4 + 16 * e;
        p.sx *= 1 + 0.08 * (1 - e); p.sy *= 1 - 0.03 * (1 - e);
        p.swing = 1 - e * 0.4;
      } else {                    // 戻り
        const e = (k - 0.55) / 0.45;
        const r = 1 - e * e * (3 - 2 * e);
        lean = 0.32 * r; lunge = 12 * r;
        p.swing = 0.6 * r * r;
      }
      p.rot += lean * dir;
      p.dx += ux * lunge;
      p.dy += uy * lunge * 0.6;
    }
    return p;
  }
}
