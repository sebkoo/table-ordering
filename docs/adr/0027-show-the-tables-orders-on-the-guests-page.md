# 0027. Show the table's orders on the guest's page, refreshed only by a send

- **Status:** accepted
- **Date:** 2026-08-25

## Context

`GET /tables/:code/orders` landed with acceptance conditions and a run step and
no client, and ADR 0026 recorded why: "the page that renders it is the next
change — the same decomposition as the write, where `POST /tables/:code/orders`
shipped one commit before the page that sends it. Until then the tree holds a
path no client calls." This is that page.

What the guest is actually asking is not "what is on this table's bill". It is
"did my round go through". README has carried that sentence since the route
landed: a guest who is unsure "can look instead of sending it again". **The
failure this page exists to prevent is a second order for food already on its
way**, and that shapes every decision below.

### Three answers that look identical

The route distinguishes them and a careless page would not. `200 {"orders": []}`
is a table with nothing at it. `404` is a code no table is served at. A request
that never completes is neither. All three render as no rows, and only the first
is a fact about the table — the other two are the page not knowing, and a page
that showed them as "nothing here" would give the guest the exact false
reassurance that sends them to order again.

### What the response carries, and what follows from it

Four fields: an order's id, and each line's name and quantity. No price, no
status, no `placed_at`, no window. Two consequences are not choices this record
makes, they are what the shape leaves available:

- **There is no time on an order**, so a round cannot be labelled. A page that
  drew a boundary between rounds could not say what the boundary was.
- **There is no price anywhere**, so showing money would mean joining a stored
  order to the current menu. ADR 0021 named "the first thing that shows an
  order's money" as the trigger for a price-and-name snapshot, and that trigger
  is not fired here.

## Decision

**The order slice renders what the table has sent, below the control that sends
it.** One row per order, each reading `2 × Flat white, 1 × Cinnamon bun` — a
round, because a round is what the guest sent and what they are looking for.

**Every outcome renders, and each carries its own value on `data-placed`:**
`loading`, `empty`, `ready`, `unavailable`. The heading is present in all four.
**The empty state is an artefact and not an absence**: a page that rendered
nothing for an empty table would be indistinguishable from a page that crashed,
never mounted, or never asked, and those are the cases the guest must not be
shown as "nothing here".

**A read that fails is one state, not two.** Every non-ok status and every
rejected request renders `unavailable`. `menu.tsx` splits its failures because
without a menu there is no page and the two halves send the guest to different
places; here the guest already has a menu and can already order, so the remedy is
identical whatever went wrong. Partitioning by remedy rather than by cause is
what stops the next status anyone meets from needing a state of its own.

**It asks on mount, and again when a send from this page is answered `ok`. On no
other occasion.** Not on a timer, not on a stream, and not after a send that was
refused or that did not go — neither wrote anything for it to find. What makes it
ask again is the key the order slice mounts it under: a send that landed makes
the table's orders a new question rather than the old answer with a row missing.

**The list carries no money**, and nothing hands it an item to look a price up
in.

**The empty state names the window**, and that duplicates a value the server
owns. See the section below, which is the cost of this sentence rather than a
footnote to it.

## The window's second copy, accepted with its failure named

`OPEN_WINDOW` is `'2 hours'` in `services/api/src/features/order/sql.ts`. The
route imports it and so do its conditions, so no statement and no assertion
restates it. The empty state does:

> No order has been sent from this table in the last two hours.

`apps/guest` does not depend on `services/api`, so the page cannot import that
constant. **If the window moves to ninety minutes, the route changes, its
conditions still pass — they import the constant and bracket whatever it says —
and this page goes on telling a guest two hours, with nothing to go red.** It is
the first copy of that value that a guest reads rather than a maintainer.

Two things reduce it and neither closes it. The sentence is exported and the
condition that reads it imports it, so there is one copy in this workspace rather
than two. And `OPEN_WINDOW`'s own docblock names this page, because the only
place that reliably gets read when a value changes is the value.

**What would close it is a repository check** that fails when `OPEN_WINDOW` moves
and names every place restating it — six such places exist today in README and in
ADR 0026, so it would not be a rule matching nothing. It is not built here: it is
a second behaviour, and its first subject arrived with the route rather than with
this page, so by ADR 0004's own rule it arrives in its own change.

