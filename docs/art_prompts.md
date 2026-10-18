# 絵の生成プロンプト（ChatGPT の画像生成向け）

`docs/art_assets.md` の絵を、オーナーの画面イメージ（2枚目：青い霊光が強い、アニメ調のダークファンタジー）の雰囲気で作るためのプロンプト集。

## 使い方
1. ChatGPT に**画面イメージの画像を添付**して、最初に「この画像の雰囲気・画風に合わせてください」と伝える（文字で説明するより確実）
2. 下の **共通の画風** と、作りたい絵の **個別のプロンプト** をつなげて貼る
3. **1回に1枚**。サイズは各項目の「サイズ」を指定する
4. 同じチャットで続けて作ると画風がそろいやすい。気に入らない時は「もっと暗く」「顔をもっと大きく」など日本語で直してもらってよい
5. できた画像はそのままチャット（Claude）に添付すれば、こちらで切り抜き・縮小・名前付けをして組み込む（サイズがぴったりでなくてよい）

## 共通の画風（毎回の先頭に貼る）
```
Style: high-detail anime-style dark fantasy illustration, painterly digital art.
Glowing cyan-blue spectral light against deep navy shadows, warm accents of candle gold and ember crimson.
Gothic cathedral ruins, dramatic rim lighting, crisp clean linework on faces, rich saturated colors, cinematic composition.
No text, no letters, no logo, no watermark, no UI elements, no border or frame.
```

---

## タイトル背景 → `title`
サイズ: 横長（1536×1024）
```
A lone knight in dark plate armor with a long tattered crimson cape, seen from behind, holding a longsword pointed at the ground,
standing on a broken stone path in a ruined gothic graveyard at night.
Beside him floats a translucent glowing cyan female ghost with very long flowing hair, gazing gently at him — she is a spirit of his past life.
Background: towering gothic cathedral spires, a bright moon in a deep blue sky, drifting petals and sparks, candles on gravestones,
white flowers in the bottom corners.
Composition: the two characters in the right 60% of the frame. Keep the left 40% darker and simpler (a logo and menu will be placed there).
```

## 納骨堂の背景 → `hub`
サイズ: 横長（1536×1024）
```
Interior of an underground ossuary chapel: walls of skull niches, hundreds of lit candles, gothic stone arches,
a stone altar in the distance with a floating cyan soul flame, faint moonlight through stained glass, ghostly wisps drifting.
Calm and quiet mood. No characters. Keep the center low in contrast and detail (UI panels will be placed on top).
```

## リザルト背景（死亡）→ `result_death`
サイズ: 横長（1536×1024）
```
A ruined graveyard battlefield bathed in deep crimson light, a fallen longsword stuck in the ground with a torn red cape draped over it,
a faint cyan soul rising from it toward the sky, silhouettes of a broken cathedral, embers floating in the air.
Somber but beautiful. Keep the center relatively dark and empty for large text.
```

## リザルト背景（生還）→ `result_clear`
サイズ: 横長（1536×1024）
```
Dawn breaking over a ruined gothic city, golden sunlight piercing through clouds,
a knight's small silhouette on a hill raising a sword, cyan spirit lights fading peacefully into the sky. Hopeful mood.
Keep the center relatively empty for large text.
```

## 戦闘の地面 → `ground`
サイズ: 正方形（1024×1024）
```
Seamless tileable texture. Straight top-down orthographic view (no perspective) of an old cobblestone graveyard path:
dark grey-blue stones with a little moss and a few cracks, a few faint cyan glints between stones.
Very subtle and low contrast, even flat lighting, no cast shadows, no objects, no gravestones, no characters.
```
※ 継ぎ目が目立っても大丈夫です。こちらで継ぎ目なしに加工します。

## ロゴ（任意）→ `logo`
サイズ: 横長（1536×1024）・背景透過
```
Game title logo with the exact text "DEATH LEGACY" on two lines ("DEATH" above, "LEGACY" below, slightly offset to the right).
Ornate gothic serif letters in tarnished silver and antique gold metal, a thin sword running vertically through the letters,
small spiked flourishes, subtle cyan glow behind. Transparent background, nothing else in the image.
```
※ この画像だけは文字が入ってよい（共通の画風の「No text」は外して使う）。文字が崩れたら作り直してもらう。

