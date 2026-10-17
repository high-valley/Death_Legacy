// 戦闘HUD（表示専用）。キャンバスの上に重ねて描く。
// 見た目はメニューと揃える: 細い枠の帯、数字は等幅、見出しは明朝。
import type { RunSim } from "../sim/runSim.ts";
import { C, FONT, MONO, SERIF } from "./theme.ts";

export const fmt = (s: number): string => {
  const n = Math.max(0, Math.floor(s));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
};

export interface Perf { fps: number; frameMs: number }

const TRACK = "rgba(8,11,15,.72)";
const RULE = "rgba(230,225,214,.14)";

/** 角を少し丸めた矩形（roundRect の無い古い端末でも動くように自前で書く） */
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ratio: number, color: string): void {
  rrect(ctx, x, y, w, h, 3);
  ctx.fillStyle = TRACK; ctx.fill();
  const fw = w * Math.max(0, Math.min(1, ratio));
  if (fw > 0) { rrect(ctx, x, y, Math.max(fw, 4), h, 3); ctx.fillStyle = color; ctx.fill(); }
  rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 3);
  ctx.strokeStyle = RULE; ctx.lineWidth = 1; ctx.stroke();
}

export class Hud {
  toastText = "";
  toastT = 0;
  private shownHp = -1;   // 減った分を少し遅れて追いかける（被弾量が見える）

  toast(text: string): void {
    this.toastText = text;
    this.toastT = 2.2;
  }

  update(dt: number): void {
    this.toastT -= dt;
  }

