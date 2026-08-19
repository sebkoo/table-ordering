/**
 * The commit message policy, as one pure predicate.
 *
 * Two callers share it: the commit-msg hook, through the CLI wrapper in
 * `check-commit-message.ts`, and the history check in `check-conventions.ts`.
 * Keeping one implementation is what stops the two paths from drifting apart.
 *
 * Trailers are deny-by-default. The goal is that no agent ever appears as a
 * contributor, so the rule is an allow list of trailers rather than a list of
 * known agent names: a name list only rejects the agents someone thought of.
 */

export type Violation = {
  /** 1-based line number within the message. */
  line: number
  text: string
  reason: string
}

/** Trailer keys a commit message may carry. Everything else is rejected. */
const ALLOWED_TRAILER_KEYS = new Set(['Signed-off-by'])

/** `Co-Authored-By:`, `Reviewed-by:`, and every other attribution trailer. */
const ATTRIBUTION_TRAILER = /^[A-Za-z-]+-[Bb]y:/
/** `Claude-Session:`, and any other vendor's equivalent. */
const SESSION_TRAILER = /^[A-Za-z-]+-Session:/
/** A `Key: value` line, which is what git treats as trailer-shaped. */
const TRAILER_SHAPE = /^([A-Za-z][A-Za-z0-9-]*):[ \t]/
const GENERATED_PHRASE = /generated\s+(?:with|by)|assisted\s+by|written\s+by/i
const AGENT_URL = /https?:\/\/\S*(?:session|trace|conversation|chat)\S*/i
// Alternation rather than a character class: a variation selector and a
// combining enclosing keycap combine with the character before them, and a
// class that mixes them with base characters does not mean what it looks like.
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F|\u20E3/u

/**
 * @param message the full commit message, comments already removed
 * @param allowedIdentity the email address a `Signed-off-by:` trailer must carry
 */
export function commitMessageViolations(message: string, allowedIdentity: string): Violation[] {
  const lines = message.split('\n')
  const violations: Violation[] = []
  const flagged = new Set<number>()

  const add = (index: number, reason: string): void => {
    flagged.add(index)
    violations.push({ line: index + 1, text: lines[index] ?? '', reason })
  }

  for (const [index, line] of lines.entries()) {
    if (SESSION_TRAILER.test(line)) {
      add(index, 'session trailer')
    } else if (ATTRIBUTION_TRAILER.test(line) && !isAllowedSignOff(line, allowedIdentity)) {
      add(index, 'attribution trailer')
    } else if (AGENT_URL.test(line)) {
      add(index, 'session, trace or conversation URL')
    } else if (GENERATED_PHRASE.test(line)) {
      add(index, 'generated-by line')
    } else if (PICTOGRAPH.test(line)) {
      add(index, 'emoji')
    }
  }

  for (const index of trailerBlockLineIndexes(lines)) {
    if (flagged.has(index)) continue
    const key = TRAILER_SHAPE.exec(lines[index] ?? '')?.[1] ?? ''
    if (ALLOWED_TRAILER_KEYS.has(key)) continue
    add(index, `trailer "${key}" is not on the allow list`)
  }

  return violations.sort((a, b) => a.line - b.line)
}

function isAllowedSignOff(line: string, allowedIdentity: string): boolean {
  if (!line.startsWith('Signed-off-by: ')) return false
  return allowedIdentity.length > 0 && line.includes(`<${allowedIdentity}>`)
}

/**
 * Line indexes of the message's trailer block, or none if it has no trailer
 * block. The final paragraph counts as one only when every line in it is
 * trailer-shaped and it is not the subject line, which keeps a body sentence
 * that happens to contain a colon out of the trailer rules.
 */
function trailerBlockLineIndexes(lines: string[]): number[] {
  let end = lines.length - 1
  while (end >= 0 && (lines[end] ?? '').trim() === '') end--
  if (end < 0) return []

  let start = end
  while (start > 0 && (lines[start - 1] ?? '').trim() !== '') start--
  if (start === 0) return []

  const indexes: number[] = []
  for (let index = start; index <= end; index++) {
    if (!TRAILER_SHAPE.test(lines[index] ?? '')) return []
    indexes.push(index)
  }
  return indexes
}
