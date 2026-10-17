class_name TouchControls
extends Control
## スマホ用の操作レイヤー。画面をドラッグ = 仮想スティック、右下 = 回避、右上 = ポーズ。攻撃は自動。

const JOY_RADIUS := 56.0

var router: InputRouter
var sim_ref: Callable
var joy := {}
var font: Font


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	font = get_theme_default_font()


func reset() -> void:
	joy = {}
	if router:
		router.touch_move = Vector2.ZERO


func buttons() -> Dictionary:
	var pad := 22.0
	var r := clampf(size.y * 0.09, 40.0, 62.0)
	return {"dash": {"pos": Vector2(size.x - pad - r, size.y - pad - r), "r": r}, "pause": {"pos": Vector2(size.x - pad - 26, pad + 26), "r": 26.0}}


func _active() -> bool:
	return visible and router != null and router.gameplay_enabled


func _input(event: InputEvent) -> void:
	if not _active():
		return
	if event is InputEventScreenTouch:
		var p: Vector2 = event.position
		if event.pressed:
			var b := buttons()
			if p.distance_to(b.pause.pos) < b.pause.r + 10.0:
				router.pause_toggled.emit()
			elif p.distance_to(b.dash.pos) < b.dash.r + 10.0:
				router.dash_requested.emit()
			elif joy.is_empty():
				joy = {"index": event.index, "origin": p, "pos": p}
		elif not joy.is_empty() and joy.index == event.index:
			reset()
		get_viewport().set_input_as_handled()
	elif event is InputEventScreenDrag:
		if not joy.is_empty() and joy.index == event.index:
			joy.pos = event.position
			var v: Vector2 = joy.pos - joy.origin
			router.touch_move = (v / JOY_RADIUS).limit_length(1.0) if v.length() > 8.0 else Vector2.ZERO
		get_viewport().set_input_as_handled()


func _process(_d: float) -> void:
	if visible:
		queue_redraw()


func _draw() -> void:
	if not _active():
		return
	var sim: RunSim = sim_ref.call() if sim_ref.is_valid() else null
	if sim == null:
		return
	var b := buttons()
	var cd := sim.hero.dash_cd / float(sim.D.player.dash_cd)
	_circle(b.dash.pos, b.dash.r, "回避", sim.hero.dash_cd <= 0.0, cd)
	_circle(b.pause.pos, b.pause.r, "II", false, 0.0)
	if not joy.is_empty():
		var v: Vector2 = (joy.pos - joy.origin).limit_length(JOY_RADIUS)
		draw_arc(joy.origin, JOY_RADIUS, 0, TAU, 48, Color(0.91, 0.94, 0.91, 0.35), 3.0)
		draw_circle(joy.origin + v, 24.0, Color(0.56, 0.94, 0.88, 0.6))
	elif sim.t < 8.0:
		draw_string(font, Vector2(24, size.y * 0.62), "画面をドラッグで移動（攻撃は自動）", HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Color("#8fa39c"))
	if size.y > size.x:
		draw_string(font, Vector2(0, 150), "横向きにすると遊びやすくなります", HORIZONTAL_ALIGNMENT_CENTER, size.x, 20, Color("#f0b35a"))


func _circle(p: Vector2, r: float, label: String, lit: bool, cd: float) -> void:
	draw_circle(p, r, Color(0.07, 0.1, 0.12, 0.8))
	if cd > 0.0:
		var pts := PackedVector2Array([p])
		for i in 33:
			var a := -PI / 2.0 + TAU * cd * i / 32.0
			pts.append(p + Vector2(cos(a), sin(a)) * r)
		draw_colored_polygon(pts, Color(0, 0, 0, 0.6))
	draw_arc(p, r, 0, TAU, 48, Color("#f0b35a") if lit else Color("#24323a"), 3.0)
	var fs := maxi(14, int(r * 0.4))
	draw_string(font, Vector2(p.x - r, p.y + fs * 0.35), label, HORIZONTAL_ALIGNMENT_CENTER, r * 2.0, fs, Color("#e8efe9"))