  draw(ctx: CanvasRenderingContext2D, sim: RunSim, W: number, H: number, touch: boolean, debug: boolean, perf: Perf): void {
    const pad = 16, small = W < 760;
    const D = sim.D, h = sim.hero;
    ctx.textBaseline = "middle";

    // ── 左上: HP / 経験値 / レベル
    const bw = Math.min(280, W * 0.32);
    if (this.shownHp < 0 || sim.hp > this.shownHp) this.shownHp = sim.hp;
    else this.shownHp += (sim.hp - this.shownHp) * 0.06;
    const hpH = 16;
    bar(ctx, pad, pad, bw, hpH, this.shownHp / sim.maxHp, "rgba(214,90,94,.35)");
    const fw = bw * Math.max(0, sim.hp / sim.maxHp);
    if (fw > 0) { rrect(ctx, pad, pad, Math.max(fw, 4), hpH, 3); ctx.fillStyle = sim.hp / sim.maxHp <= 0.3 ? "#e8484e" : C.blood; ctx.fill(); }
    ctx.fillStyle = C.bone; ctx.font = `600 11px ${MONO}`;
    ctx.fillText(`${Math.ceil(sim.hp)} / ${Math.round(sim.maxHp)}`, pad + 8, pad + hpH / 2 + 1);

    bar(ctx, pad, pad + hpH + 5, bw, 5, sim.xp / sim.xpNeed(), C.candle);

    ctx.textBaseline = "alphabetic";
    const ly = pad + hpH + 5 + 5 + 22;
    ctx.font = `600 11px ${FONT}`; ctx.fillStyle = C.dim;
    ctx.fillText("Lv", pad, ly);
    ctx.font = `600 20px ${MONO}`; ctx.fillStyle = C.bone;
    ctx.fillText(String(sim.level), pad + 18, ly + 1);
    const lvW = 18 + ctx.measureText(String(sim.level)).width + 14;
    // 回避の状態は小さな丸で（スマホは右下のボタンにも出る）
    const ready = h.dashCd <= 0;
    ctx.fillStyle = ready ? C.candle : C.edge;
    ctx.beginPath(); ctx.arc(pad + lvW + 4, ly - 5, 4, 0, 7); ctx.fill();
    ctx.font = `12px ${FONT}`; ctx.fillStyle = ready ? C.candle : C.dim;
    ctx.fillText(ready ? "回避できる" : `回避 ${h.dashCd.toFixed(1)}`, pad + lvW + 14, ly - 1);

    // 装備は名前とレベルを細い区切りで並べる
    ctx.font = `12px ${FONT}`;
    let x = pad;
    const items: [string, number, boolean][] = [
      ...Object.keys(sim.weapons).map((k): [string, number, boolean] => [sim.weaponName(k), sim.weapons[k], true]),
      ...Object.keys(sim.passives).map((k): [string, number, boolean] => [D.passives[k].name, sim.passives[k], false]),
    ];
    const iy = ly + 20;
    for (const [name, lv, weapon] of items) {
      ctx.fillStyle = weapon ? C.bone : C.dim;
      ctx.fillText(name, x, iy);
      x += ctx.measureText(name).width + 3;
      ctx.font = `600 11px ${MONO}`; ctx.fillStyle = weapon ? C.candle : C.dim;
      ctx.fillText(String(lv), x, iy);
      x += ctx.measureText(String(lv)).width + 12;
      ctx.font = `12px ${FONT}`;
      if (x > W * 0.42) break;   // 中央の時計にかからないところで打ち切る
    }

    // ── 中央上: 残り時間とボス
    ctx.textAlign = "center";
    const tsz = small ? 26 : 34;
    ctx.font = `500 ${tsz}px ${MONO}`; ctx.fillStyle = sim.bossSpawned ? C.blood : C.bone;
    ctx.fillText(sim.bossSpawned ? fmt(sim.t) : fmt(sim.runLen - sim.t), W / 2, pad + tsz * 0.8);
    ctx.font = `12px ${SERIF}`; ctx.fillStyle = C.dim;
    ctx.fillText(sim.bossSpawned ? "冥王戦" : "冥王が来るまで", W / 2, pad + tsz + 14);
    if (sim.boss && !sim.boss.dead) {
      const w = Math.min(420, W - 220), y = pad + tsz + 24;
      bar(ctx, W / 2 - w / 2, y, w, 8, sim.boss.hp / sim.boss.maxHp, C.blood);
    }

    // ── 右上: 同行亡霊と撃破（スマホではポーズボタンを避ける）
    ctx.textAlign = "right";
    const gx = W - pad - (touch ? 60 : 0);
    let ry = pad + 12;
    if (sim.ghost) {
      const rec = sim.ghost.rec;
      const tier = D.tiers.find((t) => t.id === rec.tier_id) ?? D.tiers[0];
      ctx.font = `600 ${small ? 13 : 14}px ${SERIF}`; ctx.fillStyle = tier.color;
      ctx.fillText(rec.display_name, gx, ry);
      ry += 18;
      ctx.font = `12px ${FONT}`; ctx.fillStyle = C.dim;
      ctx.fillText(`力の解放 ${Math.round(sim.ghostUnlock() * 100)}%`, gx, ry);
    } else {
      ctx.font = `12px ${FONT}`; ctx.fillStyle = C.dim;
      ctx.fillText(`単独　経験値 +${Math.round(D.solo_xp_bonus * 100)}%`, gx, ry);
    }
    ry += 22;
    ctx.font = `600 16px ${MONO}`; ctx.fillStyle = C.bone;
    const kills = String(sim.kills);
    ctx.fillText(kills, gx, ry);
    const kw = ctx.measureText(kills).width;
    ctx.font = `12px ${FONT}`; ctx.fillStyle = C.dim;
    ctx.fillText("撃破", gx - kw - 6, ry);
    ctx.textAlign = "left";

    // ── お知らせ（中央）
    if (this.toastT > 0) {
      ctx.globalAlpha = Math.min(1, this.toastT * 2);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `600 ${small ? 15 : 17}px ${SERIF}`;
      const w = ctx.measureText(this.toastText).width + 48, y = H * 0.24;
      ctx.fillStyle = "rgba(14,18,23,.88)"; ctx.fillRect(W / 2 - w / 2, y - 18, w, 36);
      ctx.fillStyle = C.candle; ctx.fillRect(W / 2 - w / 2, y - 18, w, 1); ctx.fillRect(W / 2 - w / 2, y + 17, w, 1);
      ctx.fillStyle = C.bone; ctx.fillText(this.toastText, W / 2, y + 1);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }
    if (debug) {
      ctx.textBaseline = "top";
      ctx.font = `12px ${MONO}`; ctx.fillStyle = "#8ff0a4";
      [
        `FPS ${perf.fps.toFixed(0)}  (1フレーム ${perf.frameMs.toFixed(1)} ms)`,
        `敵 ${sim.enemies.length} (最大 ${sim.maxAlive})`,
        `更新 ${sim.updateMs.toFixed(2)} ms`,
        `弾 ${sim.shots.length + sim.eshots.length}  炎 ${sim.zones.length}  経験値 ${sim.gems.length}`,
        `seed ${sim.seed}`,
      ].forEach((l, i) => ctx.fillText(l, pad, pad + 96 + i * 16));
    }
    ctx.textBaseline = "alphabetic";
  }
}
