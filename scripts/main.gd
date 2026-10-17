extends Node
## ゲーム全体の状態機械と配線。
##   TITLE → HUB（出撃・祭壇・書庫・形見の棚）→ PLAY ⇄ (LEVEL / PAUSE) → RESULT → HUB
## RunSim（戦闘ロジック）・MetaService（亡霊・供物・形見・ラン終了処理）・表示・入力をつなぐだけ。

enum State { TITLE, HUB, PLAY, LEVEL, PAUSE, SETTINGS, RESULT, LOADTEST }

var state := State.TITLE
var data: DataLoader
var repo: SaveRepository
var meta: MetaService
var sim: RunSim
var end_timer := 0.0
var settings_back: Callable
var load_text := ""
var _load := {}

var router: InputRouter
var view: BattleView
var hud: Hud
var touch: TouchControls
var menus: Menus
var sfx: Sfx


func _ready() -> void:
	randomize()
	data = DataLoader.load_file()
	if not data.is_valid():
		var l := Label.new()
		l.text = "データ定義にエラーがあります:\n" + "\n".join(data.errors)
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		add_child(l)
		return
	repo = SaveRepository.new()
	repo.load_save()
	meta = MetaService.new(repo, data.D)

	router = InputRouter.new()
	add_child(router)
	view = BattleView.new()
	add_child(view)
	var layer := CanvasLayer.new()
	add_child(layer)
	hud = Hud.new()
	hud.view = view
	layer.add_child(hud)
	touch = TouchControls.new()
	touch.router = router
	touch.sim_ref = func() -> RunSim: return sim
	layer.add_child(touch)
	menus = Menus.new()
	menus.setup(meta)
	layer.add_child(menus)
	sfx = Sfx.new()
	add_child(sfx)
	menus.hub.seed = randi() % 1000000

	router.dash_requested.connect(func() -> void: if state == State.PLAY: sim.try_dash(router.move_vector()))
	router.pause_toggled.connect(func() -> void:
		if state == State.PLAY:
			_pause()
		elif state == State.PAUSE:
			_set_state(State.PLAY))
	router.debug_toggled.connect(func() -> void:
		Settings.debug_hud = not Settings.debug_hud
		Settings.save())
	router.hotkey.connect(func(i: int) -> void: if state in [State.LEVEL, State.RESULT]: menus.press_hotkey(i))
	router.touch_mode_changed.connect(_on_touch_mode)
	menus.sortie_requested.connect(_sortie)
	get_window().size_changed.connect(_apply_ui_scale)
	get_window().focus_exited.connect(func() -> void: if state == State.PLAY: _pause())
	router.set_touch_mode(Platform.prefers_touch())
	_on_touch_mode(router.touch_mode)
	_to_title()
	_dev_hooks()


# ------------------------------------------------------------------ loop
## 戦闘は物理ティック（60Hz固定）で進める → seed 再現性
func _physics_process(_delta: float) -> void:
	if sim == null or not state in [State.PLAY, State.LOADTEST]:
		return
	sim.step(RunSim.STEP, router.move_vector())
	for e in sim.drain_events():
		match e.type:
			"fx": view.add_fx(e)
			"sfx": sfx.play(e.name)
			"toast": hud.toast(e.text)
			"shake":
				if Settings.shake:
					view.add_shake(e.amount)
	if state == State.LOADTEST:
		sim.pending = 0
		return
	if sim.checkpoint_due():
		meta.checkpoint(sim.run_id, sim.snapshot())
	if sim.result != "":
		end_timer -= RunSim.STEP
		if end_timer <= 0.0:
			_finish()
	elif sim.pending > 0:
		_level_up()


func _process(delta: float) -> void:
	if state == State.LOADTEST:
		_load.time += delta
		_load.frames += 1
		_load.upd += sim.update_ms
		_load.worst = maxf(_load.worst, sim.update_ms)
		if _load.time >= 10.0:
			load_text = "敵%d体: 平均 %d FPS / 更新 %.2f ms（最大 %.1f ms）" % [sim.enemies.size(), roundi(_load.frames / _load.time), _load.upd / _load.frames, _load.worst]
			_drop_sim()
			_open_settings(settings_back)


