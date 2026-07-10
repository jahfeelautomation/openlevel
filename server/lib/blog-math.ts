/**
 * Honest derived figures for the Blogs module. A post's "5 min read" is COMPUTED
 * here from its real word count — never stored — so it can't drift from the body
 * it describes and can't be padded. The same honesty-by-construction rule the
 * course progress, review average, and invoice total follow. Everything here is
 * pure (text in, numbers out), so it is trivially testable and side-effect free.
 */

/** Average adult reading speed used to turn a word count into minutes. */
const WORDS_PER_MINUTE = 200

/** Count words in a body of text: whitespace-delimited runs, trimmed. Markup is
 *  left as-is (a tag counts as its visible tokens — close enough for a read
 *  estimate). Empty / whitespace-only / null / undefined is an honest 0. */
export function wordCount(text: string | null | undefined): number {
  if (!text) return 0
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/** Whole-minute read time for a body, rounded up, with a floor of 1 minute for
 *  any non-empty post — a one-line post is still "1 min read", never "0 min". An
 *  empty post is an honest 0. Derived from the real word count, never stored. */
export function readingTimeMinutes(text: string | null | undefined): number {
  const words = wordCount(text)
  if (words === 0) return 0
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE))
}
