/**
 * The one way a guest sends an order from their page.
 *
 * The interesting thing here is not the control. It is the submission id, which
 * the API uses to make a resend one order: `POST /tables/:code/orders` answers a
 * repeat with the order the first send produced and writes nothing further. That
 * is a guarantee about a *send*, so this client mints one id per send, keeps it
 * only while that send is unresolved, and retires it the moment an answer
 * arrives.
 *
 * Reusing one id for a whole visit would look identical and lose food. The
 * second round would carry the first id, the API would answer 201 with the first
 * order, and the second round would never be written.
 *
 * The mirror of that rule: while a send is unresolved the choices are frozen. If
 * the first send reached the server and only the answer was lost, minting a new
 * id for edited lines would order everything twice. A pending submission is
 * retried as it was written, or it is nothing -- and a guest who wants neither
 * closes the tab, which takes the stored submission with it.
 *
 * This slice owns both halves of the conversation, so what the table has already
 * sent is rendered here rather than beside the menu: only the half that sends
 * knows when a send landed, and lifting that signal to the menu would tell the
 * menu slice that orders exist.
 */

import { type ReactElement, useState } from 'react'
import { Placed } from './placed.tsx'

/** A menu row, with its price already formatted by the slice that owns money. */
type Item = {
  id: string
  name: string
  price: string
}

/**
 * One line of a pending send. `name` is carried for the page's own use and is
 * stripped before the request: the route's body schema is
 * `additionalProperties: false`, and a line carrying anything else is a 400.
 *
 * It is stored rather than looked up so that a restored send can name what it
 * holds even when the menu it was chosen from no longer offers it.
 */
type Line = {
  menuItemId: string
  quantity: number
  name: string
}

/** One send: the id the API keys on, and the lines that id was minted for. */
type Pending = {
  submissionId: string
  lines: Line[]
}

/**
 * Partitioned by what the guest can do about it rather than by what went wrong,
 * which is what stops the next status anyone meets from needing a state of its
 * own.
 *
 * `unsent` is the only state that holds a pending, and the only frozen one: the
 * send may have landed, so it is retried as written. Every other state leaves
 * the page orderable, `refused` included -- a 4xx wrote nothing, so there is no
 * outstanding send for a new id to duplicate, and a guest whose item came off
 * the menu can drop it and send the rest.
 */
type State =
  | { kind: 'idle' }
  | { kind: 'sent' }
  | { kind: 'unsent'; pending: Pending }
  | { kind: 'refused' }

const OUTCOME: Record<State['kind'], string | null> = {
  idle: null,
  sent: 'Your order is with the kitchen.',
  unsent: 'That did not send. Please try again.',
  // One wording for three statuses. Only 422 has a path from this page -- a code
  // this page reached the menu with resolves, and a submission id kept per table
  // cannot arrive at another one -- so it reads for the case that happens and
  // sends the guest to a person for the rest. It cannot name the item: the
  // route's 422 says an item on the order is not on that menu, not which.
  refused:
    'That order was not sent. The menu may have changed — please check it, or ask a member of staff.',
}

const STORAGE_PREFIX = 'order:'

/**
 * Where a pending send lives, and it is `sessionStorage` keyed by the table's
 * code.
 *
 * It has to outlive a reload, because a guest whose send is in doubt reloads.
 * It must not outlive the visit: a pending submission found by the same phone at
 * the next meal would offer to send food nobody is waiting for. A tab is the
 * closest thing the platform has to one visit. And keying it by the code is what
 * keeps a guest who moves tables from carrying an id to a table it does not
 * belong to, which the API would refuse.
 *
 * What that costs is a dedup this page cannot do: a guest who opens the printed
 * code a second time mints a second id and can produce two orders for one round.
 * That is indistinguishable from a table ordering the same round twice, which is
 * a real thing a restaurant does.
 */
function keyFor(code: string): string {
  return `${STORAGE_PREFIX}${code}`
}

function restore(code: string): State {
  const stored = sessionStorage.getItem(keyFor(code))
  if (stored === null) return { kind: 'idle' }
  return { kind: 'unsent', pending: JSON.parse(stored) as Pending }
}

