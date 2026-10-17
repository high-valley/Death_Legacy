class_name MetaService
extends RefCounted
## ランをまたぐ要素をまとめて扱う。
##   GhostInventory  : 亡霊の保管・入れ替え
##   GhostFactory    : 死亡した主人公から亡霊を作る
##   Offerings       : 供物の獲得と、祭壇（レア率）・書庫（縁・封印）への割り振り
##   Heirlooms       : 形見の候補・棚・装備
##   RunSettlement   : 出撃予約 → チェックポイント → ラン終了処理（冪等）
## 亡霊と形見の状態: stored → reserved（出撃中）→ consumed / 使用済み。異常終了しても reserved のまま残り、同じランを再開できる。

var repo: SaveRepository
var D: Dictionary


func _init(p_repo: SaveRepository, p_D: Dictionary) -> void:
	repo = p_repo
	D = p_D


func S() -> Dictionary:
	return repo.data


static func uuid() -> String:
	var b := Crypto.new().generate_random_bytes(16)
	return b.hex_encode()


# ================================================================== ghosts
func stored_ghosts() -> Array:
	return S().ghosts.filter(func(g: Dictionary) -> bool: return g.status == "stored")


func get_ghost(id: String) -> Variant:
	for g in S().ghosts:
		if g.ghost_id == id:
			return g
	return null


func tier_for(sec: float, run_len: float) -> Dictionary:
	var f := sec / run_len
	var out: Dictionary = D.tiers[0]
	for x in D.tiers:
		if f >= float(x.from) - 1e-6:
			out = x
	return out


func tier(id: String) -> Dictionary:
	for x in D.tiers:
		if x.id == id:
			return x
	return D.tiers[0]


## GhostFactory: 生存時間 → 等級、最も育った武器と代表パッシブを継承
func create_ghost(sm: Dictionary) -> Dictionary:
	var tr := tier_for(float(sm.t), float(sm.run_len))
	var wid: String = sm.main_weapon
	var wlv := -1
	for id in sm.weapons:
		var lv := int(sm.weapons[id])
		if lv > wlv or (lv == wlv and id == sm.main_weapon):
			wid = id
			wlv = lv
	var pid := ""
	var pbest := -1.0
	for id in sm.ppow:
		if float(sm.ppow[id]) > pbest:
			pbest = float(sm.ppow[id])
			pid = id
	S().ghost_seq = int(S().ghost_seq) + 1
	var ppow: Dictionary = sm.ppow
	return {
		"ghost_id": uuid(), "origin_run_id": sm.run_id, "created_at": Time.get_datetime_string_from_system(true),
		"display_name": "第%d代・%sの%s" % [int(S().ghost_seq), D.weapons[wid].name, tr.name],
		"survival_seconds": int(sm.t), "run_length": int(sm.run_len), "tier_id": tr.id,
		"primary_weapon_id": wid, "weapon_level": wlv, "evolved": bool(sm.evolved.get(wid, false)),
		"passive_id": pid, "passive_level": int(sm.passives.get(pid, 0)) if pid != "" else 0,
		"kills": int(sm.kills), "boss_kills": int(sm.boss_kills), "death_cause_id": sm.death_cause if sm.death_cause != "" else "unknown",
		"stat_snapshot": {
			"attack_mult": float(tr.mult) * (1.0 + 0.12 * float(ppow.get("might", 0.0))) * (1.0 + float(sm.wbonus.get(wid, 0.0))),
			"attack_speed": 1.0 + 0.1 * float(ppow.get("haste", 0.0)),
			"area": 1.0 + 0.12 * float(ppow.get("area", 0.0)),
		},
		"data_version": int(D.data_version), "status": "stored",
	}


## 保管庫が満杯の時の入れ替え。release_id が新しい亡霊なら、新しい方を成仏させる
func resolve_pending_ghost(release_id: String) -> bool:
	var ng: Variant = S().pending_ghost
	if ng == null:
		return false
	if release_id == ng.ghost_id:
		ng.status = "released"
	else:
		var g: Variant = get_ghost(release_id)
		if g == null or g.status != "stored":
			return false
		g.status = "released"
		ng.status = "stored"
	S().ghosts.append(ng)
	S().pending_ghost = null
	repo.write()
	return true


# ================================================================== heirlooms
func stored_heirs() -> Array:
	return S().heirlooms.filter(func(h: Dictionary) -> bool: return h.status == "stored")


func get_heir(id: String) -> Variant:
	for h in S().heirlooms:
		if h.heir_id == id:
			return h
	return null


func heir_label(o: Dictionary) -> String:
	var nm: String = D.weapons[o.id].name if o.type == "weapon" else D.passives[o.id].name
	return "%s Lv%d" % [nm, int(o.level)]


func heir_effect(o: Dictionary) -> String:
	var nm: String = D.weapons[o.id].name if o.type == "weapon" else D.passives[o.id].name
	return "出撃時から%sをLv%dで持つ" % [nm, int(o.level)]


