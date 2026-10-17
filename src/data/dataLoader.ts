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
  if (!need(raw, ["schema_version", "data_version", "run_length", "vault_capacity", "tiers", "ghost_unlock", "player", "xp", "weapons",
    "passives", "rarities", "maxed_weapon_bonus", "evolutions", "offerings", "altar", "library", "shelf", "enemies", "spawn", "checkpoint_interval", "lineages"], "balance")) {
    return { D, errors };
  }
  // 等級は生存割合の昇順で、最初は0から
  let prev = -1;
  D.tiers.forEach((t, i) => {
    if (!need(t, ["id", "name", "from", "mult", "color"], `tiers[${i}]`)) return;
    if (t.from <= prev) errors.push("tiers: from は昇順にする");
    prev = t.from;
  });
  if (D.tiers.length > 0 && D.tiers[0].from !== 0) errors.push("tiers[0].from は 0");
  need(D.player, ["hp", "speed", "radius", "dash_speed", "dash_time", "dash_cd", "hit_iframe", "pickup"], "player");
  for (const id of Object.keys(D.weapons)) {
    need(D.weapons[id], ["name", "desc", "cd", "damage"], `weapons.${id}`);
    if (!isDict(D.evolutions) || !(id in D.evolutions)) errors.push(`evolutions に ${id} がない（LRで進化できない）`);
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
  for (const [lv, u] of D.ghost_unlock) if (!(lv >= 1 && u > 0 && u <= 1)) errors.push("ghost_unlock は [レベル, 0〜1]");
  return { D, errors };
}
