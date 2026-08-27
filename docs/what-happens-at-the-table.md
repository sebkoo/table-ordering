# What happens at the table

This is the README's "What happens at the table", moved here whole by
[ADR 0041](adr/0041-move-the-depth-under-the-rules-sight.md). Nothing in it
changed except the eight record links and the one sentence that pointed at a
section below it, both of which are addressing rather than content.

## Today

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
([ADR 0026](adr/0026-read-a-tables-open-orders-by-its-printed-code.md)).

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
([ADR 0023](adr/0023-mint-a-submission-id-per-send.md)).

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
([ADR 0027](adr/0027-show-the-tables-orders-on-the-guests-page.md)).

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
([ADR 0029](adr/0029-verify-a-staff-credential-and-carry-a-session.md)).

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
([ADR 0030](adr/0030-read-the-restaurants-open-orders-from-the-staff-session.md)).

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
([ADR 0034](adr/0034-clear-a-ticket-by-recording-when-it-was-served.md)).

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
([ADR 0036](adr/0036-record-a-round-as-paid-and-gate-nothing-on-it.md)).

The board's own list does not keep a ticket until it is settled. If it did, a
restaurant that records no payments would watch nothing ever leave, which is the
option becoming a requirement. So "open" still means recent and not yet served,
and the row carries what it knows about payment beside the control that records
one.

The address itself takes no window and no served clause. Those bound what the
board *discloses*, not what may be written down: a round settled when the plates
were cleared was settled, and by then its ticket had left the board. What that
costs is stated in [the limitations](known-limitations.md) — no page path reaches
a served ticket, and settling a whole table in one act waits on the sitting.

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
([ADR 0031](adr/0031-show-the-board-on-a-page-staff-sign-in-to.md)).

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

## Next

1. The list on the guest's page will keep itself current, so a round sent from
   another phone at the same table appears without anyone reloading.
2. The board will keep itself current the same way, and will say how long a
   ticket has waited — the field for that is deliberately not on the answer yet.
3. A sitting: the row a restaurant actually settles a bill across, which is what
   the window above is standing in for and what a bill-level act waits on.
