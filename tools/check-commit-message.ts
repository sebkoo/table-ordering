/**
 * CLI wrapper the commit-msg hook runs. A shell hook cannot import a module,
 * so this file is the bridge: it resolves the message file and the identity the
 * commit will be authored by, then hands both to the one predicate that defines
 * the policy.
 *
 * The commit does not exist yet, so that identity has nowhere to come from but
 * git's own resolution on this machine. That is not the same as asking who is
 * running the check: it is asking who this commit will be authored by, and the
 * answer is the value git is about to stamp into the object the history check
 * will later read.
 *
 * Exit codes: 0 accepted, 1 the message violates the policy, 2 bad usage.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { commitMessageViolations } from './commit-message.ts'

/**
 * Remove the comment lines git adds to the message file. They never reach the
 * stored commit, so checking them would reject the editor template itself.
 */
export function stripComments(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim()
}

/** `Name <email> 1699999999 +0000`, which is what `git var` prints. */
const IDENTITY_EMAIL = /<([^>]*)>/

/**
 * The address this commit will be authored by.
 *
 * `git var GIT_AUTHOR_IDENT` rather than `git config --get user.email`, because
 * the two disagree exactly where it matters. Under `GIT_AUTHOR_EMAIL`, or
 * `--author`, the configured address is not the one the commit will carry, and
 * a hook reading the configuration would accept a sign-off in the name of
 * somebody who is not the author -- which is the one thing the trailer exists
 * to rule out, and which the history check would then catch after the fact.
 *
 * git refuses rather than guessing when it has no identity, and the empty
 * string that produces rejects every sign-off. A commit with no identity cannot
 * be made either way.
 */
function authorIdentity(): string {
  try {
    const ident = execFileSync('git', ['var', 'GIT_AUTHOR_IDENT'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return (IDENTITY_EMAIL.exec(ident)?.[1] ?? '').trim()
  } catch {
    return ''
  }
}

export function main(argv: readonly string[]): number {
  const messagePath = argv[2]
  if (messagePath === undefined) {
    process.stderr.write('usage: check-commit-message <message-file>\n')
    return 2
  }

  let raw: string
  try {
    raw = readFileSync(messagePath, 'utf8')
  } catch (error) {
    process.stderr.write(`cannot read commit message file ${messagePath}: ${String(error)}\n`)
    return 2
  }

  const violations = commitMessageViolations(stripComments(raw), authorIdentity())
  if (violations.length === 0) return 0

  process.stderr.write('commit rejected: the message violates the commit message policy\n\n')
  for (const violation of violations) {
    process.stderr.write(`  line ${violation.line}: ${violation.reason}\n`)
    process.stderr.write(`    ${violation.text}\n`)
  }
  process.stderr.write(
    '\nAllowed: a subject line, a body, and a Signed-off-by trailer carrying the\n' +
      "commit's own author address. The subject is lowercase throughout,\n" +
      'imperative, under 50 characters, and carries no Conventional Commits\n' +
      'prefix; of those four, mood is the one nothing here checks. Attribution\n' +
      'trailers, session URLs, generated-by lines and emoji are rejected,\n' +
      'whoever wrote them.\n',
  )
  return 1
}

const entryPoint = process.argv[1]
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv))
}
