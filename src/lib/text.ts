/** Normalises text for duplicate detection only (never used to alter stored content). */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[‘’‛`´]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/[^a-z0-9£%' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function promptKey(prompt: string): string {
  return normalizeText(prompt);
}

const STOP = new Set(
  "the a an of to in on at for and or is was were be by with which what who when where how did does do this that from as its it are known called following not true".split(
    " ",
  ),
);

export function keywords(s: string): Set<string> {
  return new Set(
    normalizeText(s)
      .split(" ")
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