## index = 選んだ候補、-1 = 残さない
func resolve_heirloom(index: int) -> void:
	var p: Variant = S().pending_heirloom
	if p == null:
		return
	if index >= 0 and index < p.options.size():
		var o: Dictionary = p.options[index]
		S().heir_seq = int(S().heir_seq) + 1
		S().heirlooms.append({"heir_id": uuid(), "name": "第%d代の形見・%s" % [int(p.generation), heir_label(o)], "type": o.type, "id": o.id,
			"level": int(o.level), "from_generation": int(p.generation), "status": "stored"})
		var st := stored_heirs()
		if st.size() > int(D.shelf.capacity):
			var old: Dictionary = st[0]
			S().heirlooms = S().heirlooms.filter(func(h: Dictionary) -> bool: return h.heir_id != old.heir_id)
	S().pending_heirloom = null
	repo.write()


# ================================================================== offerings
func offerings_used() -> int:
	var a: Dictionary = S().alloc
	var n := int(a.altar) + int(a.seals.size()) * int(D.library.seal_cost)
	for k in a.affinity:
		n += int(a.affinity[k])
	return n


func offerings_free() -> int:
	return int(S().offerings.earned) - offerings_used()


func library_unlocked() -> bool:
	return int(S().progress.total_survival) >= int(D.library.unlock_total_survival)


func shelf_unlocked() -> bool:
	return int(S().progress.generation) >= int(D.shelf.unlock_generation)


func affinity(id: String) -> int:
	return int(S().alloc.affinity.get(id, 0))


func sealed(id: String) -> bool:
	return id in S().alloc.seals


func card_mods() -> Dictionary:
	return {"altar": int(S().alloc.altar), "affinity": S().alloc.affinity.duplicate(), "seals": S().alloc.seals.duplicate()}


func alloc_altar(delta: int) -> bool:
	var a: Dictionary = S().alloc
	var nv := int(a.altar) + delta
	if nv < 0 or nv > int(D.altar.max) or (delta > 0 and offerings_free() < delta):
		return false
	a.altar = nv
	repo.write()
	return true


func alloc_affinity(id: String, delta: int) -> bool:
	var a: Dictionary = S().alloc
	var nv := affinity(id) + delta
	if nv < 0 or nv > int(D.library.affinity_max) or (delta > 0 and (offerings_free() < delta or sealed(id) or not library_unlocked())):
		return false
	if nv == 0:
		a.affinity.erase(id)
	else:
		a.affinity[id] = nv
	repo.write()
	return true


func toggle_seal(id: String) -> bool:
	var a: Dictionary = S().alloc
	if sealed(id):
		a.seals.erase(id)
	else:
		if not library_unlocked() or a.seals.size() >= int(D.library.seal_max) or offerings_free() < int(D.library.seal_cost) or affinity(id) > 0:
			return false
		a.seals.append(id)
	repo.write()
	return true


# ================================================================== sortie / settlement
## 出撃確定の瞬間に保存。亡霊・形見は reserved になり、異常終了しても複製されない
func reserve(run_id: String, seed_value: int, mode: String, weapon: String, ghost_id: String, heir_id: String) -> bool:
	if S().active_run != null:
		return false
	var g: Variant = null
	var h: Variant = null
	if ghost_id != "":
		g = get_ghost(ghost_id)
		if g == null or g.status != "stored":
			return false            # 使用済み・重複選択を拒否
	if heir_id != "":
		h = get_heir(heir_id)
		if h == null or h.status != "stored":
			return false
	if g:
		g.status = "reserved"
		g.reserved_by_run = run_id
	if h:
		h.status = "reserved"
		h.reserved_by_run = run_id
	S().active_run = {"run_id": run_id, "seed": seed_value, "mode": mode, "weapon": weapon, "ghost_id": ghost_id, "heirloom_id": heir_id,
		"started_at": Time.get_datetime_string_from_system(true), "checkpoint": null}
	repo.write()
	return true


func checkpoint(run_id: String, snap: Dictionary) -> void:
	var ar: Variant = S().active_run
	if ar == null or ar.run_id != run_id:
		return
	ar.checkpoint = snap
	repo.write()


