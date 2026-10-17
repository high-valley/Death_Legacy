class_name SpatialGrid
extends RefCounted
## 一様グリッドの空間分割。敵100〜300体の近傍探索に使う。毎ティック作り直す。

var cell: float
var cells: Dictionary = {}


func _init(cell_size: float = 64.0) -> void:
	cell = cell_size


func rebuild(items: Array) -> void:
	cells.clear()
	for e in items:
		var k := Vector2i(floori(e.pos.x / cell), floori(e.pos.y / cell))
		var b: Variant = cells.get(k)
		if b == null:
			cells[k] = [e]
		else:
			b.append(e)


func query(p: Vector2, r: float) -> Array:
	var out: Array = []
	for cx in range(floori((p.x - r) / cell), floori((p.x + r) / cell) + 1):
		for cy in range(floori((p.y - r) / cell), floori((p.y + r) / cell) + 1):
			var b: Variant = cells.get(Vector2i(cx, cy))
			if b != null:
				out.append_array(b)
	return out


func nearest(p: Vector2, r: float) -> Object:
	var best: Object = null
	var bd := r * r
	for e in query(p, r):
		if e.dead:
			continue
		var d := p.distance_squared_to(e.pos)
		if d < bd:
			bd = d
			best = e
	return best



## 重なっていれば両方を逆向きに押し離す（大きい敵の押し合い用）
static func push_pair(a: Object, b: Object, strength: float) -> void:
	var off: Vector2 = b.pos - a.pos
	var rr: float = a.r + b.r
	var d2 := off.length_squared()
	if d2 < rr * rr and d2 > 0.0:
		var d := sqrt(d2)
		var push := off / d * (rr - d) * strength
		a.pos -= push
		b.pos += push
