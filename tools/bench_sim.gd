extends SceneTree
## 戦闘ロジックの速度計測（敵300体が主人公に群がる最悪ケース）。
##   godot --headless --path . -s res://tools/bench_sim.gd

func _init() -> void:
	var data := DataLoader.load_file()
	var s := RunSim.new(data, {"run_id": "bench", "seed": 1, "mode": "full", "weapon": "fire"})
	s.hp = 1e9
	s.max_hp = 1e9
	s.t = 300.0
	s.weapons = {"sword": 5, "bow": 5, "fire": 5}
	for i in 300:
		var e := s.spawn_enemy(["chaser", "charger", "shooter"][i % 3])
		e.hp = 1e6
		e.max_hp = 1e6
	s.spawn_acc = -1e9
	var t0 := Time.get_ticks_usec()
	var worst := 0
	for i in 1200:
		var a := Time.get_ticks_usec()
		s.step(RunSim.STEP, Vector2(cos(i * 0.01), sin(i * 0.013)))
		worst = maxi(worst, Time.get_ticks_usec() - a)
		if i % 300 == 299:
			print("tick %d: avg %.2f ms (last 300), enemies %d" % [i + 1, (Time.get_ticks_usec() - t0) / 300000.0, s.enemies.size()])
			t0 = Time.get_ticks_usec()
	print("worst %.2f ms" % (worst / 1000.0))
	var mx := 0
	for k in s.sep_grid.cells: mx = maxi(mx, s.sep_grid.cells[k].size())
	print("cells ", s.sep_grid.cells.size(), " max per cell ", mx)
	s.dispose()
	quit()
