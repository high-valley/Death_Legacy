class_name Menus
extends Control
## 戦闘以外の画面: タイトル / 納骨堂（出撃・祭壇・書庫・形見の棚）/ 確認 / レベルアップ / ポーズ / 設定 / リザルト。
## 仮UIなのでコードで組み立てている。

signal sortie_requested(ghost_id: String, heir_id: String, weapon: String, mode: String, seed_value: int)

const C_NIGHT := Color("#0b1014")
const C_MOSS := Color("#121a1f")
const C_EDGE := Color("#24323a")
const C_BONE := Color("#e8efe9")
const C_DIM := Color("#8fa39c")
const C_SOUL := Color("#8ff0e0")
const C_CANDLE := Color("#f0b35a")
const C_BLOOD := Color("#e2555a")

var meta: MetaService
var D: Dictionary
var screens := {}
var hub := {"tab": "sortie", "ghost": "", "heir": "", "weapon": "sword", "mode": "short", "seed": 0}
var touch_mode := false
var _hotkeys: Array = []
var _retire_armed := false
var _wipe_armed := false
var seed_edit: LineEdit


func setup(m: MetaService) -> void:
	meta = m
	D = m.D


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	theme = _theme()
	for name in ["title", "hub", "confirm", "level", "pause", "settings", "result"]:
		screens[name] = _overlay()
	hide_all()


# ------------------------------------------------------------------ building blocks
func _box(bg: Color, edge: Color, pad := 14, left := 1) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = edge
	sb.set_border_width_all(1)
	sb.border_width_left = left
	sb.set_corner_radius_all(4)
	sb.set_content_margin_all(pad)
	return sb


func _theme() -> Theme:
	var th := Theme.new()
	th.default_font_size = 20
	th.set_stylebox("normal", "Button", _box(Color("#1b262c"), Color("#2f414a")))
	th.set_stylebox("hover", "Button", _box(Color("#1b262c"), C_SOUL))
	th.set_stylebox("pressed", "Button", _box(Color("#22323a"), C_SOUL))
	th.set_stylebox("focus", "Button", _box(Color("#1b262c"), C_CANDLE))
	th.set_stylebox("disabled", "Button", _box(Color("#10171b"), C_EDGE))
	th.set_color("font_color", "Button", C_BONE)
	th.set_color("font_hover_color", "Button", C_BONE)
	th.set_color("font_disabled_color", "Button", Color("#56635f"))
	th.set_color("font_color", "Label", C_BONE)
	th.set_stylebox("normal", "LineEdit", _box(C_NIGHT, C_EDGE, 10))
	return th


func _overlay() -> Dictionary:
	var ov := ColorRect.new()
	ov.color = Color(C_NIGHT, 0.86)
	ov.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	ov.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(ov)
	var scroll := ScrollContainer.new()
	scroll.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	ov.add_child(scroll)
	var center := CenterContainer.new()
	center.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	center.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.add_child(center)
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _box(C_MOSS, C_EDGE, 28))
	center.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 14)
	panel.add_child(box)
	return {"ov": ov, "box": box, "panel": panel, "scroll": scroll}


func _width() -> float:
	return minf(1040.0, get_viewport_rect().size.x - 40.0)


func _cols() -> int:
	return 3 if _width() > 900.0 else (2 if _width() > 600.0 else 1)


func _open(name: String) -> VBoxContainer:
	hide_all()
	var s: Dictionary = screens[name]
	for c in s.box.get_children():
		s.box.remove_child(c)
		c.queue_free()
	s.panel.custom_minimum_size = Vector2(_width(), 0)
	s.ov.show()
	s.scroll.scroll_vertical = 0
	_hotkeys = []
	return s.box


func hide_all() -> void:
	for s in screens.values():
		s.ov.hide()


func press_hotkey(i: int) -> void:
	if i < _hotkeys.size() and not _hotkeys[i].disabled:
		_hotkeys[i].pressed.emit()


func _label(text: String, size := 20, col := C_BONE) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", col)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l


