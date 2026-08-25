# 0026. Read a table's open orders by its printed code, and defer the board to a staff identity

- **Status:** accepted
- **Date:** 2026-08-24

## Context

The roadmap carries "Kitchen board", and ADR 0021 closed with the state it would
arrive into: "An order has no reader. Nothing in the repository selects one
except the conditions that assert it was written." The repository's own
description says the order is written under row-level security, and that has
only ever been demonstrated on the write side.

**Nothing in this repository distinguishes a staff request from a guest
request.** Every handler reads `request.params` and nothing else; no header,
cookie, session or token is read anywhere in `apps/` or `services/`; the only
credentials that exist are the PostgreSQL role credentials the server process
holds. So a kitchen board on the request shape that exists is a public page
listing every order in a restaurant, keyed on a slug the README prints and
`/r/<slug>` already advertises. It would pass every check here. It would also
make the row-level-security sentence misleading rather than earned: the policy
would scope the read to one restaurant exactly as designed, and then hand it to
anybody. A tenancy boundary is not an authorisation boundary.

### What a printed code is worth, measured rather than assumed

There is no generator. ADR 0014 rejected `gen_random_uuid()` and
`gen_random_bytes` as a column default deliberately, so that a card is
reproducible and a test can open a code it knows. Three different numbers
follow, and the gap between them is the finding:

| | Guessable space |
| --- | --- |
| The schema guarantees | **0 bits.** `code text not null unique` — no default, no check, no length. `table001` is a valid row. |
| The route admits | `^[a-z0-9]{8,64}$`, so 36⁸ ≈ 2⁴¹ at the shortest admissible length — **only if the value was chosen at random.** The pattern constrains alphabet and length, never choice. |
| The documented practice produces | **48 bits.** `openssl rand -hex 6`, the only mint instruction in the tree. At 10⁶ requests per second a single code is some 4.5 years of expected search. |

The practice is genuinely unguessable and the guarantee is nothing, and no
observation inside the system separates a deployment that followed the practice
from one that typed `table001`. Entropy cannot be made structural here — no
constraint enforces randomness in a text column — so it stays a property of the
mint. What changes with this record is that the property becomes load-bearing
for a third party's data for the first time.

### Why the existing records do not settle it

ADR 0014 and ADR 0023 decided that possession of the printed code is the whole
of what a guest brings. Citing them here would be a category shift. Those
records answered it for a **menu read**, which is public information a card
already carries, and for an **order write**, which is an action by the person
taking it. This is the first time the same credential guards **someone else's
data**, and extending it there is a new decision rather than an inherited one.

The argument that carries it is narrower and does not appeal to either record.
**The code already authorises the strictly greater action against the same
subject.** A stranger holding it can send £200 of wine to that table. Reading
what the table has ordered is dominated by the write that already ships.

Where that argument stops is persistence. A write is one-time and visibly
consequential — food arrives, staff notice, the guest disputes it. A read is
silent and repeatable, and the placard is permanent: a passer-by who
photographed it, a previous diner, anyone who has ever sat there. Full history
would make one photograph a standing subscription to that table.

## Decision

**`GET /tables/:code/orders` answers the orders placed at that table within the
last two hours, each with its lines as a name and a quantity.** The same address
the menu is read from and the order is sent to, because the printed code is the
whole of what a guest has.

**The read is scoped by the policy, not by the statement.** One transaction
resolves the code, sets `app.restaurant_id` from the row it returned, and then
issues a select naming no restaurant at all. `table_order` and
`table_order_line` already carry `for all` policies whose `using` clause is that
scope, and the application role already holds `select` on both, so no migration
is required and none is made. `menu_item` carries no policy, so its join scopes
itself against the line's `restaurant_id`, which the policy has already
filtered.

**The window is two hours, and it is a proxy for the sitting rather than a
substitute for one.** It converts "anyone who has ever seen this placard learns
what this table has eaten since" into "learns what is being eaten now". It
cannot separate one party from the party before it — a table can turn over in
five minutes and no window is shorter than that. ADR 0021 defers a sitting row
to "the first view that can close a table"; that decision now carries a second
reason, and this window retires when a sitting exists.