# ------------------------------------------------------------------ states
func _set_state(s: State) -> void:
	state = s
	router.gameplay_enabled = s == State.PLAY
	touch.reset()
	if s in [State.PLAY, State.LOADTEST]:
		menus.hide_all()
		get_viewport().gui_release_focus()
	hud.visible = sim != null
	touch.visible = router.touch_mode and s == State.PLAY


func _to_title() -> void:
	_drop_sim()
	_set_state(State.TITLE)
	menus.show_title(meta.S().active_run, _to_hub, _resume, func() -> void:
		meta.abandon_active()
		_to_title(), func() -> void: _open_settings(_to_title))


func _to_hub() -> void:
	_drop_sim()
	_set_state(State.HUB)
	if meta.S().pending_ghost != null or meta.S().pending_heirloom != null:
		menus.show_pending(_to_hub)
		return
	menus.show_hub(_to_title)


func _drop_sim() -> void:
	if sim:
		sim.dispose()
	sim = null
	view.sim = null
	hud.sim = null
	view.clear()


func _begin(s: RunSim) -> void:
	sim = s
	view.sim = s
	hud.sim = s
	end_timer = 1.3
	_set_state(State.PLAY)
	if s.ghost:
		hud.toast("%s が付き従う" % s.ghost.rec.display_name)
		sfx.play("ghost")


func _sortie(ghost_id: String, heir_id: String, weapon: String, mode: String, seed_value: int) -> void:
	var rid := MetaService.uuid()
	# 出撃確定の瞬間に予約を保存（亡霊・形見は reserved）
	if not meta.reserve(rid, seed_value, mode, weapon, ghost_id, heir_id):
		_to_hub()
		return
	var s := RunSim.new(data, {"run_id": rid, "seed": seed_value, "mode": mode, "weapon": weapon,
		"ghost": meta.get_ghost(ghost_id) if ghost_id != "" else null, "heirloom": meta.get_heir(heir_id) if heir_id != "" else null, "card_mods": meta.card_mods()})
	menus.hub.ghost = ""
	menus.hub.heir = ""
	if heir_id != "":
		hud.toast("形見を身につけた")
	_begin(s)


func _resume() -> void:
	var ar: Dictionary = meta.S().active_run
	_begin(RunSim.new(data, {"run_id": ar.run_id, "seed": int(ar.seed), "mode": ar.mode, "weapon": ar.weapon,
		"ghost": meta.get_ghost(ar.ghost_id) if ar.ghost_id != "" else null, "heirloom": meta.get_heir(ar.get("heirloom_id", "")) if ar.get("heirloom_id", "") != "" else null,
		"card_mods": meta.card_mods(), "checkpoint": ar.checkpoint if ar.checkpoint is Dictionary else null}))


func _level_up() -> void:
	_set_state(State.LEVEL)
	sfx.play("level")
	menus.show_level(sim, sim.roll_choices(), func(c: Dictionary) -> void:
		sim.apply_choice(c)
		if sim.pending > 0:
			_level_up()
		else:
			_set_state(State.PLAY))


func _pause() -> void:
	_set_state(State.PAUSE)
	menus.show_pause(sim, func() -> void: _set_state(State.PLAY), func() -> void: _open_settings(_pause), func() -> void:
		sim.end("retired")
		_finish())


func _finish() -> void:
	var out := meta.settle(sim.summary(), sim.result)   # 冪等: 2回呼ばれても重複しない
	_set_state(State.RESULT)
	menus.show_result(sim, out, _to_hub)


func _open_settings(back: Callable) -> void:
	settings_back = back
	var prev := state
	_set_state(State.SETTINGS)
	menus.show_settings(func() -> void:
		if prev == State.PAUSE:
			_pause()
		else:
			back.call(), _start_load_test, func() -> void: repo.wipe(), load_text)


