// 色と書体（Canvas と DOM の両方で使う）。日本語は端末に入っている書体を使う（iPhone=ヒラギノ、Windows=游ゴシック/メイリオ）。
export const FONT = `"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, "Noto Sans JP", "Noto Sans CJK JP", sans-serif`;
export const SERIF = `"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", "Noto Serif CJK JP", serif`;
export const MONO = `ui-monospace, "SF Mono", Menlo, Consolas, monospace`;

export const C = {
  night: "#0e1217",   // 墓地の地面
  moss: "#1a2029",    // パネル
  edge: "#2e3845",    // 枠
  bone: "#e6e1d6",    // 文字
  dim: "#9aa3a8",     // 補助の文字
  soul: "#86e0d2",    // 亡霊
  candle: "#d9a85b",  // 強調・経験値・注意
  blood: "#d65a5e",   // HP・危険
} as const;
