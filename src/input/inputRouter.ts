// キーボード・マウス・タッチを「プレイヤーの意図」に変換する層。攻撃は自動なので、移動・回避・ポーズだけ。
// ゲームの他の部分はキーやタッチを直接見ず、ここのコールバックと moveVector() だけを使う。
import type { P } from "./stick.ts";

const MOVE: Record<string, [number, number]> = {
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
};

export class InputRouter {
  gameplayEnabled = false;
  touchMode = false;
  touchMove: P = { x: 0, y: 0 };
  private keys = new Set<string>();

  onDash: () => void = () => {};
  onPause: () => void = () => {};
  onDebug: () => void = () => {};
  onHotkey: (i: number) => void = () => {};
  onTouchMode: (on: boolean) => void = () => {};
  onBlur: () => void = () => {};
  onAnyInput: () => void = () => {};

  attach(): void {
    addEventListener("keydown", (e) => {
      this.onAnyInput();
      this.setTouchMode(false);
      if (this.gameplayEnabled && (e.code === "Space" || e.code.startsWith("Arrow"))) e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === "Escape" || e.code === "KeyP") this.onPause();
      else if (e.code === "F3") { e.preventDefault(); this.onDebug(); }
      else if (e.code === "Space" && this.gameplayEnabled) this.onDash();
      else {
        const m = /^Digit([123])$/.exec(e.code);
        if (m) this.onHotkey(Number(m[1]) - 1);
      }
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => {
      this.keys.clear();
      this.touchMove = { x: 0, y: 0 };
      this.onBlur();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.onBlur();
    });
  }

  setTouchMode(on: boolean): void {
    if (on !== this.touchMode) {
      this.touchMode = on;
      this.onTouchMode(on);
    }
  }

  moveVector(): P {
    if (this.touchMove.x !== 0 || this.touchMove.y !== 0) return this.touchMove;
    let x = 0, y = 0;
    for (const k of this.keys) {
      const v = MOVE[k];
      if (v) { x += v[0]; y += v[1]; }
    }
    return { x, y };
  }

  reset(): void {
    this.touchMove = { x: 0, y: 0 };
  }
}
