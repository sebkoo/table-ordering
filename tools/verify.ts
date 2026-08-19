/**
 * One command that runs every repository check.
 *
 * Each step reports its own result rather than folding into a single verdict,
 * so a run that skipped a check is distinguishable from a run that passed it.
 * The convention checks print their own per-rule lines; this file streams them
 * through untouched instead of summarising them a second time.
 *
 * Usage: node tools/verify.ts [--require-history]
 */

import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

type Step = {
  name: string
  command: string
  args: string[]
  /** Show the child's output even when it succeeds. */
  stream: boolean
}

function localBin(name: string): string {
  return join(root, 'node_modules', '.bin', name)
}

function steps(passThrough: readonly string[]): Step[] {
  return [
    {
      name: 'typecheck',
      command: localBin('tsc'),
      args: ['--noEmit', '-p', join(root, 'tsconfig.base.json')],
      stream: false,
    },
    // A second project rather than a wider first one. The guest client needs
    // the DOM library, and adding it to the shared configuration would hand
    // `document` and `window` to the API, where reaching for either is a
    // runtime error that nothing would catch.
    {
      name: 'typecheck-guest',
      command: localBin('tsc'),
      args: ['--noEmit', '-p', join(root, 'apps', 'guest', 'tsconfig.json')],
      stream: false,
    },
    { name: 'lint', command: localBin('biome'), args: ['check', '.'], stream: false },
    { name: 'test', command: localBin('vitest'), args: ['run'], stream: false },
    {
      name: 'conventions',
      command: process.execPath,
      args: [
        '--disable-warning=ExperimentalWarning',
        join(root, 'tools', 'check-conventions.ts'),
        ...passThrough,
      ],
      stream: true,
    },
  ]
}

function seconds(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`
}

function run(): number {
  const passThrough = process.argv.slice(2).filter((arg) => arg === '--require-history')
  const startedAt = Date.now()
  const all = steps(passThrough)
  const width = Math.max(...all.map((step) => step.name.length))
  let failed = false

  for (const step of all) {
    const stepStartedAt = Date.now()

    if (step.stream) {
      process.stdout.write(`${step.name}:\n`)
      const result = spawnSync(step.command, step.args, { cwd: root, stdio: 'inherit' })
      if (result.status !== 0) failed = true
      process.stdout.write('\n')
      continue
    }

    const result = spawnSync(step.command, step.args, { cwd: root, encoding: 'utf8' })
    const dots = '.'.repeat(Math.max(1, width + 2 - step.name.length))
    const verdict = result.status === 0 ? 'PASS' : 'FAIL'
    process.stdout.write(`${step.name} ${dots} ${verdict}  ${seconds(stepStartedAt)}\n`)

    if (result.status !== 0) {
      failed = true
      process.stdout.write(`${indent(`${result.stdout ?? ''}${result.stderr ?? ''}`)}\n`)
    }
  }

  process.stdout.write(`verify: ${failed ? 'FAIL' : 'PASS'}  ${seconds(startedAt)}\n`)
  return failed ? 1 : 0
}

function indent(text: string): string {
  return text
    .trimEnd()
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
}

process.exit(run())