## result: player_death / boss_cleared / retired。同じ run_id で何度呼んでも1回分しか処理しない
func settle(sm: Dictionary, res: String) -> Dictionary:
	var s := S()
	if sm.run_id in s.settled_runs:
		for h in s.run_history:
			if h.run_id == sm.run_id:
				return h
		return {}
	var ended := Time.get_datetime_string_from_system(true)
	var out := {"run_id": sm.run_id, "seed": sm.seed, "mode": sm.mode, "duration_seconds": int(sm.t), "result": res,
		"selected_ghost_id": sm.ghost_id, "player_build": {"weapons": sm.weapons, "passives": sm.passives}, "player_level": sm.level,
		"kills": sm.kills, "boss_kills": sm.boss_kills, "ended_at": ended, "consumed_ghost": "", "new_ghost_id": "", "new_ghost_pending": false,
		"used_heirloom": "", "offerings": 0, "generation": 0}
	# ① 同行亡霊は結果にかかわらず消費
	if sm.ghost_id != "":
		var g: Variant = get_ghost(sm.ghost_id)
		if g != null and g.status == "reserved" and g.get("reserved_by_run", "") == sm.run_id:
			g.status = "consumed"
			g.consumed_by_run = sm.run_id
			g.consumed_at = ended
			out.consumed_ghost = g.display_name
	# ② 死亡時だけ新しい亡霊。満杯なら pending にして入れ替えを選ばせる（捨てない）
	if res == "player_death":
		var ng := create_ghost(sm)
		if stored_ghosts().size() < int(D.vault_capacity):
			s.ghosts.append(ng)
		else:
			ng.status = "pending"
			s.pending_ghost = ng
			out.new_ghost_pending = true
		out.new_ghost_id = ng.ghost_id
		out.new_ghost = ng.display_name
		s.progress.deaths = int(s.progress.deaths) + 1
	if res == "boss_cleared":
		s.progress.clears = int(s.progress.clears) + 1
	s.progress.runs = int(s.progress.runs) + 1
	# ③ 世代交代: 供物・形見の候補・世代数
	var of: Dictionary = D.offerings
	var frac := minf(1.0, float(sm.t) / float(sm.run_len))
	var offer := int(floor(frac * 10.0)) * int(of.per_tenth_survived) + int(sm.kills / 100) * int(of.per_100_kills) + (int(of.clear_bonus) if res == "boss_cleared" else 0)
	if res == "retired":
		offer = int(floor(offer * float(of.retire_rate)))
	s.offerings.earned = int(s.offerings.earned) + offer
	out.offerings = offer
	s.progress.generation = int(s.progress.generation) + 1
	s.progress.total_survival = int(s.progress.total_survival) + int(sm.t)
	out.generation = s.progress.generation
	if sm.heirloom_id != "":
		var h: Variant = get_heir(sm.heirloom_id)
		if h != null and h.status == "reserved" and h.get("reserved_by_run", "") == sm.run_id:
			out.used_heirloom = h.name
			s.heirlooms = s.heirlooms.filter(func(x: Dictionary) -> bool: return x.heir_id != h.heir_id)
	if res != "retired":
		var opts: Array = []
		for id in sm.weapons:
			opts.append({"type": "weapon", "id": id, "level": mini(int(D.shelf.max_level), ceili(int(sm.weapons[id]) / 2.0))})
		for id in sm.passives:
			opts.append({"type": "passive", "id": id, "level": mini(int(D.shelf.max_level), ceili(int(sm.passives[id]) / 2.0))})
		s.pending_heirloom = {"run_id": sm.run_id, "generation": s.progress.generation, "options": opts}
	# ④ 履歴・処理済み記録・出撃中フラグの解除を同じ書き込みで確定
	s.run_history.push_front(out)
	s.run_history = s.run_history.slice(0, 30)
	s.settled_runs.append(sm.run_id)
	s.settled_runs = s.settled_runs.slice(maxi(0, s.settled_runs.size() - 100))
	s.active_run = null
	var gone: Array = s.ghosts.filter(func(g: Dictionary) -> bool: return g.status in ["consumed", "released"])
	if gone.size() > 30:
		var drop := {}
		for i in gone.size() - 30:
			drop[gone[i].ghost_id] = true
		s.ghosts = s.ghosts.filter(func(g: Dictionary) -> bool: return not drop.has(g.ghost_id))
	repo.write()
	return out


## 中断したランを再開せずに放棄する（リタイア扱い: 同行亡霊・形見は消費、亡霊は生まれない）
func abandon_active() -> Dictionary:
	var ar: Variant = S().active_run
	if ar == null:
		return {}
	var cp: Dictionary = ar.checkpoint if ar.checkpoint is Dictionary else {}
	var sm := {"run_id": ar.run_id, "seed": ar.seed, "mode": ar.mode, "t": float(cp.get("t", 0.0)), "run_len": float(D.run_length[ar.mode]),
		"main_weapon": ar.weapon, "weapons": cp.get("weapons", {ar.weapon: 1}), "passives": cp.get("passives", {}), "ppow": cp.get("ppow", {}),
		"wbonus": cp.get("wbonus", {}), "evolved": cp.get("evolved", {}), "level": int(cp.get("level", 1)), "kills": int(cp.get("kills", 0)),
		"boss_kills": 0, "death_cause": "", "ghost_id": ar.ghost_id, "heirloom_id": ar.get("heirloom_id", "")}
	return settle(sm, "retired")
