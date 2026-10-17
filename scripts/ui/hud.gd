class_name Hud
extends Control
## 戦闘HUD（表示専用）。

var sim: RunSim
var view: BattleView
var font: Font
var toast_text := ""
var toast_t := 0.0
var fps := 60.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	font = get_theme_default_font()


func toast(text: String) -> void:
	toast_text = text
	toast_t = 2.2


func _process(delta: float) -> void:
	toast_t -= delta
	fps = lerpf(fps, Engine.get_frames_per_second(), 0.1)
	if visible:
		queue_redraw()


static func fmt(s: float) -> String:
	var n := maxi(0, floori(s))
	return "%02d:%02d" % [n / 60, n % 60]


func _text(p: Vector2, s: String, size: int, col: Color, align := HORIZONTAL_ALIGNMENT_LEFT, width := -1.0) -> void:
	draw_string(font, p, s, align, width, size, col)


func _draw() -> void:
	if sim == null:
		return
	var pad := 22.0
	var fg := Color("#e8efe9")
	var dim := Color("#8fa39c")
	var touch := view != null and view.touch_mode
	var bw := minf(340.0, size.x * 0.34)
	draw_rect(Rect2(pad, pad, bw, 24), Color(0, 0, 0, 0.6))
	draw_rect(Rect2(pad, pad, bw * maxf(0.0, sim.hp / sim.max_hp), 24), Color("#e2555a"))
	_text(Vector2(pad + 10, pad + 18), "HP %d / %d" % [ceili(sim.hp), int(sim.max_hp)], 16, fg)
	draw_rect(Rect2(pad, pad + 30, bw, 8), Color(0, 0, 0, 0.6))
	draw_rect(Rect2(pad, pad + 30, bw * sim.xp / sim.xp_need(), 8), Color("#f0b35a"))
	_text(Vector2(pad, pad + 66), "Lv %d" % sim.level, 22, fg)
	_text(Vector2(pad + 80, pad + 66), "回避 OK" if sim.hero.dash_cd <= 0.0 else "回避 %.1fs" % sim.hero.dash_cd, 18, Color("#f0b35a") if sim.hero.dash_cd <= 0.0 else dim)
	var parts: Array = []
	for id in sim.weapons:
		parts.append("%s%d" % [sim.weapon_name(id), int(sim.weapons[id])])
	for id in sim.passives:
		parts.append("%s%d" % [sim.D.passives[id].name, int(sim.passives[id])])
	_text(Vector2(pad, pad + 92), " ".join(parts), 16, dim)
	# 時間とボス
	_text(Vector2(0, pad + 36), fmt(sim.t) if sim.boss_spawned else fmt(sim.run_len - sim.t), 40, fg, HORIZONTAL_ALIGNMENT_CENTER, size.x)
	_text(Vector2(0, pad + 60), "冥王戦　経過時間" if sim.boss_spawned else "冥王出現まで", 15, dim, HORIZONTAL_ALIGNMENT_CENTER, size.x)
	if sim.boss and not sim.boss.dead:
		var w := minf(520.0, size.x - 200.0)
		draw_rect(Rect2(size.x / 2 - w / 2, pad + 72, w, 12), Color(0, 0, 0, 0.6))
		draw_rect(Rect2(size.x / 2 - w / 2, pad + 72, w * maxf(0.0, sim.boss.hp / sim.boss.max_hp), 12), Color("#e2555a"))
	# 同行亡霊（右上）
	var rx := size.x - pad - (80.0 if touch else 0.0)
	if sim.ghost:
		var rec := sim.ghost.rec
		var tier := view._tier(rec.tier_id) if view else {}
		_text(Vector2(0, pad + 18), rec.display_name, 18, tier.get("color_c", fg), HORIZONTAL_ALIGNMENT_RIGHT, rx)
		_text(Vector2(0, pad + 42), "生前 %s · %s Lv%d · 解放 %d%%" % [fmt(rec.survival_seconds), sim.D.weapons[rec.primary_weapon_id].name, int(rec.weapon_level), roundi(sim.ghost_unlock() * 100)], 15, dim, HORIZONTAL_ALIGNMENT_RIGHT, rx)
	else:
		_text(Vector2(0, pad + 18), "単独出撃（経験値 +%d%%）" % roundi(float(sim.D.solo_xp_bonus) * 100), 15, dim, HORIZONTAL_ALIGNMENT_RIGHT, rx)
	_text(Vector2(0, pad + (64.0 if sim.ghost else 40.0)), "撃破 %d" % sim.kills, 15, dim, HORIZONTAL_ALIGNMENT_RIGHT, rx)
	if toast_t > 0.0:
		var a := minf(1.0, toast_t * 2.0)
		_text(Vector2(0, size.y * 0.24), toast_text, 22, Color(fg, a), HORIZONTAL_ALIGNMENT_CENTER, size.x)
	if Settings.debug_hud:
		var lines := ["FPS %d" % roundi(fps), "敵 %d (最大 %d)" % [sim.enemies.size(), sim.max_alive], "更新 %.2f ms" % sim.update_ms,
			"弾 %d  炎 %d  経験値 %d" % [sim.shots.size() + sim.eshots.size(), sim.zones.size(), sim.gems.size()], "seed %d" % sim.seed_value, "run %s" % sim.run_id.substr(0, 8)]
		for i in lines.size():
			_text(Vector2(pad, pad + 128 + i * 20), lines[i], 15, Color("#8ff0a4"))
