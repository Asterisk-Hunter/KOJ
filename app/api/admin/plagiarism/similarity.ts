const SHINGLE_SIZE = 5;
const WINDOW_SIZE = 4;

export type SimilarityDocument = {
  submissionId: number;
  userId: string;
  username: string;
  language: string;
  submittedAt: string;
  code: string;
  truncated: boolean;
};

export type SimilarityMatch = {
  first: Omit<SimilarityDocument, "code" | "truncated" | "userId"> & { truncated: boolean };
  second: Omit<SimilarityDocument, "code" | "truncated" | "userId"> & { truncated: boolean };
  similarity: number;
  sharedFingerprints: number;
};

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "#" || (character === "/" && nextCharacter === "/")) {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index = Math.min(source.length, index + 2);
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      const delimiter = character;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index++] === delimiter) break;
      }
      tokens.push("<literal>");
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const start = index++;
      while (index < source.length && /[\w$]/.test(source[index])) index += 1;
      const identifier = source.slice(start, index);
      tokens.push(/^(?:true|false)$/i.test(identifier) ? "<literal>" : "<id>");
      continue;
    }
    if (/\d/.test(character)) {
      index += 1;
      while (index < source.length && /[\w.]/.test(source[index])) index += 1;
      tokens.push("<number>");
      continue;
    }
    tokens.push(character);
    index += 1;
  }

  return tokens;
}

function hashShingle(tokens: readonly string[], start: number): number {
  let hash = 2166136261;
  for (const token of tokens.slice(start, start + SHINGLE_SIZE)) {
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function winnowedFingerprints(source: string): ReadonlySet<number> {
  const tokens = tokenize(source);
  if (tokens.length < SHINGLE_SIZE) return new Set();

  const hashes = Array.from(
    { length: tokens.length - SHINGLE_SIZE + 1 },
    (_, index) => hashShingle(tokens, index),
  );
  if (hashes.length <= WINDOW_SIZE) return new Set([Math.min(...hashes)]);

  const selected = new Set<number>();
  let lastSelectedIndex = -1;
  for (let start = 0; start <= hashes.length - WINDOW_SIZE; start += 1) {
    let minIndex = start;
    for (let index = start + 1; index < start + WINDOW_SIZE; index += 1) {
      if (hashes[index] <= hashes[minIndex]) minIndex = index;
    }
    if (minIndex !== lastSelectedIndex) {
      selected.add(hashes[minIndex]);
      lastSelectedIndex = minIndex;
    }
  }
  return selected;
}

function publicSubmission(document: SimilarityDocument) {
  return {
    submissionId: document.submissionId,
    username: document.username,
    language: document.language,
    submittedAt: document.submittedAt,
    truncated: document.truncated,
  };
}

export function findSimilarSubmissions(
  documents: readonly SimilarityDocument[],
  options: { minimumSimilarity?: number; minimumSharedFingerprints?: number } = {},
): SimilarityMatch[] {
  const minimumSimilarity = options.minimumSimilarity ?? 0.2;
  const minimumSharedFingerprints = options.minimumSharedFingerprints ?? 3;
  const prepared = documents.map((document) => ({
    document,
    fingerprints: winnowedFingerprints(document.code),
  }));
  const matches: SimilarityMatch[] = [];

  for (let firstIndex = 0; firstIndex < prepared.length; firstIndex += 1) {
    const first = prepared[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < prepared.length; secondIndex += 1) {
      const second = prepared[secondIndex];
      if (first.document.userId === second.document.userId) continue;
      if (first.fingerprints.size === 0 || second.fingerprints.size === 0) continue;

      let sharedFingerprints = 0;
      for (const fingerprint of first.fingerprints) {
        if (second.fingerprints.has(fingerprint)) sharedFingerprints += 1;
      }
      if (sharedFingerprints < minimumSharedFingerprints) continue;

      const unionSize = first.fingerprints.size + second.fingerprints.size - sharedFingerprints;
      const similarity = sharedFingerprints / unionSize;
      if (similarity < minimumSimilarity) continue;

      matches.push({
        first: publicSubmission(first.document),
        second: publicSubmission(second.document),
        similarity: Math.round(similarity * 1000) / 10,
        sharedFingerprints,
      });
    }
  }

  return matches.sort(
    (left, right) => right.similarity - left.similarity || right.sharedFingerprints - left.sharedFingerprints,
  );
}
