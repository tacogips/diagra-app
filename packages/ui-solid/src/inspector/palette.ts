// The preset colour palette the Inspector and the floating toolbar share.
//
// Eight fills light enough to sit on the #f6f4ee canvas without shouting,
// and eight strokes dark enough to read as a border or a line on it. The
// stylesheet default stays reachable through "none" (a `null` style write).

export interface PaletteEntry {
  readonly name: string;
  readonly value: string;
}

export interface StylePalette {
  readonly fills: readonly PaletteEntry[];
  readonly strokes: readonly PaletteEntry[];
}

export const STYLE_PALETTE: StylePalette = {
  fills: [
    { name: "Paper", value: "#fffdf8" },
    { name: "Rose", value: "#fde2e4" },
    { name: "Butter", value: "#fff1c9" },
    { name: "Sage", value: "#e2f0cb" },
    { name: "Mist", value: "#d6ecef" },
    { name: "Periwinkle", value: "#dfe3f7" },
    { name: "Lilac", value: "#efdff5" },
    { name: "Sand", value: "#ece6da" },
  ],
  strokes: [
    { name: "Ink", value: "#1d2a2e" },
    { name: "Brick", value: "#8c2f26" },
    { name: "Amber", value: "#a4661a" },
    { name: "Moss", value: "#3f6b3a" },
    { name: "Teal", value: "#335c67" },
    { name: "Navy", value: "#2f4f8f" },
    { name: "Plum", value: "#6b3f8c" },
    { name: "Slate", value: "#596366" },
  ],
};
