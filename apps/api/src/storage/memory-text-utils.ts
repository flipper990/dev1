/** Tokenise a string into lowercase words longer than 2 characters. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

export function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(tokenize(a));
  const wordsB = new Set(tokenize(b));
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Simple TF-overlap score for keyword-based search. */
export function textMatchScore(queryWords: string[], content: string): number {
  const contentWords = new Set(tokenize(content));
  let matches = 0;
  for (const w of queryWords) {
    if (contentWords.has(w)) matches++;
  }
  return queryWords.length === 0 ? 0 : matches / queryWords.length;
}
