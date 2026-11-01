// WCAG contrast for brand colours. Only colours written as hex or rgb() can be
// checked; anything else (named colours, gradients) is skipped, not guessed.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseColor(value: string): Rgb | undefined {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex) {
    const digits = hex[1]!;
    const full = digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits;
    return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
  }
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*(?:[,/]\s*(?:1|1\.0+|100%)\s*)?\)$/.exec(text);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number);
    if ([r, g, b].every((n) => n !== undefined && n <= 255)) return { r: r!, g: g!, b: b! };
  }
  return undefined;
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2 contrast ratio, from 1 to 21. Undefined when either colour can't be read. */
export function contrastRatio(foreground: string, background: string): number | undefined {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return undefined;
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
