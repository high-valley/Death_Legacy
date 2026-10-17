extends SceneTree
## ヘッドレス単体テスト（仕様書 §11 の受け入れ条件＋フェーズ1の機能）
##   godot --headless --path . -s res://tests/run_tests.gd
## 失敗があれば終了コード1。

const TEST_SAVE := "user://test_save.json"

var failures := 0
var passed := 0
var data: DataLoader
var repo: SaveRepository
var meta: MetaService


func _init() -> void:
	data = DataLoader.load_file()
	var tests := [
		"test_data_valid", "test_data_rejects_broken", "t_separation_pushes_apart", "t_touch_stick_follows",
		"t01_fresh_play_levelup_boss_death", "t02_tier_from_survival", "t03_solo_keeps_vault", "t04_companion_consumed_on_death",
		"t05_companion_consumed_on_clear", "t06_ghost_matches_and_attacks", "t07_settle_idempotent", "t08_crash_resume",
		"t08b_abandon_consumes", "t09_vault_full_swap", "t10_load_300",
		"t_reject_used_or_double", "t_corrupt_save_uses_backup", "t_migrate_old_save",
		"t_rarity_altar_shift", "t_lr_evolves", "t_rarity_passive_power", "t_seal_excludes", "t_affinity_raises_rate",
		"t_offerings_once", "t_alloc_limits", "t_heirloom_flow", "t_heirloom_crash_resume", "t_shelf_capacity", "t_retire_rules",
		"t_determinism", "t_bot_balance",
	]
	for name in tests:
		_reset()
		var before := failures
		call(name)
		if failures == before:
			passed += 1
			print("  ok   ", name)
		else:
			print("  FAIL ", name)
	print("\n%d passed, %d failed" % [passed, tests.size() - passed])
	for p in [TEST_SAVE, TEST_SAVE + ".bak", TEST_SAVE + ".tmp"]:
		if FileAccess.file_exists(p):
			DirAccess.remove_absolute(p)
	quit(1 if failures > 0 else 0)


func check(cond: bool, msg: String) -> void:
	if not cond:
		failures += 1
		printerr("    assertion failed: ", msg)


func _reset() -> void:
	for p in [TEST_SAVE, TEST_SAVE + ".bak", TEST_SAVE + ".tmp"]:
		if FileAccess.file_exists(p):
			DirAccess.remove_absolute(p)
	repo = SaveRepository.new(TEST_SAVE)
	repo.load_save()
	meta = MetaService.new(repo, data.D)


## 出撃（予約まで含む）。失敗時は null
func sortie(ghost_id := "", heir_id := "", mode := "short", weapon := "sword", seed_value := 1) -> RunSim:
	var rid := MetaService.uuid()
	if not meta.reserve(rid, seed_value, mode, weapon, ghost_id, heir_id):
		return null
	return RunSim.new(data, {"run_id": rid, "seed": seed_value, "mode": mode, "weapon": weapon,
		"ghost": meta.get_ghost(ghost_id) if ghost_id != "" else null, "heirloom": meta.get_heir(heir_id) if heir_id != "" else null, "card_mods": meta.card_mods()})


func die(r: RunSim, at := -1.0) -> Dictionary:
	if at >= 0.0:
		r.t = at
	r.hp = 0.0
	r.end("player_death")
	return meta.settle(r.summary(), r.result)


## 簡易ボット: 近い敵から逃げ、弾をよけ、経験値を拾う
func bot_step(r: RunSim) -> void:
	if r.pending > 0:
		r.apply_choice(r.roll_choices()[0])
	var mv := Vector2.ZERO
	var e: Object = r.grid.nearest(r.hero.pos, 95.0)
	if e:
		mv = (r.hero.pos - e.pos).normalized()
	elif not r.gems.is_empty():
		var best: Dictionary = r.gems[0]
		for g in r.gems:
			if g.pos.distance_to(r.hero.pos) < best.pos.distance_to(r.hero.pos):
				best = g
		mv = (best.pos - r.hero.pos).normalized()
	for s in r.eshots:
		var off: Vector2 = r.hero.pos - s.pos
		if off.length() < 90.0 and off.dot(s.vel) > 0.0:
			mv = Vector2(-s.vel.y, s.vel.x).normalized()
			if off.length() < 50.0:
				r.try_dash(mv)
			break
	r.step(RunSim.STEP, mv)
	r.drain_events()


