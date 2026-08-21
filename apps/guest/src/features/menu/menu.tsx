/**
 * What a guest sees after opening the code on their table.
 *
 * This half fetches the menu and reports what came back. What a guest does with
 * a menu belongs to the slice that owns doing it: at a table the list is handed
 * to the order slice, because a quantity on a row is ordering and a send that
 * has not resolved has to freeze the rows it was chosen from -- which only one
 * owner can do. A restaurant's menu has no table to order at and keeps its own
 * list. Prices are formatted here either way, because money is this slice's.
 *
 * The response shape is declared here rather than shared with the API. A
 * package holding one type, for one caller, is a guess about a second caller;
 * what keeps the two honest today is the response schema the route serialises
 * through and the browser test that reads the rendered result.
 */

import { type ReactElement, useEffect, useState } from 'react'
import { Order } from '../order/order.tsx'

/**
 * Which menu this is. A table's code is what a printed card carries; a
 * restaurant's slug is the same menu with nobody sitting at it.
 */
export type Source = { kind: 'restaurant'; slug: string } | { kind: 'table'; code: string }

type Item = {
  /** What an order names a line by. A name is not unique within a restaurant. */
  id: string
  name: string
  priceMinor: number
  currency: string
}

type Menu = {
  restaurant: { slug: string; name: string }
  /** Present when a table's code was opened, absent when a restaurant's slug was. */
  table?: { label: string }
  items: Item[]
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; menu: Menu }
  | { kind: 'unknown' }
  | { kind: 'unreachable' }

/** A relative path, so the request goes to the origin that served the page. */
function pathFor(source: Source): string {
  return source.kind === 'table'
    ? `/tables/${encodeURIComponent(source.code)}/menu`
    : `/restaurants/${encodeURIComponent(source.slug)}/menu`
}

/**
 * Prices arrive as an integer count of the currency's minor unit, which is how
 * they are stored and how they cross the wire. The exponent belongs to the
 * currency and is not always two: JPY has no minor unit, and dividing it by a
 * hard-coded hundred would show a guest a hundredth of the price. Ask Intl what
 * the exponent is. The division is for display and nothing downstream reads it.
 */
function money(priceMinor: number, currency: string): string {
  const format = new Intl.NumberFormat(undefined, { style: 'currency', currency })
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2
  return format.format(priceMinor / 10 ** digits)
}

export function Menu({ source }: { source: Source }): ReactElement {
  const [state, setState] = useState<State>({ kind: 'loading' })
  // A string, so the effect does not re-run on an object that is merely new.
  const endpoint = pathFor(source)

  useEffect(() => {
    let cancelled = false

    /**
     * Partitioned by what the guest can do about it, not by what went wrong.
     * The two statuses this API answers with are both final: 400 is an address
     * its pattern rejects and 404 is one it serves nothing at, and a code that
     * was mistyped, truncated or badly printed is not fixed by asking again.
     * Everything else -- a server that is down, a proxy in the way, a body that
     * will not parse -- might be, so it is worth trying again and says so.
     *
     * Splitting on the remedy rather than on the cause is what stops the next
     * status anyone meets from needing a state of its own.
     */
    const resolve = async (): Promise<State> => {
      const response = await fetch(endpoint)
      if (response.ok) return { kind: 'ready', menu: (await response.json()) as Menu }
      return response.status === 400 || response.status === 404
        ? { kind: 'unknown' }
        : { kind: 'unreachable' }
    }

    resolve()
      .catch((): State => ({ kind: 'unreachable' }))
      .then((next) => {
        if (!cancelled) setState(next)
      })

    return () => {
      cancelled = true
    }
  }, [endpoint])

  if (state.kind === 'loading') {
    return (
      <main data-state="loading">
        <p>Fetching the menu…</p>
      </main>
    )
  }

  // Names no restaurant, and cannot: a table's URL carries only the code, so
  // the page does not know which restaurant it failed to find. The wording
  // holds for both statuses that land here.
  if (state.kind === 'unknown') {
    return (
      <main data-state="unknown">
        <p>
          This address is not in use. If you scanned the code on your table, please ask a member of
          staff.
        </p>
      </main>
    )
  }

  if (state.kind === 'unreachable') {
    return (
      <main data-state="unreachable">
        <p>We could not reach the menu just now. Please try again.</p>
      </main>
    )
  }

  const items = state.menu.items.map((item) => ({
    id: item.id,
    name: item.name,
    price: money(item.priceMinor, item.currency),
  }))

  return (
    <main data-state="ready">
      <h1>{state.menu.restaurant.name}</h1>
      {state.menu.table !== undefined && <p className="table">{state.menu.table.label}</p>}
      {source.kind === 'table' ? (
        <Order code={source.code} items={items} />
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <span className="name">{item.name}</span>
              <span className="price">{item.price}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