func _button(text: String, on_press: Callable, primary := false, danger := false) -> Button:
	var b := Button.new()
	b.text = text
	if primary:
		b.add_theme_stylebox_override("normal", _box(C_SOUL, C_SOUL))
		b.add_theme_stylebox_override("hover", _box(C_SOUL.lightened(0.15), C_CANDLE))
		b.add_theme_color_override("font_color", Color("#082420"))
		b.add_theme_color_override("font_hover_color", Color("#082420"))
	elif danger:
		b.add_theme_stylebox_override("normal", _box(Color("#1b262c"), C_BLOOD))
		b.add_theme_color_override("font_color", Color("#ffd9da"))
	b.pressed.connect(on_press)
	return b


func _row(parent: Control) -> HFlowContainer:
	var r := HFlowContainer.new()
	r.add_theme_constant_override("h_separation", 10)
	r.add_theme_constant_override("v_separation", 10)
	parent.add_child(r)
	return r


func _grid(parent: Control, cols := -1) -> GridContainer:
	var g := GridContainer.new()
	g.columns = cols if cols > 0 else _cols()
	g.add_theme_constant_override("h_separation", 10)
	g.add_theme_constant_override("v_separation", 10)
	parent.add_child(g)
	return g


## 複数行・色付きのカード。lines: [[text, size, color], ...]。on_press が無効なら表示だけ
func _card(lines: Array, accent: Color, on_press: Callable, height := 118.0, pressed := false, disabled := false) -> Control:
	var root: Control
	if on_press.is_valid():
		var b := Button.new()
		b.disabled = disabled
		var edge := C_SOUL if pressed else C_EDGE
		b.add_theme_stylebox_override("normal", _box(C_NIGHT, edge, 12, 4))
		b.add_theme_stylebox_override("hover", _box(C_NIGHT, C_SOUL, 12, 4))
		b.add_theme_stylebox_override("focus", _box(C_NIGHT, C_CANDLE, 12, 4))
		b.add_theme_stylebox_override("pressed", _box(C_NIGHT, C_SOUL, 12, 4))
		b.add_theme_stylebox_override("disabled", _box(C_NIGHT, C_EDGE, 12, 4))
		for st in ["normal", "hover", "focus", "pressed", "disabled"]:
			var sb: StyleBoxFlat = b.get_theme_stylebox(st)
			sb.border_color = accent if st == "normal" and not pressed else sb.border_color
			sb.border_width_left = 4
			if pressed:
				sb.set_border_width_all(2)
				sb.border_width_left = 4
		b.pressed.connect(on_press)
		root = b
	else:
		var p := PanelContainer.new()
		p.add_theme_stylebox_override("panel", _box(C_NIGHT, accent, 12, 4))
		root = p
	root.custom_minimum_size = Vector2(0, height)
	root.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var m := MarginContainer.new()
	m.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		m.add_theme_constant_override("margin_" + side, 12)
	m.add_theme_constant_override("margin_left", 16)
	m.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	m.add_child(v)
	for ln in lines:
		var l := _label(ln[0], ln[1], ln[2])
		l.mouse_filter = Control.MOUSE_FILTER_IGNORE
		if disabled:
			l.modulate = Color(1, 1, 1, 0.45)
		v.add_child(l)
	if root is PanelContainer:
		root.add_child(m)
	else:
		root.add_child(m)
	return root


func ghost_card(g: Dictionary, pressed: bool, on_press: Callable, extra := "") -> Control:
	var tr := meta.tier(g.tier_id)
	var w: Dictionary = D.weapons[g.primary_weapon_id]
	var line2 := "生存 %s / %s Lv%d%s" % [Hud.fmt(g.survival_seconds), D.evolutions[g.primary_weapon_id].name if g.get("evolved", false) else w.name, int(g.weapon_level),
		(" / %s Lv%d" % [D.passives[g.passive_id].name, int(g.passive_level)]) if g.passive_id != "" else ""]
	var cause: String = D.enemies[g.death_cause_id].name if D.enemies.has(g.death_cause_id) else "不明"
	var lines := [["%s · 攻撃 ×%s" % [tr.name, str(tr.mult)], 14, tr.color_c], [g.display_name, 18, C_BONE], [line2, 14, C_DIM], ["撃破 %d · 死因 %s" % [int(g.kills), cause], 14, C_DIM]]
	if extra != "":
		lines.append([extra, 14, C_CANDLE])
	return _card(lines, tr.color_c, on_press, 136.0 if extra != "" else 118.0, pressed)