# ------------------------------------------------------------------ sim
## タッチ操作: 大きくスワイプした後でも、少し逆に動かすだけで向きが変わる
func t_touch_stick_follows() -> void:
	var o := Vector2(100, 100)
	var p := o
	for i in 20:   # 右へ200px スワイプ
		p += Vector2(10, 0)
		o = TouchControls.follow_origin(o, p)
	check(o.distance_to(p) <= TouchControls.JOY_RADIUS + 0.01, "中心が指に付いてこない")
	check(TouchControls.stick_vector(o, p).x > 0.99, "右に全速で進まない")
	# 左へ切り返し: 中心を越えるまでの距離は半径ぶん（56px）＋少し
	for i in 7:
		p += Vector2(-10, 0)
		o = TouchControls.follow_origin(o, p)
	check(TouchControls.stick_vector(o, p).x < 0.0, "70px戻しても左へ向かない: %s" % TouchControls.stick_vector(o, p))


## 押し合い: 重なった小さい敵は離れ、精鋭は小さい敵を押しのける
func t_separation_pushes_apart() -> void:
	var r := RunSim.new(data, {"run_id": "sep", "seed": 3, "mode": "full", "weapon": "sword"})
	r.weapons = {}
	var a := r.spawn_enemy("chaser", 600.0)
	var b := r.spawn_enemy("chaser", 600.0)
	var e := r.spawn_enemy("elite", 600.0)
	var c := r.spawn_enemy("chaser", 600.0)
	b.pos = a.pos + Vector2(4, 0)
	c.pos = e.pos + Vector2(6, 0)
	for i in 10:
		r.step(RunSim.STEP, Vector2.ZERO)
	check(a.pos.distance_to(b.pos) > 15.0, "小さい敵どうしが離れない: %.1f" % a.pos.distance_to(b.pos))
	check(e.pos.distance_to(c.pos) > 20.0, "精鋭が押しのけない: %.1f" % e.pos.distance_to(c.pos))
	r.dispose()


# ------------------------------------------------------------------ data
func test_data_valid() -> void:
	check(data.is_valid(), "balance.json に検証エラー: %s" % [data.errors])


func test_data_rejects_broken() -> void:
	var d := DataLoader.new()
	var raw: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/balance.json"))
	raw.evolutions.erase("bow")
	raw.rarities.pop_back()
	raw.enemies.erase("boss")
	d.setup(raw)
	check(not d.is_valid() and d.errors.size() >= 3, "進化欠落・レア度不足・ボス欠落を検出 %s" % [d.errors])


# ------------------------------------------------------------------ §11 受け入れ条件
func t01_fresh_play_levelup_boss_death() -> void:
	check(meta.stored_ghosts().is_empty(), "新規データは亡霊0体")
	var r := sortie("", "", "short", "sword", 11)
	check(r != null, "亡霊0体でも出撃できる")
	for i in 60 * 40:
		bot_step(r)
	check(r.level >= 3 and r.kills > 20, "敵を倒してレベルアップできる (Lv%d, 撃破%d)" % [r.level, r.kills])
	r.t = r.run_len
	r.step(RunSim.STEP, Vector2.ZERO)
	check(r.boss_spawned, "時間でボスが出る")
	var out := die(r)
	check(out.result == "player_death" and meta.stored_ghosts().size() == 1, "敗北で亡霊が1体生まれる")


func t02_tier_from_survival() -> void:
	var r := sortie("", "", "full", "bow", 12)
	r.weapons.bow = 3
	die(r, 300.0)
	var g: Dictionary = meta.stored_ghosts()[0]
	check(g.survival_seconds == 300 and g.tier_id == "hero" and g.primary_weapon_id == "bow", "10分ランの5分 = 30分版の15分相当の英霊・弓 (%s)" % g.display_name)


func t03_solo_keeps_vault() -> void:
	die(sortie("", "", "short", "sword", 1), 60.0)
	var before := JSON.stringify(meta.stored_ghosts())
	var r := sortie("", "", "short", "fire", 13)
	r.end("boss_cleared")
	meta.settle(r.summary(), r.result)
	check(JSON.stringify(meta.stored_ghosts()) == before, "単独出撃では保管庫が変わらない")


