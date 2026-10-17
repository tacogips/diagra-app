/**
 * Fonts for rasterizing. Scanning every system font is slow (tens of seconds
 * on some machines), so a short list of common sans and mono faces is loaded;
 * --font-dir adds more. Only when none of them exists does it fall back to a
 * full system scan.
 */
export const FONT_FILES: readonly string[] = [
  "/System/Library/Fonts/Helvetica.ttc",
  "/System/Library/Fonts/HelveticaNeue.ttc",
  "/System/Library/Fonts/SFNS.ttf",
  "/System/Library/Fonts/Menlo.ttc",
  "/System/Library/Fonts/Hiragino Sans GB.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
  "C:\\Windows\\Fonts\\arial.ttf",
  "C:\\Windows\\Fonts\\consola.ttf",
  "C:\\Windows\\Fonts\\YuGothR.ttc",
];
