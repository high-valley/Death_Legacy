class_name RngStreams
extends RefCounted
## 用途ごとの乱数列。演出の乱数が増えても、敵の出現とカード候補の順序は同じ seed で再現される。

var spawn := RandomNumberGenerator.new()   # 敵の種類と出現位置
var cards := RandomNumberGenerator.new()   # レベルアップの候補とレア度
var misc := RandomNumberGenerator.new()    # 炎の落下先などのばらつき


func _init(seed_value: int) -> void:
	spawn.seed = ("%d:spawn" % seed_value).hash()
	cards.seed = ("%d:cards" % seed_value).hash()
	misc.seed = ("%d:misc" % seed_value).hash()


## 再開時に、経過時間ぶん乱数列を進めて同じ流れに戻す
func advance(n: int) -> void:
	for i in n:
		spawn.randf()