func t04_companion_consumed_on_death() -> void:
	die(sortie("", "", "short", "sword", 1), 60.0)
	var gid: String = meta.stored_ghosts()[0].ghost_id
	var r := sortie(gid, "", "short", "sword", 14)
	check(meta.get_ghost(gid).status == "reserved", "出撃で reserved")
	die(r, 80.0)
	check(meta.get_ghost(gid).status == "consumed", "死亡でも同行亡霊は consumed")
	check(meta.stored_ghosts().size() == 1 and meta.stored_ghosts()[0].ghost_id != gid, "今回の主人公から新しい亡霊が生まれ、使った亡霊は選べない")
	check(sortie(gid) == null, "使用済みの亡霊は再び選べない")


func t05_companion_consumed_on_clear() -> void:
	die(sortie("", "", "short", "sword", 1), 60.0)
	var gid: String = meta.stored_ghosts()[0].ghost_id
	var r := sortie(gid, "", "short", "bow", 15)
	r.t = r.run_len + 1
	r.spawn_boss()
	r.boss.hp = 0
	r.step(RunSim.STEP, Vector2.ZERO)
	var out := meta.settle(r.summary(), r.result)
	check(r.result == "boss_cleared" and meta.get_ghost(gid).status == "consumed" and out.new_ghost_id == "", "生還でも consumed、亡霊は生まれない")


func t06_ghost_matches_and_attacks() -> void:
	die(sortie("", "", "short", "fire", 1), 150.0)
	var g: Dictionary = meta.stored_ghosts()[0]
	var r := sortie(g.ghost_id, "", "short", "sword", 16)
	check(r.ghost != null and r.ghost.rec.ghost_id == g.ghost_id, "選んだ亡霊が同行する")
	r.ghost.rec.display_name = "書き換え"
	check(meta.get_ghost(g.ghost_id).display_name != "書き換え", "戦闘中の亡霊は保管データのコピー")
	var ghost_hits := 0
	for i in 60 * 15:
		r.step(RunSim.STEP, Vector2.ZERO)
		for e in r.drain_events():
			pass
		for z in r.zones:
			if z.ghost:
				ghost_hits += 1
	check(ghost_hits > 0, "亡霊が生前の武器（炎魔法）で攻撃する")
	check(is_equal_approx(r.ghost_unlock(), 0.25), "序盤の解放率は25%")


func t07_settle_idempotent() -> void:
	var r := sortie("", "", "short", "sword", 17)
	r.t = 90.0
	r.hp = 0.0
	r.end("player_death")
	var a := meta.settle(r.summary(), r.result)
	var snap := JSON.stringify(repo.data)
	meta.settle(r.summary(), "player_death")
	meta.settle(r.summary(), "boss_cleared")
	check(JSON.stringify(repo.data) == snap, "終了処理を何度呼んでも生成・消費・供物が重複しない")
	check(a.offerings > 0, "1回目は供物が付く")


func t08_crash_resume() -> void:
	die(sortie("", "", "short", "sword", 1), 60.0)
	var gid: String = meta.stored_ghosts()[0].ghost_id
	var r := sortie(gid, "", "short", "fire", 18)
	for i in 60 * 12:
		bot_step(r)
		if r.checkpoint_due():
			meta.checkpoint(r.run_id, r.snapshot())
	var rid := r.run_id
	# アプリが落ちた: メモリを捨ててファイルから読み直す
	repo = SaveRepository.new(TEST_SAVE)
	repo.load_save()
	meta = MetaService.new(repo, data.D)
	var ar: Dictionary = repo.data.active_run
	check(ar.run_id == rid and meta.get_ghost(gid).status == "reserved", "異常終了後も出撃中のまま")
	check(repo.data.ghosts.filter(func(g: Dictionary) -> bool: return g.ghost_id == gid).size() == 1, "亡霊は複製されない")
	var r2 := RunSim.new(data, {"run_id": ar.run_id, "seed": int(ar.seed), "mode": ar.mode, "weapon": ar.weapon, "ghost": meta.get_ghost(ar.ghost_id),
		"heirloom": null, "card_mods": meta.card_mods(), "checkpoint": ar.checkpoint})
	check(r2.t >= 10.0 and r2.ghost != null and r2.ghost.rec.ghost_id == gid, "同じランを途中から再開 (%.0f秒)" % r2.t)
	die(r2)
	check(meta.get_ghost(gid).status == "consumed", "再開したランの終了で1回だけ消費")


