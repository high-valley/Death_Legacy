// 戦闘HUD（表示専用）。キャンバスの上に重ねて描く。
import type { RunSim } from "../sim/runSim.ts";
import { C, FONT, MONO } from "./theme.ts";

export const fmt = (s: number): string => {
  const n = Math.max(0, Math.floor(s));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
};

export interface Perf { fps: number; frameMs: number }

export class Hud {
  toastText = "";
  toastT = 0;

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
    // HP / 経験値
    const bw = Math.min(300, W * 0.34);
    ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(pad, pad, bw, 18);
    ctx.fillStyle = C.blood; ctx.fillRect(pad, pad, bw * Math.max(0, sim.hp / sim.maxHp), 18);
    ctx.fillStyle = C.bone; ctx.font = `600 12px ${MONO}`;
    ctx.fillText(`HP ${Math.ceil(sim.hp)} / ${Math.round(sim.maxHp)}`, pad + 8, pad + 10);
    ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(pad, pad + 22, bw, 6);
    ctx.fillStyle = C.candle; ctx.fillRect(pad, pad + 22, bw * Math.min(1, sim.xp / sim.xpNeed()), 6);
    ctx.textBaseline = "top";
    ctx.font = `700 16px ${FONT}`; ctx.fillStyle = C.bone;
    ctx.fillText(`Lv ${sim.level}`, pad, pad + 36);
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = h.dashCd > 0 ? C.dim : C.candle;
    ctx.fillText(h.dashCd > 0 ? `回避 ${h.dashCd.toFixed(1)}s` : "回避 OK", pad + 58, pad + 38);
    const parts = [
      ...Object.keys(sim.weapons).map((k) => `${sim.weaponName(k)}${sim.weapons[k]}`),
      ...Object.keys(sim.passives).map((k) => `${D.passives[k].name}${sim.passives[k]}`),
    ];
    ctx.fillStyle = C.dim; ctx.font = `12px ${FONT}`;
    ctx.fillText(parts.join(" "), pad, pad + 60);

    // 時間とボス
    ctx.textAlign = "center";
    ctx.font = `600 ${small ? 24 : 34}px ${MONO}`; ctx.fillStyle = C.bone;
    ctx.fillText(sim.bossSpawned ? fmt(sim.t) : fmt(sim.runLen - sim.t), W / 2, pad - 2);
    ctx.font = `12px ${FONT}`; ctx.fillStyle = C.dim;
    ctx.fillText(sim.bossSpawned ? "冥王戦　経過時間" : "冥王出現まで", W / 2, pad + (small ? 26 : 38));
    if (sim.boss && !sim.boss.dead) {
      const w = Math.min(420, W - 200), y = pad + (small ? 44 : 56);
      ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(W / 2 - w / 2, y, w, 9);
      ctx.fillStyle = C.blood; ctx.fillRect(W / 2 - w / 2, y, w * Math.max(0, sim.boss.hp / sim.boss.maxHp), 9);
    }

    // 同行亡霊（右上。スマホではポーズボタンを避ける）
    ctx.textAlign = "right";
    const gx = W - pad - (touch ? 56 : 0);
    if (sim.ghost) {
      const rec = sim.ghost.rec;
      const tier = D.tiers.find((t) => t.id === rec.tier_id) ?? D.tiers[0];
      ctx.font = `700 14px ${FONT}`; ctx.fillStyle = tier.color;
      ctx.fillText(rec.display_name, gx, pad);
      ctx.font = `12px ${FONT}`; ctx.fillStyle = C.dim;
      ctx.fillText(`生前 ${fmt(rec.survival_seconds)} · ${D.weapons[rec.primary_weapon_id].name}Lv${rec.weapon_level} · 解放 ${Math.round(sim.ghostUnlock() * 100)}%`, gx, pad + 20);
    } else {
      ctx.font = `12px ${FONT}`; ctx.fillStyle = C.dim;
      ctx.fillText(`単独出撃（経験値 +${Math.round(D.solo_xp_bonus * 100)}%）`, gx, pad);
    }
    ctx.fillText(`撃破 ${sim.kills}`, gx, pad + (sim.ghost ? 38 : 18));
    ctx.textAlign = "left";

    if (this.toastT > 0) {
      ctx.globalAlpha = Math.min(1, this.toastT * 2);
      ctx.textAlign = "center";
      ctx.font = `${small ? 14 : 16}px ${FONT}`;
      const w = ctx.measureText(this.toastText).width + 24;
      ctx.fillStyle = "rgba(11,16,20,.85)"; ctx.fillRect(W / 2 - w / 2, H * 0.22 - 5, w, 28);
      ctx.fillStyle = C.bone; ctx.fillText(this.toastText, W / 2, H * 0.22);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }
    if (debug) {
      ctx.font = `12px ${MONO}`; ctx.fillStyle = "#8ff0a4";
      [
        `FPS ${perf.fps.toFixed(0)}  (1フレーム ${perf.frameMs.toFixed(1)} ms)`,
        `敵 ${sim.enemies.length} (最大 ${sim.maxAlive})`,
        `更新 ${sim.updateMs.toFixed(2)} ms`,
        `弾 ${sim.shots.length + sim.eshots.length}  炎 ${sim.zones.length}  経験値 ${sim.gems.length}`,
        `seed ${sim.seed}`,
      ].forEach((l, i) => ctx.fillText(l, pad, pad + 82 + i * 16));
    }
    ctx.textBaseline = "alphabetic";
  }
}