---

## 亡霊の肖像 → `portrait_<武器>_<番号>`
サイズ: 縦長（1024×1536）。各プロンプトの後ろに、この**肖像の共通部分**もつける。
ChatGPT には日本語で「縦長の画像で、胸から上のアップにしてください。顔を大きく、画面の上のほうに。」と一言添えると、横長の全身絵になりにくい。
```
Vertical portrait orientation. Bust portrait from the chest up, the face clearly visible and placed in the upper third, looking toward the viewer.
Dark simple background with a soft cyan spirit glow behind the character, a few floating light particles.
Same art style and lighting for every portrait in this series.
```
等級（残響〜伝説の英霊）の色の枠と光は画面側で付けるので、人物の色は自由でよい。

### 顔を描き分けるコツ（女性キャラが同じ顔になる時）
- **1人ごとに新しいチャット**で作り、毎回スタイルの見本画像を添付する（同じチャットだと前の顔を引き継ぎやすい）
- 下の「女性キャラの描き分け」から1つ選び、人物プロンプトの後ろにつける。年齢・顔の形・目の形・肌の色・表情・髪型を**具体的に**変えるのが効く
- 「前の人物とは顔立ちをまったく変えて」と日本語で添えるのもよい

**描き分けの指定（例）**
```
Give her a clearly distinct face, not the default anime heroine face:
[タイプの説明をここに入れる]
Modest, practical clothing that fully covers the chest.
```
| タイプ | 入れる説明 |
|---|---|
| 元気な狩人 | late teens, round face, freckles, sun-tanned skin, big bright green eyes, short messy auburn hair in a small ponytail, wide confident grin |
| 気高い年長者 | woman in her mid-30s, long oval face with high cheekbones, deep brown skin, narrow heavy-lidded amber eyes, black hair in many thin braids with gold beads, calm knowing smile |
| 歴戦の老魔女 | elderly woman around 65, wrinkles and laugh lines, sharp pale grey eyes, thin lips, white hair tied in a tight bun, stern but kind expression |
| 無骨な女傭兵 | woman around 30, square jaw, broad shoulders, a scar across the eyebrow, very short undercut dark hair, small fierce eyes, serious frown |
| 物静かな東方の剣士 | woman in her late 20s, slim face, monolid dark eyes, straight black hair in a high ponytail, light olive skin, composed neutral expression |

### 剣（sword）
- `portrait_sword_1`
  ```
  A fierce young swordswoman with long crimson hair and amber eyes, dark ornate armor with gold trim,
  the hilt of a burning longsword resting on her shoulder, embers around her.
  ```
- `portrait_sword_2`
  ```
  A stoic knight in a full steel helmet with a narrow visor, battered dark plate armor, a cold cyan light glowing inside the visor slit,
  gauntlet gripping a longsword held upright in front of the chest.
  ```
- `portrait_sword_3`
  ```
  A young man with short black hair and a scar across the nose, light leather armor over a dark tunic, a short dagger held in reverse grip,
  determined expression.
  ```

### 弓（bow）
- `portrait_bow_1`
  ```
  A calm young woman archer with long silver hair and violet eyes, dark blue hooded cloak with silver embroidery,
  holding a slender longbow, moonlight on her face.
  ```
- `portrait_bow_3`（描き分け版・元気な狩人）
  ```
  A young huntress archer, late teens, round face with freckles, sun-tanned skin, big bright green eyes,
  short messy auburn hair in a small ponytail, wide confident grin, practical brown leather hood and jerkin,
  a shortbow over her shoulder and a quiver of feathered arrows. Modest, practical clothing that fully covers the chest.
  ```
- `portrait_bow_2`
  ```
  A young male archer with messy dark green hair, grey-green leather armor, a quiver of faintly glowing arrows over the shoulder,
  one eye narrowed as if aiming.
  ```

