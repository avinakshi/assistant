/**
 * Best-effort site detection from OCR text.
 *
 * We use this to route to the right parser. The heuristics are intentionally cheap + greedy —
 * if we misroute, the `unknown` parser still extracts title + description + examples as a
 * fallback, so the LLM still gets something useful.
 */
export function detectSite(text: string): 'leetcode' | 'hackerrank' | 'unknown' {
  const lower = text.toLowerCase();

  // LeetCode fingerprints: "leetcode.com" watermark, numeric "N. Title" format, the
  // Easy/Medium/Hard pill, "Constraints:" header, "Example 1:" header.
  const leetcodeHits = [
    /leetcode\.com/.test(lower),
    /^\s*\d+\.\s+[A-Z]/m.test(text),
    /\b(easy|medium|hard)\b\s*(accepted|submissions|runtime)/i.test(text),
    /^\s*constraints\s*:/im.test(text),
    /^\s*example\s+\d+\s*:/im.test(text),
  ].filter(Boolean).length;

  // HackerRank fingerprints: hackerrank.com, "Problem", "Input Format", "Output Format",
  // "Sample Input", "Sample Output", "Constraints".
  const hackerrankHits = [
    /hackerrank\.com/.test(lower),
    /^\s*(input|output)\s+format\s*$/im.test(text),
    /^\s*sample\s+(input|output)/im.test(text),
    /^\s*constraints\s*$/im.test(text),
  ].filter(Boolean).length;

  if (leetcodeHits >= 2 && leetcodeHits > hackerrankHits) return 'leetcode';
  if (hackerrankHits >= 2 && hackerrankHits > leetcodeHits) return 'hackerrank';
  return 'unknown';
}
