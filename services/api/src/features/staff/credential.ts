/**
 * The secrets this slice handles, and the only place any of them is derived.
 *
 * Two different kinds of secret live here and they are protected differently,
 * which is the whole reason the file is one file.
 *
 * A PASSWORD is chosen from a small space, so it is stored as a key derived
 * with a memory-hard function and never as itself. A SESSION TOKEN is 32 bytes
 * from the system's own generator, so it has no guessing space to protect and a
 * digest is enough: nothing is gained by making the lookup slow, and a slow
 * lookup would be paid on every request instead of on every sign-in.
 *
 * The derivation is `node:crypto`'s. Nothing is added to the dependency list
 * for it: `scrypt` is in the standard library at the parameters below, and a
 * package that computed the same thing would be a supply-chain surface bought
 * for nothing. ADR 0029.
 */

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * OWASP's Password Storage Cheat Sheet gives two minimum scrypt lines: N=2^17,
 * r=8, p=1, or N=2^16, r=8, p=2. This is the first. p is 1 rather than 2
 * because OpenSSL runs the parallelism factor serially, so p>1 buys work
 * without buying concurrency, and the first line costs the same for the same
 * memory.
 *
 * These numbers are written into every record this file produces, and read back
 * from the record rather than from here when one is verified. That is what lets
 * them be raised later without invalidating a row that was minted under the old
 * ones, and it is why a record carries five fields rather than two.
 */
const PARAMETERS = { N: 131072, r: 8, p: 1 } as const

const KEY_LENGTH = 32
const SALT_LENGTH = 16

/**
 * Node's default is 32 MiB and REJECTS the parameters above with
 * `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`. OpenSSL needs 128 * r * (N + p + 2),
 * which is a little over 128 MiB here, so this is that with room rather than a
 * number chosen for its looks.
 */
const MAX_MEMORY = 192 * 1024 * 1024

/** How much of a generated password a person has to type. 15 bytes, base64url. */
const PASSWORD_BYTES = 15

/** The session token. 32 bytes, so the digest below is the only thing worth storing. */
const TOKEN_BYTES = 32

const ALGORITHM = 'scrypt'
const FIELDS = 5

/**
 * `scryptSync` would hold the event loop for the whole derivation -- a third of
 * a second at these parameters -- so every request on the process would wait
 * behind one sign-in. The callback form runs on the thread pool.
 */
function derive(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((settle, fail) => {
    scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: MAX_MEMORY }, (error, key) => {
      if (error !== null) fail(error)
      else settle(key)
    })
  })
}

/**
 * The stored form of a password: the algorithm, its three parameters, the salt
 * and the key, separated by a character none of them can contain.
 *
 * base64url rather than base64, so a record can be pasted into a shell, a URL
 * or a SQL literal without an escape. The password is not in it and cannot be
 * recovered from it.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const { N, r, p } = PARAMETERS
  const key = await derive(password, salt, N, r, p)
  return [ALGORITHM, N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$')
}

/**
 * Whether a password produces the key a record carries, under the parameters
 * that record was made with.
 *
 * `timingSafeEqual` rather than `equals` or `===`. No test can see the
 * difference -- both answers are the same boolean -- so it is stated here and
 * in the record rather than claimed as a condition. It throws on operands of
 * different lengths, so the lengths are compared first; a key length is not a
 * secret, and a record whose key is the wrong size is a corrupt record rather
 * than a near miss.
 *
 * A record this cannot read is `false`, not an exception. The caller's question
 * is whether the password matches, and the answer for a row nobody can read is
 * no.
 */
export async function verifyPassword(record: string, password: string): Promise<boolean> {
  const parts = record.split('$')
  if (parts.length !== FIELDS + 1 || parts[0] !== ALGORITHM) return false

  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false

  const salt = Buffer.from(parts[4] ?? '', 'base64url')
  const stored = Buffer.from(parts[5] ?? '', 'base64url')
  if (salt.length === 0 || stored.length === 0) return false

  let derived: Buffer
  try {
    derived = await derive(password, salt, N, r, p)
  } catch {
    // Parameters the record carries that this machine will not run -- a cost
    // raised beyond `MAX_MEMORY`, say. The row cannot be checked, so it does
    // not match.
    return false
  }

  if (derived.length !== stored.length) return false
  return timingSafeEqual(derived, stored)
}

/**
 * The work an unknown address is answered through.
 *
 * Without it, a sign-in for an address no staff member uses returns before a
 * derivation has been run, and the difference in how long the two refusals take
 * is a way to ask which addresses exist. The record is minted once per process
 * and over a value nobody holds, so the answer is always no.
 *
 * It is minted lazily rather than at import: a third of a second at module load
 * would be paid by every process that imports this file, including the ones
 * that never verify anything.
 */
let nobody: string | undefined

export async function verifyNobody(password: string): Promise<false> {
  nobody ??= await hashPassword(randomBytes(PASSWORD_BYTES).toString('base64url'))
  await verifyPassword(nobody, password)
  return false
}

/** A session token. Never stored, and never put in a path or a query string. */
export function mintToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/** What a session row holds instead of the token. */
export function digestToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

/**
 * A password and the record that verifies it.
 *
 * The password is generated rather than chosen, for the reason a table's code
 * is: a value a person picks is a value somebody else can guess, and there is
 * nothing in the schema or the route that can tell the two apart afterwards.
 */
export async function mintCredential(): Promise<{ password: string; credential: string }> {
  const password = randomBytes(PASSWORD_BYTES).toString('base64url')
  return { password, credential: await hashPassword(password) }
}

// ---------------------------------------------------------------------------
// The mint: the only part of this file that touches the outside world.
// ---------------------------------------------------------------------------

/**
 * Print a credential for the operator to insert, and the password once.
 *
 * The record goes to stdout so the run step can capture it; the password goes
 * to stderr so it appears on the terminal and reaches no pipe, no file and no
 * shell history. It is not stored anywhere and cannot be recovered from the
 * record, so a password nobody wrote down is a staff member who needs a new
 * row. There is no admin surface, and this is the whole of the mint.
 */
async function main(): Promise<void> {
  const { password, credential } = await mintCredential()
  process.stderr.write(`password (give this to the staff member, it is not stored): ${password}\n`)
  process.stdout.write(credential)
}

const entryPoint = process.argv[1]
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) {
  await main()
}