**The read carries no money and no status.** An order records no price, so the
only price available is the menu's current one, which is the wrong number for an
order placed before it moved.

## Rejected alternatives

- **A kitchen board now, on the request shape that exists.** The roadmap row,
  and the reason this change was taken up at all. Rejected because nothing
  distinguishes a staff request from a guest one, so it is a public list of
  every order in the restaurant — and it would be green, which is worse than
  being wrong.
- **Staff authentication in this commit, as the board's prerequisite.** The
  honest ordering, and it is what the board waits for. Rejected on size and on
  care: it is a credential store, a migration, a login path and a second client,
  and authentication built in a hurry as somebody else's prerequisite is
  authentication built badly. It lands deliberately, when the board needs it.
- **Reading only the sends this browser made, by remembered submission id.** It
  discloses strictly less, and it was the closest call. Rejected because it
  contradicts a recorded invariant: a submission id is minted per send and
  retired when the API answers, and keeping one to read by would make it a name
  for a visit again — the exact defect ADR 0023 exists to prevent. It would also
  show one phone at a shared table only its own round, which is not what the
  table ordered, and a guest would re-send a round a friend had already sent.
- **Treating the printed code as a capability, signed or secret.** Rejected
  already by ADR 0014, and nothing here revives it: a string printed in a public
  room is not a secret, and a signature proves only that the card is genuine.
- **Carrying the price, so a guest can check the bill.** Rejected because the
  price would be the menu's current one. ADR 0021 named the first thing that
  shows an order's money as the trigger for the price-and-name snapshot; this is
  not that thing, and showing today's price would fire that trigger by accident
  and answer it wrongly.
- **A status column, so the read could say what is still unserved.** It is what
  "open" ought to mean, and the roadmap says it. Rejected because a status has
  no writer until something can change one, which is the staff client: the
  column would be `'open'` on every row forever, which is the same as no column
  and one more thing every later change has to keep true.
- **Full history, with no window.** Simpler, and it is what the guest would
  probably prefer. Rejected on the physical model above: the placard is
  permanent and cannot be revoked without reprinting the card, so an unbounded
  read is unbounded in time as well as in audience.
- **`begin read only` for the transaction.** One word, and it would make it
  structurally impossible for this path to write. Rejected because its
  acceptance condition would exercise a fixture rather than the route — this
  route issues no write — and the privilege boundary already refuses `update`
  and `delete` to the application role.
- **Naming the bound in the address, as `/tables/:code/orders/open`.** It would
  stop the address promising more than it answers. Rejected because it invites
  `/orders/all`, which is the thing that must not exist.

## Consequences

**Anyone holding a table's code can read what that table has ordered in the last
two hours.** That is the cost, stated plainly. It is bounded to one table, it
adds no way to enumerate other tables, and it is dominated by the write the same
code already permits — but it is a disclosure, and it rests on a mint the system
cannot verify.

**A window is not a sitting.** A party arriving at a table the previous party
left within the window sees the previous party's order. No window closes that,
because parties can be minutes apart; only a sitting can, and this is now a
second reason for the one ADR 0021 deferred.

**This is the first read in the repository under a policy.** It does not
discharge the roadmap row that follows it: `restaurant`, `restaurant_table` and
`menu_item` still carry none, and the menu queries still scope themselves.

**The guest's page does not show this yet.** The route lands with its acceptance
conditions and a run step, and the page that renders it is the next change — the
same decomposition as the write, where `POST /tables/:code/orders` shipped one
commit before the page that sends it. Until then the tree holds a path no client
calls.

It shows it from
[ADR 0027](0027-show-the-tables-orders-on-the-guests-page.md), which is that
change. Two things there follow from this record and are worth finding from here.
The window becomes a sentence a guest reads, in a workspace that cannot import
the constant it restates — so a window moved here leaves that page saying
something untrue, and the page names this file rather than the other way round.
And the page does not poll, because the bound above is on what one photograph of
a placard reaches, not on how often it is asked for.