# ------------------------------------------------------------------ title
func show_title(active: Variant, on_hub: Callable, on_resume: Callable, on_abandon: Callable, on_settings: Callable) -> void:
	var box := _open("title")
	box.add_child(_label("PROTOTYPE · GODOT %s" % Engine.get_version_info().string.split(".stable")[0], 14, C_CANDLE))
	var t := RichTextLabel.new()
	t.bbcode_enabled = true
	t.fit_content = true
	t.scroll_active = false
	t.add_theme_font_size_override("normal_font_size", 78)
	t.text = "DEATH [color=#8ff0e0]LEGACY[/color]"
	box.add_child(t)
	box.add_child(_label("今日の自分が、明日の仲間になる。死んだ主人公は亡霊として残り、次の出撃に一度だけ連れていける。連れていった亡霊は、そのランが終われば成仏する。", 19, C_DIM))
	var row := _row(box)
	var gen := int(meta.S().progress.generation)
	if active != null:
		var cp: Dictionary = active.checkpoint if active.checkpoint is Dictionary else {}
		var g: Variant = meta.get_ghost(active.ghost_id) if active.ghost_id != "" else null
		row.add_child(_button("中断したランを再開（%s%s）" % [Hud.fmt(float(cp.get("t", 0.0))), ("・" + g.display_name + "同行") if g else "・単独"], on_resume, true))
		row.add_child(_button("放棄する（リタイア扱い）", on_abandon, false, true))
	else:
		row.add_child(_button("納骨堂へ（第%d代が出撃を待つ）" % (gen + 1) if int(meta.S().progress.runs) > 0 else "はじめる", on_hub, true))
	row.add_child(_button("Settings", on_settings))
	if Platform.can_quit():
		row.add_child(_button("Quit", func() -> void: get_tree().quit()))
	box.add_child(_label("画面ドラッグで移動 / 攻撃は自動 / 右下で回避 / 右上でポーズ（横向き推奨）" if touch_mode else "WASD 移動 / 攻撃は自動 / Space 回避 / Esc・P ポーズ / 強化は クリック か 1・2・3 / F3 デバッグ", 16, C_DIM))
	if meta.repo.source == "backup":
		box.add_child(_label("セーブが壊れていたため、バックアップから復元しました。", 16, C_CANDLE))


# ------------------------------------------------------------------ hub
func show_hub(on_back: Callable) -> void:
	var box := _open("hub")
	var top := HBoxContainer.new()
	var hl := _label("納骨堂", 14, C_CANDLE)
	hl.autowrap_mode = TextServer.AUTOWRAP_OFF
	top.add_child(hl)
	var off := _label("供物 %d / %d　第%d代" % [meta.offerings_free(), int(meta.S().offerings.earned), int(meta.S().progress.generation) + 1], 16, C_CANDLE)
	off.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	off.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	top.add_child(off)
	box.add_child(top)
	var tabs := _row(box)
	for t in [["sortie", "出撃", true], ["altar", "祭壇", true], ["library", "書庫", meta.library_unlocked()], ["shelf", "形見の棚", meta.shelf_unlocked()]]:
		var id: String = t[0]
		var b := _button(t[1] + ("" if t[2] else "（未解放）"), func() -> void:
			hub.tab = id
			show_hub(on_back))
		if hub.tab == id:
			b.add_theme_stylebox_override("normal", _box(Color("#1f3036"), C_SOUL))
			b.add_theme_color_override("font_color", C_SOUL)
		tabs.add_child(b)
	match hub.tab:
		"altar": _hub_altar(box, on_back)
		"library": _hub_library(box, on_back)
		"shelf": _hub_shelf(box)
		_: _hub_sortie(box, on_back)


