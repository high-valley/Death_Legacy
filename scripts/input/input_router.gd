class_name InputRouter
extends Node
## キーボード・マウス・タッチを「プレイヤーの意図」に変換する層。攻撃は自動なので、移動・回避・ポーズだけ。

signal dash_requested
signal pause_toggled
signal debug_toggled
signal hotkey(index: int)          # レベルアップ画面などの 1/2/3
signal touch_mode_changed(on: bool)

const ACTIONS := {
	"move_left": [KEY_A, KEY_LEFT], "move_right": [KEY_D, KEY_RIGHT], "move_up": [KEY_W, KEY_UP], "move_down": [KEY_S, KEY_DOWN],
	"dash": [KEY_SPACE], "pause": [KEY_ESCAPE, KEY_P], "debug_hud": [KEY_F3], "pick_1": [KEY_1], "pick_2": [KEY_2], "pick_3": [KEY_3],
}

var gameplay_enabled := false
var touch_mode := false
var touch_move := Vector2.ZERO


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for action in ACTIONS:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
			for key in ACTIONS[action]:
				var ev := InputEventKey.new()
				ev.physical_keycode = key
				InputMap.action_add_event(action, ev)


func move_vector() -> Vector2:
	if touch_move.length() > 0.0:
		return touch_move
	return Input.get_vector("move_left", "move_right", "move_up", "move_down")


func set_touch_mode(on: bool) -> void:
	if on != touch_mode:
		touch_mode = on
		touch_mode_changed.emit(on)


func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch or event is InputEventScreenDrag:
		set_touch_mode(true)
	elif event is InputEventMouseMotion and event.device != InputEvent.DEVICE_ID_EMULATION and event.relative.length() > 3.0:
		set_touch_mode(false)
	elif event is InputEventKey and event.pressed and not event.echo:
		set_touch_mode(false)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause"):
		pause_toggled.emit()
	elif event.is_action_pressed("debug_hud"):
		debug_toggled.emit()
	elif gameplay_enabled and event.is_action_pressed("dash"):
		dash_requested.emit()
	else:
		for i in 3:
			if event.is_action_pressed("pick_%d" % (i + 1)):
				hotkey.emit(i)
