class_name SaveRepository
extends RefCounted
## セーブの読み書き。
##   書き込み: 一時ファイルに書く → 読み戻して検証 → 旧ファイルを .bak に退避 → 本体へ置き換え
##   読み込み: 本体が壊れていれば .bak から復元
## デスクトップでは user://（OSのユーザーデータ領域）、Web版ではブラウザ内（IndexedDB）に保存される。

const SCHEMA_VERSION := 1

var path: String
var data: Dictionary = {}
var source := "fresh"      # fresh / main / backup
var last_error := ""


func _init(p_path: String = "user://save.json") -> void:
	path = p_path


static func fresh(data_version: int = 1) -> Dictionary:
	return {
		"schema_version": SCHEMA_VERSION, "data_version": data_version,
		"ghost_seq": 0, "ghosts": [], "run_history": [], "settled_runs": [],
		"active_run": null, "pending_ghost": null, "pending_heirloom": null,
		"progress": {"clears": 0, "deaths": 0, "runs": 0, "generation": 0, "total_survival": 0},
		"offerings": {"earned": 0}, "alloc": {"altar": 0, "affinity": {}, "seals": []},
		"heirlooms": [], "heir_seq": 0,
	}


static func is_valid(d: Variant) -> bool:
	return d is Dictionary and d.has("schema_version") and d.get("ghosts") is Array and d.get("run_history") is Array


## schema_version を上げる時は、ここに段階的な変換（v1 → v2 → …）を足す
static func migrate(d: Dictionary) -> Dictionary:
	var base := fresh()
	for k in base:
		if not d.has(k):
			d[k] = base[k]
	for k in base.progress:
		if not d.progress.has(k):
			d.progress[k] = base.progress[k]
	for k in base.alloc:
		if not d.alloc.has(k):
			d.alloc[k] = base.alloc[k]
	d.schema_version = SCHEMA_VERSION
	return d


func load_save() -> Dictionary:
	source = "fresh"
	var found: Variant = null
	for p in [path, path + ".bak"]:
		if not FileAccess.file_exists(p):
			continue
		var j := JSON.new()
		if j.parse(FileAccess.get_file_as_string(p)) != OK:
			continue
		var v: Variant = j.data
		if is_valid(v):
			found = v
			source = "main" if p == path else "backup"
			break
	data = migrate(found) if found != null else fresh()
	return data


func write() -> bool:
	var text := JSON.stringify(data)
	var tmp := path + ".tmp"
	var f := FileAccess.open(tmp, FileAccess.WRITE)
	if f == null:
		last_error = "一時ファイルを開けない"
		return false
	f.store_string(text)
	f.close()
	if FileAccess.get_file_as_string(tmp) != text:
		last_error = "書き込み検証に失敗"
		return false
	if FileAccess.file_exists(path):
		var prev := FileAccess.get_file_as_string(path)
		var b := FileAccess.open(path + ".bak", FileAccess.WRITE)
		if b:
			b.store_string(prev)
			b.close()
		DirAccess.remove_absolute(path)
	var err := DirAccess.rename_absolute(tmp, path)
	if err != OK:
		last_error = "置き換えに失敗 (%d)" % err
		return false
	return true


func wipe() -> void:
	data = fresh()
	write()
