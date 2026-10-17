// 色と書体（Canvas と DOM の両方で使う）。日本語は端末に入っている書体を使う（iPhone=ヒラギノ、Windows=游ゴシック/メイリオ）。
export const FONT = `"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, "Noto Sans JP", "Noto Sans CJK JP", sans-serif`;
export const MONO = `ui-monospace, "SF Mono", Menlo, Consolas, monospace`;

export const C = {
  night: "#0b1014",   // 墓地の地面
  moss: "#121a1f",    // パネル
  edge: "#24323a",    // 枠
  bone: "#e8efe9",    // 文字
  dim: "#8fa39c",     // 補助の文字
  soul: "#8ff0e0",    // 亡霊
  candle: "#f0b35a",  // 強調・経験値・注意
  blood: "#e2555a",   // HP・危険
} as const;
