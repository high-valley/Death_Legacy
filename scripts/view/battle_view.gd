class_name BattleView
extends Node2D
## 戦場の描画。RunSim の状態を読むだけ。仮アセットなので図形で描く。

var sim: RunSim
var touch_mode := false
var camera := Camera2D.new()
var fx: Array = []
var shake := 0.0
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	add_child(camera)
	camera.make_current()


func add_fx(e: Dictionary) -> void:
	e["t"] = 0.0
	if fx.size() < 260:
		fx.append(e)


func add_shake(a: float) -> void:
	shake = minf(12.0, shake + a)


func clear() -> void:
	fx.clear()
	shake = 0.0


func world_to_screen(p: Vector2) -> Vector2:
	return get_canvas_transform() * p


func _process(delta: float) -> void:
	var vp := get_viewport_rect().size
	var z := minf(vp.x, vp.y) / 520.0 if touch_mode else minf(vp.x / 1280.0, vp.y / 720.0) * 1.05
	camera.zoom = Vector2(z, z)
	if sim:
		camera.position = sim.hero.pos
		camera.offset = Vector2(_rng.randf() - 0.5, _rng.randf() - 0.5) * shake
	shake *= 0.85
	for f in fx:
		f.t += delta
	fx = fx.filter(func(f: Dictionary) -> bool: return f.t < f.dur)
	queue_redraw()


func _draw() -> void:
	if sim == null:
		return
	var half := get_viewport_rect().size / camera.zoom / 2.0
	var c := camera.position
	_ground(c - half, c + half)
	for z in sim.zones:
		draw_circle(z.pos, z.r, Color(0.56, 0.94, 0.88, 0.13) if z.ghost else Color(0.94, 0.47, 0.24, 0.16))
		draw_arc(z.pos, z.r, 0, TAU, 40, Color(0.56, 0.94, 0.88, 0.4) if z.ghost else Color(0.94, 0.59, 0.31, 0.45), 1.5)
	for f in fx:
		if f.kind == "warn":
			var k: float = f.t / f.dur
			draw_circle(f.pos, f.r * k, Color(0.89, 0.33, 0.35, 0.1 + 0.22 * k))
			draw_arc(f.pos, f.r, 0, TAU, 48, Color(0.89, 0.33, 0.35, 0.75), 2.0)
	for g in sim.gems:
		draw_rect(Rect2(g.pos - Vector2(3, 3), Vector2(6, 6)), Color("#f0b35a"))
	for e in sim.enemies:
		draw_circle(e.pos, e.r, Color.WHITE if e.flash > 0.0 else e.def.color_c)
		if e.kind == "charger" and e.phase == 1:
			draw_line(e.pos, e.pos + e.dir * 120.0, Color("#e2555a"), 1.5)
		if e.kind in ["boss", "elite"]:
			draw_arc(e.pos, e.r * 0.55, 0, TAU, 32, Color("#0b1014"), 3.0)
	if sim.ghost:
		_draw_ghost()
	_draw_hero()
	for s in sim.shots:
		draw_line(s.pos, s.pos - s.vel * 0.02, Color("#8ff0e0") if s.ghost else Color("#f2e3b3"), 2.0)
	for s in sim.eshots:
		draw_circle(s.pos, 4.5, Color("#ff8a8e") if s.cause == "boss" else Color("#b9a6ff"))
	for f in fx:
		var k: float = f.t / f.dur
		match f.kind:
			"arc":
				var col := Color(0.56, 0.94, 0.88, 1.0 - k) if f.ghost else Color(0.91, 0.94, 0.91, 1.0 - k)
				draw_arc(f.pos, f.r * (0.75 + 0.25 * k), f.a - f.arc / 2.0, f.a + f.arc / 2.0, 32, col, 4.0)
			"boom":
				draw_arc(f.pos, f.r, 0, TAU, 48, Color(1, 0.55, 0.47, 1.0 - k), 6.0)
			"poof":
				draw_circle(f.pos, 5.0 + 12.0 * k, Color(f.color, (1.0 - k) * 0.5))


func _ground(a: Vector2, b: Vector2) -> void:
	var g := 96.0
	var col := Color("#131c21")
	var x := floorf(a.x / g) * g
	while x < b.x:
		draw_line(Vector2(x, a.y), Vector2(x, b.y), col, 1.0)
		x += g
	var y := floorf(a.y / g) * g
	while y < b.y:
		draw_line(Vector2(a.x, y), Vector2(b.x, y), col, 1.0)
		y += g
	# 墓標（座標から決まる飾り）
	var step := 288.0
	var gx := floorf(a.x / step) * step
	while gx < b.x:
		var gy := floorf(a.y / step) * step
		while gy < b.y:
			var h := absi(hash(Vector2i(int(gx), int(gy))))
			if h % 3 == 0:
				var o := Vector2(h % 200, (h >> 8) % 200)
				draw_rect(Rect2(Vector2(gx, gy) + o, Vector2(14, 20)), Color("#18242a"))
				draw_rect(Rect2(Vector2(gx, gy) + o + Vector2(-4, 4), Vector2(22, 5)), Color("#18242a"))
			gy += step
		gx += step


func _draw_hero() -> void:
	var h := sim.hero
	var alpha := 0.4 if h.iframe > 0.0 and int(sim.t * 30.0) % 2 == 0 else 1.0
	draw_circle(h.pos, h.r, Color(1, 1, 1, alpha) if h.flash > 0.0 else Color(0.91, 0.94, 0.91, alpha))
	draw_circle(h.pos + h.face * 6.0, 3.5, Color(0.94, 0.7, 0.35, alpha))


func _draw_ghost() -> void:
	var g := sim.ghost
	var tier := _tier(g.rec.tier_id)
	var a := 0.45 + 0.25 * sim.ghost_unlock()
	var p := g.pos
	var pts := PackedVector2Array()
	for i in 13:
		var ang := PI + PI * i / 12.0
		pts.append(p + Vector2(cos(ang) * 11.0, sin(ang) * 11.0 - 4.0))
	pts.append(p + Vector2(11, 10))
	for i in 4:
		pts.append(p + Vector2(11.0 - (i + 0.5) * 5.5, 5.0 if i % 2 == 0 else 10.0))
	pts.append(p + Vector2(-11, 10))
	draw_colored_polygon(pts, Color(0.85, 1.0, 0.97, a))
	pts.append(pts[0])
	draw_polyline(pts, tier.color_c, 2.0)


func _tier(id: String) -> Dictionary:
	for t in sim.D.tiers:
		if t.id == id:
			return t
	return sim.D.tiers[0]