func _hub_sortie(box: VBoxContainer, on_back: Callable) -> void:
	var stored := meta.stored_ghosts()
	if hub.ghost != "" and not stored.any(func(g: Dictionary) -> bool: return g.ghost_id == hub.ghost):
		hub.ghost = ""
	box.add_child(_label("亡霊保管庫 %d / %d" % [stored.size(), int(D.vault_capacity)], 22))
	var g := _grid(box)
	g.add_child(_card([["単独出撃", 14, C_CANDLE], ["誰も連れていかない", 18, C_BONE], ["亡霊は温存される。経験値 +%d%%" % roundi(float(D.solo_xp_bonus) * 100), 14, C_DIM]], C_CANDLE,
		func() -> void:
			hub.ghost = ""
			show_hub(on_back), 118.0, hub.ghost == ""))
	for gh in stored:
		var gid: String = gh.ghost_id
		g.add_child(ghost_card(gh, hub.ghost == gid, func() -> void:
			hub.ghost = gid
			show_hub(on_back)))
	if stored.is_empty():
		box.add_child(_label("まだ亡霊はいない。死ねば、その生き様が最初の亡霊になる。", 16, C_DIM))
	if meta.shelf_unlocked():
		var heirs := meta.stored_heirs()
		if hub.heir != "" and not heirs.any(func(h: Dictionary) -> bool: return h.heir_id == hub.heir):
			hub.heir = ""
		box.add_child(_label("形見（1つだけ身につけられる・そのランで使い切り）", 20))
		var hg := _grid(box)
		hg.add_child(_card([["形見", 14, C_CANDLE], ["何も持たない", 18, C_BONE], ["形見は棚に残る", 14, C_DIM]], C_CANDLE, func() -> void:
			hub.heir = ""
			show_hub(on_back), 100.0, hub.heir == ""))
		for h in heirs:
			var hid: String = h.heir_id
			hg.add_child(_card([["第%d代より" % int(h.from_generation), 14, C_CANDLE], [h.name, 17, C_BONE], [meta.heir_effect(h), 14, C_DIM]], C_CANDLE, func() -> void:
				hub.heir = hid
				show_hub(on_back), 100.0, hub.heir == hid))
	box.add_child(_label("初期武器", 18))
	var wr := _row(box)
	for id in D.weapons:
		var wid: String = id
		var b := _button(D.weapons[id].name, func() -> void:
			hub.weapon = wid
			show_hub(on_back))
		if hub.weapon == wid:
			b.add_theme_stylebox_override("normal", _box(Color("#1f3036"), C_SOUL))
		wr.add_child(b)
	var mr := _row(box)
	for m in [["short", "短縮 3分でボス"], ["full", "仕様どおり 10分"]]:
		var mid: String = m[0]
		var b := _button(m[1], func() -> void:
			hub.mode = mid
			show_hub(on_back))
		if hub.mode == mid:
			b.add_theme_stylebox_override("normal", _box(Color("#1f3036"), C_SOUL))
		mr.add_child(b)
	seed_edit = LineEdit.new()
	seed_edit.text = str(hub.seed)
	seed_edit.custom_minimum_size = Vector2(200, 0)
	var sl := _label("Seed", 16, C_DIM)
	sl.autowrap_mode = TextServer.AUTOWRAP_OFF
	sl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	mr.add_child(sl)
	mr.add_child(seed_edit)
	var warn := ""
	var gsel: Variant = meta.get_ghost(hub.ghost) if hub.ghost != "" else null
	var hsel: Variant = meta.get_heir(hub.heir) if hub.heir != "" else null
	warn = ("%s を連れていく。このランが終わると（勝っても負けても）成仏し、二度と選べない。" % gsel.display_name) if gsel else "単独で出撃する。保管庫の亡霊は1体も減らない。"
	if hsel:
		warn += "\n形見「%s」を身につける（このランで使い切る）。" % hsel.name
	box.add_child(_label(warn, 16, C_CANDLE))
	var act := _row(box)
	act.add_child(_button("出撃する", func() -> void:
		var s := int(seed_edit.text) if seed_edit.text.is_valid_int() else randi() % 1000000
		hub.seed = randi() % 1000000
		var go := func() -> void: sortie_requested.emit(hub.ghost, hub.heir, hub.weapon, hub.mode, s)
		if gsel or hsel:
			show_confirm("%s して出撃する" % ("亡霊を連れて" if gsel else "形見を身につけて"),
				"出撃した時点で使用予約され、ランが終わると消費される。途中でアプリを閉じても複製はされず、次に開いた時に同じランから再開できる。", go, func() -> void: show_hub(on_back))
		else:
			go.call(), true))
	act.add_child(_button("タイトル", on_back))
	box.add_child(_label("ラン履歴", 18))
	var hist := ""
	for r in meta.S().run_history.slice(0, 8):
		hist += "%s　%s　%s　Lv%d　撃破%d%s\n" % [String(r.ended_at).substr(5, 11).replace("T", " "), {"player_death": "死亡", "boss_cleared": "生還", "retired": "リタイア"}[r.result],
			Hud.fmt(r.duration_seconds), int(r.player_level), int(r.kills), ("　同行:" + r.consumed_ghost) if r.consumed_ghost != "" else ""]
	box.add_child(_label(hist if hist != "" else "まだ記録はない", 14, C_DIM))


