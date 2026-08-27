# Table-side ordering for restaurants

Self-hosted table-side ordering, built in the open under AGPL-3.0. A guest opens
the code printed on their table, sees the menu, and sends a round to the kitchen
from the page — no app to install, and no request to any origin but the one that
served it.

**Status:** 2026-08-27 · a member of staff signs in on a page of their own,
reads every open order in their restaurant, records a round as paid for, and
clears a ticket from the board when the kitchen has served it.

[![CI](https://github.com/sebkoo/table-ordering/actions/workflows/ci.yml/badge.svg)](https://github.com/sebkoo/table-ordering/actions/workflows/ci.yml)

[![The Blue Door's menu on a guest's phone: the restaurant's name, the table's label beneath it, then each item with its price and a box for how many. Below the send button the page says the order is with the kitchen, and under that is what this table has already sent, each round with its quantity and no price beside it.](docs/images/guest-page-order-placed.png)](https://github.com/sebkoo/table-ordering/releases/tag/v0.1.0)

*The guest's page, captured at `a8f828f`. The picture links to the `v0.1.0`
release, whose one asset is a 32 s take of the whole loop — a guest sends a
round, a member of staff signs in, and the round is on the board — produced by
`tools/record-demo.ts`.*

## Why

Every table-ordering product I looked at wanted a percentage of card volume, a
tablet on every table, or both — and most of what they were charging for was a
menu on a screen. The menu is not the hard part. The hard part is making one
guest's order survive a retry, a dropped signal, and a kitchen screen that
somebody else is updating at the same moment. That is worth building carefully,
and it is worth being able to run yourself.

## Run it

Requires Node 24 (see `.nvmrc`), pnpm, and Docker for PostgreSQL.

```sh
git clone https://github.com/sebkoo/table-ordering.git
cd table-ordering
pnpm install
docker compose up -d
```

PostgreSQL is published on host port 55432 rather than 5432, so that it comes
up beside whatever PostgreSQL you already run. If 55432 is taken, change it in
`compose.yaml` and set `DATABASE_URL` to match.

Create the schema. There is no migration runner yet, so this is `psql` reading
each migration in turn, on a database that has had none of them —
re-applying one raises `relation already exists`, and nothing is applied —
the loud failure the absence of a runner rests on. `--single-transaction` is
not optional: without it `psql` commits each statement as it goes, and a file
that failed halfway would leave the half behind
([ADR 0015](docs/adr/0015-apply-the-second-migration-by-hand.md)):

```sh
for m in services/api/migrations/*.up.sql; do
  docker compose exec -T postgres \
    psql -U table_ordering -d table_ordering --single-transaction < "$m"
done
```

Give it a restaurant to serve, and a table to sit at. There is no admin route
yet either. The code is the address the table's card will carry, so mint it
rather than choose it — `openssl rand -hex 6` produced the one below — and do
not name the table in it.

The flag is not optional here either, and it buys more than it does above.
`restaurant` and `restaurant_table` each carry a unique constraint that stops a
second run; `menu_item` carries none. Without `--single-transaction` a repeated
run therefore leaves the item behind on its own, duplicated, while the two
inserts around it fail — and `psql` exits 0 having reported the failures on
stderr and nothing about what it kept:

```sh
docker compose exec -T postgres \
  psql -U table_ordering -d table_ordering --single-transaction <<'SQL'
insert into restaurant (slug, name) values ('blue-door', 'The Blue Door');
insert into menu_item (restaurant_id, name, price_minor, currency, sort_order)
select id, 'Flat white', 300, 'GBP', 10 from restaurant where slug = 'blue-door';
insert into restaurant_table (restaurant_id, code, label)
select id, '9f3c1a7b20de', 'Table 7' from restaurant where slug = 'blue-door';
SQL
```

Then start the API and ask it for that table's menu:

```sh
pnpm dev
curl -s localhost:3000/tables/9f3c1a7b20de/menu
```

```json
{"restaurant":{"slug":"blue-door","name":"The Blue Door"},"table":{"label":"Table 7"},"items":[{"id":"8f14e45f-ceea-467a-9f0b-2c2e0a3f7c31","name":"Flat white","priceMinor":300,"currency":"GBP"}]}
```

## What's here

The roadmap below is complete — every row Done — and the depth is under it or
one link from it: what happens at the table, how a request is served, the run
steps in full, the decisions in [`docs/adr/`](docs/adr/), and the limitations in
[`docs/known-limitations.md`](docs/known-limitations.md).

A moving picture of the loop is produced by `tools/record-demo.ts`. The producer
is in this tree; what it emits is not.

## What it looks like

The pages, and the loop between them: a guest sends a round from the table, a
member of staff signs in, and the round is on the board. Each picture is a
capture of the running product, and its caption names the revision it was taken
at.

![The board's sign-in on a wider screen: a field for an email address, a field for a password whose characters the browser has replaced with dots, and a button to sign in.](docs/images/staff-sign-in.png)

*The board's sign-in, captured at `a8f828f`. What was typed into the password
field is masked by the browser, and no value from it is in the picture.*

![The open-orders board on a wider screen: the heading, the name of whoever is signed in and the restaurant they work at beneath it, then a row per ticket with the table on the left and what was ordered beside it, oldest at the top.](docs/images/staff-board.png)

*The board, captured at `0fe409d`.*

## What happens at the table

### Today

The API serves a restaurant's menu:

```
GET /restaurants/blue-door/menu
```

```json
{
  "restaurant": { "slug": "blue-door", "name": "The Blue Door" },
  "items": [
    { "id": "8f14e45f-ceea-467a-9f0b-2c2e0a3f7c31", "name": "Flat white", "priceMinor": 300, "currency": "GBP" },
    { "id": "c9f0f895-fb98-4b3f-a4d4-7f0a1f1a2b3c", "name": "Cinnamon bun", "priceMinor": 450, "currency": "GBP" }
  ]
}
```

Each item carries an id, because an order has to name a line by something and a
name is not unique within a restaurant. It identifies a row and authorises
nothing.

Items the restaurant has marked unavailable are left out, and the rest come
back in the order the restaurant chose. Prices are an integer count of the
currency's minor unit: 300 GBP is three pounds.

A slug no restaurant uses is answered `404`. A restaurant whose items are all
unavailable is answered `200` with an empty list — a guest sitting in a real
restaurant that has sold out is not a guest at a restaurant that does not
exist.

Each table carries its own code, and that code is the whole of the address a
card prints:

```
GET /tables/9f3c1a7b20de/menu
```

```json
{
  "restaurant": { "slug": "blue-door", "name": "The Blue Door" },
  "table": { "label": "Table 7" },
  "items": [
    { "id": "8f14e45f-ceea-467a-9f0b-2c2e0a3f7c31", "name": "Flat white", "priceMinor": 300, "currency": "GBP" }
  ]
}
```

The code names one table, the table names one restaurant, and the menu follows
from that — so a guest never types a restaurant's name and the card never
carries one. It is opaque rather than `blue-door/7` because a printed code
cannot be revised: a rename would kill every card in the building, and a
number anyone can count to is an address anyone can construct, which costs
nothing today and costs someone else's order once a code says where the food
goes. It is not a secret, though. It is printed on a table in a public room,
and holding it authorises nothing.

That table can also be ordered at:

```
POST /tables/9f3c1a7b20de/orders

{
  "submissionId": "6c2e1b40-9f3a-4d2e-8a1b-5f7c9e0d3a24",
  "lines": [{ "menuItemId": "8f14e45f-ceea-467a-9f0b-2c2e0a3f7c31", "quantity": 2 }]
}
```

```json
{ "order": { "id": "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed" } }
```

The submission id is minted by whoever is sending, and it is what makes a resend
one order rather than two: send it again from a flaky connection or a second tab
and the answer is the same `201` with the same order id, and nothing further is
written. Send the same submission id at a *different* table and it is refused
`409` — that is a collision, not a retry, and answering it would hand a guest at
one table a confirmation for food going to another.

A line naming an item that is not on that restaurant's menu is refused `422` and
nothing at all is written, not even the lines that were fine. A code no table
uses is `404`, as it is for the menu.

That table can also be read back:

```
GET /tables/9f3c1a7b20de/orders
```

```json
{
  "orders": [
    { "id": "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", "lines": [{ "name": "Flat white", "quantity": 2 }] }
  ]
}
```

The orders placed at that table in the last two hours, each with what was
ordered and how much of it. A table nobody has ordered at is `200` with an empty
list; a code no table uses is still `404`.

Holding the code is the whole of what that asks for, as it is for the menu and
for sending an order — so what it reaches is bounded in time rather than by a
secret. Two hours is a meal in progress rather than a record of the table, and
it is a proxy for a sitting rather than a substitute for one
([ADR 0026](docs/adr/0026-read-a-tables-open-orders-by-its-printed-code.md)).

A guest opens `/t/9f3c1a7b20de` on their phone and gets that menu as a page:

```
The Blue Door
Table 7

Flat white                                        £3.00      [ 2 ]
Cinnamon bun                                      £4.50      [ 0 ]

                 [ Send to the kitchen ]

Sent from this table
  2 × Flat white
  1 × Cinnamon bun
```

`/r/blue-door` still answers with the same menu and no table, for a restaurant
that wants to put its menu on a link.

A fresh load of that page asks for nothing but its own origin. No font, script,
image, analytics or beacon from anywhere else — and what says so is not a
promise in this file, it is a browser test that loads the built page and
inspects every request it made.

**The page sends it.** A guest raises the quantity on the rows they want and
sends, and what leaves the page is exactly the request above. The submission id
is the page's: minted when the guest sends, kept in `sessionStorage` under that
table's code while the send is unresolved, and retired the moment the API
answers. So a guest who reloads because they are not sure it went through sends
the *same* submission again rather than a second one, and a guest who orders a
second round gets a second order
([ADR 0023](docs/adr/0023-mint-a-submission-id-per-send.md)).

A send the network refuses says so and offers to try the same submission again.
A send the API refuses — an item that came off the menu while the guest was
choosing — says the menu may have changed and leaves the page orderable, because
nothing was written.

**The page shows it back.** Under the button is what has already been sent from
that table, one row per round, read from the address above. It is the table's
list and not this phone's: a round a friend sent from their own phone is on it,
which is what makes it an answer to "did that go through" rather than a memory of
what this browser did.

It carries no prices. An order records none, so the only price available is the
menu's current one, which is the wrong number for an order placed before it
moved.

It asks when the page opens and again when a send from that page lands, and on
no other occasion — no polling, because the code is printed in a public room and
what one photograph of it reaches is bounded by that window rather than by how
often it is asked for. So a round sent from another phone appears when this one
sends or is reloaded, and not before.

A table with nothing on it says so in as many words, and so does a read that
failed — and they are different sentences. A page that showed an unreachable
API as an empty table would tell a guest their food is not with the kitchen,
which is the one thing it must never say wrongly
([ADR 0027](docs/adr/0027-show-the-tables-orders-on-the-guests-page.md)).

Nothing is written when a guest *arrives*, either. A table is a row in the
schema, not a record of anyone's visit, and there is still no sitting: what
groups an order is the table it was placed at and the time it was placed.

An address the page cannot serve says which kind it is. A code no table uses,
and a code the address cannot hold at all, both send the guest to a member of
staff — asking again will not help either one. A menu that cannot be fetched
says to try again instead.

**Staff sign in for themselves.** A restaurant mints a credential for each
member of staff, and signing in answers who they are and where they work:

```
POST /staff/sessions

{ "email": "ada@blue-door.example", "password": "the one the mint printed" }
```

```json
{
  "token": "…",
  "staff": { "name": "Ada" },
  "restaurant": { "slug": "blue-door", "name": "The Blue Door" }
}
```

The token is what the next request carries, in an `authorization: Bearer`
header, and `GET /staff/sessions/current` answers the same identity for it. It
is never in a path or a query string, because those are written into every proxy
log between the client and here.

Nothing in either request names a restaurant, and nothing may. Which restaurant
a staff request reaches follows from the row the credential resolved to, so a
credential minted for one restaurant cannot be pointed at another — the same
construction that makes a printed code safe, applied to a person
([ADR 0029](docs/adr/0029-verify-a-staff-credential-and-carry-a-session.md)).

A wrong password and an address no staff member uses get the same answer, and
take the same work to produce: an API that told them apart would answer "does
this person work here" for anybody who asked. The password itself is stored
nowhere. What the row holds is a key derived from it with `scrypt`, carrying the
parameters it was derived under so they can be raised later without invalidating
anybody's row.

**And they see what their restaurant has ordered.** That token is the whole of
what the board asks with:

```
GET /staff/orders
authorization: Bearer …
```

```json
{
  "orders": [
    { "id": "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
      "table": { "label": "Table 7" },
      "paid": false,
      "lines": [{ "name": "Flat white", "quantity": 2 }] }
  ]
}
```

Every open order in that restaurant, oldest first, each naming the table it was
placed at. Which restaurant is not in the request and cannot be: it is the one on
the row the session resolved to, and every statement after that resolve is scoped
by the policy rather than by the query
([ADR 0030](docs/adr/0030-read-the-restaurants-open-orders-from-the-staff-session.md)).

It carries the table's label and never the table's code. The code is what a guest
orders with; the board has no reader for it, and a value that authorises a write
does not travel where nothing reads it. `paid` is a boolean rather than a moment,
for the reason there is no time on the answer at all: what a row needs is whether
the control that records a payment still belongs on it.

Open here means recent **and not yet served**. That second half is what the
kitchen presses:

```
POST /staff/orders/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed/served
authorization: Bearer …
```

```
204
```

No body going in and no body coming back. There is nothing a caller may say
about the act beyond which ticket it is for — an address that took a field would
be one that could take `false`, and putting a ticket *back* on a board is a
different question nobody has asked yet. The ticket leaves the board, and the
order records the moment it went.

Press it twice and the second answer is the first answer, byte for byte, and the
recorded moment does not move. Two kitchen screens showing one ticket is the
ordinary case, and the second person to press should not be shown an error for
something that did happen — the same reasoning that makes a resent order one
order.

A ticket in another restaurant, and an id no order ever carried, are refused
`404` **with the same body**. That is the point rather than a tidiness: a message
naming the id would tell a caller that a ticket they cannot see exists somewhere.
Which restaurant a session may clear in is not in the request and cannot be
([ADR 0034](docs/adr/0034-clear-a-ticket-by-recording-when-it-was-served.md)).

**And a round can be recorded as paid for.** The second control on a row, at an
address shaped like the first:

```
POST /staff/orders/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed/paid
authorization: Bearer …
```

```
204
```

No body either way, a repeat answers as the first act did and moves nothing, and
a ticket in another restaurant gets the same `404` in the same bytes. It is the
clearing act with one column changed, because it is the same shape.

What it records is a moment and not money. No amount, no currency, no card and
no processor: routing a self-hosted restaurant's guests through somebody else's
checkout is what "no third-party requests" rules out, so what this offers is a
fact to record rather than a flow to run. An amount would be a ledger, and a
ledger is a decision nobody has needed yet.

**Nothing is gated on it**, which is what the roadmap row's "rather than a
requirement" means here. Ordering does not consult it, the guest is never told —
their own list answers the same bytes before and after — and a ticket still
leaves the board on `served` alone. A restaurant that never presses it behaves
exactly as it did before the column existed, and that is pinned by a condition
rather than promised in this file
([ADR 0036](docs/adr/0036-record-a-round-as-paid-and-gate-nothing-on-it.md)).

The board's own list does not keep a ticket until it is settled. If it did, a
restaurant that records no payments would watch nothing ever leave, which is the
option becoming a requirement. So "open" still means recent and not yet served,
and the row carries what it knows about payment beside the control that records
one.

The address itself takes no window and no served clause. Those bound what the
board *discloses*, not what may be written down: a round settled when the plates
were cleared was settled, and by then its ticket had left the board. What that
costs is stated in the limitations below — no page path reaches a served ticket,
and settling a whole table in one act waits on the sitting.

The guest's own list is deliberately unchanged. A guest is asking whether their
round reached the kitchen, and that stays true after the kitchen has cooked it;
a page that emptied itself the moment a ticket was picked up would send the one
guest most likely to act on it to order the same round again. So "open" names two
questions of the same rows, and one window still bounds both.

**And the board is a page.** Staff open a page of their own and sign in:

```
Open orders
Ada · The Blue Door

Table 7        2 × Flat white
Table 8        1 × Cinnamon bun
```

The page holds the token and nothing else. It asks `GET /staff/sessions/current`
who that token names rather than remembering what the sign-in answered, so the
name written over the board and the board itself are answers about the same
session rather than one answer and one memory.

That token lives in the page's memory. Not in a cookie, not in storage, not in
the address bar, and not in an attribute — so a reload signs staff out, and
closing the tab is the only close there is. What says the token is nowhere else
is not a promise in this file: it is a browser test that reads the rendered
document, both storages, the cookie jar and the address bar, and looks for the
value the page really carried
([ADR 0031](docs/adr/0031-show-the-board-on-a-page-staff-sign-in-to.md)).

A refused sign-in is shown in the API's own words rather than in wording this
repository invented. A session refused at the board sends staff back to the form,
because the remedy is signing in again; a board that could not be read says that
instead, and the session survives. And a restaurant with nothing open says so in
its own sentence — an empty board is a fact about a restaurant, and the other
three are the page not knowing.

Each row carries the control that clears it, and — while the round is unpaid —
the control that records a payment. The second disappears once the round is
recorded, because a button whose press the server answers by writing nothing is
a button that lies about having something to do; the row says which it is either
way. Pressing either one sends the request above
and then asks the board again, so the ticket leaves because the server says it
has rather than because the page struck the row out — a list the page edited
would be a second account of the queue, and the two would drift the first time an
act half succeeded. An act that does not land says so and leaves the board
readable, because blanking it would tell a kitchen its other tickets were gone on
the strength of one button. An act refused with a `401` is the session ending and
sends staff back to the form, exactly as a refused read does.

It asks when a session opens, and again when an act from that page lands. An
order placed in between appears at the next act or the next sign-in, for the
reason the guest's list does not poll either.

That page asks for nothing but its own origin, and a browser is what says so —
the same condition the guest's page carries, now written as an invariant about
any page this repository serves rather than about one of them.

### Next

1. The list on the guest's page will keep itself current, so a round sent from
   another phone at the same table appears without anyone reloading.
2. The board will keep itself current the same way, and will say how long a
   ticket has waited — the field for that is deliberately not on the answer yet.
3. A sitting: the row a restaurant actually settles a bill across, which is what
   the window above is standing in for and what a bill-level act waits on.

## How a request is served

Two paths through the code, and both are one transaction of the same shape: the
printed code resolves to a restaurant, the scope is set on that transaction from
the row the resolve returned, and every statement after it names no restaurant at
all. The diagrams that trace the menu read and the order write layer by layer —
route, transaction, policy, PostgreSQL, and what each one answers — are in
[`docs/how-a-request-is-served.md`](docs/how-a-request-is-served.md).

## Roadmap

Every row is Done. That is a statement about this list and not about the
product being finished: the list is what was planned when it was written.

| Step | State |
| --- | --- |
| Toolchain, convention checks, CI | Done |
| Tenant schema | Done |
| Guest menu, over HTTP | Done |
| A page the guest's phone loads | Done |
| A table's own code, on the guest's page | Done |
| Order submission over HTTP, tolerating retries | Done |
| Row-level security on a write, so scope is not the query's job | Done |
| The guest's page sends the order | Done |
| A table's own orders, read back under the policy | Done |
| The guest's page shows what the table has sent | Done |
| A member of staff can prove who they are | Done |
| The restaurant's open orders, read under a staff session | Done |
| The board on a page staff sign in to | Done |
| Row-level security on a read, so a menu query drops its scope too | Done |
| A kitchen board a ticket can be acted on from | Done |
| Payment, as an option rather than a requirement | Done |

## Run it in full

The rest of the walkthrough: the role the API connects as, ordering and reading
back with `curl`, a member of staff, the two pages, and what the checks do.

The API connects as `table_ordering_app`, not as `table_ordering`. The migration
above creates that role and grants it `usage` on the schema, which is why there
is no step here for it. Against a schema that predates that migration the
connection still succeeds and the query does not: with no `usage`, the schema
drops out of the role's `search_path` and PostgreSQL answers `relation
"restaurant" does not exist`, which reads like a missing table and is a missing
grant.

Order from that menu, taking the item's id out of what it just answered and
minting a submission id the same way the table's code was minted:

```sh
item=$(curl -s localhost:3000/tables/9f3c1a7b20de/menu | sed 's/.*"items":\[{"id":"\([^"]*\)".*/\1/')
submission=$(uuidgen | tr 'A-Z' 'a-z')

curl -s -X POST localhost:3000/tables/9f3c1a7b20de/orders \
  -H 'content-type: application/json' \
  -d "{\"submissionId\":\"$submission\",\"lines\":[{\"menuItemId\":\"$item\",\"quantity\":2}]}"
```

```json
{"order":{"id":"1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed"}}
```

Run that second command again with the same `$submission` and it answers the
same id, and the order is still one order with one line. Change
`9f3c1a7b20de` to another table's code while keeping `$submission` and it
answers `409`.

Read that table's orders back:

```sh
curl -s localhost:3000/tables/9f3c1a7b20de/orders
```

```json
{"orders":[{"id":"1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed","lines":[{"name":"Flat white","quantity":2}]}]}
```

Anything placed more than two hours ago is not in that list.

Give that restaurant a member of staff. There is no admin route for this either,
and the password is minted rather than chosen, for the reason the table's code
was. The mint prints the credential to be stored on standard output and the
password on standard error, so the password appears on your terminal and reaches
no pipe and no shell history — it is stored nowhere and cannot be recovered from
what is:

```sh
credential=$(node --disable-warning=ExperimentalWarning \
  services/api/src/features/staff/credential.ts)
```

```sh
docker compose exec -T postgres \
  psql -U table_ordering -d table_ordering --single-transaction <<SQL
insert into staff (restaurant_id, email, name, credential)
select id, 'ada@blue-door.example', 'Ada', '$credential' from restaurant where slug = 'blue-door';
SQL
```

Then sign in as them, pasting in the password it printed:

```sh
curl -s -X POST localhost:3000/staff/sessions \
  -H 'content-type: application/json' \
  -d '{"email":"ada@blue-door.example","password":"THE PRINTED PASSWORD"}'
```

```json
{"token":"...","staff":{"name":"Ada"},"restaurant":{"slug":"blue-door","name":"The Blue Door"}}
```

Take the token out of that and ask who is holding it:

```sh
curl -s localhost:3000/staff/sessions/current -H 'authorization: Bearer THE TOKEN'
```

A password that is not that one, and an address no staff member uses, both
answer `401` with the same body.

The same token reads the board, which is every open order in Ada's restaurant and
no other restaurant's:

```sh
curl -s localhost:3000/staff/orders -H 'authorization: Bearer THE TOKEN'
```

```json
{"orders":[{"id":"1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed","table":{"label":"Table 7"},"paid":false,"lines":[{"name":"Flat white","quantity":2}]}]}
```

Record that round as paid for, taking the id out of what the board just
answered:

```sh
ticket=$(curl -s localhost:3000/staff/orders -H 'authorization: Bearer THE TOKEN' \
  | sed 's/.*"orders":\[{"id":"\([^"]*\)".*/\1/')

curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  localhost:3000/staff/orders/$ticket/paid -H 'authorization: Bearer THE TOKEN'
```

```
204
```

Ask for the board again and that ticket is still on it, now with `"paid":true`.
Nothing left, because payment clears nothing. Run it again and it answers `204`
again and records nothing further.

Clear that ticket, with the id you already have:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  localhost:3000/staff/orders/$ticket/served -H 'authorization: Bearer THE TOKEN'
```

```
204
```

There is no body to print, which is why that reads the status code. Run it again
with the same `$ticket` and it answers `204` again and records nothing further.
Ask for the board once more and the ticket is gone, while
`curl -s localhost:3000/tables/9f3c1a7b20de/orders` still shows the guest the
round they sent.

The page a guest opens is a second process in development:

```sh
pnpm dev        # the API, on port 3000
pnpm dev:guest  # the page, on port 5173
```

Then open `http://localhost:5173/t/9f3c1a7b20de`, which is what the card on that
table would point at. `http://localhost:5173/r/blue-door` gives the same menu
with no table. The page asks for the menu at a relative path, and the guest dev
server proxies `/tables` and `/restaurants` to the API, so the two are on one
origin.

Raise a quantity on a row and send. That is the same request as the `curl`
above, under a submission id the page minted for it, and what you sent appears
under the button — the same answer as the `GET` above, without the `curl`. Send a
second round and it joins the first. Open the same address in another tab and
send from there: the round shows up on both, because the list is the table's.

The board is a page of its own, on a port of its own:

```sh
pnpm dev        # the API, on port 3000
pnpm dev:staff  # the board, on port 5174
```

Open `http://localhost:5174` and sign in as `ada@blue-door.example`, with the
password the mint printed. What you get is the same answer as the `curl` above,
without the token going anywhere near your shell history. Reload the page and you
are signed out: the token was only ever in the page.

Everything the repository checks runs in one command:

```sh
pnpm verify
```

It drives a real browser as well as a real database. Install the one the
lockfile pins, once per machine:

```sh
pnpm --filter @table-ordering/guest exec playwright install chromium
```

One command for both page suites. `apps/guest` and `apps/staff` pin the same
playwright, so they resolve to the same browser build in the same per-machine
cache; each suite is probed for in its own workspace, so if that ever stopped
being true the run would say which one could not launch.

`pnpm install` does one thing beyond fetching dependencies: it points git at
this repository's hooks by setting `core.hooksPath` to `.githooks` in your
clone. That is a change to your local git configuration, and it is what makes
the commit message check active without any manual setup step. Installing with
`--ignore-scripts` skips it, and the hook then does nothing.

`pnpm verify` reports `PASS`, `FAIL` or `SKIP` per check. A `SKIP` means the
check had nothing to evaluate, and it says so on its own line — either because
the commit it would inspect does not exist yet, or because the dependency it
needs is not on this machine.

Three of the checks need something this repository does not contain. `test-api`
talks to a real PostgreSQL. `test-guest` and `test-staff` each build a client,
serve it and load it in Chromium. Each is probed for before it runs, so a clone
with no Docker gets

```
test-api ......... SKIP  nothing is listening at 127.0.0.1:55432
```

rather than a failure that reads as though the code is broken. The tool suites
have no such dependency and run either way. Pass `--require-environment` to turn
those skips into failures — CI does, because CI provisions both, and a skip
there would mean the provisioning silently stopped working.

Each test step also says what each of its files cost:

```
test-api ......... PASS  1.2s
  services/api/src/features/menu/menu.test.ts .... 0.3s
  services/api/src/features/order/order.test.ts .. 0.4s
```

so a change that made a run slower can be attributed to the file it landed in,
rather than to a step total that a startup cost dominates. The figure is the
module's own — its collection and its hooks as well as its assertions — read
from the report vitest is asked to write beside its readable output.

Nothing fails because one of those numbers moved. There is no threshold and no
budget: a duration that can fail a build is a flaky build, and the line is worth
reading only while it means one thing
([ADR 0024](docs/adr/0024-report-what-each-test-file-cost.md)).

Everything above runs before a commit exists. What the remote holds *after* a
push is a separate question, and `pnpm check-push` asks it:

```sh
pnpm check-push --revision "$(git rev-parse HEAD)" \
  --description "Self-hosted table-side ordering for restaurants. ..." \
  --topics docker,fastify,github-actions,monorepo,pnpm,postgresql,react,rest-api,typescript,vite,vitest \
  --require-environment
```

Run against the push of `6064402`, it printed:

```
push-arrived ....... PASS  origin holds 60644025ad99c59c5d90bd8bc8309216f0b148c0
run-verified ....... PASS  run 32432461939, 12 verdict lines, all PASS, verify: 10.1s in 47s of jobs, 1 warning
metadata-declared .. PASS  the description and 11 topics are as declared
check-push: PASS
```

Each line answers a question the obvious source answers wrongly. The revision
comes from the server, not from the exit code of the push, which reports what
the client believed it sent. The run is read for the per-check lines `verify`
printed, not for its conclusion — a run whose environment-dependent checks
skipped reads `success`. And the description and topics are compared against
what you pass in rather than against a file in this repository, because a stored
copy of the expectation drifts from the real one with nothing to notice; the
repository's description and topics otherwise pass through no check at all.

The two timings come out of what the check had already fetched. `verify`'s own
elapsed figure is in the log that is read to count those verdict lines, and the
job's duration is one call from the run that was already found. Both were being
looked up by hand after every push.

The warning count is not free in that way. It belongs to a check run rather than
to a workflow run, so it costs a request per job, asked by an id the job list
already carried. It is reported and never asserted against zero: the line
answers whether CI verified the revision, and a deprecation somebody else
scheduled is a different question
([ADR 0019](docs/adr/0019-report-a-runs-warnings-without-asserting-them.md)). It
reads `1 warning` above because that run predates the action bump that ended it.

It needs `gh`. Without it the last two lines skip and name what is missing, and
`--require-environment` turns those skips into failures, which is what the
commit procedure passes.

`docker compose up -d` also starts Redis. Nothing connects to it yet, and it
publishes no host port.

## Decisions

Architecture decisions are in [`docs/adr/`](docs/adr/), one file per decision,
each with the alternatives that were rejected and why.

- [0001 Record architecture decisions](docs/adr/0001-record-decisions.md)
- [0002 Pick the toolchain](docs/adr/0002-pick-the-toolchain.md)
- [0003 Choose the name: describe now, brand later](docs/adr/0003-choose-the-name.md)
- [0004 Defer each convention to the commit that creates its first subject](docs/adr/0004-defer-conventions-to-first-subject.md)
- [0005 Choose the AGPL-3.0 licence](docs/adr/0005-choose-the-licence.md)
- [0006 Keep changes small](docs/adr/0006-keep-changes-small.md)
- [0007 Serve HTTP with Fastify, and validate at the boundary](docs/adr/0007-serve-http-with-fastify.md)
- [0008 Version the schema as plain SQL migrations](docs/adr/0008-version-the-schema-as-plain-sql-migrations.md)
- [0009 Render the guest page in the browser](docs/adr/0009-render-the-guest-page-in-the-browser.md)
- [0010 Observe the guest page in a real browser](docs/adr/0010-observe-the-guest-page-in-a-real-browser.md)
- [0011 Report a check whose environment is absent as a skip](docs/adr/0011-skip-a-check-whose-environment-is-absent.md)
- [0012 Record the commit procedure as a skill, and check its mechanical half after a push](docs/adr/0012-record-the-commit-procedure.md)
- [0013 Bound the CI job in time, and take Chromium's libraries from the runner image](docs/adr/0013-bound-the-ci-job.md)
- [0014 Print a table's own code, and make it the guest's URL](docs/adr/0014-print-a-tables-own-code-and-make-it-the-guests-url.md)
- [0015 Apply the second migration by hand, and defer the runner to a named trigger](docs/adr/0015-apply-the-second-migration-by-hand.md)
- [0016 Make every run step atomic, and check the flag rather than restate it](docs/adr/0016-make-every-run-step-atomic.md)
- [0017 Check the procedure by running it, not by matching its text](docs/adr/0017-check-the-procedure-by-running-it.md)
- [0018 Pick a revision's newest run, and extract only a picking that fails silently](docs/adr/0018-pick-a-revisions-newest-run.md)
- [0019 Take the action release that ends the Node 20 notice, and report a run's warnings without asserting them](docs/adr/0019-report-a-runs-warnings-without-asserting-them.md)
- [0020 Scope a write with row-level security, carried on the transaction](docs/adr/0020-scope-a-write-with-row-level-security.md)
- [0021 Record an order as a submission with lines, and nothing else](docs/adr/0021-record-an-order-as-a-submission-with-lines.md)
- [0022 Take a check's inputs from the repository, not from the machine](docs/adr/0022-take-a-checks-inputs-from-the-repository.md)
- [0023 Mint a submission id per send, and keep it until the API answers](docs/adr/0023-mint-a-submission-id-per-send.md)
- [0024 Report what each test file cost, and assert nothing about it](docs/adr/0024-report-what-each-test-file-cost.md)
- [0025 Check the subject clauses a program can decide, and say which one it cannot](docs/adr/0025-make-the-subject-clauses-executable.md)
- [0026 Read a table's open orders by its printed code, and defer the board to a staff identity](docs/adr/0026-read-a-tables-open-orders-by-its-printed-code.md)
- [0027 Show the table's orders on the guest's page, refreshed only by a send](docs/adr/0027-show-the-tables-orders-on-the-guests-page.md)
- [0028 Check the window where it is restated, and leave the records alone](docs/adr/0028-check-the-window-where-it-is-restated.md)
- [0029 Verify a staff credential with scrypt, and carry it as a session token](docs/adr/0029-verify-a-staff-credential-and-carry-a-session.md)
- [0030 Read the restaurant's open orders from the staff session, and name the table rather than its code](docs/adr/0030-read-the-restaurants-open-orders-from-the-staff-session.md)
- [0031 Show the board on a page staff sign in to, and hold the token in memory alone](docs/adr/0031-show-the-board-on-a-page-staff-sign-in-to.md)
- [0032 Show both pages in the README as dated captures, and defer the check that would hold them](docs/adr/0032-show-both-pages-as-dated-captures.md)
- [0033 Read the menu under a policy, and split the resolve from the read](docs/adr/0033-read-the-menu-under-a-policy.md)
- [0034 Clear a ticket by recording when it was served, and leave the guest's list alone](docs/adr/0034-clear-a-ticket-by-recording-when-it-was-served.md)
- [0035 Check a suite's migration list against the directory, by two keys](docs/adr/0035-check-a-suites-migration-list-against-the-directory.md)
- [0036 Record a round as paid, gate nothing on it, and leave the bill to the sitting](docs/adr/0036-record-a-round-as-paid-and-gate-nothing-on-it.md)
- [0037 Produce the demo from a script in the tree, and publish it as a release asset](docs/adr/0037-produce-the-demo-from-a-script-in-the-tree.md)
- [0038 Order the README for a reader who scans, and move nothing out of its collectors' sight](docs/adr/0038-order-the-readme-for-a-reader-who-scans.md)
- [0039 Relocate only a section no collector reads, and link the demo from the front door](docs/adr/0039-relocate-only-what-no-collector-reads.md)
- [0040 Widen the window's sight to the documents, and move Known limitations out](docs/adr/0040-widen-the-windows-sight-to-the-documents.md)

## Known limitations

Every limitation this project knows about is written down at length in
[`docs/known-limitations.md`](docs/known-limitations.md) — what a second opening
of a printed code can do, what a table's code discloses to whoever holds it,
what the board cannot do yet, and what each convention rule is blind to. It is
the honest half of every claim above it, and it is a document rather than a
section because it was the longest block in this file and the least scannable
in place.

## Non-goals

- Replacing a restaurant's point-of-sale system.
- A delivery marketplace, or anything that puts a third party between the
  restaurant and its guest.
- An app for guests to download.
- Taking a percentage of the money that moves through it.

## Money

This platform takes zero basis points of card volume. That is a statement about
what this software charges, not a claim about what a restaurant pays overall:
the restaurant still pays its own card processor, whoever that is.

A round can be recorded as paid for, and nothing requires it. That is the whole
of what is built: a moment on the order, written by a member of staff, read by
the board and by nobody else. There is no amount, no currency and no card —
recording a fact is not handling money, and an amount would be a ledger, which
is its own decision.

Payment *handling* is not built and no processor is planned. Routing a
self-hosted restaurant's guests through somebody else's checkout is the thing
the sentence "no third-party requests" rules out, and it is the reason the
option is a fact to record rather than a flow to run
([ADR 0036](docs/adr/0036-record-a-round-as-paid-and-gate-nothing-on-it.md)).
If this ever needs to fund itself, the honest routes are hosting, support and
integration work — the same routes that are available under any licence —
rather than a cut of the till.

## Licence

AGPL-3.0-only. The full text is in [`LICENSE`](LICENSE); the reasoning, and the
licences that were rejected, are in
[ADR 0005](docs/adr/0005-choose-the-licence.md).

— Ben Koo
