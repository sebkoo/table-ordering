# 0030. Read the restaurant's open orders from the staff session, and name the table rather than its code

- **Status:** accepted
- **Date:** 2026-08-25

## Context

[ADR 0029](0029-verify-a-staff-credential-and-carry-a-session.md) built the staff
identity and named, in the same record, the thing it could not demonstrate:

> **No staff request reads an order yet**, so nothing here demonstrates that a
> staff scope reaches only its own restaurant's rows. What is demonstrated is the
> layer above it: a credential minted for one restaurant answers that restaurant
> and never the other, across two seeded restaurants. The order-row version of
> that condition lands with the read that needs it, which is the board's API.

It also recorded the shape of the wait: "The board's API is the next change and
consumes the resolve; the board's page is the one after". This is the first of
those two.

### What is already in position

The guest's read of a table's orders established the mechanism a year of records
had been building towards: one transaction resolves what the caller holds,
`set_config('app.restaurant_id', …, true)` takes its value from the row that
resolve returned, and the select that follows names no restaurant at all --
`table_order` and `table_order_line` carry `for all` policies whose `using`
clause is that setting. Nothing about that mechanism is specific to a printed
code. A staff session resolves to a restaurant in exactly the same position, so
the read this record decides needs no migration, no new policy and no grant.

### What was deliberately left open

ADR 0029 rejected building this alongside the credential, and said why: "secret
handling and what a board discloses are two decision-heavy surfaces, and taken
together the second gets decided by whoever is tired after the first." What a
board discloses is therefore undecided until here, and it is most of what this
record is about.

## Decision

**`GET /staff/orders` answers every open order in the restaurant the caller's
session resolves to.** One transaction, the shape the guest's read already has:
resolve the bearer token's digest, set the scope from the restaurant on the row
that resolve returned, then read. An absent, forged or expired session is `401`
with the body `GET /staff/sessions/current` already uses.

**The route lives in the staff slice rather than a slice of its own.** This
router is grouped by the boundary it sits behind: every handler in the file
begins by resolving a credential, and nothing outside the file needs the bearer
parser or the body a closed session is refused with. Its statement lives in the
slice's `sql.ts`, because a slice owns its SQL.

