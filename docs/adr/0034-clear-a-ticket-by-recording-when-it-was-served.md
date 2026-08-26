# 0034. Clear a ticket by recording when it was served, and leave the guest's list alone

- **Status:** accepted
- **Date:** 2026-08-26

## Context

The board exists in halves. [ADR 0030](0030-read-the-restaurants-open-orders-from-the-staff-session.md)
gave `GET /staff/orders` a restaurant's open orders and
[ADR 0031](0031-show-the-board-on-a-page-staff-sign-in-to.md) drew them on a page
staff sign in to, and nothing acts. "Open" is a fact about time alone:
`OPEN_ORDERS_IN_RESTAURANT` filtered on `o.placed_at > now() - $1::interval` and
on nothing else, so a ticket the kitchen had already sent out stayed on the board
until the window expired. A kitchen that can see a ticket and never clear it has
a list that only grows.

Two records scheduled this change and used the same words for its trigger.
ADR 0026 rejected a status column because "a status has no writer until something
can change one, which is the staff client"; ADR 0030 rejected it again and said
"the column arrives with the first thing staff can do to an order rather than the
first thing they can see". This is that thing, and it is the repository's first
staff-scoped write.

What forces most of the decisions below is that the two reads of a stored order
now want different answers. A guest reading their own table is asking whether
their round reached the kitchen; a kitchen reading its board is asking what is
still outstanding. Before this change one predicate served both.

## Decision

**A member of staff clears a ticket from the board, and the order records the
moment it was served.** `table_order` gains `served_at timestamptz`, null until
the kitchen clears the ticket. The board's read gains `and o.served_at is null`;
the guest's read gains nothing.

`POST /staff/orders/:id/served` performs the act. It sits on the staff router
behind the same `bearer` check the board's read uses, takes **no body**, and
answers `204` with an empty body. Two statements inside one transaction, in the
shape the order slice already has for a resend — `MARK_SERVED` claims the act
with `and served_at is null`, and `ORDER_IN_RESTAURANT` reads back only when the
claim reached no row, which is what tells a repeat from an order this scope
cannot see.

Migration `0006` adds the column and grants `update (served_at)` — a **column
grant**, the first in this schema. No policy is written: `0003`'s
`table_order_scope` is `for all`, so the policy that scopes the board's read is
already the policy that scopes this write.

## Rejected alternatives

- **A status enum, so "open" could name a state.** It is the shape the roadmap's
  word "kitchen board" suggests. Rejected because it carries more states than the
  product has behaviours — the board needs exactly two — and because it records
  no moment, so "when did that go out" would need this column beside it anyway.
  A boolean loses the same thing for the same reason.
- **`closed_at` rather than `served_at`.** Rejected because "closed" is the
  sitting's word, and the sitting is what ADR 0026 deferred; a ticket going out
  and a table being cleared are different events and will want different columns.
- **Filtering the guest's read too**, so that "open" means one thing everywhere.
  One clause, and it would retire the ambiguity this change creates. Rejected
  because it is exactly the failure `placed.tsx` exists to prevent: a page that
  showed nothing would tell a guest their food is not with the kitchen, and send
  them to order it again. A round that has been cooked has still been sent, and a
  guest whose order silently vanished the moment the kitchen picked it up would
  be the one guest most likely to order it twice.
- **`409` on a repeat.** It reports something true. Rejected because two kitchen
  screens showing one ticket is the ordinary case, and the second person to press
  would be shown an error for something that did happen. The order slice settled
  this for a resend — "a client that retries cannot act on the difference, and an
  API that reported one would be inviting it to" — and a second screen is a
  retry by another hand.
- **`set served_at = coalesce(served_at, now())`**, which is one statement and
  needs no read-back. Rejected because a repeat then rewrites the row with the
  value it already held, and "the write path answers a repeat with the first
  order and writes nothing further" is the posture this repository already holds
  for a submission id.
- **A window clause on `MARK_SERVED`**, so the act reaches exactly what the board
  shows. Rejected because the window bounds what a *read* discloses and not what
  a *write* may record: a ticket that aged off the board unserved is the
  forgotten ticket, and recording that it was served records something true.
  It would also cost a three-way read-back — `404` for aged-out-unserved against
  `204` for a repeat — to buy a refusal no client can reach, since the board is
  where ids come from.
- **`PATCH /staff/orders/:id` with `{ "served": true }`.** More conventional.
  Rejected because a field that can be `true` can be `false`, and un-serving is a
  second behaviour: it needs a reason a ticket goes back on the board, and nobody
  has one yet. **It reopens with the first kitchen that clears a ticket by
  mistake and says so.**
- **`DELETE /staff/orders/:id`.** Rejected because a served ticket is history and
  not garbage. The row is what a later sitting, bill or report is built from, and
  the foreign keys from `table_order_line` mean the delete would either fail or
  cascade away the food.
- **Acting from the guest's page.** Rejected because clearing a ticket is a claim
  about the kitchen, and the guest's page authorises with a code printed in a
  public room. Anyone who photographed a placard could clear that table's
  tickets, and the board would then be a list of what strangers had not yet
  pressed.
