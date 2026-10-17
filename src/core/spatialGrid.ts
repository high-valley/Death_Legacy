// 一様グリッドの空間分割。敵100〜300体の近傍探索に使う。毎ティック作り直す。
// ゴミ（GC）を出さないように、セルの配列と結果の配列は使い回す。

export interface Body {
  x: number;
  y: number;
  r: number;
  dead: boolean;
}

const OFF = 32768;
const key = (cx: number, cy: number): number => (cx + OFF) * 65536 + (cy + OFF);

export class SpatialGrid<T extends Body> {
  readonly cell: number;
  readonly cells = new Map<number, T[]>();
  private pool: T[][] = [];
  private out: T[] = [];

  constructor(cell = 64) {
    this.cell = cell;
  }

  clear(): void {
    for (const b of this.cells.values()) {
      b.length = 0;
      this.pool.push(b);
    }
    this.cells.clear();
  }

  rebuild(items: readonly T[]): void {
    this.clear();
    const c = this.cell;
    for (let i = 0; i < items.length; i++) {
      const e = items[i];
      const k = key(Math.floor(e.x / c), Math.floor(e.y / c));
      let b = this.cells.get(k);
      if (b === undefined) {
        b = this.pool.pop() ?? [];
        this.cells.set(k, b);
      }
      b.push(e);
    }
  }

  /** 半径 r の範囲に掛かるセルの中身。返す配列は次の query で上書きされるので、入れ子で呼ばないこと */
  query(x: number, y: number, r: number): readonly T[] {
    const out = this.out;
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const b = this.cells.get(key(cx, cy));
        if (b !== undefined) for (let i = 0; i < b.length; i++) out.push(b[i]);
      }
    }
    return out;
  }

  /** 入れ子で使ってよい版（新しい配列を返す） */
  queryCopy(x: number, y: number, r: number): T[] {
    return this.query(x, y, r).slice();
  }

  nearest(x: number, y: number, r: number): T | null {
    let best: T | null = null;
    let bd = r * r;
    const list = this.query(x, y, r);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead) continue;
      const dx = e.x - x, dy = e.y - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /**
   * 重なっている組を押し離す（各組を1回だけ調べ、両方を逆向きに動かす）。
   * セルの大きさ ≥ 半径の和 の組だけが正しく処理される（大きい敵は呼び出し側で別に処理）。
   */
  separate(k: number): void {
    const c = this.cells;
    for (const [kk, b] of c) {
      const n = b.length;
      for (let i = 0; i < n; i++) {
        const a = b[i];
        for (let j = i + 1; j < n; j++) pushPair(a, b[j], k);
      }
      // 右・右下・下・左下の4方向だけ見れば、隣り合うセルの組を1回ずつ調べられる
      const nb1 = c.get(kk + 65536), nb2 = c.get(kk + 65537), nb3 = c.get(kk + 1), nb4 = c.get(kk - 65535);
      if (nb1) pairs(b, nb1, k);
      if (nb2) pairs(b, nb2, k);
      if (nb3) pairs(b, nb3, k);
      if (nb4) pairs(b, nb4, k);
    }
  }
}

function pairs<T extends Body>(a: T[], b: T[], k: number): void {
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    for (let j = 0; j < b.length; j++) pushPair(p, b[j], k);
  }
}

/** 重なっていれば両方を逆向きに押し離す */
export function pushPair(a: Body, b: Body, k: number): void {
  const dx = b.x - a.x, dy = b.y - a.y;
  const rr = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 < rr * rr && d2 > 0) {
    const d = Math.sqrt(d2);
    const s = ((rr - d) / d) * k;
    a.x -= dx * s; a.y -= dy * s;
    b.x += dx * s; b.y += dy * s;
  }
}
