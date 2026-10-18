// 戦闘HUD（表示専用）。キャンバスの上に重ねて描く。
// 左上: 紋章・HP・経験値・Lv / 中央上: 残り時間・ボスと怨霊のHP / 右上: ミニマップ・撃破数
// 左下: 武器スロット（段階の色）とパッシブ / 下: 同行する亡霊の札 / 右下（PC）: 回避キー
import { gradeIndex } from "../data/weapons.ts";
import type { RunSim } from "../sim/runSim.ts";
import { Art } from "./art.ts";
import { drawIcon } from "./icons.ts";
import { C, FONT, MONO, SERIF } from "./theme.ts";

export const fmt = (s: number): string => {
  const n = Math.max(0, Math.floor(s));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
};

export interface Perf { fps: number; frameMs: number }

const TRACK = "rgba(6,8,11,.78)";
const GOLD = "#c9a35a", GOLD_DIM = "rgba(201,163,90,.55)";
/** 武器の段階ごとの枠の色（短剣 → … → 伝説） */
const GRADE_COLORS = ["#8e959b", "#7fc4e8", "#d9a85b", "#ff7ad9"];

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

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ratio: number, color: string, edge = "rgba(201,163,90,.35)"): void {
  rrect(ctx, x, y, w, h, 2);
  ctx.fillStyle = TRACK; ctx.fill();
  const fw = w * Math.max(0, Math.min(1, ratio));
  if (fw > 0) { rrect(ctx, x, y, Math.max(fw, 3), h, 2); ctx.fillStyle = color; ctx.fill(); }
  rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 2);
  ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
}

