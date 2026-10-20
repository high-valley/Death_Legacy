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
  if (!need(raw, ["schema_version", "data_version", "run_length", "vault_capacity", "tiers", "ghost_unlock", "player", "xp", "weapons", "rank_levels", "weapon_card_weight", "cd_cut_max", "guard_floor", "crit_mult",
    "passives", "rarities", "maxed_weapon_bonus", "offerings", "altar", "library", "tree", "rites", "shelf", "enemies", "spawn", "checkpoint_interval", "lineages", "tags", "tag_points", "sigils", "sigil_chance", "curses", "curse_chance", "ghost_slots", "ghost_birth", "facilities"], "balance")) {
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
  need(D.spawn, ["base_per_sec", "per_progress", "max_alive", "hp_growth", "dmg_growth", "full_hp_growth", "full_dmg_growth", "full_curve", "curve"], "spawn");
  need(D.player, ["weapon_mult", "hp", "speed", "radius", "dash_speed", "dash_time", "dash_cd", "hit_iframe", "pickup"], "player");
  for (const id of Object.keys(D.weapons)) {
    if (!need(D.weapons[id], ["name", "desc", "cd", "damage", "per_level", "grades", "tags"], `weapons.${id}`)) continue;
    for (const t of D.weapons[id].tags) if (!(t in D.tags)) errors.push(`weapons.${id}: タグ '${t}' が tags にない`);
    // 段階: Lv1 から始まり lv は最大Lv以下、最後の1つだけが進化（evo）。道（branch）は a と b が同じLvにそろう
    const gs = D.weapons[id].grades;
    gs.forEach((g, i) => {
      need(g, ["name", "desc", "cd", "dmg"], `weapons.${id}.grades[${i}]`);
      const last = i === gs.length - 1;
      if (last !== !!g.evo) errors.push(`weapons.${id}: 進化（evo）は最後の段階に1つだけ（LRで進化できない）`);
      if (!last) {
        const lv = g.lv ?? 0;
        if (i === 0 && (lv !== 1 || g.branch)) errors.push(`weapons.${id}: 最初の段階は lv 1（道なし）`);
        if (lv < 1 || lv > D.weapon_max_level) errors.push(`weapons.${id}: 段階の lv は 1〜${D.weapon_max_level}`);
        if (g.branch && g.branch !== "a" && g.branch !== "b") errors.push(`weapons.${id}: branch は a / b`);
      }
    });
    for (const lv of new Set(gs.filter((g) => g.branch).map((g) => g.lv))) {
      const at = gs.filter((g) => g.lv === lv);
      if (!at.some((g) => g.branch === "a") || !at.some((g) => g.branch === "b")) errors.push(`weapons.${id}: Lv${lv} に道 a と b の両方が必要`);
    }
    if (gs.length < 2) errors.push(`weapons.${id}: 段階は2つ以上`);
    const ranks = new Set(gs.filter((g) => !g.evo).map((g) => g.lv ?? 1)).size;
    if (Array.isArray(D.rank_levels) && D.rank_levels.length !== ranks) errors.push(`weapons.${id}: rank_levels は ${ranks} 個（段階の数に合わせる）`);
  }
  if (Array.isArray(D.rank_levels)) D.rank_levels.forEach((v, i) => {
    if (!(v >= 1 && v <= D.weapon_max_level) || (i > 0 && v <= D.rank_levels[i - 1])) errors.push("rank_levels: 1〜最大Lvで、昇順にする");
  });
  for (const id of Object.keys(D.passives)) {
    need(D.passives[id], ["name", "per", "fmt"], `passives.${id}`);
    const t = D.passives[id].tag;
    if (t && isDict(D.tags) && !(t in D.tags)) errors.push(`passives.${id}: タグ '${t}' が tags にない`);
    const pm = D.passives[id].mod;
    if (pm !== undefined && (!t || !["burn", "slow_t", "cd", "length"].includes(pm))) errors.push(`passives.${id}: mod は burn / slow_t / cd / length（tag が要る）`);
  }
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
  const fids = new Set<string>();
  D.facilities.forEach((f, i) => {
    if (!need(f, ["id", "name", "icon", "desc", "cost", "slots", "unlock", "effect"], `facilities[${i}]`)) return;
    if (fids.has(f.id)) errors.push(`facilities: id '${f.id}' が重複`);
    fids.add(f.id);
    if (!["ghosts_born", "vault", "mourned"].includes(f.unlock.type)) errors.push(`facilities[${f.id}].unlock: type は ghosts_born / vault / mourned`);
    if (!(f.cost >= 0) || !(f.slots >= 0)) errors.push(`facilities[${f.id}]: cost と slots は0以上`);
    const e = f.effect;
    if (!(Number(f.unlock.count) >= 1)) errors.push(`facilities[${f.id}].unlock: count は1以上`);
    if (e.steps && !(Number(e.every) >= 1)) errors.push(`facilities[${f.id}].effect: steps には every（1以上）が要る`);
    (e.steps ?? []).forEach((st, j) => {
      if (typeof st.text !== "string") errors.push(`facilities[${f.id}].steps[${j}]: text が要る`);
      for (const k of Object.keys(st)) if (!["text", "ghost_atk", "hp"].includes(k)) errors.push(`facilities[${f.id}].steps[${j}]: 知らない項目 '${k}'`);
    });
    for (const k of Object.keys(e)) if (!["offer_per_mult", "tag_points", "every", "steps"].includes(k)) errors.push(`facilities[${f.id}].effect: 知らない項目 '${k}'`);
  });
  // 祭壇の樹: 根は1つ（費用0・親なし）、親は先に定義された節、レア度の合計は altar.max 以下
  const nids = new Set<string>();
  let altarSum = 0;
  const effKeys = ["altar", "affinity_pts", "seal_slots", "ghost_atk", "devour_bonus", "taint_resist", "mourn_bonus", "ghost_slots", "sigil_tier", "curses"];
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
  // タグとセット効果・刻印・呪い・亡霊の枠と誕生条件
  const MODS = ["dmg", "cd", "area", "burn", "explode", "slow_t", "freeze", "shatter", "chain", "nodecay", "count", "pierce", "length", "ghost_atk", "ghost_cd", "ghost_full"];
  for (const [t, def] of Object.entries(D.tags)) {
    if (!need(def, ["name", "color", "sets"], `tags.${t}`)) continue;
    let pa = 0;
    for (const st of def.sets) {
      if (!(st.at > pa)) errors.push(`tags.${t}: sets の at は昇順`);
      pa = st.at;
      for (const k of Object.keys(st.mods)) if (!MODS.includes(k)) errors.push(`tags.${t}: 知らない効果 '${k}'`);
    }
  }
  need(D.tag_points, ["hero_weapon", "ghost_weapon", "ghost_spirit", "passive_level"], "tag_points");
  const SIG = ["ember_step", "soul_drain", "iron_vow", "greed", "frost_thorn", "executioner", "ghost_echo", "storm_heart", "undying", "hunt_glory"];
  for (const sg of D.sigils) if (need(sg, ["id", "tier", "name", "desc"], "sigils") && !SIG.includes(sg.id)) errors.push(`sigils: '${sg.id}' の効果がコードにない`);
  const CUR = ["might", "max_hp", "haste", "xp", "enemy_speed", "dmg_taken", "area", "dash_cd", "speed", "pickup", "spawn_rate", "enemy_hp", "hp_drain", "weapon_lv", "passive_slots"];
  for (const c of D.curses) if (need(c, ["id", "name", "desc", "mods"], "curses")) {
    for (const k of Object.keys(c.mods)) if (!CUR.includes(k)) errors.push(`curses.${c.id}: 知らない効果 '${k}'`);
    if (c.need !== undefined && c.need !== "few_passives") errors.push(`curses.${c.id}: need は few_passives だけ`);
  }
  if (need(D.ghost_slots, ["base", "max"], "ghost_slots") && !(D.ghost_slots.base >= 1 && D.ghost_slots.max >= D.ghost_slots.base)) errors.push("ghost_slots: 1 <= base <= max");
  need(D.ghost_birth, ["fragments", "min_survival", "drops"], "ghost_birth");
  for (const [lv, u] of D.ghost_unlock) if (!(lv >= 1 && u > 0 && u <= 1)) errors.push("ghost_unlock は [レベル, 0〜1]");
  return { D, errors };
}
