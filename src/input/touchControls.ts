// スマホ用の操作レイヤー。画面をドラッグ = 仮想スティック（指に付いてくる）、右下 = 回避、右上 = ポーズ。攻撃は自動。
// pointer イベントを直接使うので、指の動きがそのフレームのうちに移動入力へ反映される。
import type { RunSim } from "../sim/runSim.ts";
import { C, FONT, SERIF } from "../view/theme.ts";
import type { InputRouter } from "./inputRouter.ts";
import { followOrigin, JOY_RADIUS, stickVector, type P } from "./stick.ts";

interface Joy { id: number; o: P; p: P }
interface Btn { x: number; y: number; r: number }

export class TouchControls {
  joy: Joy | null = null;
  W = 0;
  H = 0;
  private readonly router: InputRouter;

  constructor(router: InputRouter) {
    this.router = router;
  }

  buttons(): { dash: Btn; pause: Btn } {
    const pad = 16, r = Math.max(34, Math.min(48, this.H * 0.1));
    return { dash: { x: this.W - pad - r, y: this.H - pad - r, r }, pause: { x: this.W - pad - 22, y: pad + 22, r: 22 } };
  }

  attach(cv: HTMLCanvasElement): void {
    const pos = (e: PointerEvent): P => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    cv.addEventListener("pointerdown", (e) => {
      this.router.onAnyInput();
      if (e.pointerType === "mouse") { this.router.setTouchMode(false); return; }
      e.preventDefault();
      this.router.setTouchMode(true);
      if (!this.router.gameplayEnabled) return;
      const p = pos(e), b = this.buttons();
      if (Math.hypot(p.x - b.pause.x, p.y - b.pause.y) < b.pause.r + 12) { this.router.onPause(); return; }
      if (Math.hypot(p.x - b.dash.x, p.y - b.dash.y) < b.dash.r + 12) { this.router.onDash(); return; }
      if (!this.joy) {
        try { cv.setPointerCapture(e.pointerId); } catch { /* 古いブラウザ */ }
        this.joy = { id: e.pointerId, o: p, p };
      }
    }, { passive: false });
    cv.addEventListener("pointermove", (e) => {
      const j = this.joy;
      if (!j || j.id !== e.pointerId) return;
      j.p = pos(e);
      j.o = followOrigin(j.o, j.p);
      this.router.touchMove = stickVector(j.o, j.p);
    });
    const end = (e: PointerEvent): void => {
      if (this.joy && this.joy.id === e.pointerId) this.reset();
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  reset(): void {
    this.joy = null;
    this.router.reset();
  }

  draw(ctx: CanvasRenderingContext2D, sim: RunSim): void {
    const b = this.buttons();
    const h = sim.hero, D = sim.D;
    // 回避ボタン（クールダウンは扇形で表示）
    const ready = h.dashCd <= 0;
    // 回避: 使える時は蝋燭色の輪、待ち時間は輪が時計回りに満ちていく
    ctx.fillStyle = "rgba(14,18,23,.78)";
    ctx.beginPath(); ctx.arc(b.dash.x, b.dash.y, b.dash.r, 0, 7); ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.edge;
    ctx.beginPath(); ctx.arc(b.dash.x, b.dash.y, b.dash.r - 0.5, 0, 7); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.candle;
    ctx.globalAlpha = ready ? 1 : 0.55;
    const prog = ready ? 1 : 1 - h.dashCd / D.player.dash_cd;
    ctx.beginPath(); ctx.arc(b.dash.x, b.dash.y, b.dash.r - 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog); ctx.stroke();
    ctx.globalAlpha = 1;
    // ポーズ
    ctx.fillStyle = "rgba(14,18,23,.78)";
    ctx.beginPath(); ctx.arc(b.pause.x, b.pause.y, b.pause.r, 0, 7); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = C.edge; ctx.stroke();
    ctx.fillStyle = C.bone;
    const bw = 3, bh = 12;
    ctx.fillRect(b.pause.x - 5, b.pause.y - bh / 2, bw, bh);
    ctx.fillRect(b.pause.x + 2, b.pause.y - bh / 2, bw, bh);
    ctx.fillStyle = ready ? C.bone : C.dim; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `600 ${Math.round(b.dash.r * 0.36)}px ${SERIF}`;
    ctx.fillText("回避", b.dash.x, b.dash.y + 1);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    if (this.joy) {
      const j = this.joy;
      let dx = j.p.x - j.o.x, dy = j.p.y - j.o.y;
      const l = Math.hypot(dx, dy);
      if (l > JOY_RADIUS) { dx = (dx / l) * JOY_RADIUS; dy = (dy / l) * JOY_RADIUS; }
      ctx.strokeStyle = "rgba(230,225,214,.28)";
      ctx.beginPath(); ctx.arc(j.o.x, j.o.y, JOY_RADIUS, 0, 7); ctx.stroke();
      ctx.fillStyle = "rgba(134,224,210,.55)";
      ctx.beginPath(); ctx.arc(j.o.x + dx, j.o.y + dy, 20, 0, 7); ctx.fill();
    } else if (sim.t < 8) {
      ctx.fillStyle = C.dim; ctx.font = `14px ${FONT}`;
      ctx.fillText("画面をドラッグで移動（攻撃は自動）", 16, this.H * 0.62);
    }
    ctx.lineWidth = 1;
  }
}
