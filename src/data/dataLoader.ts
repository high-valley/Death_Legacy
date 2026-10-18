// data/balance.json を検証する。項目を足したら、ここにも検証を足す。
import type { Balance } from "./types.ts";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);

export interface Loaded {
  D: Balance;
  errors: string[];
}

export function loadBalance(raw: unknown): Loaded {
  const errors: string[] = [];
  const need = (d: unknown, keys: string[], label: string): boolean => {
    if (!isDict(d)) {
      errors.push(`${label}: 辞書ではない`);
      return false;
    }
    let ok = true;
    for (const k of keys) {
      if (!(k in d)) {
        errors.push(`${label}: '${k}' がない`);
        ok = false;
      }
    }
    return ok;
  };

  const D = raw as Balance;
  if (!need(raw, ["schema_version", "data_version", "run_length", "vault_capacity", "tiers", "ghost_unlock", "player", "xp", "weapons", "evolve_min_level",
    "passives", "rarities", "maxed_weapon_bonus", "offerings", "altar", "library", "tree", "rites", "shelf", "enemies", "spawn", "checkpoint_interval", "lineages"], "balance")) {
    return { D, errors };
  }
  // 等級は生存割合の昇順で、最初は0から
  let prev = -1;
  D.tiers.forEach((t, i) => {
    if (!need(t, ["id", "name", "from", "mult", "rank", "color"], `tiers[${i}]`)) return;
    if (t.from <= prev) errors.push("tiers: from は昇順にする");
    prev = t.from;
  });
  if (D.tiers.length > 0 && D.tiers[0].from !== 0) errors.push("tiers[0].from は 0");
  need(D.player, ["hp", "speed", "radius", "dash_speed", "dash_time", "dash_cd", "hit_iframe", "pickup"], "player");
  for (const id of Object.keys(D.weapons)) {
    if (!need(D.weapons[id], ["name", "desc", "cd", "damage", "per_level", "grades"], `weapons.${id}`)) continue;
    // 段階: Lv1 から始まり lv は昇順・最大Lv以下、最後の1つだけが進化（evo）
    const gs = D.weapons[id].grades;
    let plv = 0;
    gs.forEach((g, i) => {
      need(g, ["name", "desc", "cd", "dmg"], `weapons.${id}.grades[${i}]`);
      const last = i === gs.length - 1;
      if (last !== !!g.evo) errors.push(`weapons.${id}: 進化（evo）は最後の段階に1つだけ（LRで進化できない）`);
      if (!last) {
        const lv = g.lv ?? 0;
        if (i === 0 && lv !== 1) errors.push(`weapons.${id}: 最初の段階は lv 1`);
        if (lv <= plv || lv > D.weapon_max_level) errors.push(`weapons.${id}: 段階の lv は昇順で ${D.weapon_max_level} 以下`);
        plv = lv;
      }
    });
    if (gs.length < 2) errors.push(`weapons.${id}: 段階は2つ以上`);
  }
  for (const id of Object.keys(D.passives)) need(D.passives[id], ["name", "per", "fmt"], `passives.${id}`);
  const rarIds: string[] = [];
  for (const r of D.rarities) {
    if (need(r, ["id", "name", "weight", "color", "wlv", "wbonus", "pmul"], "rarities")) {
      rarIds.push(r.id);
      if (!(r.id in D.altar.shift)) errors.push(`altar.shift に ${r.id} がない`);
      if (!(r.id in D.maxed_weapon_bonus)) errors.push(`maxed_weapon_bonus に ${r.id} がない`);
    }
  }
  if (rarIds.join(",") !== "N,R,SR,UR,LR") errors.push("rarities は N, R, SR, UR, LR の順");
  for (const id of Object.keys(D.enemies)) need(D.enemies[id], ["name", "hp", "speed", "radius", "damage", "xp", "ai", "color"], `enemies.${id}`);
  if (!isDict(D.enemies.boss) || D.enemies.boss.ai !== "boss") errors.push("enemies.boss（ai: boss）が必要");
  if (!(D.vault_capacity >= 1)) errors.push("vault_capacity は1以上");
  // 家系: 最初の1つは最初から使える（unlock なし）。武器は実在するもの、解放条件は既知の型
  const lids = new Set<string>();
  D.lineages.forEach((l, i) => {
    if (!need(l, ["id", "name", "motto", "trait", "weakness", "weapon", "mods", "card", "unlock"], `lineages[${i}]`)) return;
    if (lids.has(l.id)) errors.push(`lineages: id '${l.id}' が重複`);
    lids.add(l.id);
    if (l.weapon !== null && !(l.weapon in D.weapons)) errors.push(`lineages[${l.id}]: weapon '${l.weapon}' がない`);
    if (need(l.card, ["id", "name", "max", "per", "fmt"], `lineages[${l.id}].card`) && !(l.card.max >= 1)) errors.push(`lineages[${l.id}].card: max は1以上`);
    const u = l.unlock;
    if (i === 0 && u !== null) errors.push("lineages[0] は最初から使える家系にする（unlock: null）");
    if (u !== null) {
      if (u.type === "weapon_level") {
        if (!(u.weapon in D.weapons)) errors.push(`lineages[${l.id}].unlock: weapon '${u.weapon}' がない`);
      } else if (u.type !== "companion_runs") {
        errors.push(`lineages[${l.id}].unlock: type は weapon_level / companion_runs`);
      }
    }
  });
  if (D.lineages.length === 0) errors.push("lineages: 1つ以上必要");
  // 祭壇の樹: 根は1つ（費用0・親なし）、親は先に定義された節、レア度の合計は altar.max 以下
  const nids = new Set<string>();
  let altarSum = 0;
  const effKeys = ["altar", "affinity_pts", "seal_slots", "ghost_atk", "devour_bonus", "taint_resist", "mourn_bonus"];
  D.tree.forEach((n, i) => {
    if (!need(n, ["id", "name", "x", "y", "cost", "parents", "desc", "effect"], `tree[${i}]`)) return;
    if (nids.has(n.id)) errors.push(`tree: id '${n.id}' が重複`);
    if (i === 0 && (n.parents.length > 0 || n.cost !== 0)) errors.push("tree[0] は根（parents: []、cost: 0）にする");
    if (i > 0 && n.parents.length === 0) errors.push(`tree[${n.id}]: 親がない`);
    for (const p of n.parents) if (!nids.has(p)) errors.push(`tree[${n.id}]: 親 '${p}' が先に定義されていない`);
    for (const k of Object.keys(n.effect)) if (!effKeys.includes(k)) errors.push(`tree[${n.id}]: 知らない効果 '${k}'`);
    altarSum += n.effect.altar ?? 0;
    nids.add(n.id);
  });
  if (altarSum > D.altar.max) errors.push(`tree: altar の合計 ${altarSum} が altar.max ${D.altar.max} を超える`);
  if (need(D.rites, ["devour", "mourn", "wraith"], "rites")) {
    need(D.rites.devour, ["might_per_mult", "hp_per_mult"], "rites.devour");
    need(D.rites.mourn, ["base", "per_mult"], "rites.mourn");
    need(D.rites.wraith, ["at", "hp_per_mult", "short_hp_mult", "purify_offerings", "enemy_hp_per_taint"], "rites.wraith");
    if (!(D.rites.wraith.at > 0 && D.rites.wraith.at < 1)) errors.push("rites.wraith.at は 0〜1");
  }
  if (!isDict(D.enemies.wraith) || D.enemies.wraith.ai !== "wraith") errors.push("enemies.wraith（ai: wraith）が必要");
  for (const [lv, u] of D.ghost_unlock) if (!(lv >= 1 && u > 0 && u <= 1)) errors.push("ghost_unlock は [レベル, 0〜1]");
  return { D, errors };
}