**The answer is a flat list, oldest first, and each order carries the label of
the table it was placed at.** The label is the one thing the caller did not
already hold: a guest reaches their own table's orders by holding that table's
code, and a member of staff holds no code at all. The sort is
`OPEN_ORDERS_AT_TABLE`'s four terms unchanged -- `o.placed_at, o.id,
item.sort_order, item.name` -- so a kitchen reads its queue in the order it
formed.

**It carries the table's label and never the table's code.** The code authorises
an order at that table; the board has no reader for it, and a value that
authorises a write does not travel to a reader that does not act on it. The
condition that pins the labels searches the same answer for every seeded code, so
the exclusion is a value rather than an intention.

**It carries no price and no time.** No price because an order records none, and
the menu's price today is the wrong number for an order placed before it moved.
No time for the reason the guest's read gives in its own schema comment:
`placed_at`'s only reader here is the sort the query has already applied. The
first board view that shows how long a ticket has waited is what adds it.

**The window is `OPEN_WINDOW`, imported from the order slice rather than
restated.** "Open" means recent here exactly as it does for a guest. The two
bounds have different reasons -- the guest's because a printed code is public and
cannot be revoked, the board's because a kitchen wants what is outstanding rather
than a history -- but one value with two reasons is safer than two values with
one each, which is the drift
[ADR 0028](0028-check-the-window-where-it-is-restated.md) exists to prevent.

**The resolve gains a column rather than a second query.**
`SESSION_FOR_DIGEST` now selects `staff.restaurant_id` as well as the identity,
which keeps the request's one unscoped query at one. The column is taken from
`staff` rather than from `staff_session`, so every value the resolve answers with
comes from the staff row and the restaurant it belongs to;
`GET /staff/sessions/current` does not read it and its response schema does not
name it, so it reaches no client.

### What the evidence pins, and what it does not

Three mechanisms could each be mistaken for the others here, so each was
exercised separately.

| Claim | Mechanism | How it was observed |
| --- | --- | --- |
| A staff scope reaches only its own restaurant's order rows | the **policies** on `table_order` and `table_order_line` | four seeded restaurants; each token's board compared as a row set against exactly that restaurant's orders |
| The statement does not scope itself | the **policies** again | one statement under two scopes and under none: rows, no rows, and `42704` |
| A session cannot belong to a restaurant its staff member does not | the **composite foreign key** `(staff_id, restaurant_id)` | the straddling insert refused `23503` |
| A straddling session, if one existed, reaches nothing | the **resolve's two-column join** | the key dropped and the row seeded anyway: the board answered `401`, not the other restaurant's orders |

The last row is the one worth stating plainly, because it is easy to claim the
key where the join answers. **The join refuses first.** The key is what makes the
row unrepresentable; the join is what makes it unusable if it were ever
represented, and only removing the key can show which is which.

**Two things here no condition can see**, stated rather than left to be
discovered. A predicate comparing `restaurant_id` with the transaction's scope,
added to the statement, would agree with the policy in every state -- including
the unscoped one, where both raise -- so nothing tells a statement that
redundantly re-scopes itself from one that leaves the job to the policy. And the
second column on the join to `restaurant_table` is guaranteed by the order's own
composite key, so no fixture can make it matter. Both are written for the
invariants they serve, and neither is claimed as evidence.

## Rejected alternatives

- **A `board/` feature directory, with the client half of commit 25 named the
  same.** This is the placement the layout rule reads most naturally: the
  behaviour is the board, and neither "staff" nor "order" names it. Rejected on
  what the directory would contain. Its route would be assembled from four
  exports of the staff slice -- the resolve, the digest, the bearer parser and
  the refusal body -- and two of the order slice, which makes it a shell around
  other slices' internals rather than a slice. It would also force
  `staff/routes.ts` to export the bearer parser and the closed-session body,
  widening a module's surface for one caller.
- **The `order` slice, on the precedent that `GET /tables/:code/orders` lives
  there despite its address.** The strongest case against what was chosen: reads
  of orders live with orders, `OPEN_WINDOW` and the grouper are already there,
  and no cross-slice import would be needed for either. Rejected because it puts
  two authentication models in one guest-facing router -- a handler that trusts a
  printed code beside one that verifies a bearer token -- and because the order
  suite would have to grow staff rows, sessions and a key derivation to test it.
- **`OPEN_ORDERS_IN_RESTAURANT` in `order/sql.ts`, beside its neighbour**, with
  the route staying here. It would put the two open-order statements side by side
  under the window's own docblock. Rejected because it is a layer: the slice that
  sends a statement owns it, and splitting a behaviour's route from its SQL
  across two slices is the arrangement the layout rule exists to prevent.
- **`placedAt` on each order.** A kitchen genuinely wants to know how long a
  ticket has waited, and this is the field that would answer it. Rejected because
  its first reader is a page that does not exist yet, and the guest's read
  already rejected the same field for the same reason one commit earlier. It is
  cheap to add and backwards compatible, and the change that shows waiting time
  is the change that adds it.
- **Grouping the answer by table**, `{ tables: [{ label, orders }] }`. It makes a
  table with nothing at it representable and matches how a board is often drawn.
  Rejected because the grouping is presentation and the page can apply it, while
  the flat list preserves the queue order the query establishes -- which the
  grouped shape discards and cannot rebuild.
- **Carrying the table's code as well as its label**, so a page could link
  straight to that table's guest view. Rejected because the code authorises an
  order at that table. A board is read on a screen in a room where deliveries and
  agency staff pass, and a value that authorises a write has no business
  travelling to a reader that does not use it.
- **A board-owned window constant**, since the two bounds have different reasons.
  Rejected because `open-window-restated` reads one constant, so a second one
  would be unchecked, and the prose that says "open" would silently mean two
  things. The reasons diverge on paper long before the values need to.
- **A status column, so "open" could mean unserved.** It is what the word ought
  to mean, and the roadmap says "kitchen board". Rejected for the reason ADR 0026
  gave and this change does not retire: a status has no writer until something
  can change one. This is a read. The column arrives with the first thing staff
  can do to an order rather than the first thing they can see.
- **The board's page in this commit.** It would end the consumer gap in one
  change instead of two. Rejected because ADR 0029 recorded the gap as
  two commits and said so "so it can be checked rather than assumed", and because
  the page brings its own decisions -- what a failed read looks like, whether it
  refreshes -- which ADR 0027 shows are a change's worth on their own.
- **Pagination, or a filter by table.** Rejected as unmeasured: a restaurant's
  open orders inside the window are bounded by how fast a kitchen can be ordered
  from, and no deployment exists to say that is large. It reopens with the first
  board that is slow to load, or the first restaurant whose window holds more
  orders than a screen.
- **A second query for the restaurant id, rather than a column on the resolve.**
  It would leave `SESSION_FOR_DIGEST` untouched. Rejected because it makes two
  queries where the invariant allows one, and the second would have to be scoped
  by something -- and the only thing available to scope it by is what the first
  one returned.
- **The board's conditions inside `staff.test.ts`.** One harness, one fixture,
  and the sign-in helpers already written. Rejected on two counts: that file
  dominates the api step, so its conditions would cost the step one-for-one while
  a second file overlaps inside it, and its fixture would have to grow tables,
  menu items and orders that none of the identity conditions use.

## Consequences

**The coverage map's open row closes.** "A staff scope reaches only A's order
rows" is now a comparison of order rows across four seeded restaurants, and the
mechanism it exercises is named rather than assumed.

**One consumer gap remains, and it is the one that was declared.** The board's
page consumes both `GET /staff/sessions/current` and this address, and it is the
next change.

**The staff slice now holds two behaviours**: proving who you are, and the first
thing that proof reaches. That is a boundary rather than a subject, and it is
worth splitting the first time something behind it is not a read of orders.

**The staff slice imports from the order slice**, which is the first cross-slice
import in this service: `SET_SCOPE` and `OPEN_WINDOW`. Both are values whose
whole point is that there is one of them, and copying either is the failure two
records already exist about.

**A member of staff sees every open order in their restaurant, with no notion of
roles.** ADR 0029 deferred roles to "the first thing staff can do that not all
staff should"; seeing the board is not that thing, and this record does not make
it one.

**Nothing here fires ADR 0021's price snapshot or its sitting**, and nothing
fires the status column. This is the second view of a stored order, it shows no
money, it closes no table and it marks nothing.

The page this record named as the next change is
[ADR 0031](0031-show-the-board-on-a-page-staff-sign-in-to.md), and with it the
consumer gap ADR 0029 declared is closed in both halves: `GET /staff/orders` is
read by the board that page draws, and `GET /staff/sessions/current` is what that
page names the signed-in staff member from. The answer's shape survived contact
with its first client unchanged — no `placedAt`, no grouping by table, no code
beside the label — and the two fields this record left for a later view are still
waiting on the same views.
