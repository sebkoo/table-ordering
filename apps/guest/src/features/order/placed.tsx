/**
 * What has already been sent from this table, on the guest's own page.
 *
 * The question this answers is the one a guest asks when they are not sure their
 * round went through, and the answer it must never give is silence. A page that
 * showed nothing when it could not read would tell them their food is not with
 * the kitchen, and send them to order it again -- so every outcome renders, each
 * with its own value on `data-placed`, and an empty table is a fact this states
 * rather than an absence a reader has to infer.
 *
 * One row per order rather than one per line, because a round is what a guest
 * sent and a round is what they are looking for. There is no heading on a round
 * and no time beside it: the response carries no `placed_at`, so a boundary
 * drawn here could not be labelled with anything, and a label nothing supports
 * is a guess about which round is which.
 *
 * The list carries no money. An order records no price, so the only price
 * available is the menu's current one, which is the wrong number for an order
 * placed before it moved -- `money` stays in the menu slice, and nothing here is
 * handed an item to look one up in.
 *
 * A read that fails is one state and not two. `menu.tsx` splits its failures,
 * because without a menu there is no page and the two halves send the guest to
 * different places; here the guest already has a menu and can already order, so
 * the remedy is the same whatever went wrong, and partitioning by remedy is what
 * stops the next status anyone meets from needing a state of its own.
 */

import { type ReactElement, useEffect, useState } from 'react'

/** One line as the route answers it: a name and a quantity, and no price. */
type Line = { name: string; quantity: number }

/** One order. The id is here because a list needs a key, and nothing else reads it. */
type PlacedOrder = { id: string; lines: Line[] }

type State =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ready'; orders: PlacedOrder[] }
  | { kind: 'unavailable' }

/**
 * What a table with nothing at it is told, and it names the window on purpose.
 *
 * The read is bounded, so a party well into a meal gets the same empty list as a
 * table nobody has sat at. "Nothing yet" would be a false statement made to the
 * guest most likely to act on it, and acting on it means ordering a second time.
 *
 * The value in that sentence belongs to the server. `OPEN_WINDOW` lives in
 * `services/api/src/features/order/sql.ts` and this workspace does not depend on
 * that one, so a window that moves there leaves this page saying something
 * untrue with nothing to go red. Exported so that the condition reading it
 * cannot drift from it as well, which leaves one copy here instead of two.
 */
export const NOTHING_IN_WINDOW = 'No order has been sent from this table in the last two hours.'

const SAID: Record<Exclude<State['kind'], 'ready'>, string> = {
  loading: "Reading this table's orders…",
  empty: NOTHING_IN_WINDOW,
  unavailable: "We could not read this table's orders just now.",
}

/**
 * Asked once per mount, and mounted again when a send lands.
 *
 * What makes it ask again is the `key` the order slice gives it, not a prop this
 * reads: a send that landed makes the table's orders a new question rather than
 * the old one with an extra row, and remounting is how React is told that. It
 * also keeps this component's answer to "when do you ask" in one place -- here,
 * once, on mount -- instead of splitting it between a mount and a dependency.
 *
 * It asks on no other occasion. Not on a timer: the code is printed in a public
 * room and cannot be revoked, and a poll would turn one photograph of that
 * placard into a standing subscription to the table, which is what the window on
 * the read exists to refuse. And not after a send that was refused or that did
 * not go, because neither wrote anything for this to find.
 */
export function Placed({ code }: { code: string }): ReactElement {
  const [state, setState] = useState<State>({ kind: 'loading' })
  // A string, so the effect does not re-run on an object that is merely new.
  const endpoint = `/tables/${encodeURIComponent(code)}/orders`

  useEffect(() => {
    let cancelled = false

    const read = async (): Promise<State> => {
      const response = await fetch(endpoint)
      if (!response.ok) return { kind: 'unavailable' }
      const { orders } = (await response.json()) as { orders: PlacedOrder[] }
      return orders.length === 0 ? { kind: 'empty' } : { kind: 'ready', orders }
    }

    read()
      .catch((): State => ({ kind: 'unavailable' }))
      .then((next) => {
        if (!cancelled) setState(next)
      })

    return () => {
      cancelled = true
    }
  }, [endpoint])

  return (
    <section data-placed={state.kind}>
      <h2>Sent from this table</h2>
      {state.kind === 'ready' ? (
        <ul>
          {state.orders.map((order) => (
            // The round's own element inside the row, the way a menu row carries
            // its name and its price separately. What the round says and the row
            // it sits in are different things, and a condition that asserts the
            // first should not be reading whatever else the second grows.
            //
            // An order carrying no line renders as an empty round rather than as
            // no row. "No order" and "an order with nothing on it" are different
            // answers, and the route is careful to keep them apart.
            <li key={order.id}>
              <span className="line">
                {order.lines.map((line) => `${line.quantity} × ${line.name}`).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="none">{SAID[state.kind]}</p>
      )}
    </section>
  )
}
