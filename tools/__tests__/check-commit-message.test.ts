/**
 * The hook has to reject a bad message through a process exit code, not just
 * through a predicate returning a non-empty array, so these tests drive the
 * CLI the way the commit-msg hook drives it.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { stripComments } from '../check-commit-message.ts'

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'check-commit-message.ts')
const IDENTITY = 'committer@example.test'

let workdir: string

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), 'table-ordering-hook-'))
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: workdir })
  execFileSync('git', ['config', 'user.name', 'A Committer'], { cwd: workdir })
  execFileSync('git', ['config', 'user.email', IDENTITY], { cwd: workdir })
})

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

/** Run the CLI against a message file, from inside the temporary repository. */
function check(message: string): { status: number; stderr: string } {
  const messagePath = join(workdir, 'COMMIT_EDITMSG')
  writeFileSync(messagePath, message, 'utf8')
  const result = spawnSync(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', CLI, messagePath],
    { cwd: workdir, encoding: 'utf8' },
  )
  return { status: result.status ?? -1, stderr: result.stderr }
}

describe('check-commit-message CLI', () => {
  it('exits 0 for a message with a subject and a body', () => {
    expect(check('set up toolchain and ci\n\nNo application code yet.\n').status).toBe(0)
  })

  it('exits 0 for a Signed-off-by trailer carrying the configured identity', () => {
    const message = `subject line\n\nbody\n\nSigned-off-by: A Committer <${IDENTITY}>\n`
    expect(check(message).status).toBe(0)
  })

  it.each([
    ['an attribution trailer', 'subject line\n\nCo-Authored-By: Agent <noreply@example.test>\n'],
    ['a session trailer', 'subject line\n\nSome-Session: 0123456789\n'],
    ['a session URL', 'subject line\n\nsee https://example.test/session/9\n'],
    ['a generated-by line', 'subject line\n\nGenerated with a tool\n'],
    ['an emoji', 'subject line\n\nshipped 🚀\n'],
    ['an unapproved trailer', 'subject line\n\nRefs: PROJ-1\n'],
  ])('exits 1 for %s', (_label, message) => {
    const result = check(message)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('commit rejected')
  })

  it('exits 2 when given no message file', () => {
    const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CLI], {
      cwd: workdir,
      encoding: 'utf8',
    })
    expect(result.status).toBe(2)
  })

  it('exits 2 when the message file does not exist', () => {
    const result = spawnSync(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', CLI, join(workdir, 'absent')],
      { cwd: workdir, encoding: 'utf8' },
    )
    expect(result.status).toBe(2)
  })

  it('ignores the comment lines git puts in the message file', () => {
    const message = [
      'subject line',
      '',
      '# Please enter the commit message for your changes. Lines starting',
      '# with # will be ignored, and an empty message aborts the commit.',
      '# Co-Authored-By: Agent <noreply@example.test>',
      '',
    ].join('\n')
    expect(check(message).status).toBe(0)
  })
})

describe('stripComments', () => {
  it('removes comment lines and surrounding blank space', () => {
    expect(stripComments('subject\n\nbody\n# a comment\n')).toBe('subject\n\nbody')
  })

  it('leaves a hash inside a line alone', () => {
    expect(stripComments('subject\n\nfixes issue #12\n')).toBe('subject\n\nfixes issue #12')
  })
})