func _rarity_bars(box: VBoxContainer, level: int) -> void:
	var ws := RunSim.rarity_weights(D, level)
	var tot := 0.0
	for w in ws:
		tot += w
	for i in D.rarities.size():
		var r: Dictionary = D.rarities[i]
		var p: float = ws[i] / tot
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		var l := _label("%s %s" % [r.id, r.name], 15, r.color_c)
		l.custom_minimum_size = Vector2(190, 0)
		l.autowrap_mode = TextServer.AUTOWRAP_OFF
		row.add_child(l)
		var bar := HBoxContainer.new()
		bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		bar.add_theme_constant_override("separation", 0)
		var fill := ColorRect.new()
		fill.color = r.color_c
		fill.custom_minimum_size = Vector2(0, 12)
		fill.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		fill.size_flags_stretch_ratio = maxf(p, 0.001)
		fill.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var rest := ColorRect.new()
		rest.color = C_NIGHT
		rest.custom_minimum_size = Vector2(0, 12)
		rest.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		rest.size_flags_stretch_ratio = maxf(1.0 - p, 0.001)
		rest.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		bar.add_child(fill)
		bar.add_child(rest)
		row.add_child(bar)
		var v := _label("%.1f%%" % (p * 100.0), 15, C_DIM)
		v.custom_minimum_size = Vector2(72, 0)
		v.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		row.add_child(v)
		box.add_child(row)


func _hub_altar(box: VBoxContainer, on_back: Callable) -> void:
	var a := int(meta.S().alloc.altar)
	box.add_child(_label("祭壇", 28))
	box.add_child(_label("供物を捧げるほど、レベルアップで出るカードのレア度が上がる。捧げた供物はいつでも戻せる。", 17, C_DIM))
	box.add_child(_label("祭壇 %d / %d　残りの供物 %d" % [a, int(D.altar.max), meta.offerings_free()], 17, C_CANDLE))
	var row := _row(box)
	var minus := _button("− 戻す", func() -> void:
		meta.alloc_altar(-1)
		show_hub(on_back))
	minus.disabled = a <= 0
	row.add_child(minus)
	var plus := _button("＋ 捧げる（供物1）", func() -> void:
		meta.alloc_altar(1)
		show_hub(on_back))
	plus.disabled = a >= int(D.altar.max) or meta.offerings_free() < 1
	row.add_child(plus)
	box.add_child(_label("いまの排出率", 20))
	_rarity_bars(box, a)


