/**
 * The board: every open order in the restaurant the token resolves to.
 *
 * One row per order, oldest first, in the sequence `GET /staff/orders` returned
 * them. The route's own record decided that sequence -- `o.placed_at, o.id,
 * item.sort_order, item.name` -- so nothing here sorts, and a client-side sort
 * would be this file deciding a queue the query already decided.
 *
 * Each row leads with the table's label, because that is what a member of staff
 * walks to. The table's *code* is not on the answer and is not here: it
 * authorises an order at that table, and a board is read on a screen in a room
 * where deliveries and agency staff pass. ADR 0030.
 *
 * No price, because an order records none and the menu's price today is the
 * wrong number for an order placed before it moved. No time, because the answer
 * carries no `placed_at` -- so a row cannot say how long it has waited, and a
 * label nothing supports is a guess about which ticket is which.
 *
 * Every outcome renders, each with its own value on `data-board`, for the reason
 * the guest's list gives: a board that showed nothing when it could not read
 * would tell a kitchen that nothing is open when what it knows is nothing at
 * all.
 *
 * A `401` is the one answer that does not render here. It is not a board that
 * could not be read, it is the session ending, and the only remedy is signing in
 * again -- so it leaves this component rather than being drawn inside it. Every
 * other failure is `unavailable`, one state and not two, partitioned by remedy
 * exactly as `placed.tsx` partitions its own.
 *
 * It asks once, when a session opens. Not on a timer: a board that polled would
 * be a second decision about how a screen stays current, and the change that
 * makes one current is the change that argues for it.
 */

import { type ReactElement, useEffect, useState } from 'react'

/** One line as the route answers it: a name and a quantity, and no price. */
type Line = { name: string; quantity: number }

/** One ticket. The id is here because a list needs a key, and nothing else reads it. */
type Ticket = { id: string; table: { label: string }; lines: Line[] }

type State =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ready'; tickets: Ticket[] }
  | { kind: 'unavailable' }

/**
 * What a restaurant with nothing open is told.
 *
 * It names the window's existence and states no duration, and that is the whole
 * of the difference from the guest's empty state. The guest's sentence carries
 * `OPEN_WINDOW`'s value because a guest is deciding whether to order the same
 * round twice and needs to know what "nothing" covers; a kitchen is reading a
 * queue. So this workspace restates no value the server owns, which is what
 * keeps it out of a rule that does not read it -- `open-window-restated`
 * inspects README and the guest page, and a duration written here would be
 * invisible to it rather than checked by it.
 *
 * Exported so the condition that reads it cannot drift from it, which leaves one
 * copy in this workspace instead of two.
 */
export const NOTHING_OPEN =
  'No order has been placed in this restaurant inside the window this board reads.'

const SAID: Record<Exclude<State['kind'], 'ready'>, string> = {
  loading: 'Reading the open orders…',
  empty: NOTHING_OPEN,
  unavailable: 'We could not read the open orders just now.',
}

export function Board({
  token,
  onRefused,
}: {
  token: string
  /** Handed the untouched response, so the sentence in it is read in one place. */
  onRefused: (response: Response) => void
}): ReactElement {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    const read = async (): Promise<State | { refused: Response }> => {
      const response = await fetch('/staff/orders', {
        // The token is in a header and never in the path, because a path is
        // written into every proxy log between here and the API. ADR 0029.
        headers: { authorization: `Bearer ${token}` },
      })
      if (response.status === 401) return { refused: response }
      if (!response.ok) return { kind: 'unavailable' }

      const { orders } = (await response.json()) as { orders: Ticket[] }
      return orders.length === 0 ? { kind: 'empty' } : { kind: 'ready', tickets: orders }
    }

    read()
      .catch((): State => ({ kind: 'unavailable' }))
      .then((next) => {
        if (cancelled) return
        if ('refused' in next) onRefused(next.refused)
        else setState(next)
      })

    return () => {
      cancelled = true
    }
  }, [token, onRefused])

  return (
    <section data-board={state.kind}>
      {state.kind === 'ready' ? (
        <ul>
          {state.tickets.map((ticket) => (
            // The table and the round are separate elements inside the row, the
            // way a menu row carries its name and its price separately: what the
            // ticket says and the row it sits in are different things, and a
            // condition asserting the first should not read whatever the second
            // grows.
            //
            // A ticket carrying no line renders as an empty round rather than as
            // no row. "No order" and "an order with nothing on it" are different
            // answers, and the route is careful to keep them apart.
            <li key={ticket.id}>
              <span className="table">{ticket.table.label}</span>
              <span className="lines">
                {ticket.lines.map((line) => `${line.quantity} × ${line.name}`).join(', ')}
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