/** 飾り枠（暗い板＋金の細線） */
function plate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, edge = GOLD_DIM): void {
  rrect(ctx, x, y, w, h, 4);
  ctx.fillStyle = "rgba(10,13,18,.82)"; ctx.fill();
  ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
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
    const pad = 14, small = W < 760 || H < 480;
    const D = sim.D, h = sim.hero;
    ctx.textBaseline = "middle";

    // 画面の縁を暗く（中央を見やすく）
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.55)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    // ── 左上: 紋章・HP・経験値
    const er = small ? 18 : 22, ex = pad + er, ey = pad + er;
    ctx.fillStyle = "rgba(10,13,18,.9)";
    ctx.beginPath(); ctx.arc(ex, ey, er, 0, 7); ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5; ctx.stroke();
    // 主人公の絵（無ければ家系の紋）
    const him = Art.image(Art.hero(sim.mainWeapon));
    if (him) {
      ctx.save();
      ctx.beginPath(); ctx.arc(ex, ey, er - 1.5, 0, 7); ctx.clip();
      const s = (er * 2) / Math.min(him.naturalWidth, him.naturalHeight);
      ctx.drawImage(him, ex - (him.naturalWidth * s) / 2, ey - er * 0.9, him.naturalWidth * s, him.naturalHeight * s);
      ctx.restore();
      ctx.beginPath(); ctx.arc(ex, ey, er, 0, 7); ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5; ctx.stroke();
    } else {
      drawIcon(ctx, sim.lineage.card.id === "grit" ? "ghost" : sim.lineage.card.id, ex, ey, er * 1.1, GOLD);
    }
    const bx = ex + er + 8, bw = Math.min(small ? 200 : 260, W * 0.3), bh = small ? 14 : 16;
    if (this.shownHp < 0 || sim.hp > this.shownHp) this.shownHp = sim.hp;
    else this.shownHp += (sim.hp - this.shownHp) * 0.06;
    bar(ctx, bx, ey - bh + 1, bw, bh, this.shownHp / sim.maxHp, "rgba(214,90,94,.35)");
    const fw = bw * Math.max(0, sim.hp / sim.maxHp);
    if (fw > 0) {
      const gr = ctx.createLinearGradient(0, ey - bh, 0, ey);
      const low = sim.hp / sim.maxHp <= 0.3;
      gr.addColorStop(0, low ? "#ff5a5f" : "#d8494e"); gr.addColorStop(1, low ? "#a3181d" : "#7e1d22");
      rrect(ctx, bx, ey - bh + 1, Math.max(fw, 3), bh, 2); ctx.fillStyle = gr; ctx.fill();
    }
    ctx.textAlign = "center"; ctx.fillStyle = C.bone; ctx.font = `600 ${small ? 11 : 12}px ${FONT}`;
    ctx.fillText(`${Math.ceil(sim.hp)} / ${Math.round(sim.maxHp)}`, bx + bw / 2, ey - bh / 2 + 1);
    bar(ctx, bx, ey + 5, bw, 5, sim.xp / sim.xpNeed(), C.soul, "rgba(134,224,210,.3)");
    ctx.textAlign = "left";
    ctx.font = `600 ${small ? 12 : 13}px ${SERIF}`; ctx.fillStyle = C.bone;
    ctx.fillText(`Lv. ${sim.level}`, pad, ey + er + 12);
    const ready = h.dashCd <= 0;
    if (!touch) {
      ctx.font = `12px ${FONT}`; ctx.fillStyle = ready ? C.candle : C.dim;
      ctx.fillText(ready ? "回避できる" : `回避 ${h.dashCd.toFixed(1)}`, bx, ey + er + 12);
    }

    // ── 中央上: 残り時間・ボス・怨霊
    ctx.textAlign = "center";
    const tsz = small ? 22 : 30;
    const tstr = sim.bossSpawned ? fmt(sim.t) : fmt(sim.runLen - sim.t);
    ctx.font = `600 ${tsz}px ${SERIF}`;
    const tw = ctx.measureText(tstr).width;
    plate(ctx, W / 2 - tw / 2 - 34, pad, tw + 56, tsz + 14);
    drawIcon(ctx, "clock", W / 2 - tw / 2 - 16, pad + (tsz + 14) / 2, small ? 14 : 16, GOLD);
    ctx.fillStyle = sim.bossSpawned ? "#ff8a8e" : C.bone;
    ctx.fillText(tstr, W / 2 + 10, pad + (tsz + 14) / 2 + 1);
    ctx.font = `11px ${SERIF}`; ctx.fillStyle = C.dim;
    ctx.fillText(sim.bossSpawned ? "冥王戦" : "冥王が来るまで", W / 2, pad + tsz + 24);
    let by = pad + tsz + 34;
    if (sim.boss && !sim.boss.dead) {
      const w = Math.min(420, W - 260);
      bar(ctx, W / 2 - w / 2, by, w, 8, sim.boss.hp / sim.boss.maxHp, C.blood);
      by += 14;
    }
    if (sim.wraith && !sim.wraith.dead) {
      const w = Math.min(300, W - 300);
      bar(ctx, W / 2 - w / 2, by, w, 6, sim.wraith.hp / sim.wraith.maxHp, C.taint);
      ctx.font = `11px ${SERIF}`; ctx.fillStyle = C.taint;
      ctx.fillText("怨霊", W / 2, by + 16);
      by += 22;
    }

    // ── 右上: ミニマップ・撃破数
    const ms = small ? 78 : 118;
    const mx = W - pad - ms - (touch ? 58 : 0), my = pad;
    this.minimap(ctx, sim, mx, my, ms);
    ctx.textAlign = "right"; ctx.font = `12px ${FONT}`; ctx.fillStyle = C.dim;
    const kills = String(sim.kills);
    ctx.font = `600 ${small ? 14 : 16}px ${SERIF}`; ctx.fillStyle = C.bone;
    ctx.fillText(kills, mx + ms, my + ms + 14);
    const kw = ctx.measureText(kills).width;
    ctx.font = `11px ${FONT}`; ctx.fillStyle = C.dim;
    ctx.fillText("撃破", mx + ms - kw - 6, my + ms + 14);

    // ── 左下: 武器スロット・パッシブ
    const ss = small ? 40 : 52, gap = 6;
    const sy = H - pad - ss - 14;
    let sx = pad;
    const slots = D.sub_weapon_slots + 1;
    const wids = Object.keys(sim.weapons);
    for (let i = 0; i < slots; i++) {
      const id = wids[i];
      if (!id) {
        plate(ctx, sx, sy, ss, ss, "rgba(201,163,90,.2)");
        sx += ss + gap;
        continue;
      }
      const lv = sim.weapons[id], gi = gradeIndex(D.weapons[id], lv, !!sim.evolved[id]);
      const col = GRADE_COLORS[Math.min(gi, GRADE_COLORS.length - 1)];
      plate(ctx, sx, sy, ss, ss, col);
      if (gi >= 2) { ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 10; rrect(ctx, sx, sy, ss, ss, 4); ctx.strokeStyle = col; ctx.stroke(); ctx.restore(); }
      drawIcon(ctx, id, sx + ss / 2, sy + ss / 2 - 3, ss * 0.56, col);
      ctx.textAlign = "center"; ctx.font = `600 ${small ? 10 : 11}px ${SERIF}`; ctx.fillStyle = C.bone;
      ctx.fillText(`Lv.${lv}`, sx + ss / 2, sy + ss + 8);
      // 段階の印（◆の数）
      for (let k = 0; k <= gi; k++) { ctx.fillStyle = col; ctx.fillRect(sx + 5 + k * 6, sy + 4, 3, 3); }
      sx += ss + gap;
    }
    const ps = small ? 20 : 24;
    let px = sx + 6;
    for (const id of Object.keys(sim.passives)) {
      plate(ctx, px, sy + ss - ps, ps, ps, "rgba(201,163,90,.35)");
      drawIcon(ctx, id, px + ps / 2, sy + ss - ps / 2, ps * 0.62, C.dim);
      ctx.textAlign = "center"; ctx.font = `10px ${MONO}`; ctx.fillStyle = C.dim;
      ctx.fillText(String(sim.passives[id]), px + ps / 2, sy + ss + 8);
      px += ps + 4;
    }

    // ── 下: 同行する亡霊（喰らった時はその力）
    const cw = small ? 196 : 240, chh = small ? 50 : 62;
    const cx = touch ? W / 2 - cw / 2 : W - pad - cw - 128, cy = H - pad - chh;
    const rec = sim.ghost?.rec ?? sim.devour?.rec ?? null;
    if (rec && cx > px + 8) {
      const tier = D.tiers.find((t) => t.id === rec.tier_id) ?? D.tiers[0];
      plate(ctx, cx, cy, cw, chh, sim.devour ? "rgba(183,139,224,.6)" : "rgba(134,224,210,.5)");
      const ps2 = chh - 10;
      {   // 亡霊は人の絵ではなく、等級の色の霊光と紋で表す
        const g = ctx.createRadialGradient(cx + 5 + ps2 / 2, cy + 5 + ps2 * 0.4, 2, cx + 5 + ps2 / 2, cy + 5 + ps2 / 2, ps2 * 0.7);
        g.addColorStop(0, tier.color); g.addColorStop(1, "rgba(0,0,0,0)");
        rrect(ctx, cx + 5, cy + 5, ps2, ps2, 3); ctx.fillStyle = "#0b0e13"; ctx.fill();
        ctx.globalAlpha = 0.55; ctx.fillStyle = g; ctx.fill(); ctx.globalAlpha = 1;
        drawIcon(ctx, "ghost", cx + 5 + ps2 / 2, cy + 5 + ps2 / 2, ps2 * 0.6, "rgba(230,240,240,.85)");
        drawIcon(ctx, rec.primary_weapon_id, cx + ps2 - 4, cy + ps2 - 4, ps2 * 0.32, tier.color);
      }
      ctx.textAlign = "left";
      const tx = cx + ps2 + 14;
      ctx.font = `600 ${small ? 12 : 13}px ${SERIF}`; ctx.fillStyle = sim.devour ? C.taint : tier.color;
      let name = rec.display_name;
      while (ctx.measureText(name).width > cw - ps2 - 22 && name.length > 4) name = name.slice(0, -2) + "…";
      ctx.fillText(name, tx, cy + 14);
      ctx.font = `11px ${FONT}`; ctx.fillStyle = C.dim;
      if (sim.devour) {
        ctx.fillText(`喰らった力　与ダメージ +${Math.round(sim.devour.might * 100)}%`, tx, cy + chh / 2 + 2);
      } else {
        ctx.fillText(`生存時間 ${fmt(rec.survival_seconds)}　解放 ${Math.round(sim.ghostUnlock() * 100)}%`, tx, cy + chh / 2 + 2);
        bar(ctx, tx, cy + chh - 12, cw - ps2 - 24, 4, sim.ghostUnlock(), C.soul, "rgba(134,224,210,.3)");
      }
    } else if (!rec && !small) {
      ctx.textAlign = touch ? "center" : "right";
      ctx.font = `11px ${FONT}`; ctx.fillStyle = C.dim;
      ctx.fillText(`単独出撃　経験値 +${Math.round(D.solo_xp_bonus * 100 * (1 + sim.mod("solo_xp")))}%`, touch ? W / 2 : W - pad - 128, H - pad - 8);
    }

    // ── 右下（PC）: 回避キー
    if (!touch) {
      const kx = W - pad - 110, ky = H - pad - 30;
      plate(ctx, kx, ky, 54, 26, ready ? GOLD : "rgba(201,163,90,.3)");
      if (!ready) { ctx.fillStyle = "rgba(201,163,90,.18)"; ctx.fillRect(kx + 1, ky + 1, 52 * (1 - h.dashCd / D.player.dash_cd), 24); }
      ctx.textAlign = "center"; ctx.font = `600 12px ${FONT}`; ctx.fillStyle = C.bone;
      ctx.fillText("Space", kx + 27, ky + 14);
      ctx.textAlign = "left"; ctx.font = `13px ${SERIF}`; ctx.fillStyle = ready ? C.bone : C.dim;
      ctx.fillText("回避", kx + 62, ky + 14);
    }

    // ── お知らせ（中央）
    ctx.textAlign = "left";
    if (this.toastT > 0) {
      ctx.globalAlpha = Math.min(1, this.toastT * 2);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `600 ${small ? 15 : 17}px ${SERIF}`;
      const w = ctx.measureText(this.toastText).width + 48, y = Math.max(H * 0.24, by + 30);
      ctx.fillStyle = "rgba(10,13,18,.88)"; ctx.fillRect(W / 2 - w / 2, y - 18, w, 36);
      ctx.fillStyle = GOLD; ctx.fillRect(W / 2 - w / 2, y - 18, w, 1); ctx.fillRect(W / 2 - w / 2, y + 17, w, 1);
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
      ].forEach((l, i) => ctx.fillText(l, pad, pad + 80 + i * 16));
    }
    ctx.textBaseline = "alphabetic";
  }

  /** 周りの敵の位置（主人公が中心。遠い敵は縁に寄せない＝範囲外は描かない） */
  private minimap(ctx: CanvasRenderingContext2D, sim: RunSim, x: number, y: number, s: number): void {
    plate(ctx, x, y, s, s);
    const cx = x + s / 2, cy = y + s / 2, R = 900, k = (s / 2 - 6) / R;
    ctx.save();
    rrect(ctx, x + 2, y + 2, s - 4, s - 4, 3); ctx.clip();
    ctx.strokeStyle = "rgba(201,163,90,.12)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.22, 0, 7); ctx.moveTo(cx + s * 0.44, cy); ctx.arc(cx, cy, s * 0.44, 0, 7); ctx.stroke();
    const h = sim.hero, en = sim.enemies;
    const step = en.length > 220 ? 2 : 1;   // 多い時は間引いて軽く
    ctx.fillStyle = "rgba(214,90,94,.75)";
    for (let i = 0; i < en.length; i += step) {
      const e = en[i];
      if (e.r > 14) continue;
      const dx = (e.x - h.x) * k, dy = (e.y - h.y) * k;
      if (Math.abs(dx) > s / 2 || Math.abs(dy) > s / 2) continue;
      ctx.fillRect(cx + dx - 1, cy + dy - 1, 2, 2);
    }
    for (const e of en) {
      if (e.r <= 14) continue;
      const dx = Math.max(-s / 2 + 5, Math.min(s / 2 - 5, (e.x - h.x) * k)), dy = Math.max(-s / 2 + 5, Math.min(s / 2 - 5, (e.y - h.y) * k));
      ctx.fillStyle = e.kind === "boss" ? "#ff5a5f" : e.kind === "wraith" ? C.taint : "#e0d36a";
      ctx.beginPath(); ctx.arc(cx + dx, cy + dy, e.kind === "boss" ? 4 : 3, 0, 7); ctx.fill();
    }
    if (sim.ghost) {
      ctx.fillStyle = C.soul;
      ctx.beginPath(); ctx.arc(cx + (sim.ghost.x - h.x) * k, cy + (sim.ghost.y - h.y) * k, 2.2, 0, 7); ctx.fill();
    }
    // 主人公（向きのわかる三角）
    const a = Math.atan2(h.fy, h.fx);
    ctx.fillStyle = "#f0d28c";
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 5, cy + Math.sin(a) * 5);
    ctx.lineTo(cx + Math.cos(a + 2.5) * 4, cy + Math.sin(a + 2.5) * 4);
    ctx.lineTo(cx + Math.cos(a - 2.5) * 4, cy + Math.sin(a - 2.5) * 4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
