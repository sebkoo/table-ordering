# 0036. Record a round as paid, gate nothing on it, and leave the bill to the sitting

- **Status:** accepted
- **Date:** 2026-08-26

## Context

The roadmap's last row is "Payment, as an option rather than a requirement", and
it is a stance rather than a mechanism. Nothing in the records says what shape
payment takes: [ADR 0021](0021-record-an-order-as-a-submission-with-lines.md)
said only that "payment is deliberately outside the product's promise", and
README's Money section said "Payment handling is optional and not built".

One sentence forces most of what follows. The repository's own description,
recently re-argued at 350 characters, promises:

> No app to install, no third-party requests.

and `AGENTS.md` holds the executable half of it: "A fresh load of a page this
repository serves reaches no origin but its own." A hosted processor is the
shape the market expects here, and it is the one shape those two sentences
forbid — it turns a self-hosted system's front door into a third party's, and
the guest page's zero-third-party property is verified by a browser rather than
promised. Taking it would be a product pivot with metadata consequences, not an
implementation detail.

What is left once a processor is out is the fact rather than the flow: whether a
round was paid for is something a restaurant knows and might want written down,
and writing it down needs nobody else's servers.

The domain resists the grain, and that is the real decision. A restaurant
settles a bill across a **sitting** — one party, several rounds, one payment —
and this schema has no sitting. ADR 0021 rejected one because "nothing here
reads it" and closed: "**It lands with the first view that can close a table.**"
[ADR 0026](0026-read-a-tables-open-orders-by-its-printed-code.md) added a second
reason and restated the trigger verbatim. [ADR 0034](0034-clear-a-ticket-by-recording-when-it-was-served.md)
rejected `closed_at` because "'closed' is the sitting's word, and the sitting is
what ADR 0026 deferred; a ticket going out and a table being cleared are
different events and will want different columns."

## Decision

**A member of staff records that a round was paid for, and nothing is gated on
it.** `table_order` gains `paid_at timestamptz`, null until somebody records
one. `POST /staff/orders/:id/paid` performs the act: no body, `204`, the same
byte-identical `404` a wrong-restaurant ticket already gets, and `and paid_at is
null` on the claim so a repeat writes nothing further. Migration `0007` adds the
column and grants `update (paid_at)` — the second column-scoped grant, already
governed by the invariant the first one added.

**The grain is the order, and it is bookkeeping rather than the bill.** An order
is what exists; a sitting is not. Recording against the finest grain the schema
has is not a claim that a bill is per round — a bill reconstructs from the
orders at a table settled together, exactly as ADR 0021 argued a sitting
reconstructs from a table and a time, and the reverse does not hold. **ADR
0021's trigger has not fired.** Recording that one round was paid for closes no
table, so the deferral stands unrewritten and the bill-level act is named as
what arrives with the sitting.

**The act takes no window and no `served_at` clause.** ADR 0034 settled the
principle — "the window bounds what a *read* discloses and not what a *write*
may record" — and it governs here for the same reason. A round settled when the
plates were cleared was settled.

**The option is automatic, and there is no flag.** Nothing in the guest's path
reads the column, the board's predicate does not consult it, and a ticket leaves
on `served` alone. A restaurant that never records a payment behaves exactly as
it did before this commit, so a per-restaurant switch would be a config with no
consumer. That claim is pinned by a condition comparing the guest's own bytes
before and after an act, not by this paragraph.

**`paid` reaches the board's answer as a boolean, with two consumers**: the row
states it on `data-paid`, and the control that records a payment renders only
while it is false.

`markServed` and this act are folded into one `act(pool, digest, id, claim)`,
and `board.tsx`'s `clear` into one `act(id, what, said)`. Two callers each, so
the seam is observed rather than guessed at.

## Rejected alternatives

- **A hosted payment processor — Stripe Checkout, SumUp, Square.** The obvious
  implementation, and the one every product in this space ships. Rejected
  because it contradicts the sentence this repository sells itself with: "No app
  to install, **no third-party requests**." A checkout redirect or an embedded
  iframe is a third-party request in the one place it matters most, and the
  guest page's zero-third-party property is asserted by a browser test that
  would go red. Taking it would be a positioning pivot, argued in the open, with
  the description rewritten — not a feature. **It reopens if the product ever
  decides its promise is worth less than the integration**, which is a decision
  and not a discovery.
- **Gating an order on payment — pay before the kitchen sees it.** It is what a
  processor integration naturally becomes, and it is the row's own word
  "requirement" in negative. Rejected because the product's whole claim is that
  a guest gets served: a network that eats a payment must not eat a dinner, and
  a restaurant that wants a card first can ask for one without this software
  refusing to send the order.
