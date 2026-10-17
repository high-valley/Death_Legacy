class_name RunSim
extends RefCounted
## 1回のランの戦闘ロジック。ノード・描画・入力・セーブに依存しない。
## 固定ステップ(1/60秒)で進めるので、同じ seed＋同じ入力なら同じ結果になる。
## 表示や効果音への通知は events キュー、セーブへの受け渡しは summary() / snapshot()。

const STEP := 1.0 / 60.0


class Foe:
	var kind: String
	var def: Dictionary
	var pos: Vector2
	var vel := Vector2.ZERO
	var r: float
	var hp: float
	var max_hp: float
	var flash := 0.0
	var cd := 0.0
	var phase := 0          # 突進・ボスの行動段階
	var st := 0.0
	var dir := Vector2.ZERO
	var target := Vector2.ZERO
	var dead := false


class Hero:
	var pos := Vector2.ZERO
	var r := 12.0
	var face := Vector2.RIGHT
	var dash_t := 0.0
	var dash_dir := Vector2.RIGHT
	var dash_cd := 0.0
	var iframe := 0.0
	var flash := 0.0
	var cds: Dictionary = {}


class Companion:
	var rec: Dictionary      # 保管データのコピー（元データは触らない）
	var pos := Vector2(-40, 20)
	var cd := 0.0
	var phase := 0.0


var data: DataLoader
var D: Dictionary
var run_id: String
var seed_value: int
var mode: String
var run_len: float
var main_weapon: String
var ghost_id := ""
var heirloom_id := ""
var solo := true
var card_mods: Dictionary = {"altar": 0, "affinity": {}, "seals": []}

var t := 0.0
var hp: float
var max_hp: float
var level := 1
var xp := 0.0
var pending := 0
var weapons: Dictionary = {}
var passives: Dictionary = {}    # 取得回数（Lv）
var ppow: Dictionary = {}        # レア度込みの効果量
var wbonus: Dictionary = {}      # 武器ごとのダメージ加算
var evolved: Dictionary = {}
var kills := 0
var boss_kills := 0
var boss: Foe = null
var boss_spawned := false
var elite_idx := 0
var spawn_acc := 0.0
var result := ""                 # "" / player_death / boss_cleared / retired
var death_cause := ""
var max_alive := 0
var last_checkpoint := 0.0
var update_ms := 0.0

var hero := Hero.new()
var ghost: Companion = null
var enemies: Array = []
var shots: Array = []    # {pos, vel, dmg, pierce, life, ghost, hit}
var eshots: Array = []   # {pos, vel, dmg, life, cause}
var zones: Array = []    # {pos, r, dmg, life, tick, ghost, evo}
var gems: Array = []     # {pos, v, mag}
var events: Array = []
var rng: RngStreams
var grid := SpatialGrid.new(64.0)


## opts: run_id, seed, mode, weapon, ghost(Dictionary|null), heirloom(Dictionary|null), card_mods, checkpoint(Dictionary|null)
func _init(p_data: DataLoader, opts: Dictionary) -> void:
	data = p_data
	D = data.D
	run_id = opts.get("run_id", "")
	seed_value = int(opts.get("seed", 1))
	mode = opts.get("mode", "short")
	run_len = float(D.run_length[mode])
	main_weapon = opts.get("weapon", "sword")
	card_mods = opts.get("card_mods", card_mods)
	rng = RngStreams.new(seed_value)
	hero.r = float(D.player.radius)
	max_hp = float(D.player.hp)
	hp = max_hp
	weapons[main_weapon] = 1
	var g: Variant = opts.get("ghost")
	if g is Dictionary and not g.is_empty():
		ghost = Companion.new()
		ghost.rec = g.duplicate(true)
		ghost_id = g.ghost_id
	solo = ghost == null
	var h: Variant = opts.get("heirloom")
	var cp: Variant = opts.get("checkpoint")
	if h is Dictionary and not h.is_empty():
		heirloom_id = h.heir_id
		if not cp is Dictionary:
			_apply_heirloom(h)
	if cp is Dictionary:
		restore(cp)