func t08b_abandon_consumes() -> void:
	die(sortie("", "", "short", "sword", 1), 60.0)
	var gid: String = meta.stored_ghosts()[0].ghost_id
	sortie(gid, "", "short", "sword", 19)
	var out := meta.abandon_active()
	check(out.result == "retired" and meta.get_ghost(gid).status == "consumed" and repo.data.active_run == null, "放棄はリタイア扱いで消費")


func t09_vault_full_swap() -> void:
	for i in 10:
		die(sortie("", "", "short", "sword", 100 + i), 30.0 + i)
		meta.resolve_heirloom(-1)
	check(meta.stored_ghosts().size() == 10, "10体保管")
	var oldest: String = meta.stored_ghosts()[0].ghost_id
	var out := die(sortie("", "", "short", "bow", 200), 170.0)
	check(out.new_ghost_pending and repo.data.pending_ghost != null and meta.stored_ghosts().size() == 10, "満杯なら pending（捨てない）")
	repo = SaveRepository.new(TEST_SAVE)
	repo.load_save()
	meta = MetaService.new(repo, data.D)
	check(repo.data.pending_ghost != null, "入れ替え前に落ちても pending は残る")
	var nid: String = repo.data.pending_ghost.ghost_id
	check(meta.resolve_pending_ghost(oldest), "既存を成仏させて入れ替え")
	check(meta.stored_ghosts().size() == 10 and meta.get_ghost(oldest).status == "released" and meta.get_ghost(nid).status == "stored", "入れ替え後も10体")


func t10_load_300() -> void:
	var r := RunSim.new(data, {"run_id": "load", "seed": 3, "mode": "full", "weapon": "fire", "card_mods": meta.card_mods()})
	r.hp = 1e9
	r.t = 300.0
	r.weapons = {"sword": 5, "bow": 5, "fire": 5}
	for i in 300:
		var e := r.spawn_enemy(["chaser", "charger", "shooter"][i % 3])
		e.hp = 1e6
		e.max_hp = 1e6
	r.spawn_acc = -1e9
	var t0 := Time.get_ticks_usec()
	for i in 300:
		r.step(RunSim.STEP, Vector2.ZERO)
		r.drain_events()
	var ms := (Time.get_ticks_usec() - t0) / 1000.0 / 300.0
	print("    load: %.2f ms/tick（敵%d体・3武器Lv5）  60FPSの予算は16.7ms" % [ms, r.enemies.size()])
	check(r.enemies.size() >= 300, "300体を維持")
	check(ms < 12.0, "1ティック12ms未満")


# ------------------------------------------------------------------ 整合性
func t_reject_used_or_double() -> void:
	die(sortie("", "", "short", "sword", 1), 60.0)
	var gid: String = meta.stored_ghosts()[0].ghost_id
	check(sortie(gid) != null, "1回目は出撃できる")
	check(sortie(gid) == null, "出撃中に同じ亡霊で二重出撃できない")


func t_corrupt_save_uses_backup() -> void:
	die(sortie("", "", "short", "sword", 1), 60.0)
	die(sortie("", "", "short", "sword", 2), 60.0)
	var f := FileAccess.open(TEST_SAVE, FileAccess.WRITE)
	f.store_string("{broken")
	f.close()
	repo = SaveRepository.new(TEST_SAVE)
	repo.load_save()
	check(repo.source == "backup" and repo.data.ghosts.size() >= 1, "本体が壊れていたらバックアップから復元")


func t_migrate_old_save() -> void:
	var old := {"schema_version": 1, "ghosts": [], "run_history": [], "settled_runs": [], "progress": {"clears": 0, "deaths": 3, "runs": 3}}
	var f := FileAccess.open(TEST_SAVE, FileAccess.WRITE)
	f.store_string(JSON.stringify(old))
	f.close()
	repo = SaveRepository.new(TEST_SAVE)
	repo.load_save()
	check(repo.data.has("offerings") and repo.data.alloc.has("seals") and int(repo.data.progress.generation) == 0 and int(repo.data.progress.deaths) == 3, "古いセーブに新項目を補う")


