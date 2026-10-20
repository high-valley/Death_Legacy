// 武器の段階（グレード＝ランク）の求め方。戦闘・セーブ・画面で共通に使う
// ランク 0（最初）→ 1（道 a / b を選ぶ）→ 2（同じ道の先）→ 進化（共通の最終段階）。
// grades の lv（1 / 3 / 5）はランクの並びを表す印。武器のレベル（ダメージ）とは別（ADR 024）
import type { Weapon, WeaponGrade } from "./types.ts";

export type Branch = "a" | "b";

/** 武器Lv・進化・選んだ道から、いまの段階を求める（道を選んでいなければ a） */
export function weaponGrade(W: Weapon, lv: number, evo: boolean, branch?: Branch | ""): WeaponGrade {
  const gs = W.grades;
  if (evo) return gs[gs.length - 1];
  const b = branch || "a";
  let g = gs[0];
  for (let i = 0; i < gs.length - 1; i++) {
    const x = gs[i];
    if (x.branch && x.branch !== b) continue;
    if (lv >= (x.lv ?? 1) && (x.lv ?? 1) >= (g.lv ?? 1)) g = x;
  }
  return g;
}

/** 段階の高さ（0〜2: ランク / 3: 進化）。HUDの色分けに使う。lv は grades の lv の印（rankLv で作る） */
export function gradeIndex(W: Weapon, lv: number, evo: boolean): number {
  if (evo) return 3;
  const lvs = [...new Set(W.grades.filter((g) => !g.evo).map((g) => g.lv ?? 1))].sort((a, b) => a - b);
  let i = 0;
  lvs.forEach((l, k) => { if (lv >= l) i = k; });
  return i;
}

/** 道を選ぶLv（最初に branch が付く段階のLv）。無ければ 0 */
export function branchLevel(W: Weapon): number {
  return W.grades.find((g) => g.branch)?.lv ?? 0;
}

/** 道ごとの段階（説明用） */
export function branchGrades(W: Weapon, b: Branch): WeaponGrade[] {
  return W.grades.filter((g) => !g.evo && g.branch === b);
}

/** ランク（0〜）を grades の lv の印に直す */
export function rankLv(W: Weapon, rank: number): number {
  const lvs = [...new Set(W.grades.filter((g) => !g.evo).map((g) => g.lv ?? 1))].sort((a, b) => a - b);
  return lvs[Math.max(0, Math.min(lvs.length - 1, rank))];
}

/** 進化前のランクの数（最初・道・道の先 = 3） */
export function rankCount(W: Weapon): number {
  return new Set(W.grades.filter((g) => !g.evo).map((g) => g.lv ?? 1)).size;
}

/** ランク・進化・道から段階を求める */
export function gradeAt(W: Weapon, rank: number, evo: boolean, branch?: Branch | ""): WeaponGrade {
  return weaponGrade(W, rankLv(W, rank), evo, branch);
}

/** 古い（ランクとレベルが一緒だった頃の Lv1〜5）武器Lvから、ランクと新しいレベルを求める */
export function legacyWeapon(oldLv: number): { rank: number; level: number } {
  const lv = Math.max(1, Math.round(oldLv));
  // 旧 Lv5 はダメージ1.8倍×攻撃間隔0.8（実質約2.3倍）→ 新しいレベル（1Lv +12%）で同じくらいの Lv12 に
  return { rank: lv >= 5 ? 2 : lv >= 3 ? 1 : 0, level: Math.min(20, Math.round(1 + (lv - 1) * 2.75)) };
}