- **A bulk "clear all" control.** Rejected as unmeasured: nothing is deployed, so
  no kitchen has said its board is long enough to want one, and a control that
  clears rows nobody read is the one act with no undo. **It arrives with the
  first restaurant whose board holds more tickets than a screen** — the same
  trigger ADR 0030 put on pagination.
- **Recording who served the ticket.** The session resolves a staff row, so the
  value is in hand. Rejected because nothing reads it: no view shows it, no
  report exists, and a column with no reader is one every later change has to
  keep true. **It arrives with the first view that shows who did what.**
- **An index on `served_at`.** Rejected as unmeasured, for the reason ADR 0030
  rejected pagination: no plan has been observed, and a restaurant's open orders
  inside the window are bounded by how fast a kitchen can be ordered from.
- **Recapturing `docs/images/staff-board.png`.** The board has grown a control,
  so the picture no longer shows the page. Rejected on two counts. The caption
  names the revision it was taken at, which is what makes a stale capture a
  historical fact rather than a silent lie, and ADR 0032 deferred the check that
  would hold captions to "the first recapture" — firing that trigger would put a
  second behaviour in this commit. And a recapture here could not be honestly
  captioned at all: the pixels would come from code that has no revision until
  this commit exists, which makes recapture structurally a later commit's choice.
- **Landing ADR 0033's full-prefix convention rule here.** Its trigger has fired.
  ADR 0033 wrote it down as: "**A convention rule enforcing the full-prefix
  rule now.** It would have seven subjects today and would fail before this
  change and pass after — the shape ADR 0004 asks for. Rejected as a second
  behaviour in one commit. Its trigger is named instead: **the next migration**,
  `0006`, which is the first chance for the rule to be broken by a new list
  rather than by an old one." `0006` is this migration. The rule is still not
  here, and the successor is a commit rather than a condition: **it is the next
  commit.** A condition can be argued with; "the next commit" can only be kept or
  visibly broken. Landing it here would also move `verify`'s verdict-line count
  from fifteen to sixteen and every restatement of that number with it, which
  deserves its own declaration. `add-slice` agrees that it is not this slice's
  ride-along: a convention rule lands with the commit creating that rule's *first*
  subject, and ten lists already exist.

## Consequences

**"Open" now names two questions asked of the same rows**, and one constant still
bounds both. The guest's read is bounded because a printed code is public and
cannot be revoked; the board's is bounded because a kitchen wants what is
outstanding rather than a history. README said they "separate the first time an
order can be marked served" — that moment is now, and they have not separated,
because the two bounds have not yet needed different values. The successor
trigger replaces it: **they separate with the first deployment that reports a
ticket ageing off the board before its kitchen cleared it, or with the sitting
ADR 0026 defers the guest's window to — whichever lands first.** Neither is an
argument; both are observations.

**The application role can write to a column for the first time**, and to exactly
one. `0003` said this schema has "no update and no delete"; that is now narrower
by one column and no wider. A statement setting `restaurant_id`, `table_id`,
`submission_id` or `placed_at` is refused with `42501` by the privilege rather
than by review, which is what makes it hold for a statement nobody read. That is
the invariant this change adds to `AGENTS.md`, and it is pinned by a condition
that runs both statements as the application role and compares the two SQLSTATEs.

**Nothing here fires ADR 0021's price snapshot or its sitting.** The act records a
time, shows no money, and closes no table.

**Ten migration lists, not seven.** The full-prefix rule ADR 0033 established was
recorded against the seven `.up.sql` lists; three `.down.sql` lists exist beside
them, in `menu.test.ts`, `order.test.ts` and `staff.test.ts`, and this change is
the first to have a down file they could omit. All ten carry `0006`. What that
bought was measured rather than assumed: with `0006.down` in the down lists,
removing `0006.up` from `menu.test.ts` or `staff.test.ts` now reddens their own
down conditions, so **five of the seven up lists are held by a condition** and two
— `menu.browser.test.ts` and `order.browser.test.ts` — are held by review alone.
The down lists themselves are held by nothing: removing `0006.down` on its own
reddens nothing, because `0003`'s down drops the table the column hangs on. That
residue is what the deferred rule is for.

**A statement that re-scopes itself is still invisible.** Adding
`and restaurant_id = current_setting('app.restaurant_id')::uuid` to `MARK_SERVED`
reddens no condition in the tree, because such a predicate agrees with the policy
in every state including the unscoped one where both raise. README already
records this and this change does not narrow it.

The rule this record named its successor for lands in
[ADR 0035](0035-check-a-suites-migration-list-against-the-directory.md). What was
promised was written here as: "The rule is still not here, and the successor is a
commit rather than a condition: **it is the next commit.** A condition can be
argued with; 'the next commit' can only be kept or visibly broken." That is the
commit after this one, and the promise is kept.

The residue this record measured is what set the rule's scope. "Five of the seven
up lists are held by a condition and two … are held by review alone. The down lists
themselves are held by nothing" — so the rule covers both directions rather than
the up lists alone, and all ten are now held by a condition rather than by review.
The verdict-line count this record predicted moved as predicted, fifteen to
sixteen, and nothing in the tree restated the old number: `check-push` computes it
at run time, and the two logs its suite carries are captures read against the step
list of their own era.