func _apply_heirloom(h: Dictionary) -> void:
	var lv := int(h.level)
	if h.type == "weapon":
		weapons[h.id] = maxi(int(weapons.get(h.id, 0)), lv)
	else:
		passives[h.id] = lv
		ppow[h.id] = float(lv)
		if h.id == "vigor":
			max_hp += 20.0 * lv
			hp = max_hp


# ------------------------------------------------------------------ events
func _emit(type: String, payload: Dictionary = {}) -> void:
	payload["type"] = type
	events.append(payload)


func drain_events() -> Array:
	var out := events
	events = []
	return out


# ------------------------------------------------------------------ stats
func progress() -> float:
	return minf(1.0, t / run_len)


func xp_need() -> float:
	return float(D.xp.base) + level * float(D.xp.per_level)


func pw(id: String) -> float:
	return float(ppow.get(id, 0.0))


func might_mul() -> float:
	return 1.0 + 0.12 * pw("might")


func haste_mul() -> float:
	return 1.0 / (1.0 + 0.1 * pw("haste"))


func area_mul() -> float:
	return 1.0 + 0.12 * pw("area")


func ghost_unlock() -> float:
	var u := 0.0
	for pair in D.ghost_unlock:
		if level >= int(pair[0]):
			u = float(pair[1])
	return u


func weapon_name(id: String) -> String:
	return D.evolutions[id].name if evolved.get(id, false) else D.weapons[id].name


# ------------------------------------------------------------------ weapons
## プレイヤーと亡霊が同じ武器コードを使う
func fire_weapon(id: String, lv: int, origin: Vector2, face: Vector2, dmg_mul: float, area: float, is_ghost: bool, evo: bool) -> bool:
	var W: Dictionary = D.weapons[id]
	var tgt: Foe = grid.nearest(origin, 520.0)
	match id:
		"sword":
			var dir := face
			if tgt:
				dir = (tgt.pos - origin).normalized()
			var reach := float(W.range) * area * (1.0 + 0.1 * (lv - 1)) * (1.3 if evo else 1.0)
			var dmg := float(W.damage) * dmg_mul * (1.0 + 0.25 * (lv - 1))
			var arc := TAU + 0.01 if evo else float(W.arc)
			var dirs := [dir] if evo or lv < 3 else [dir, -dir]
			for dv in dirs:
				var a0: float = dv.angle()
				for e in grid.query(origin, reach + 30.0):
					if e.dead or origin.distance_to(e.pos) > reach + e.r:
						continue
					if absf(angle_difference(a0, (e.pos - origin).angle())) < arc / 2.0:
						_hurt(e, dmg)
				_emit("fx", {"kind": "arc", "pos": origin, "a": a0, "r": reach, "arc": minf(arc, TAU), "dur": 0.18, "ghost": is_ghost})
		"bow":
			if tgt == null:
				return false
			var n := 1 + int((lv - 1) / 2) + (3 if evo else 0)
			var dmg := float(W.damage) * dmg_mul * (1.0 + 0.2 * (lv - 1))
			var base := (tgt.pos - origin).angle()
			for i in n:
				var a := base + (i - (n - 1) / 2.0) * 0.16
				shots.append({"pos": origin, "vel": Vector2(cos(a), sin(a)) * float(W.speed), "dmg": dmg, "pierce": 3 if evo else (2 if lv >= 4 else 0), "life": 1.0, "ghost": is_ghost, "hit": {}})
		"fire":
			if tgt == null:
				return false
			var n := 3 if evo else (2 if lv >= 4 else 1)
			for i in n:
				var at: Vector2 = tgt.pos if i == 0 or enemies.is_empty() else enemies[rng.misc.randi() % enemies.size()].pos
				zones.append({"pos": at, "r": float(W.radius) * area * (1.0 + 0.08 * (lv - 1)) * (1.4 if evo else 1.0),
					"dmg": float(W.damage) * dmg_mul * (1.0 + 0.3 * (lv - 1)), "life": float(W.burn) * (1.5 if evo else 1.0), "tick": 0.0, "ghost": is_ghost})
	return true


func _hurt(e: Foe, d: float) -> void:
	if e.dead:
		return
	e.hp -= d
	e.flash = 0.07
	if rng.misc.randf() < 0.08:
		_emit("sfx", {"name": "hit"})


