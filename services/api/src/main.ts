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
import { orderRoutes } from './features/order/routes.ts'

/**
 * The application role, not the one that owns the tables.
 *
 * PostgreSQL exempts a table's owner from its own policies, and exempts a
 * superuser unconditionally -- `compose.yaml`'s `table_ordering` is both. A
 * connection as that role would write orders with every policy in the schema
 * enforcing nothing, so this process connects as `table_ordering_app`, which
 * `0003-create-table-order.up.sql` creates and grants. The port is the one
 * `compose.yaml` publishes; the password is a development literal from that
 * migration, and a deployment supplies its own through `DATABASE_URL`.
 */
export const DEFAULT_DATABASE_URL =
  'postgres://table_ordering_app:table_ordering_app_dev@127.0.0.1:55432/table_ordering'

export function buildApp(pool: Pool): FastifyInstance {
  const app = Fastify()
  app.register(menuRoutes(pool))
  app.register(orderRoutes(pool))
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