## 負荷試験: 敵300体を出して10秒間の更新時間とFPSを測る（セーブには触れない）
func _start_load_test() -> void:
	_drop_sim()
	var s := RunSim.new(data, {"run_id": "load-test", "seed": 1, "mode": "full", "weapon": "fire"})
	s.hp = 1e9
	s.max_hp = 1e9
	s.t = 300.0
	s.weapons = {"sword": 5, "bow": 5, "fire": 5}
	for i in 300:
		var e := s.spawn_enemy(["chaser", "charger", "shooter"][i % 3])
		e.hp = 1e6
		e.max_hp = 1e6
	s.spawn_acc = -1e9
	sim = s
	view.sim = s
	hud.sim = s
	_load = {"time": 0.0, "frames": 0, "upd": 0.0, "worst": 0.0}
	_set_state(State.LOADTEST)


# ------------------------------------------------------------------ touch / scale
func _on_touch_mode(on: bool) -> void:
	view.touch_mode = on
	menus.touch_mode = on
	touch.visible = on and state == State.PLAY
	_apply_ui_scale()


## スマホでは論理解像度の短辺を約600にして、文字とボタンを指で扱える大きさにする
func _apply_ui_scale() -> void:
	var win := get_window()
	if not router.touch_mode:
		win.content_scale_factor = 1.0
		return
	var phys := Vector2(win.size)
	var base_fit := minf(phys.x / 1920.0, phys.y / 1080.0)
	win.content_scale_factor = clampf(minf(phys.x, phys.y) / 600.0 / maxf(base_fit, 0.01), 1.0, 4.0)


# ------------------------------------------------------------------ dev
## `godot --path . -- --shot=out.png [--play] [--touch] [--frames=N] [--screen=hub|altar|library|shelf|level|result] [--save=path]`
func _dev_hooks() -> void:
	var args := {}
	for a in OS.get_cmdline_user_args():
		var kv := a.trim_prefix("--").split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	if not args.has("shot"):
		return
	repo.path = "user://devshot_save.json"
	repo.wipe()
	if args.has("touch"):
		router.set_touch_mode(true)
	var screen: String = args.get("screen", "")
	if screen != "" or args.has("play"):
		# 見本データ: 亡霊3体・形見・供物
		for k in 3:
			var rid := MetaService.uuid()
			meta.reserve(rid, k, "short", ["bow", "fire", "sword"][k], "", "")
			var r := RunSim.new(data, {"run_id": rid, "seed": k, "mode": "short", "weapon": ["bow", "fire", "sword"][k]})
			r.t = [100.0, 150.0, 172.0][k]
			r.weapons[r.main_weapon] = 4
			r.passives = {"haste": 2}
			r.ppow = {"haste": 3.0}
			r.kills = 300 + k * 200
			r.hp = 0
			r.end("player_death")
			meta.settle(r.summary(), r.result)
			meta.resolve_heirloom(0)
		repo.data.alloc.altar = 4
		repo.data.alloc.affinity = {"fire": 2, "might": 1}
		repo.data.alloc.seals = ["swift"]
		repo.write()
	if screen in ["hub", "altar", "library", "shelf"]:
		menus.hub.tab = "sortie" if screen == "hub" else screen
		menus.hub.ghost = meta.stored_ghosts()[2].ghost_id
		_to_hub()
	if args.has("play") or screen in ["level", "result"]:
		_sortie(meta.stored_ghosts()[2].ghost_id if screen != "" or args.has("play") else "", "", "fire", "short", 12345)
	var frames := int(args.get("frames", "30"))
	for i in frames:
		await get_tree().physics_frame
		if state == State.LEVEL and i < frames - 3:
			menus.press_hotkey(0)
	if screen == "level" and sim:
		sim.pending = 1
		_level_up()
	if screen == "result" and sim:
		sim.hp = 0
		sim.end("player_death")
		_finish()
	for i in 3:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(args.shot)
	print("screenshot saved: ", args.shot)
	get_tree().quit()