func hurt_player(d: float, cause: String) -> void:
	if result != "" or hero.iframe > 0.0:
		return
	hp -= d
	hero.iframe = float(D.player.hit_iframe)
	hero.flash = 0.15
	death_cause = cause
	_emit("sfx", {"name": "hurt"})
	_emit("shake", {"amount": 4.0})
	if hp <= 0.0:
		hp = 0.0
		end("player_death")


func end(res: String) -> void:
	if result == "":
		result = res


func try_dash(move: Vector2) -> bool:
	if hero.dash_cd > 0.0 or result != "":
		return false
	hero.dash_dir = move.normalized() if move.length() > 0.01 else hero.face
	hero.dash_t = float(D.player.dash_time)
	hero.dash_cd = float(D.player.dash_cd)
	hero.iframe = maxf(hero.iframe, float(D.player.dash_time) + 0.08)
	_emit("sfx", {"name": "dash"})
	return true


# ------------------------------------------------------------------ spawning
func spawn_enemy(kind: String, dist: float = -1.0) -> Foe:
	var def: Dictionary = D.enemies[kind]
	var a := rng.spawn.randf() * TAU
	var d := dist if dist > 0.0 else 760.0 + rng.spawn.randf() * 80.0
	var e := Foe.new()
	e.kind = kind
	e.def = def
	e.pos = hero.pos + Vector2(cos(a), sin(a)) * d
	e.r = float(def.radius)
	var scale := 1.0 + float(D.spawn.hp_growth) * progress()
	if kind == "boss":
		scale = float(def.get("short_hp_mult", 1.0)) if mode == "short" else 1.0
	e.max_hp = float(def.hp) * scale
	e.hp = e.max_hp
	e.cd = rng.spawn.randf() * 2.0
	enemies.append(e)
	return e


func spawn_boss() -> void:
	boss = spawn_enemy("boss", 700.0)
	boss_spawned = true
	_emit("toast", {"text": "冥王が現れた。倒せば生還できる"})
	_emit("sfx", {"name": "boss"})


func _spawning(dt: float) -> void:
	var S: Dictionary = D.spawn
	var p := progress()
	if not boss_spawned and t >= run_len:
		spawn_boss()
	if elite_idx < S.elites_at.size() and p >= float(S.elites_at[elite_idx]):
		spawn_enemy("elite")
		elite_idx += 1
		_emit("toast", {"text": "墓守が来る"})
	spawn_acc += dt * (float(S.base_per_sec) + float(S.per_progress) * p) * (float(S.boss_phase_rate) if boss_spawned else 1.0)
	while spawn_acc >= 1.0:
		spawn_acc -= 1.0
		if enemies.size() >= int(S.max_alive):
			continue
		var r := rng.spawn.randf()
		var kind := "chaser"
		if p > float(S.charger_from) and r < float(S.charger_share):
			kind = "charger"
		elif p > float(S.shooter_from) and r > 1.0 - float(S.shooter_share):
			kind = "shooter"
		spawn_enemy(kind)