/**
 * A version 4 UUID from `crypto.getRandomValues`, and never `crypto.randomUUID`.
 *
 * `randomUUID` is exposed only in a secure context. This is software a
 * restaurant hosts itself, and a server on the room's own network over plain
 * HTTP is the likeliest first deployment -- where the menu would load, the guest
 * would choose, and the send would die. `getRandomValues` carries no such gate.
 * There is no fallback to `randomUUID`, because a second path that only the
 * other kind of origin takes is a path nothing runs.
 *
 * A UUID rather than a shorter token because the schema decides the format:
 * `table_order.submission_id` is `uuid`, and the route's body schema admits only
 * the hyphenated hex shape. The version and variant bits are set for the same
 * reason -- a value stored in a `uuid` column that names no version is one in
 * shape only.
 */
function mintSubmissionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function Order({ code, items }: { code: string; items: Item[] }): ReactElement {
  const [chosen, setChosen] = useState<Record<string, number>>({})
  const [state, setState] = useState<State>(() => restore(code))
  // How many sends have landed. Nothing reads the number: it is the key the list
  // below is mounted under, so a send that landed makes the table's orders a new
  // question rather than a stale answer with a row missing.
  const [landed, setLanded] = useState(0)
  // An attribute rather than a state. Every outcome clears it, so a page that is
  // no longer busy has settled whatever it settled into, and there is no fifth
  // state for a condition to be unable to reach.
  const [busy, setBusy] = useState(false)

  const frozen = state.kind === 'unsent'
  const chosenLines: Line[] = items
    .map((item) => ({ menuItemId: item.id, quantity: chosen[item.id] ?? 0, name: item.name }))
    .filter((line) => line.quantity > 0)
  const pendingLines = state.kind === 'unsent' ? state.pending.lines : chosenLines

  async function submit(): Promise<void> {
    const pending: Pending =
      state.kind === 'unsent'
        ? state.pending
        : { submissionId: mintSubmissionId(), lines: chosenLines }

    // Stored before the request rather than after it. A reload while the send is
    // in flight is the case the id exists for, and a page that stored it once the
    // answer came back would have nothing left to find.
    sessionStorage.setItem(keyFor(code), JSON.stringify(pending))
    setBusy(true)

    try {
      const response = await fetch(`/tables/${encodeURIComponent(code)}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          submissionId: pending.submissionId,
          lines: pending.lines.map((line) => ({
            menuItemId: line.menuItemId,
            quantity: line.quantity,
          })),
        }),
      })

      if (response.ok) {
        sessionStorage.removeItem(keyFor(code))
        setChosen({})
        setState({ kind: 'sent' })
        // Here and nowhere else. A refused send and one that did not go both
        // wrote nothing, so there is nothing new for the list to find and asking
        // again would be a request made because a request failed.
        setLanded((sends) => sends + 1)
      } else if (response.status < 500) {
        sessionStorage.removeItem(keyFor(code))
        setState({ kind: 'refused' })
      } else {
        setState({ kind: 'unsent', pending })
      }
    } catch {
      // A rejected fetch, which is what a phone that lost the room's wifi
      // produces. It says nothing about whether the server took the order, which
      // is why the pending stays exactly as it was sent.
      setState({ kind: 'unsent', pending })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span className="name">{item.name}</span>
            <span className="price">{item.price}</span>
            <input
              className="quantity"
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              step={1}
              value={chosen[item.id] ?? 0}
              disabled={frozen}
              aria-label={`How many ${item.name}`}
              onChange={(event) => {
                const quantity = Number.parseInt(event.target.value, 10)
                setChosen((previous) => ({
                  ...previous,
                  [item.id]: Number.isNaN(quantity) ? 0 : Math.min(99, Math.max(0, quantity)),
                }))
              }}
            />
          </li>
        ))}
      </ul>

      <section data-order={state.kind} data-busy={busy ? 'true' : 'false'}>
        {frozen && (
          <p className="pending">
            {pendingLines.map((line) => `${line.quantity} × ${line.name}`).join(', ')}
          </p>
        )}
        {OUTCOME[state.kind] !== null && <p className="outcome">{OUTCOME[state.kind]}</p>}
        <button
          className="send"
          type="button"
          disabled={busy || pendingLines.length === 0}
          onClick={() => {
            void submit()
          }}
        >
          {busy ? 'Sending…' : frozen ? 'Try again' : 'Send to the kitchen'}
        </button>
      </section>

      <Placed key={landed} code={code} />
    </>
  )
}
