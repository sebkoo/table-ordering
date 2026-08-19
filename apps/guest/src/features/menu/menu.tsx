/**
 * What a guest sees after opening the code on their table.
 *
 * Read only. Nothing here takes an order.
 *
 * The response shape is declared here rather than shared with the API. A
 * package holding one type, for one caller, is a guess about a second caller;
 * what keeps the two honest today is the response schema the route serialises
 * through and the browser test that reads the rendered result.
 */

import { type ReactElement, useEffect, useState } from 'react'

type Item = {
  name: string
  priceMinor: number
  currency: string
}

type Menu = {
  restaurant: { slug: string; name: string }
  items: Item[]
}

type State = { kind: 'loading' } | { kind: 'ready'; menu: Menu } | { kind: 'unavailable' }

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

export function Menu({ slug }: { slug: string }): ReactElement {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    // A relative path, so the request goes to the origin that served the page.
    // 404 and a refused connection land in the same place on purpose: a guest
    // holding a phone can do the same thing about either one.
    fetch(`/restaurants/${encodeURIComponent(slug)}/menu`)
      .then((response) => (response.ok ? (response.json() as Promise<Menu>) : null))
      .then((menu) => {
        if (cancelled) return
        setState(menu === null ? { kind: 'unavailable' } : { kind: 'ready', menu })
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'unavailable' })
      })

    return () => {
      cancelled = true
    }
  }, [slug])

  if (state.kind === 'loading') {
    return (
      <main data-state="loading">
        <p>Fetching the menu…</p>
      </main>
    )
  }

  if (state.kind === 'unavailable') {
    return (
      <main data-state="unavailable">
        <p>We could not load a menu at this address.</p>
      </main>
    )
  }

  return (
    <main data-state="ready">
      <h1>{state.menu.restaurant.name}</h1>
      <ul>
        {state.menu.items.map((item) => (
          <li key={item.name}>
            <span className="name">{item.name}</span>
            <span className="price">{money(item.priceMinor, item.currency)}</span>
          </li>
        ))}
      </ul>
    </main>
  )
}