func _hub_library(box: VBoxContainer, on_back: Callable) -> void:
	var L: Dictionary = D.library
	box.add_child(_label("書庫", 28))
	if not meta.library_unlocked():
		box.add_child(_label("累計の生存時間が %s に達すると解放される（いま %s）。" % [Hud.fmt(float(L.unlock_total_survival)), Hud.fmt(float(meta.S().progress.total_survival))], 17, C_DIM))
		return
	box.add_child(_label("「縁」を結んだカードは出やすくなる（1つにつき ×%s、最大%d）。「封印」したカードは新しく取得する候補から外れる（供物%d、最大%d枚）。いつでも戻せる。" % [str(1.0 + float(L.affinity_step)), int(L.affinity_max), int(L.seal_cost), int(L.seal_max)], 17, C_DIM))
	box.add_child(_label("残りの供物 %d　封印 %d / %d" % [meta.offerings_free(), meta.S().alloc.seals.size(), int(L.seal_max)], 17, C_CANDLE))
	var cards: Array = []
	for id in D.weapons:
		cards.append([id, D.weapons[id].name, "武器"])
	for id in D.passives:
		cards.append([id, D.passives[id].name, "パッシブ"])
	for c in cards:
		var id: String = c[0]
		var af := meta.affinity(id)
		var sealed := meta.sealed(id)
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		var nm := _label("%s　%s%s%s" % [c[1], c[2], (" · 出やすさ ×%.2f" % (1.0 + af * float(L.affinity_step))) if af > 0 else "", " · 封印中" if sealed else ""], 17, C_DIM if sealed else C_BONE)
		nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(nm)
		var pips := _label("●".repeat(af) + "○".repeat(int(L.affinity_max) - af), 17, C_SOUL)
		pips.autowrap_mode = TextServer.AUTOWRAP_OFF
		row.add_child(pips)
		var mb := _button("−", func() -> void:
			meta.alloc_affinity(id, -1)
			show_hub(on_back))
		mb.disabled = af <= 0
		row.add_child(mb)
		var pb := _button("＋縁", func() -> void:
			meta.alloc_affinity(id, 1)
			show_hub(on_back))
		pb.disabled = sealed or af >= int(L.affinity_max) or meta.offerings_free() < 1
		row.add_child(pb)
		var sb := _button("封印を解く" if sealed else "封印", func() -> void:
			meta.toggle_seal(id)
			show_hub(on_back))
		sb.disabled = not sealed and (meta.S().alloc.seals.size() >= int(L.seal_max) or meta.offerings_free() < int(L.seal_cost) or af > 0)
		row.add_child(sb)
		box.add_child(row)


func _hub_shelf(box: VBoxContainer) -> void:
	box.add_child(_label("形見の棚", 28))
	if not meta.shelf_unlocked():
		box.add_child(_label("最初のランを終えると解放される。", 17, C_DIM))
		return
	var st := meta.stored_heirs()
	box.add_child(_label("%d / %d　ランを終えるたび（死亡・生還）に、主人公の武器かパッシブを1つ形見として残せる。出撃時に1つだけ身につけられ、そのランで使い切る。棚が満杯の時は一番古い形見が手放される。" % [st.size(), int(D.shelf.capacity)], 17, C_DIM))
	var g := _grid(box)
	for h in st:
		g.add_child(_card([["第%d代より" % int(h.from_generation), 14, C_CANDLE], [h.name, 17, C_BONE], [meta.heir_effect(h), 14, C_DIM]], C_CANDLE, Callable(), 100.0))
	if st.is_empty():
		box.add_child(_label("まだ形見はない。", 16, C_DIM))


# ------------------------------------------------------------------ confirm / level / pause / settings
func show_confirm(title: String, body: String, on_yes: Callable, on_no: Callable) -> void:
	var box := _open("confirm")
	box.add_child(_label(title, 28))
	box.add_child(_label(body, 17, C_DIM))
	var row := _row(box)
	row.add_child(_button("出撃する", on_yes, true))
	row.add_child(_button("戻る", on_no))


func show_level(sim: RunSim, choices: Array, on_pick: Callable) -> void:
	var box := _open("level")
	box.add_child(_label("LEVEL %d" % (sim.level - sim.pending + 1), 14, C_CANDLE))
	box.add_child(_label("強化を1つ選ぶ", 28))
	var g := _grid(box)
	for i in choices.size():
		var c: Dictionary = choices[i]
		var R := sim.rarity(c.rar)
		var d := sim.describe(c)
		var aff := int(sim.card_mods.get("affinity", {}).get(c.get("id", ""), 0))
		var lines := [["%s %s%s" % [R.id, R.name, (" · 縁" + "●".repeat(aff)) if aff > 0 else ""], 14, R.color_c], ["[%d] %s" % [i + 1, d.k], 14, C_DIM],
			[d.n, 21, R.color_c if c.rar != "N" else C_BONE], [d.d, 15, C_DIM]]
		var card := _card(lines, R.color_c, func() -> void: on_pick.call(c), 168.0, c.rar in ["UR", "LR"])
		g.add_child(card)
		_hotkeys.append(card)
	box.add_child(_label(sim.build_text(), 15, C_DIM))
	if g.get_child_count() > 0:
		g.get_child(0).grab_focus()


