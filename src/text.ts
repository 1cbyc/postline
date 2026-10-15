// Small text utilities shared by lint and the channel adapters.

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

export function graphemeLength(s: string): number {
  let n = 0;
  for (const _ of segmenter.segment(s)) n++;
  return n;
}

export const HASHTAG_RE = /(^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*)/gu;

export function hashtags(s: string): string[] {
  return [...s.matchAll(HASHTAG_RE)].map((m) => m[2]!);
}

// Explicit URLs, plus bare domains that carry a path (example.com/blog). A bare
// domain without a path is ambiguous ("Node.js") so we leave it alone.
export const LINK_RE =
  /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]|\b(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>()]*[^\s<>().,;:!?'"]/gi;

export interface FoundLink {
  text: string;
  url: string;
  host: string;
  index: number;
}

export function links(s: string): FoundLink[] {
  const out: FoundLink[] = [];
  for (const m of s.matchAll(LINK_RE)) {
    const text = m[0];
    const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    out.push({ text, url, host, index: m.index ?? 0 });
  }
  return out;
}

export function hostAllowed(host: string, allowed: string[]): boolean {
  return allowed.some((d) => {
    const dom = d.toLowerCase().replace(/^\*\./, "");
    return host === dom || host.endsWith(`.${dom}`);
  });
}

const EMOJI_RE = /\p{Extended_Pictographic}/u;

export function hasEmoji(s: string): boolean {
  return EMOJI_RE.test(s);
}

// UTF-8 text decoded as Latin-1/Windows-1252 shows up as these sequences.
// Catching them before a post goes out is cheaper than editing it after.
const MOJIBAKE_RE = /â€[\u0080-ÿŒ-™]?|Ã[\u0080-¿]|Â[ -¿]|�/;

export function findMojibake(s: string): string | undefined {
  return MOJIBAKE_RE.exec(s)?.[0];
}

export function firstLine(s: string): string {
  return s.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? "";
}