# ------------------------------------------------------------------ tick
func step(dt: float, move: Vector2) -> void:
	var t0 := Time.get_ticks_usec()
	t += dt
	var mv := move.normalized() if move.length() > 0.01 else Vector2.ZERO
	if mv != Vector2.ZERO:
		hero.face = mv
	var speed := float(D.player.speed) * (1.0 + 0.08 * pw("swift"))
	if hero.dash_t > 0.0:
		hero.dash_t -= dt
		hero.pos += hero.dash_dir * float(D.player.dash_speed) * dt
	else:
		hero.pos += mv * speed * dt
	hero.dash_cd = maxf(0.0, hero.dash_cd - dt)
	hero.iframe = maxf(0.0, hero.iframe - dt)
	hero.flash -= dt
	grid.rebuild(enemies)

	if result == "":
		for id in weapons:
			hero.cds[id] = float(hero.cds.get(id, 0.0)) - dt
			if hero.cds[id] <= 0.0:
				var ok := fire_weapon(id, int(weapons[id]), hero.pos, hero.face, might_mul() * (1.0 + float(wbonus.get(id, 0.0))), area_mul(), false, evolved.get(id, false))
				hero.cds[id] = float(D.weapons[id].cd) * haste_mul() * (1.0 - 0.06 * (int(weapons[id]) - 1)) if ok else 0.2
		if ghost:
			_ghost_update(dt)

	for s in shots:
		s.pos += s.vel * dt
		s.life -= dt
		for e in grid.query(s.pos, 30.0):
			if s.life <= 0.0 or e.dead or s.hit.has(e):
				continue
			if e.pos.distance_to(s.pos) < e.r + 4.0:
				_hurt(e, s.dmg)
				s.hit[e] = true
				s.pierce -= 1
				if s.pierce < 0:
					s.life = 0.0
	shots = shots.filter(func(s: Dictionary) -> bool: return s.life > 0.0)
	for z in zones:
		z.life -= dt
		z.tick -= dt
		if z.tick <= 0.0:
			z.tick = float(D.weapons.fire.tick)
			for e in grid.query(z.pos, z.r + 20.0):
				if e.pos.distance_to(z.pos) < z.r + e.r:
					_hurt(e, z.dmg)
	zones = zones.filter(func(z: Dictionary) -> bool: return z.life > 0.0)

	for e in enemies:
		if e.dead or e.hp > 0.0:
			continue
		e.dead = true
		kills += 1
		if int(e.def.xp) > 0:
			gems.append({"pos": e.pos, "v": float(e.def.xp), "mag": false})
		if e == boss:
			boss_kills += 1
			end("boss_cleared")
		_emit("fx", {"kind": "poof", "pos": e.pos, "dur": 0.3, "color": e.def.color_c})
	enemies = enemies.filter(func(e: Foe) -> bool: return not e.dead)
	if result == "":
		_spawning(dt)

	for e in enemies:
		_enemy_update(e, dt)
	grid.rebuild(enemies)
	for a in enemies:
		for b in grid.query(a.pos, a.r + 24.0):
			if a == b:
				continue
			var off: Vector2 = b.pos - a.pos
			var d := off.length()
			var rr: float = a.r + b.r
			if d < rr and d > 0.0:
				a.pos -= off / d * (rr - d) * 0.25
	for s in eshots:
		s.pos += s.vel * dt
		s.life -= dt
		if s.pos.distance_to(hero.pos) < hero.r + 4.0:
			hurt_player(s.dmg, s.cause)
			s.life = 0.0
	eshots = eshots.filter(func(s: Dictionary) -> bool: return s.life > 0.0)

	var pick := float(D.player.pickup) * (1.0 + 0.25 * pw("magnet"))
	var keep: Array = []
	for g in gems:
		var off: Vector2 = hero.pos - g.pos
		var d := off.length()
		if d < hero.r + 8.0:
			xp += g.v * (1.0 + float(D.solo_xp_bonus) if solo else 1.0)
			_emit("sfx", {"name": "xp"})
			continue
		if d < pick or g.mag:
			g.mag = true
			g.pos += off / d * maxf(240.0, 520.0 - d) * dt
		keep.append(g)
	gems = keep.slice(maxi(0, keep.size() - 600))
	while xp >= xp_need():
		xp -= xp_need()
		level += 1
		pending += 1
	max_alive = maxi(max_alive, enemies.size())
	update_ms = update_ms * 0.9 + (Time.get_ticks_usec() - t0) / 1000.0 * 0.1


func _ghost_update(dt: float) -> void:
	ghost.phase += dt
	var target := hero.pos - hero.face * 46.0 + Vector2(cos(ghost.phase) * 14.0, sin(ghost.phase * 1.3) * 10.0)
	ghost.pos += (target - ghost.pos) * minf(1.0, dt * 5.0)
	ghost.cd -= dt
	if ghost.cd <= 0.0:
		var r := ghost.rec
		var s: Dictionary = r.stat_snapshot
		var wid: String = r.primary_weapon_id
		var lv := int(r.weapon_level)
		var ok := fire_weapon(wid, lv, ghost.pos, Vector2.RIGHT, float(s.attack_mult) * ghost_unlock(), float(s.area), true, bool(r.get("evolved", false)))
		ghost.cd = float(D.weapons[wid].cd) / float(s.attack_speed) * (1.0 - 0.06 * (lv - 1)) if ok else 0.25