func show_pause(sim: RunSim, on_resume: Callable, on_settings: Callable, on_retire: Callable) -> void:
	_retire_armed = false
	var box := _open("pause")
	box.add_child(_label("ポーズ中", 28))
	box.add_child(_label(sim.build_text(), 16, C_DIM))
	var row := _row(box)
	var r := _button("再開", on_resume, true)
	row.add_child(r)
	row.add_child(_button("Settings", on_settings))
	var warn := _label("", 16, C_CANDLE)
	row.add_child(_button("リタイア", func() -> void:
		if not _retire_armed:
			_retire_armed = true
			warn.text = "リタイアすると亡霊も形見も生まれない%s。もう一度押すとリタイアする。" % ("。同行中の亡霊は成仏する" if sim.ghost else "")
			return
		on_retire.call(), false, true))
	box.add_child(warn)
	r.grab_focus()


func show_settings(on_back: Callable, on_load_test: Callable, on_wipe: Callable, load_text := "") -> void:
	_wipe_armed = false
	var box := _open("settings")
	box.add_child(_label("Settings", 28))
	box.add_child(_label("音量", 17, C_DIM))
	var vol := HSlider.new()
	vol.min_value = 0
	vol.max_value = 1
	vol.step = 0.05
	vol.value = Settings.volume
	vol.custom_minimum_size = Vector2(0, 32)
	box.add_child(vol)
	var shake := CheckButton.new()
	shake.text = "被弾時の画面揺れ"
	shake.button_pressed = Settings.shake
	box.add_child(shake)
	var dbg := CheckButton.new()
	dbg.text = "デバッグHUD（FPS・敵数・更新時間・seed）"
	dbg.button_pressed = Settings.debug_hud
	box.add_child(dbg)
	var lt := _row(box)
	lt.add_child(_button("負荷試験（敵300体・10秒）", on_load_test))
	lt.add_child(_label(load_text, 16, C_CANDLE))
	var wr := _row(box)
	var wl := _label("", 16, C_BLOOD)
	wr.add_child(_button("セーブを消去", func() -> void:
		if not _wipe_armed:
			_wipe_armed = true
			wl.text = "亡霊・形見・供物・履歴がすべて消える。もう一度押すと消去する。"
			return
		on_wipe.call()
		wl.text = "消去した", false, true))
	wr.add_child(wl)
	box.add_child(_button("戻る", func() -> void:
		Settings.volume = vol.value
		Settings.shake = shake.button_pressed
		Settings.debug_hud = dbg.button_pressed
		Settings.save()
		on_back.call(), true))


