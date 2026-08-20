/**
 * The guest page.
 *
 * Two addresses, both read from the URL rather than from a build-time
 * constant, so one build serves every restaurant and every table:
 *
 *   /t/<code>   the code printed on a table -- what a card carries
 *   /r/<slug>   a restaurant's menu, with nobody sitting at it
 *
 * Anything else resolves to an empty slug, which the API answers with a 400 the
 * page reports as an address that is not in use. One segment read from
 * `location.pathname` is still not routing.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Menu, type Source } from './features/menu/menu.tsx'

const [area = '', value = ''] = window.location.pathname.split('/').filter((part) => part !== '')

const source: Source =
  area === 't'
    ? { kind: 'table', code: value }
    : { kind: 'restaurant', slug: area === 'r' ? value : '' }

const root = document.getElementById('root')
if (root === null) throw new Error('index.html carries no #root to mount into')

createRoot(root).render(
  <StrictMode>
    <Menu source={source} />
  </StrictMode>,
)
