class_name DataLoader
extends RefCounted
## data/balance.json を読み込み、検証する。バランス値はすべてここから参照する。

var D: Dictionary = {}
var errors: PackedStringArray = []


static func load_file(path: String = "res://data/balance.json") -> DataLoader:
	var d := DataLoader.new()
	if not FileAccess.file_exists(path):
		d.errors.append("ファイルがない: " + path)
		return d
	var v: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not v is Dictionary:
		d.errors.append("JSONとして読めない: " + path)
		return d
	d.setup(v)
	return d


func setup(dict: Dictionary) -> void:
	D = dict
	errors.clear()
	validate()
	if errors.is_empty():
		for t in D.tiers:
			t["color_c"] = Color.html(t.color)
		for r in D.rarities:
			r["color_c"] = Color.html(r.color)
		for id in D.enemies:
			D.enemies[id]["color_c"] = Color.html(D.enemies[id].color)


func is_valid() -> bool:
	return errors.is_empty()


func _need(dict: Variant, keys: Array, label: String) -> bool:
	if not dict is Dictionary:
		errors.append("%s: 辞書ではない" % label)
		return false
	var ok := true
	for k in keys:
		if not dict.has(k):
			errors.append("%s: '%s' がない" % [label, k])
			ok = false
	return ok


func validate() -> void:
	if not _need(D, ["schema_version", "data_version", "run_length", "vault_capacity", "tiers", "ghost_unlock", "player", "xp", "weapons",
			"passives", "rarities", "evolutions", "offerings", "altar", "library", "shelf", "enemies", "spawn"], "balance"):
		return
	# 等級は生存割合の昇順で、最初は0から
	var prev := -1.0
	for i in D.tiers.size():
		var t: Variant = D.tiers[i]
		if not _need(t, ["id", "name", "from", "mult", "color"], "tiers[%d]" % i):
			continue
		if float(t.from) <= prev:
			errors.append("tiers: from は昇順にする")
		prev = float(t.from)
	if not D.tiers.is_empty() and float(D.tiers[0].get("from", 1)) != 0.0:
		errors.append("tiers[0].from は 0")
	for id in D.weapons:
		_need(D.weapons[id], ["name", "desc", "cd", "damage"], "weapons." + id)
		if not D.evolutions.has(id):
			errors.append("evolutions に %s がない（LRで進化できない）" % id)
	for id in D.passives:
		_need(D.passives[id], ["name", "per", "fmt"], "passives." + id)
	var rar_ids := []
	for r in D.rarities:
		if _need(r, ["id", "name", "weight", "color", "wlv", "wbonus", "pmul"], "rarities"):
			rar_ids.append(r.id)
			if not D.altar.shift.has(r.id):
				errors.append("altar.shift に %s がない" % r.id)
			if not D.maxed_weapon_bonus.has(r.id):
				errors.append("maxed_weapon_bonus に %s がない" % r.id)
	if rar_ids != ["N", "R", "SR", "UR", "LR"]:
		errors.append("rarities は N, R, SR, UR, LR の順")
	for id in D.enemies:
		_need(D.enemies[id], ["name", "hp", "speed", "radius", "damage", "xp", "ai", "color"], "enemies." + id)
	if not D.enemies.has("boss") or D.enemies.get("boss", {}).get("ai", "") != "boss":
		errors.append("enemies.boss（ai: boss）が必要")
	if int(D.vault_capacity) < 1:
		errors.append("vault_capacity は1以上")