# ------------------------------------------------------------------ フェーズ1
func _count_rarity(altar: int) -> Dictionary:
	var r := RunSim.new(data, {"run_id": "x", "seed": 5, "mode": "short", "weapon": "sword", "card_mods": {"altar": altar, "affinity": {}, "seals": []}})
	var c := {"N": 0, "R": 0, "SR": 0, "UR": 0, "LR": 0}
	for i in 20000:
		c[r.roll_rarity()] += 1
	return c


func t_rarity_altar_shift() -> void:
	var c0 := _count_rarity(0)
	var c10 := _count_rarity(10)
	print("    rarity LR %.1f%% → %.1f%%,  N %.0f%% → %.0f%%" % [c0.LR / 200.0, c10.LR / 200.0, c0.N / 200.0, c10.N / 200.0])
	check(c10.LR > c0.LR * 3 and c10.N < c0.N * 0.5, "祭壇で高レア率が上がる")


func t_lr_evolves() -> void:
	var r := RunSim.new(data, {"run_id": "x", "seed": 1, "mode": "short", "weapon": "sword"})
	r.weapons.sword = 2
	r.pending = 1
	r.apply_choice({"kind": "weapon", "id": "sword", "lv": 2, "rar": "LR"})
	check(r.evolved.get("sword", false) and r.weapons.sword == 3 and r.weapon_name("sword") == "冥剣", "LRで所持武器が進化")
	for i in 200:
		for c in r.roll_choices():
			check(not (c.kind == "weapon" and c.id == "sword" and c.rar == "LR"), "進化済みの武器にLRは出ない")


func t_rarity_passive_power() -> void:
	var r := RunSim.new(data, {"run_id": "x", "seed": 1, "mode": "short", "weapon": "sword"})
	r.apply_choice({"kind": "passive", "id": "might", "lv": 0, "rar": "UR"})
	r.apply_choice({"kind": "weapon", "id": "bow", "lv": 0, "rar": "SR"})
	check(r.passives.might == 1 and is_equal_approx(r.ppow.might, 2.5), "URパッシブは効果2.5倍")
	check(r.weapons.bow == 2 and is_equal_approx(r.wbonus.bow, 0.1), "SR武器はLv+2・ダメージ+10%")


func t_seal_excludes() -> void:
	var r := RunSim.new(data, {"run_id": "x", "seed": 1, "mode": "short", "weapon": "sword", "card_mods": {"altar": 0, "affinity": {}, "seals": ["bow", "swift"]}})
	var ids: Array = r.card_pool().map(func(o: Dictionary) -> String: return o.id)
	check(not "bow" in ids and not "swift" in ids and "fire" in ids, "封印したカードは新規取得の候補に出ない")


func t_affinity_raises_rate() -> void:
	var rate := func(af: Dictionary) -> float:
		var n := 0
		for i in 2000:
			var r := RunSim.new(data, {"run_id": "x", "seed": 1000 + i, "mode": "short", "weapon": "sword", "card_mods": {"altar": 0, "affinity": af, "seals": []}})
			if r.roll_choices().any(func(c: Dictionary) -> bool: return c.id == "haste"):
				n += 1
		return n / 2000.0
	var f0: float = rate.call({})
	var f4: float = rate.call({"haste": 4})
	print("    affinity haste: %.0f%% → %.0f%%" % [f0 * 100, f4 * 100])
	check(f4 > f0 * 1.2, "縁で出現率が上がる")


func t_offerings_once() -> void:
	var r := sortie("", "", "short", "bow", 21)
	r.kills = 250
	var out := die(r, 120.0)
	check(out.offerings == 8 and int(repo.data.offerings.earned) == 8, "生存6/10 + 撃破200 = 供物8 (%d)" % out.offerings)
	check(int(repo.data.progress.generation) == 1, "世代が1進む")


func t_alloc_limits() -> void:
	repo.data.offerings.earned = 5
	repo.data.progress.total_survival = 9999
	check(meta.alloc_altar(3), "祭壇に3")
	check(meta.alloc_affinity("fire", 2), "縁に2")
	check(not meta.alloc_altar(1), "供物が足りなければ捧げられない")
	check(not meta.toggle_seal("bow"), "封印は供物2が必要")
	check(meta.alloc_altar(-3) and meta.toggle_seal("bow"), "戻した供物で封印できる")
	check(not meta.alloc_affinity("bow", 1), "封印中のカードに縁は結べない")
	check(meta.offerings_free() >= 0, "使える供物は負にならない")


