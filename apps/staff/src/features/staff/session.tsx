/**
 * What a member of staff signs in with, and the whole of what this page holds
 * afterwards.
 *
 * **It holds a token and nothing else.** The sign-in answers a token *and* an
 * identity; the identity in that body is discarded and the page asks
 * `GET /staff/sessions/current` who the token names. An identity remembered from
 * the request that minted the session would be a claim about a session this page
 * cannot re-check, and the name over a board has to be an answer about the same
 * thing the board is an answer about. So everything shown about who is signed in
 * comes from the token, and nothing from what was sent to get it.
 *
 * **The token lives in memory.** Not `localStorage`, not `sessionStorage`, not a
 * cookie, not a URL, a query string or an attribute. A reload therefore signs
 * staff out, and closing the tab ends this client's session -- which is also the
 * only close there is, because there is no revocation route. Both of those are
 * decisions rather than omissions and ADR 0031 carries them with the fact that
 * would reopen each.
 *
 * **A refusal is shown in the API's own words.** The route's `401` schema
 * requires an `error` string, so the only sentence that can reach `said` is the
 * server's; an answer this cannot read is `unreachable` instead. Translating a
 * refusal into page copy would put this file in the business of restating a
 * value it does not own.
 *
 * The four states partition by what a person can do next rather than by what
 * went wrong, which is what stops the next status anyone meets from needing a
 * state of its own: sign in again, or try again.
 */

import { type FormEvent, type ReactElement, useCallback, useState } from 'react'
import { Board } from './board.tsx'

/** Who a token names. The slug is not shown; it is what the response carries. */
type Identity = {
  staff: { name: string }
  restaurant: { slug: string; name: string }
}

type State =
  | { kind: 'signed-out' }
  | { kind: 'refused'; said: string }
  | { kind: 'unreachable' }
  | { kind: 'signed-in'; token: string; who: Identity }

/** The one sentence this page writes, for the one state the server did not describe. */
const UNREACHABLE = 'We could not reach the board just now. Please try again.'

/**
 * The state a refused answer puts this page in, carrying what the API said.
 *
 * A `401` this can read is `refused` and a person signs in again. A `401` it
 * cannot -- a proxy's own error page, a body that is not JSON -- is
 * `unreachable`, because the page has not been told anything and "try again" is
 * the honest remedy. Two answers with the same status and different remedies.
 */
async function refused(response: Response): Promise<State> {
  let said: unknown
  try {
    said = ((await response.json()) as { error?: unknown }).error
  } catch {
    return { kind: 'unreachable' }
  }
  return typeof said === 'string' && said !== ''
    ? { kind: 'refused', said }
    : { kind: 'unreachable' }
}

export function Session(): ReactElement {
  const [state, setState] = useState<State>({ kind: 'signed-out' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // An attribute rather than a state. Every outcome clears it, so a page that is
  // no longer busy has settled into whatever it settled into, and there is no
  // fifth state for a condition to be unable to reach.
  const [busy, setBusy] = useState(false)

  // Stable, so the board's effect has one dependency that moves -- the token --
  // and a re-render cannot make it read again.
  const onRefused = useCallback((response: Response) => {
    void refused(response).then(setState)
  }, [])

  async function signIn(): Promise<void> {
    setBusy(true)

    try {
      const opened = await fetch('/staff/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!opened.ok) {
        setState(await refused(opened))
        return
      }

      // The token, and deliberately nothing else out of this body.
      const { token } = (await opened.json()) as { token: string }

      const current = await fetch('/staff/sessions/current', {
        headers: { authorization: `Bearer ${token}` },
      })
      if (current.status === 401) {
        setState(await refused(current))
        return
      }
      if (!current.ok) {
        setState({ kind: 'unreachable' })
        return
      }

      setState({ kind: 'signed-in', token, who: (await current.json()) as Identity })
    } catch {
      // A rejected fetch, which is what a screen that lost the room's network
      // produces. Nothing was established, so nothing is claimed.
      setState({ kind: 'unreachable' })
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void signIn()
  }

  if (state.kind === 'signed-in') {
    return (
      <main data-staff="signed-in" data-busy={busy ? 'true' : 'false'}>
        <h1>Open orders</h1>
        <p className="who">
          {state.who.staff.name} · {state.who.restaurant.name}
        </p>
        <Board token={state.token} onRefused={onRefused} />
      </main>
    )
  }

  return (
    <main data-staff={state.kind} data-busy={busy ? 'true' : 'false'}>
      <h1>Sign in</h1>
      {state.kind !== 'signed-out' && (
        <p className="said">{state.kind === 'refused' ? state.said : UNREACHABLE}</p>
      )}
      <form onSubmit={onSubmit}>
        <label>
          <span className="label">Email</span>
          <input
            className="field"
            type="email"
            autoComplete="username"
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          <span className="label">Password</span>
          <input
            className="field"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button className="sign-in" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