# ------------------------------------------------------------------ result / pending
func show_result(sim: RunSim, out: Dictionary, on_hub: Callable) -> void:
	var box := _open("result")
	box.add_child(_label("RUN RESULT", 14, C_CANDLE))
	var title: String = {"player_death": "死亡：亡霊が生まれた", "boss_cleared": "生還：冥王を倒した", "retired": "リタイア"}[sim.result]
	box.add_child(_label(title, 30, C_CANDLE if sim.result == "boss_cleared" else C_BLOOD))
	var stats := _grid(box, 5 if _width() > 900.0 else 2)
	for it in [["生存時間", Hud.fmt(sim.t)], ["到達レベル", str(sim.level)], ["撃破数", str(sim.kills)], ["最大同時敵数", str(sim.max_alive)], ["seed", str(sim.seed_value)]]:
		stats.add_child(_card([[it[1], 24, C_BONE], [it[0], 14, C_DIM]], C_EDGE, Callable(), 72.0))
	box.add_child(_label("使用武器: " + sim.build_text(), 16, C_DIM))
	if not out.is_empty():
		box.add_child(_label("供物 +%d（合計 %d）　第%d代の記録が残った。" % [int(out.offerings), int(meta.S().offerings.earned), int(out.generation)], 17, C_CANDLE))
		if out.used_heirloom != "":
			box.add_child(_label("形見「%s」を使い切った。" % out.used_heirloom, 16, C_DIM))
		if out.consumed_ghost != "":
			box.add_child(_label("同行した %s は成仏した。" % out.consumed_ghost, 16, C_DIM))
	match sim.result:
		"player_death":
			var pg: Variant = meta.S().pending_ghost
			var ng: Variant = pg if pg != null and pg.ghost_id == out.get("new_ghost_id", "") else meta.get_ghost(out.get("new_ghost_id", ""))
			if ng:
				var g := _grid(box)
				g.add_child(ghost_card(ng, false, Callable(), "新しく生まれた亡霊"))
		"boss_cleared":
			box.add_child(_label("生還したため亡霊は生まれない。クリア記録と供物のボーナスが残った。", 16, C_DIM))
		_:
			box.add_child(_label("リタイアしたため亡霊も形見も生まれない。", 16, C_DIM))
	var done := func() -> void: show_result(sim, out, on_hub)
	if meta.S().pending_ghost != null:
		_pending_ghost_ui(box, done)
		return
	if meta.S().pending_heirloom != null:
		_heir_choice_ui(box, done)
	var row := _row(box)
	var b := _button("納骨堂へ", on_hub, true)
	b.disabled = meta.S().pending_heirloom != null
	row.add_child(b)
	if not b.disabled:
		b.grab_focus()


func show_pending(on_done: Callable) -> void:
	var box := _open("result")
	if meta.S().pending_ghost != null:
		box.add_child(_label("保管庫が満杯", 28, C_BLOOD))
		_pending_ghost_ui(box, func() -> void: show_pending(on_done))
	elif meta.S().pending_heirloom != null:
		box.add_child(_label("形見を残す", 28, C_CANDLE))
		_heir_choice_ui(box, func() -> void: show_pending(on_done))
	else:
		on_done.call()


func _pending_ghost_ui(box: VBoxContainer, done: Callable) -> void:
	var ng: Dictionary = meta.S().pending_ghost
	box.add_child(_label("保管庫は%d体まで。新しい亡霊を残すには、どれか1体を成仏させる。成仏させる亡霊を選ぶ。" % int(D.vault_capacity), 17, C_CANDLE))
	var g := _grid(box)
	g.add_child(ghost_card(ng, true, func() -> void:
		meta.resolve_pending_ghost(ng.ghost_id)
		done.call(), "新しい亡霊をそのまま成仏させる"))
	for gh in meta.stored_ghosts():
		var gid: String = gh.ghost_id
		g.add_child(ghost_card(gh, false, func() -> void:
			meta.resolve_pending_ghost(gid)
			done.call(), "この亡霊を成仏させて入れ替え"))


func _heir_choice_ui(box: VBoxContainer, done: Callable) -> void:
	var p: Dictionary = meta.S().pending_heirloom
	box.add_child(_label("第%d代の形見を1つ選ぶ" % int(p.generation), 22))
	var full := meta.stored_heirs().size() >= int(D.shelf.capacity)
	box.add_child(_label("選んだものは形見の棚に置かれ、次からの世代が1回だけ身につけて出撃できる（効果は元の半分ほど、最大Lv%d）。%s" % [int(D.shelf.max_level), "\n棚が満杯なので、一番古い形見が手放される。" if full else ""], 16, C_DIM))
	var g := _grid(box)
	for i in p.options.size():
		var o: Dictionary = p.options[i]
		var idx: int = i
		var card := _card([["武器" if o.type == "weapon" else "パッシブ", 14, C_CANDLE], [meta.heir_label(o), 18, C_BONE], [meta.heir_effect(o), 14, C_DIM]], C_CANDLE, func() -> void:
			meta.resolve_heirloom(idx)
			done.call(), 100.0)
		g.add_child(card)
		if i < 3:
			_hotkeys.append(card)
	g.add_child(_card([["選ばない", 14, C_DIM], ["何も残さない", 18, C_BONE], ["棚は変わらない", 14, C_DIM]], C_EDGE, func() -> void:
		meta.resolve_heirloom(-1)
		done.call(), 100.0))
