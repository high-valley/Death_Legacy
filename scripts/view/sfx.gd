class_name Sfx
extends Node
## 仮の効果音。短い波形をコードで生成する（音源ファイル不要）。

const RATE := 22050
const SOUNDS := {
	"hit": [220.0, 90.0, 0.07, "square"], "hurt": [160.0, 60.0, 0.18, "saw"], "level": [440.0, 1320.0, 0.3, "tri"],
	"xp": [1400.0, 1900.0, 0.04, "sine"], "boss": [80.0, 45.0, 0.6, "saw"], "ghost": [300.0, 900.0, 0.4, "sine"], "dash": [300.0, 700.0, 0.08, "sine"],
}

var players := {}


func _ready() -> void:
	for name in SOUNDS:
		var p := AudioStreamPlayer.new()
		p.stream = _make(SOUNDS[name])
		p.max_polyphony = 4
		p.volume_db = -10.0
		add_child(p)
		players[name] = p


func play(name: String) -> void:
	if players.has(name):
		players[name].play()


static func _make(spec: Array) -> AudioStreamWAV:
	var f0: float = spec[0]
	var f1: float = spec[1]
	var dur: float = spec[2]
	var n := int(RATE * dur)
	var bytes := PackedByteArray()
	bytes.resize(n * 2)
	var phase := 0.0
	for i in n:
		var k := float(i) / n
		phase = fmod(phase + f0 * pow(f1 / f0, k) / RATE, 1.0)
		var v := 0.0
		match spec[3]:
			"sine": v = sin(phase * TAU)
			"square": v = 1.0 if phase < 0.5 else -1.0
			"saw": v = phase * 2.0 - 1.0
			_: v = 1.0 - absf(phase * 4.0 - 2.0)
		bytes.encode_s16(i * 2, int(v * exp(-k * 5.0) * 0.5 * 32767.0))
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = RATE
	s.data = bytes
	return s