func _enemy_update(e: Foe, dt: float) -> void:
	var off := hero.pos - e.pos
	var d := maxf(off.length(), 0.001)
	var u := off / d
	var def := e.def
	var sp := float(def.speed)
	e.flash -= dt
	e.cd -= dt
	match def.ai:
		"chase":
			e.vel = u * sp
		"charge":
			if e.phase == 0:
				e.vel = u * sp
				if d < 260.0 and e.cd <= 0.0:
					e.phase = 1
					e.st = 0.6
					e.dir = u
			elif e.phase == 1:
				e.vel = Vector2.ZERO
				e.st -= dt
				if e.st <= 0.0:
					e.phase = 2
					e.st = 0.5
			else:
				e.vel = e.dir * float(def.dash_speed)
				e.st -= dt
				if e.st <= 0.0:
					e.phase = 0
					e.cd = 2.5
		"shoot":
			var want := 1.0 if d > float(def.range) else (-1.0 if d < float(def.range) - 70.0 else 0.0)
			e.vel = u * sp * want
			if d < float(def.range) + 40.0 and e.cd <= 0.0:
				e.cd = float(def.interval)
				eshots.append({"pos": e.pos, "vel": u * float(def.bullet_speed), "dmg": float(def.damage), "life": 2.2, "cause": "shooter"})
		"boss":
			e.vel = u * sp
			var slam: Dictionary = def.slam
			if e.phase == 0 and e.cd <= 0.0:
				e.phase = 1
				e.st = float(slam.windup)
				e.target = hero.pos
				_emit("fx", {"kind": "warn", "pos": hero.pos, "r": float(slam.radius), "dur": float(slam.windup)})
			elif e.phase == 1:
				e.st -= dt
				if e.st <= 0.0:
					if hero.pos.distance_to(e.target) < float(slam.radius) + hero.r:
						hurt_player(float(slam.damage), "boss")
					_emit("fx", {"kind": "boom", "pos": e.target, "r": float(slam.radius), "dur": 0.35})
					_emit("shake", {"amount": 6.0})
					e.phase = 2
					e.st = 1.2
			elif e.phase == 2:
				e.st -= dt
				if e.st <= 0.0:
					var nova: Dictionary = def.nova
					for k in int(nova.count):
						var a := k / float(nova.count) * TAU + t
						eshots.append({"pos": e.pos, "vel": Vector2(cos(a), sin(a)) * float(nova.speed), "dmg": float(nova.damage), "life": 3.5, "cause": "boss"})
					e.phase = 0
					e.cd = float(def.cycle)
	e.pos += e.vel * dt
	if d < e.r + hero.r:
		hurt_player(float(def.damage), e.kind)


# ------------------------------------------------------------------ cards
func card_pool() -> Array:
	var opts: Array = []
	var subs := 0
	for w in weapons:
		if w != main_weapon:
			subs += 1
	var seals: Array = card_mods.get("seals", [])
	for id in D.weapons:
		var lv := int(weapons.get(id, 0))
		if lv > 0 and (lv < int(D.weapon_max_level) or not evolved.get(id, false)):
			opts.append({"kind": "weapon", "id": id, "lv": lv})
		elif lv == 0 and subs < int(D.sub_weapon_slots) and not id in seals:   # 封印は新規取得だけを止める
			opts.append({"kind": "weapon", "id": id, "lv": 0})
	for id in D.passives:
		var lv := int(passives.get(id, 0))
		if lv > 0 and lv < int(D.passive_max_level):
			opts.append({"kind": "passive", "id": id, "lv": lv})
		elif lv == 0 and passives.size() < int(D.passive_slots) and not id in seals:
			opts.append({"kind": "passive", "id": id, "lv": 0})
	return opts


static func rarity_weights(D_: Dictionary, altar: int) -> Array:
	var out: Array = []
	for r in D_.rarities:
		out.append(maxf(1.0 if r.id == "N" else 0.1, float(r.weight) + float(D_.altar.shift[r.id]) * altar))
	return out


