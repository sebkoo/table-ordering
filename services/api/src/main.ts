/**
 * The API process.
 *
 * `buildApp` is exported because the test drives the same application this
 * process serves; a test that assembled its own would stop telling you
 * anything about what a guest reaches. The entry-point guard at the bottom is
 * what lets the module be imported without binding a port.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { menuRoutes } from './features/menu/routes.ts'

/** The credentials and published port in `compose.yaml`, so a fresh clone needs no environment file. */
export const DEFAULT_DATABASE_URL =
  'postgres://table_ordering:table_ordering_dev@127.0.0.1:55432/table_ordering'

export function buildApp(pool: Pool): FastifyInstance {
  const app = Fastify()
  app.register(menuRoutes(pool))
  return app
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL })
  const address = await buildApp(pool).listen({
    port: Number(process.env.PORT ?? 3000),
    host: '127.0.0.1',
  })
  process.stdout.write(`api listening on ${address}\n`)
}

const entryPoint = process.argv[1]
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) {
  await main()
}