## Rejected alternatives

- **The response carries the window**, as `windowMinutes`, and the page formats
  from it. The closest call, and the only answer that makes the drift impossible
  rather than documented. Rejected on four counts: it reopens a response schema
  decided one commit earlier whose record says what a reader is told "and the
  whole of it"; it needs an acceptance condition of its own, which makes this
  change two behaviours; it puts duration formatting in a client for a value with
  one setting, which is a seam ahead of anything that varies; and ADR 0026
  already retires the window when a sitting exists, at which point the field is
  dead and the sentence is rewritten anyway.
- **A wording that names no window** — "nothing has been sent yet". Better copy
  at a real table and it needs no second copy of anything. Rejected because it is
  false exactly when it matters: a party two hours into a meal gets the same
  empty list, and telling *them* nothing was sent is the re-send this page exists
  to prevent.
- **The test importing `OPEN_WINDOW` across the workspace boundary.** The guest
  suite already reaches into `services/api` for the migration files — but it
  reads them as files, with no module graph. An import would put that package's
  types inside the guest project's typecheck, and a test is not a reason to open
  a boundary the application does not cross.
- **Polling, so the list stays current.** The obvious way to show a round sent
  from another phone at the same table. Rejected because it contradicts the read
  it would be polling: the code is printed in a public room and cannot be
  revoked, and ADR 0026 bounds what one photograph of that placard reaches to a
  meal in progress. A poll turns that photograph into a standing subscription,
  multiplied by the rate. The bound is on the disclosure, not on the request, and
  a client that asks repeatedly is spending the same budget faster.
- **A server-sent stream.** It does not have the poll's problem — the server
  decides what to send and when. Rejected on size and on shape: nothing here
  keeps a connection open, and the first thing to need one should be the one that
  argues for it. It is what live updates land on when they land.
- **A retry control on `unavailable`.** A dead end is a poor state to leave a
  guest in. Rejected because it is not a dead end: the next send re-reads and so
  does a reload, and a button would be a second path to one fetch, added for a
  state nobody has yet seen outside a test.
- **Refreshing after every send, not only after one that landed.** Simpler to
  write and it looks harmless. Rejected on what it means rather than on what it
  costs: nothing was written, so it is a request made because a request failed.
  It is also invisible — the answer is identical either way, so no condition in
  this repository can tell the two apart, and that is worth knowing about a rule
  that is therefore held by reading alone.
- **Showing a price beside each round, or a total.** What a guest checking a bill
  would want. Rejected because the only price available is the menu's current
  one, which is the wrong number for an order placed before it moved. Showing it
  would fire ADR 0021's snapshot trigger by accident and answer it wrongly.
- **One row per line rather than per round.** It would read more like a bill.
  Rejected because it discards the only grouping the response carries, and the
  page cannot rebuild it: there is no `placed_at`, so a round has nothing to be
  labelled with.
- **Rendering the list beside the menu, in the menu slice.** The two lists sit
  next to each other on the page, so it looks like where they belong. Rejected
  because only the half that sends knows when a send landed, and lifting that
  signal would tell the menu slice that orders exist.

## Consequences

**The page shows the table's orders as of the last time it asked.** A round sent
from another phone at the same table does not appear until this page sends or is
reloaded, and nothing on it says how old the list is. That is the cost of not
polling, stated plainly, and it is what live updates are for.

**A guest whose send is in doubt now has somewhere to look**, which is the
sentence README has carried since the route landed. It works because the page
reads the *table*, not this browser: an order this tab never sent is on the list.

**The window's value now lives in two workspaces**, and only one of them is
checked. Recorded above rather than left to be found.

**Nothing here fires ADR 0021's snapshot trigger or its sitting.** This is the
first view of a stored order and it shows no money and closes no table; both
records keep their scheduling, and the invariant that a view prices nothing from
today's menu is now written down where the next view will meet it.

The check this record deferred is
[ADR 0028](0028-check-the-window-where-it-is-restated.md), which reads the
constant and fails every restatement of it in README and on the page. It is
narrower than the sentence above: the records are outside it, because a window
written into a decision is a capture of that decision rather than a copy of the
value.