func roll_rarity() -> String:
	var ws := rarity_weights(D, int(card_mods.get("altar", 0)))
	var total := 0.0
	for w in ws:
		total += w
	var r := rng.cards.randf() * total
	for i in ws.size():
		r -= ws[i]
		if r <= 0.0:
			return D.rarities[i].id
	return "N"


## 3択。書庫の「縁」で出やすさ、祭壇の段階でレア度の重みが変わる
func roll_choices() -> Array:
	var opts := card_pool()
	var out: Array = []
	var aff: Dictionary = card_mods.get("affinity", {})
	while out.size() < 3 and not opts.is_empty():
		var ws: Array = opts.map(func(o: Dictionary) -> float: return 1.0 + float(aff.get(o.id, 0)) * float(D.library.affinity_step))
		var total := 0.0
		for w in ws:
			total += w
		var r := rng.cards.randf() * total
		var idx := 0
		for i in ws.size():
			idx = i
			r -= ws[i]
			if r <= 0.0:
				break
		var o: Dictionary = opts[idx].duplicate()
		opts.remove_at(idx)
		var rar := roll_rarity()
		if rar == "LR" and o.kind == "weapon" and (o.lv == 0 or evolved.get(o.id, false)):
			rar = "UR"   # 進化は所持武器だけ
		o["rar"] = rar
		out.append(o)
	if out.is_empty():
		out.append({"kind": "heal", "id": "", "lv": 0, "rar": "N"})
	return out


func rarity(id: String) -> Dictionary:
	for r in D.rarities:
		if r.id == id:
			return r
	return D.rarities[0]


func describe(c: Dictionary) -> Dictionary:
	var R := rarity(c.rar)
	if c.kind == "weapon":
		var W: Dictionary = D.weapons[c.id]
		var lv := int(c.lv)
		var maxlv := int(D.weapon_max_level)
		if R.get("evolve", false) and lv > 0 and not evolved.get(c.id, false):
			var E: Dictionary = D.evolutions[c.id]
			return {"k": "武器進化 Lv%d → %d" % [lv, mini(maxlv, lv + 1)], "n": "%s → %s" % [W.name, E.name], "d": E.desc}
		if lv >= maxlv:
			return {"k": "武器 最大Lv", "n": W.name, "d": "%sのダメージ +%d%%" % [W.name, roundi(float(D.maxed_weapon_bonus[c.rar]) * 100)]}
		var to := mini(maxlv, lv + int(R.wlv))
		var head := "武器 Lv%d → %d" % [lv, to] if lv > 0 else ("メイン武器" if c.id == main_weapon else "サブ武器を追加（Lv%d）" % to)
		var extra := ("\nさらに%sのダメージ +%d%%" % [W.name, roundi(float(R.wbonus) * 100)]) if float(R.wbonus) > 0.0 else ""
		return {"k": head, "n": W.name, "d": (_weapon_level_text(c.id, to) if lv > 0 else W.desc) + extra}
	if c.kind == "passive":
		var P: Dictionary = D.passives[c.id]
		var head := "パッシブ Lv%d → %d" % [c.lv, int(c.lv) + 1] if int(c.lv) > 0 else "パッシブを追加"
		return {"k": head, "n": P.name, "d": String(P.fmt).replace("{v}", str(roundi(float(P.per) * float(R.pmul))))}
	return {"k": "全強化済み", "n": "回復", "d": "HP +30"}


static func _weapon_level_text(id: String, lv: int) -> String:
	match id:
		"sword":
			return "前後同時に斬る" if lv == 3 else "ダメージ・範囲・速度アップ"
		"bow":
			return "矢が貫通する" if lv == 4 else ("矢が1本増える" if lv % 2 == 1 else "ダメージ・速度アップ")
	return "炎が2か所に落ちる" if lv == 4 else "ダメージ・範囲アップ"


