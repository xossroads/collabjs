// Color math for user colors: parsing the formats peers send, WCAG contrast,
// and adapting a user's color to the viewer's editor theme.

interface Hsl {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

type Rgb = [number, number, number]; // 0-1 each

const DARK_TEXT = '#1e1e1e';
const LIGHT_TEXT = '#ffffff';

// Caret/label lightness per editor background. A single 50% lightness can't
// stand out on both: on dark themes blues/violets fell under 3:1, on light
// themes yellow through cyan did. Measured across every hue and every bundled
// theme, 72% (dark) and 28% (light) keep every caret at >= 3:1 and leave a
// label text color with >= 4.5:1.
const CARET_LIGHTNESS_ON_DARK = 72;
const CARET_LIGHTNESS_ON_LIGHT = 28;

// The selection tint stays a mid-tone: a bright tint on a dark theme (or a
// dark one on a light theme) costs the code text under it too much contrast.
const HIGHLIGHT_LIGHTNESS = 50;
const MAX_SATURATION = 70;
const HIGHLIGHT_ALPHA = 0.2;

function rgbToHsl([r, g, b]: Rgb): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

// Accepts the formats that reach us: hsl()/hsla() (what clients generate),
// #hex (allowed from peers), and rgb()/rgba() (what the browser hands back
// from element.style). Returns null for anything else.
function parseRgb(color: string): Rgb | null {
  const c = color.trim();
  let m = /^hsla?\(\s*([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%/.exec(c);
  if (m) return hslToRgb({ h: +m[1], s: +m[2], l: +m[3] });
  m = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(c);
  if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
  m = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex.slice(0, 3)].map((x) => x + x).join('');
    if (hex.length < 6) return null;
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
  }
  return null;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Dark or white text, whichever has more WCAG contrast on `background`.
export function readableTextOn(background: string): string {
  const rgb = parseRgb(background);
  if (!rgb) return LIGHT_TEXT;
  const bg = luminance(rgb);
  const dark = luminance(parseRgb(DARK_TEXT)!);
  return contrast(bg, dark) > contrast(bg, 1) ? DARK_TEXT : LIGHT_TEXT;
}

// A user's colors as this viewer should draw them: same hue and saturation
// (so the person stays recognizable), lightness chosen for the editor theme.
export function themedUserColors(
  color: string,
  editorIsDark: boolean
): { color: string; colorLight: string } {
  const rgb = parseRgb(color);
  const { h, s } = rgb ? rgbToHsl(rgb) : { h: 0, s: 0 };
  const hue = Math.round(h) % 360;
  // Capped at the saturation clients generate (70%): the lightness levels
  // and the per-theme label text color were measured for it, and a fully
  // saturated custom color could fall below 4.5:1 for its label.
  const sat = Math.min(Math.round(s), MAX_SATURATION);
  const l = editorIsDark ? CARET_LIGHTNESS_ON_DARK : CARET_LIGHTNESS_ON_LIGHT;
  return {
    color: `hsl(${hue}, ${sat}%, ${l}%)`,
    colorLight: `hsla(${hue}, ${sat}%, ${HIGHLIGHT_LIGHTNESS}%, ${HIGHLIGHT_ALPHA})`,
  };
}
