// 武器の段階（グレード）の求め方。戦闘・セーブ・画面で共通に使う
import type { Weapon, WeaponGrade } from "./types.ts";

/** 武器Lvと進化の有無から、いまの段階（グレード）を求める */
export function weaponGrade(W: Weapon, lv: number, evo: boolean): WeaponGrade {
  const gs = W.grades;
  if (evo) return gs[gs.length - 1];
  let g = gs[0];
  for (let i = 0; i < gs.length - 1; i++) if (lv >= (gs[i].lv ?? 1)) g = gs[i];
  return g;
}

/** 段階の番号（0から。進化は最後） */
export function gradeIndex(W: Weapon, lv: number, evo: boolean): number {
  return W.grades.indexOf(weaponGrade(W, lv, evo));
}
