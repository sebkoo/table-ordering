/**
 * CLI wrapper the commit-msg hook runs. A shell hook cannot import a module,
 * so this file is the bridge: it resolves the message file and the configured
 * identity, then hands both to the one predicate that defines the policy.
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

function configuredIdentity(): string {
  try {
    return execFileSync('git', ['config', '--get', 'user.email'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
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

  const violations = commitMessageViolations(stripComments(raw), configuredIdentity())
  if (violations.length === 0) return 0

  process.stderr.write('commit rejected: the message violates the commit message policy\n\n')
  for (const violation of violations) {
    process.stderr.write(`  line ${violation.line}: ${violation.reason}\n`)
    process.stderr.write(`    ${violation.text}\n`)
  }
  process.stderr.write(
    '\nAllowed: a subject line, a body, and a Signed-off-by trailer carrying the\n' +
      'committer identity. Attribution trailers, session URLs, generated-by lines\n' +
      'and emoji are rejected, whoever wrote them.\n',
  )
  return 1
}

const entryPoint = process.argv[1]
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv))
}