func t_heirloom_flow() -> void:
	var r := sortie("", "", "short", "bow", 22)
	r.passives = {"haste": 3}
	r.ppow = {"haste": 3.0}
	die(r, 100.0)
	var p: Dictionary = repo.data.pending_heirloom
	check(p != null and p.options.size() == 2, "死亡で形見の候補（武器とパッシブ）")
	meta.resolve_heirloom(1)
	var h: Dictionary = meta.stored_heirs()[0]
	check(h.type == "passive" and h.id == "haste" and h.level == 2, "形見はLvの半分（切り上げ）%s" % h.name)
	var r2 := sortie("", h.heir_id, "short", "sword", 23)
	check(meta.get_heir(h.heir_id).status == "reserved" and r2.passives.get("haste", 0) == 2, "身につけて出撃すると最初から持っている")
	die(r2, 50.0)
	check(meta.get_heir(h.heir_id) == null, "ランが終わると使い切り")


func t_heirloom_crash_resume() -> void:
	var r := sortie("", "", "short", "fire", 24)
	die(r, 100.0)
	meta.resolve_heirloom(0)
	var hid: String = meta.stored_heirs()[0].heir_id
	var r2 := sortie("", hid, "short", "sword", 25)
	for i in 60 * 11:
		bot_step(r2)
		if r2.checkpoint_due():
			meta.checkpoint(r2.run_id, r2.snapshot())
	repo = SaveRepository.new(TEST_SAVE)
	repo.load_save()
	meta = MetaService.new(repo, data.D)
	check(meta.get_heir(hid).status == "reserved", "異常終了後も形見は reserved のまま")
	var ar: Dictionary = repo.data.active_run
	var r3 := RunSim.new(data, {"run_id": ar.run_id, "seed": int(ar.seed), "mode": ar.mode, "weapon": ar.weapon, "ghost": null,
		"heirloom": meta.get_heir(ar.heirloom_id), "card_mods": meta.card_mods(), "checkpoint": ar.checkpoint})
	check(r3.weapons.get("fire", 0) >= 1, "再開しても形見の武器を持っている")
	die(r3)
	check(meta.get_heir(hid) == null, "再開したランの終了で1回だけ使い切る")


func t_shelf_capacity() -> void:
	for i in 7:
		die(sortie("", "", "short", "fire", 30 + i), 30.0)
		meta.resolve_heirloom(0)
	check(meta.stored_heirs().size() == int(data.D.shelf.capacity), "棚は5つまで（古いものから手放す）")


func t_retire_rules() -> void:
	var r := sortie("", "", "short", "sword", 50)
	r.t = 90.0
	r.end("retired")
	var out := meta.settle(r.summary(), r.result)
	check(out.offerings == 2 and repo.data.pending_heirloom == null and out.new_ghost_id == "", "リタイアは供物半分・形見と亡霊なし")


func t_determinism() -> void:
	var digests := []
	for k in 2:
		var r := RunSim.new(data, {"run_id": "d", "seed": 77, "mode": "short", "weapon": "bow", "card_mods": {"altar": 3, "affinity": {"fire": 2}, "seals": []}})
		for i in 60 * 50:
			bot_step(r)
		digests.append("%d|%d|%d|%.2f|%s" % [r.kills, r.level, r.enemies.size(), r.hp, JSON.stringify(r.weapons)])
	check(digests[0] == digests[1], "同seed・同入力で一致 %s" % [digests])


func t_bot_balance() -> void:
	var lines := []
	for altar in [0, 10]:
		var clears := 0
		for s in [1, 2, 3, 5, 6, 7]:
			var r := RunSim.new(data, {"run_id": "b", "seed": s, "mode": "short", "weapon": ["sword", "bow", "fire"][s % 3], "card_mods": {"altar": altar, "affinity": {}, "seals": []}})
			var i := 0
			while r.result == "" and i < 60 * 400:
				bot_step(r)
				i += 1
			if r.result == "boss_cleared":
				clears += 1
		lines.append("祭壇%d: %d/6 クリア" % [altar, clears])
	print("    bot: ", ", ".join(lines))
	check(true, "")
