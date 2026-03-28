/**
 * Utilities for parsing and working with @mention tokens embedded in
 * annotation comments (e.g. "@question", "@todo", "@critical", "@stale").
 */

/**
 * Extracts unique, lowercased @mention tokens from a comment string.
 * A mention is any `@` immediately followed by one or more word characters.
 *
 * @param comment - The raw annotation comment text.
 * @returns Deduplicated array of lowercased mention strings including the `@` prefix.
 */
export function parseMentions(comment: string): string[] {
  const matches = comment.match(/@[a-zA-Z]\w*/g) ?? [];
  return [...new Set(matches.map(m => m.toLowerCase()))];
}

/**
 * Returns true if the annotation comment contains at least one of the
 * provided mention tokens.
 *
 * @param comment   - The annotation comment text.
 * @param mentions  - The set of mention strings to match against (e.g. ["@question"]).
 */
export function commentHasMention(comment: string, mentions: ReadonlySet<string>): boolean {
  if (mentions.size === 0) { return false; }
  return parseMentions(comment).some(m => mentions.has(m));
}

/**
 * Collects all unique @mention tokens that appear across a collection of
 * annotation comments, sorted alphabetically.
 *
 * @param comments - Iterable of comment strings.
 */
export function collectAllMentions(comments: Iterable<string>): string[] {
  const all = new Set<string>();
  for (const c of comments) {
    for (const m of parseMentions(c)) {
      all.add(m);
    }
  }
  return [...all].sort();
}