- **A per-restaurant flag turning payment on.** README's own Next section
  phrased the row as "Payment, as an option a restaurant **turns on** rather
  than a requirement", so the switch reading was there to be taken. Rejected
  because nothing would consume it: the guest's path does not read the column,
  the board's predicate does not, and a ticket clears without it — so a
  restaurant that never presses the control already gets the "off" behaviour
  exactly. A column read by no branch is the seam `AGENTS.md` rules out. **It
  arrives with the first thing that must render or refuse differently per
  restaurant**, which a payment fact is not.
- **An amount, a currency, or both, on the order.** It is what "payment" means
  to most readers. Rejected because a paid moment is a fact and an amount is a
  ledger: a stored amount immediately raises what it should equal, and the only
  answer is the sum of the lines at the prices they were ordered at — which is
  the price snapshot ADR 0021 deferred and this change does not fire. A column
  whose correctness cannot be checked against anything is worse than no column.
  **It arrives with the price snapshot, and needs it first.**
- **The sitting first, with payment recorded on it.** The truest shape, and the
  one a restaurant would recognise. Rejected as a different size of change: it
  mints an entity, re-points the guest's read and the board's read at it, and
  retires the two-hour window that ADR 0026 says "retires when a sitting
  exists" — three or four commits, not one, and each of them a behaviour. Taking
  it here would also have left the roadmap row open across the whole arc. **It
  arrives on its own trigger, unchanged: the first view that can close a table.**
  A bill-level settlement is that view, and this change does not build one.
- **`settled_at` rather than `paid_at`.** Rejected for the reason ADR 0034
  rejected `closed_at`: settlement is the sitting's word as closing is, and
  taking it here would name a bill this column is not.
- **Widening the board's read to `served_at is null or paid_at is null`,** so a
  served ticket could still be settled from the page. It is the obvious repair
  for the limitation below. Rejected because it makes the option a requirement:
  at a restaurant that never records payment, every ticket would stay on the
  board until the window expired, and the board is the thing that must not
  change for them. A second list of what is served and unsettled is the honest
  version, and it wants the sitting.
- **Showing the paid state to the guest.** The value is in hand on a read the
  guest already makes. Rejected because it is not an answer to the question that
  read exists for — "did my round reach the kitchen" — and because a guest knows
  whether they paid. It would also put a fact about the till on a page anyone
  holding a printed code can open.
- **Recording who took the payment, or how.** The session resolves a staff row,
  so the identity is in hand. Rejected on ADR 0034's trigger for the same
  question, unchanged: **it arrives with the first view that shows who did what.**
- **`PATCH /staff/orders/:id` with `{ "paid": true }`.** Rejected for ADR 0034's
  reason: a field that can be `true` can be `false`, and un-recording a payment
  is a second behaviour that needs a reason nobody has.
- **A third browser condition for the `401` at the paid address.** Rejected
  because the fold makes it the same door: one `act` function, one `onRefused`,
  already pinned by "returns to the sign-in state when the act is refused". It
  costs ≈1.15s to assert the same thing twice. **It comes back the moment the
  fold is undone**, and a change that splits the two acts apart owes it.

## Consequences

**The roadmap table is complete**, and README says so in those words. That is a
statement about the list rather than about the product: the list is what was
planned when it was written.

**No page path records a payment against a ticket that has been served**, which
is the ordinary restaurant flow — settle at the end of the meal. The address
reaches such a ticket and the board does not show one, so the act is reachable
by a client and not by the page. This is the sharpest cost of choosing the order
as the grain, it is stated in README's limitations rather than left to be
discovered, and the view that would close it is the sitting's.

**The privilege no longer isolates the two acts from each other.** The role
holds `update` on `served_at` and on `paid_at`, so a statement recording a
payment could set the wrong one and the grant would permit it. What still holds
for a statement nobody read is the boundary `0003` drew and `0034` narrowed by
one column: `restaurant_id`, `table_id`, `submission_id` and `placed_at` are
refused with `42501`. Each act is kept to its own column by its own statement,
and that is weaker than a privilege — named here rather than left implied.

**Nothing here fires ADR 0021's price snapshot or its sitting**, and nothing
fires ADR 0026's window retirement. The act records a time, shows no money and
closes no table.

**`AGENTS.md` gains no invariant.** The column grant is already governed. A line
saying a staff-recorded fact is unreadable in the guest's path would be true and
would arrive one commit late for its own first subject — `served_at` created
that class at `0006` — which is what ADR 0004 rules out. The property is pinned
by a condition instead.

**The board's picture is now two shapes behind**, and it is still not recaptured,
on ADR 0034's grounds unchanged: a capture is taken at a revision that exists,
the newest one that does is the parent, and the parent's board does not have this
control. ADR 0032's caption check stays deferred to the first recapture. README
says how far behind the picture is.