### 炎の魔導書（fire）
- `portrait_fire_1`（描き分け版・気高い年長者）
  ```
  A sorceress in her mid-30s with a long oval face and high cheekbones, deep brown skin, narrow heavy-lidded amber eyes,
  black hair in many thin braids with gold beads, a calm knowing smile, high-collared black and crimson robes with gold embroidery,
  holding an open ancient grimoire; glowing red runes and small flames rise from its pages and light her face.
  Modest clothing that fully covers the chest.
  ```
- `portrait_fire_2`
  ```
  An old male sage with a long white beard and sharp eyes, dark hooded robes with gold trim,
  a heavy leather-bound grimoire with metal clasps held against his chest, faint orange fire rune circles floating behind him.
  ```

### 氷の魔導書（ice）
- `portrait_ice_1`
  ```
  A calm young sorceress with long silver-white hair and pale blue eyes, white and deep blue robes with silver embroidery,
  an open grimoire in her hands with frost spreading from its pages, small ice crystals and snowflakes floating around her.
  ```
- `portrait_ice_3`（描き分け版・歴戦の老魔女）
  ```
  An elderly frost witch around 65, wrinkles and laugh lines, sharp pale grey eyes, thin lips, white hair tied in a tight bun,
  stern but kind expression, heavy deep blue robes with a fur collar, frost spreading from an open grimoire in her gloved hands.
  ```
- `portrait_ice_2`
  ```
  A pale young scholar with short silver hair and round glasses, high-collared dark navy coat with frost on the shoulders,
  a floating grimoire bound in chains with an ice-blue sigil glowing on its cover, cold mist around him.
  ```

### 雷の魔導書（thunder）
- `portrait_thunder_1`（男性）
  ```
  A sharp-featured young man around 25 with an angular face and thin straight eyebrows, light olive skin,
  piercing golden eyes, messy medium-length violet hair falling over one eye, a faint confident smirk,
  high-collared dark purple coat with silver buckles and a short cape,
  an open grimoire in one hand with crackling violet lightning arcing from its pages to his fingertips.
  Masculine face and build, clearly male.
  ```
- `portrait_thunder_3`（描き分け版・無骨な女傭兵）
  ```
  A battle mage woman around 30 with a square jaw, broad shoulders and a scar across her eyebrow, very short dark undercut hair,
  small fierce yellow eyes, serious frown, worn black leather coat with steel pauldrons,
  a battered grimoire chained to her belt with violet lightning crackling from it. Modest, practical clothing.
  ```
- `portrait_thunder_2`
  ```
  A hooded young man with sharp features and glowing yellow eyes under the hood, black and indigo robes,
  a worn grimoire with a lightning-bolt emblem on the cover, thin lightning bolts flickering around him.
  ```

### 槍（spear）
- `portrait_spear_1`
  ```
  A noble lancer with long blond braided hair and a winged silver helm, white and blue tabard over armor,
  holding a tall spear with a torn pennant.
  ```
- `portrait_spear_2`
  ```
  A battle-hardened woman halberdier with short blue-black hair and a scar on her cheek, heavy dark pauldrons,
  the blade of a halberd visible behind her shoulder.
  ```

### 斧（axe）
- `portrait_axe_1`
  ```
  A burly warrior with a braided red beard and shaved head with runic tattoos, fur cloak over dark mail,
  a double-bladed battle axe resting on his shoulder.
  ```
- `portrait_axe_2`
  ```
  A wild young woman berserker with untamed white hair and tribal face markings, fur and leather armor,
  gripping a hand axe, a fierce grin.
  ```

武器ごとに2〜4枚あれば十分。足りない分は同じ雰囲気で「別の人物で」と頼んで増やせる（名前は `_4`, `_5` … と続ける）。

---

## 作る順番のおすすめ
1. 肖像（いちばん目に入る。各武器1枚ずつ → 2枚目以降）
2. タイトル背景
3. 戦闘の地面
4. 納骨堂の背景
5. リザルト背景2枚・ロゴ
