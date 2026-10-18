// 絵の素材（肖像・背景）。art/ に決まった名前で置いたものだけを使い、無ければ図形の仮表示にする。
// 名前の決まりは docs/art_assets.md。ファイルの一覧はビルド時に __ART__ として埋め込まれる。
const FILES: string[] = typeof __ART__ !== "undefined" ? __ART__ : [];

function find(base: string): string | null {
  const f = FILES.find((x) => x.replace(/\.[^.]+$/, "") === base);
  return f ? `art/${f}` : null;
}

/** 文字列から決まった数を作る（同じ亡霊はいつも同じ肖像） */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const imgCache = new Map<string, HTMLImageElement>();

export const Art = {
  /** title / hub / result_death / result_clear / ground / logo など */
  file(key: string): string | null {
    return find(key);
  },

  /** portrait_<武器>_<番号> の中から、亡霊ごとに1枚を決める。武器別が無ければ portrait_<番号> */
  portrait(weapon: string, seed: string): string | null {
    let list = FILES.filter((f) => f.startsWith(`portrait_${weapon}_`));
    if (list.length === 0) list = FILES.filter((f) => /^portrait_\d+\./.test(f));
    return list.length ? `art/${list[hash(seed) % list.length]}` : null;
  },

  /** 主人公の絵（武器ごとに1人。portrait_<武器>_1、無ければその武器の最初の1枚） */
  hero(weapon: string): string | null {
    const list = FILES.filter((f) => f.startsWith(`portrait_${weapon}_`)).sort();
    return list.length ? `art/${list[0]}` : null;
  },

  /** キャンバスに描く用（読み込み終わるまでは null） */
  image(src: string | null): HTMLImageElement | null {
    if (!src) return null;
    let im = imgCache.get(src);
    if (!im) {
      im = new Image();
      im.src = src;
      imgCache.set(src, im);
    }
    return im.complete && im.naturalWidth > 0 ? im : null;
  },
};
