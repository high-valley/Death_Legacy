// 武器の段階（グレード）の求め方。戦闘・セーブ・画面で共通に使う
// 段階: Lv1 → Lv3（道 a / b を選ぶ）→ Lv5（同じ道の先）→ レジェンドレアで進化（共通の最終段階）
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

/** 段階の高さ（0: Lv1〜 / 1: Lv3〜 / 2: Lv5 / 3: 進化）。HUDの色分けに使う */
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