func apply_choice(c: Dictionary) -> void:
	var R := rarity(c.get("rar", "N"))
	var maxlv := int(D.weapon_max_level)
	match c.kind:
		"weapon":
			var lv := int(weapons.get(c.id, 0))
			if R.get("evolve", false) and lv > 0 and not evolved.get(c.id, false):
				evolved[c.id] = true
				weapons[c.id] = mini(maxlv, lv + 1)
			elif lv >= maxlv:
				wbonus[c.id] = float(wbonus.get(c.id, 0.0)) + float(D.maxed_weapon_bonus[c.rar])
			else:
				weapons[c.id] = mini(maxlv, lv + int(R.wlv))
				if float(R.wbonus) > 0.0:
					wbonus[c.id] = float(wbonus.get(c.id, 0.0)) + float(R.wbonus)
		"passive":
			passives[c.id] = int(passives.get(c.id, 0)) + 1
			ppow[c.id] = pw(c.id) + float(R.pmul)
			if c.id == "vigor":
				var add := roundf(20.0 * float(R.pmul))
				max_hp += add
				hp = minf(max_hp, hp + add)
		"heal":
			hp = minf(max_hp, hp + 30.0)
	pending = maxi(0, pending - 1)


func build_text() -> String:
	var w: Array = []
	for id in weapons:
		var b := float(wbonus.get(id, 0.0))
		w.append("%s%s Lv%d%s" % [weapon_name(id), "(メイン)" if id == main_weapon else "", int(weapons[id]), (" +%d%%" % roundi(b * 100)) if b > 0.0 else ""])
	var p: Array = []
	for id in passives:
		p.append("%s Lv%d" % [D.passives[id].name, int(passives[id])])
	return "武器: %s　/　パッシブ(%d/%d): %s" % ["・".join(w), passives.size(), int(D.passive_slots), "・".join(p) if not p.is_empty() else "なし"]


# ------------------------------------------------------------------ save bridge
## 中断復帰用のスナップショット（10秒ごとにセーブへ）
func snapshot() -> Dictionary:
	return {"t": t, "hp": hp, "max_hp": max_hp, "level": level, "xp": xp, "weapons": weapons.duplicate(), "passives": passives.duplicate(),
		"ppow": ppow.duplicate(), "wbonus": wbonus.duplicate(), "evolved": evolved.duplicate(), "kills": kills, "boss_kills": boss_kills,
		"boss_spawned": boss_spawned, "elite_idx": elite_idx, "spawn_acc": spawn_acc}


func restore(c: Dictionary) -> void:
	t = float(c.t)
	hp = float(c.hp)
	max_hp = float(c.max_hp)
	level = int(c.level)
	xp = float(c.xp)
	weapons = _ints(c.weapons)
	passives = _ints(c.passives)
	ppow = c.ppow.duplicate()
	wbonus = c.wbonus.duplicate()
	evolved = c.evolved.duplicate()
	kills = int(c.kills)
	boss_kills = int(c.boss_kills)
	elite_idx = int(c.elite_idx)
	spawn_acc = float(c.spawn_acc)
	last_checkpoint = t
	rng.advance(int(t * 3.0))   # 乱数列を経過時間ぶん進めて、同じ seed の流れに乗せる
	if bool(c.boss_spawned):
		spawn_boss()
	_emit("toast", {"text": "中断したランを再開した"})


static func _ints(d: Dictionary) -> Dictionary:
	var out := {}
	for k in d:
		out[k] = int(d[k])
	return out


## ラン終了処理（MetaService.settle）に渡す要約
func summary() -> Dictionary:
	return {"run_id": run_id, "seed": seed_value, "mode": mode, "t": t, "run_len": run_len, "main_weapon": main_weapon, "weapons": weapons.duplicate(),
		"passives": passives.duplicate(), "ppow": ppow.duplicate(), "wbonus": wbonus.duplicate(), "evolved": evolved.duplicate(), "level": level,
		"kills": kills, "boss_kills": boss_kills, "death_cause": death_cause, "ghost_id": ghost_id, "heirloom_id": heirloom_id}


func checkpoint_due() -> bool:
	if result == "" and t - last_checkpoint >= float(D.checkpoint_interval):
		last_checkpoint = t
		return true
	return false


func dispose() -> void:
	enemies.clear()
	shots.clear()
	eshots.clear()
	zones.clear()
	gems.clear()
	events.clear()
	boss = null
	ghost = null
	grid.cells.clear()
