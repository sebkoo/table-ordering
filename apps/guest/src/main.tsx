/**
 * The guest page.
 *
 * A table's code points at `/r/<slug>`, so the slug is in the URL rather than
 * in a build-time constant: one build serves every restaurant.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Menu } from './features/menu/menu.tsx'

const [, slug = ''] = window.location.pathname.split('/').filter((part) => part !== '')

const root = document.getElementById('root')
if (root === null) throw new Error('index.html carries no #root to mount into')

createRoot(root).render(
  <StrictMode>
    <Menu slug={slug} />
  </StrictMode>,
)
