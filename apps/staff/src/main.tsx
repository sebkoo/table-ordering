/**
 * The staff page.
 *
 * One address and no routing. The guest page reads a segment out of
 * `location.pathname` because a printed card carries a table's code and one
 * build has to serve every table; nothing here is addressed that way. Which
 * restaurant this page shows follows from the credential somebody signs in
 * with, and there is nothing in the URL for it to follow from -- which is the
 * same construction that keeps a restaurant out of every staff request.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Session } from './features/staff/session.tsx'

const root = document.getElementById('root')
if (root === null) throw new Error('index.html carries no #root to mount into')

createRoot(root).render(
  <StrictMode>
    <Session />
  </StrictMode>,
)
