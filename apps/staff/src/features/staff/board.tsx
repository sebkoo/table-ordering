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
 * **Each row carries the control that clears it**, and an act that lands makes
 * the board ask again rather than striking the row out here. The ticket then
 * leaves because the server says it has, which is the same answer to "what is
 * open" that the row arrived as -- a list this file edited would be a second
 * account of the queue, and the two would drift the first time an act half
 * succeeded.
 *
 * The act's own outcome is `data-acted` and not a fifth `data-board` value. They
 * answer different questions: the board was read or it was not, and separately
 * an act landed or it did not. A failed act must leave a readable board
 * readable, because blanking it would tell a kitchen its other tickets were gone
 * on the strength of one button.
 *
 * It asks when a session opens and again when an act from this page lands, and
 * on no other occasion -- the shape `placed.tsx` already has for a send. Not on
 * a timer: a board that polled would be a second decision about how a screen
 * stays current, and the change that makes one current is the change that argues
 * for it.
 */

import { type ReactElement, useCallback, useEffect, useState } from 'react'

/** One line as the route answers it: a name and a quantity, and no price. */
type Line = { name: string; quantity: number }

/**
 * One ticket. The id is here because a list needs a key and the acts need an
 * address; `paid` is here because the row states it and the control that records
 * it belongs on the row only while it is false.
 */
type Ticket = { id: string; table: { label: string }; lines: Line[]; paid: boolean }

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

/**
 * What an act that did not land says.
 *
 * The remedy is trying again, so it says that and nothing about what went wrong:
 * a ticket that is still the kitchen's to cook is the same situation whether the
 * network dropped it or the server did. Exported so the condition that reads it
 * cannot drift from it, which leaves one copy in this workspace instead of two.
 */
export const NOT_ACTED = 'That ticket did not clear. Please try again.'

/**
 * What a payment that was not recorded says.
 *
 * A second sentence rather than one shared with the act above, though the remedy
 * is the same. "That ticket did not clear" is not true of a round nobody was
 * clearing, and a sentence that names the wrong act is worse than a longer file.
 * Exported for the reason the first is.
 */
export const NOT_RECORDED = 'That payment was not recorded. Please try again.'

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
  // Whether the last act landed, and which sentence says so when it did not.
  // `none` covers both "no act has been made" and "the last one landed", which
  // are the same thing to read: there is nothing to say. Only a failure has a
  // sentence, and it carries its own rather than sharing one, because the two
  // acts fail at different things. `data-acted` still renders the kind alone, so
  // what a condition reads there is the same two words it always was.
  const [acted, setActed] = useState<{ kind: 'none' } | { kind: 'failed'; said: string }>({
    kind: 'none',
  })
  // An attribute rather than a state. Every outcome clears it, so a board that is
  // no longer busy has settled into whatever it settled into, and there is no
  // fifth state for a condition to be unable to reach.
  const [busy, setBusy] = useState(false)

  /**
   * Ask what is open, and settle into whatever came back.
   *
   * One function with two callers rather than a counter in the effect's
   * dependencies: the mount asks, and an act that lands asks again. A dependency
   * that the effect never reads is a dependency a reader cannot check, and the
   * lint rule that says so is right -- what makes the board ask again is an
   * event, and an event is a call.
   */
  const read = useCallback(async (): Promise<void> => {
    const settle = async (): Promise<State | { refused: Response }> => {
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

    const next = await settle().catch((): State => ({ kind: 'unavailable' }))
    if ('refused' in next) onRefused(next.refused)
    else setState(next)
  }, [token, onRefused])

  useEffect(() => {
    void read()
  }, [read])

  /**
   * Act on one ticket: clear it, or record that it was paid for.
   *
   * One function and one door, because the two acts differ in their address and
   * their sentence and in nothing else. A `401` is the session ending and leaves
   * by the same door the read's does, because the remedy is the same and the page
   * has one place that knows it. Anything else the server says, and a request
   * that never arrived, are one outcome: the round is still what it was and the
   * remedy is trying again, so there is nothing for a second state to tell
   * anyone.
   *
   * The board is asked again on a successful act and on no other occasion. A
   * refused act and one that did not go both left the board as it was, so asking
   * again would be a request made because a request failed. That holds for a
   * payment too, even though it removes nothing: what the row says about itself
   * comes from the server, exactly as the list does.
   */
  async function act(id: string, what: 'served' | 'paid', said: string): Promise<void> {
    setBusy(true)

    try {
      const response = await fetch(`/staff/orders/${encodeURIComponent(id)}/${what}`, {
        // In a header, never in the path, for the reason the read gives.
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      if (response.status === 401) {
        onRefused(response)
        return
      }
      if (!response.ok) {
        setActed({ kind: 'failed', said })
        return
      }

      setActed({ kind: 'none' })
      await read()
    } catch {
      // A rejected fetch, which is what a screen that lost the room's network
      // produces. It says nothing about whether the act was recorded, and the
      // board's next answer is what settles that.
      setActed({ kind: 'failed', said })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-board={state.kind} data-acted={acted.kind} data-busy={busy ? 'true' : 'false'}>
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
            <li key={ticket.id} data-paid={ticket.paid ? 'true' : 'false'}>
              <span className="table">{ticket.table.label}</span>
              <span className="lines">
                {ticket.lines.map((line) => `${line.quantity} × ${line.name}`).join(', ')}
              </span>
              {/*
                Every control is disabled while any act is unresolved, which is
                `order.tsx`'s posture towards a send in flight and is here for a
                weaker reason: one screen, one pair of hands, and an act that has
                not answered yet is one whose ticket nobody should be clearing
                twice. It costs nothing a kitchen would notice, because the act
                is one round trip with no derivation in it.
              */}
              <button
                className="served"
                type="button"
                disabled={busy}
                aria-label={`Clear ${ticket.table.label}`}
                onClick={() => {
                  void act(ticket.id, 'served', NOT_ACTED)
                }}
              >
                Served
              </button>
              {/*
                Only while the round is unpaid. A control that stayed would be one
                whose press the server answers by writing nothing, which is a
                button that lies about having something to do -- and the row
                already says which it is, on `data-paid`.

                Recording a payment does not clear anything, so a row keeps its
                Served control either way. Nothing here is gated on payment: that
                is the whole of "an option rather than a requirement", and it is
                what makes a restaurant that never presses this behave exactly as
                it did before the control existed. ADR 0036.
              */}
              {!ticket.paid && (
                <button
                  className="paid"
                  type="button"
                  disabled={busy}
                  aria-label={`Record ${ticket.table.label} paid`}
                  onClick={() => {
                    void act(ticket.id, 'paid', NOT_RECORDED)
                  }}
                >
                  Paid
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="none">{SAID[state.kind]}</p>
      )}
      {acted.kind === 'failed' && <p className="said">{acted.said}</p>}
    </section>
  )
}
