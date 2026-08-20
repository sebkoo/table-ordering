# 0014. Print a table's own code, and make it the guest's URL

- **Status:** accepted
- **Date:** 2026-08-20

## Context

The guest page has been reached at `/r/<slug>` since ADR 0009, which recorded
that "the restaurant's slug comes from the URL, `/r/<slug>`, so one build serves
every restaurant" and described a guest who "arrives from a code on a table".
Nothing has made that code exist. `apps/guest/src/main.tsx` has said "a table's
code points at `/r/<slug>`" — a restaurant's address standing in for a table's.

Two constraints force the shape rather than leave it to taste.

The first is that a printed code is not revisable. It goes onto a card, a sticker
or an etched plate, and changing it means walking the room. Whatever the URL
becomes is what a restaurant carries for years, so its failure modes have to be
chosen now and not discovered later.

The second is that this URL will later be the thing that attaches an order to a
table. Today the page is read only and a wrong address costs a guest a wasted
scan. Once a code names where the food goes, an address anyone can construct is
an order anyone can place on someone else's table — and by then the cards are
printed.

What a table session is here is also a product question, and AGENTS.md has
already answered part of it: the product keeps what a paper menu is, "fast,
shared, anonymous, and needing no app download". A table is shared by whoever
sits at it and nobody signs in, so what is identified is the furniture, not a
person and not a visit.

## Decision

A table has its own code, and the guest's address is `/t/<code>`. The code is
the whole of it: no restaurant slug, no table number, one segment.

`GET /tables/:code/menu` resolves the code and answers with the restaurant, the
table's label and the menu. `/r/<slug>` is kept beside it as a restaurant's menu
with no table in it; ADR 0009's "one build serves every restaurant" is unchanged,
and its sentence about the slug in the URL gains a second entry path rather than
losing its own.

Four properties of the code, each load-bearing:

**It is a literal, supplied when the row is written.** Not a column default and
not generated in SQL. A value the database invents differs in every environment,
which leaves a test with no known code to open and a printed card with no way to
be reproduced.

**It is unique across restaurants, not within one.** The address has no other
segment to disambiguate it, so uniqueness has to hold globally. The unique index
says so.

**It is not derived from the label.** A table renamed from 7 to 12, or a
restaurant renamed altogether, leaves the code valid and the card in place. The
label is data the page renders; the code is the address.

**It is not a secret, and holding it authorises nothing.** A string printed on a
table in a public room cannot be a capability. It is opaque so that it cannot be
guessed from another table's, which is a different property from being
confidential, and whatever later lets a guest send an order has to establish that
right itself rather than infer it from possession of a code.

No sitting is stored. The row that would group one visit's orders has no reader
until orders exist, so this slice writes nothing at runtime: table rows arrive
the way restaurant rows do, as SQL somebody runs. The word "session" in the
roadmap resolves here to the table's identity, and the sitting lands with order
submission.

One query in the system is not scoped by a restaurant: the one that resolves a
code, because it is the query that finds the restaurant. The scope arrives with
its first join and holds from there on — the items come from the table row's
`restaurant_id` and never from anything the caller sent. AGENTS.md records this
as an invariant rather than leaving it as an exception a reader has to notice.

## Rejected alternatives

- **`/r/<slug>/t/<label>`.** Readable, typeable, and it keeps the restaurant in
  the address where every query is naturally scoped by the URL. It was rejected
  on the two things a printed code cannot survive. A rename kills every card in
  the building and a renumber kills that card, while a code that names nothing
  survives both. And it is enumerable: `/t/7` invites `/t/8`, and any slug
  invites any number. That costs nothing while the page is read only and costs
  someone else's order the moment a code names where food goes.
- **`/r/<slug>/t/<code>`.** The closest call. It leaves ADR 0009's sentence
  untouched, and it puts the tenant in the URL, so a scoped query needs no
  exception recorded. It loses because it still dies on rename-and-reprint, and
  the legibility it buys is legibility the card already provides: the card can
  print "The Blue Door, Table 7" beside a code that says neither.
- **A sitting minted when a guest arrives.** The literal reading of "table
  session", and the shape the later slices want. It was rejected because it is a
  row written here and read by nothing until order submission exists, and because
  it would make this the first write path in the repository — pulling the
  row-level-security work forward, one commit after that work was split onto its
  own roadmap row precisely because a write path is where a wrong scope corrupts
  rather than leaks.
- **A signed token in the URL.** It would let the server reject a code it never
  issued without a lookup, and it would let codes expire. Rejected because a
  secret printed on a table in a public room is not a secret, so the signature
  proves only that the card is genuine, and rotating the key reprints every card
  in the building.
- **A generated default for the code — `gen_random_uuid()` or `gen_random_bytes`.**
  It would make unguessability structural instead of conventional, which is the
  strongest argument against the decision above. Rejected because the value then
  differs in every environment: the acceptance conditions would have to read back
  the code they just created rather than open a code they know, and a card could
  not be reprinted from anything but the database.
- **Redis for the table's session.** ADR 0002 left "what each one holds" to the
  commit that first needs it, and this is where that question would fall due if
  anything ephemeral existed. Nothing does: a table is furniture, it carries an
  invariant, and nothing can rebuild it, which is that record's own description of
  the store of record. Redis stays unused for another commit, and the decision it
  deferred stays deferred rather than being answered by silence.

## Consequences

A code cannot be revoked without reprinting the card it is on. Retiring a table
means deleting the row, and every card carrying that code stops working at once,
which is the intended behaviour and is also the only lever there is.

Unguessability lives in how a code is minted and nowhere else. The route's
pattern admits `table001`; the schema has no opinion. The README's run step is
the only place in the repository that carries the property, which is why it
prints an opaque literal and names the command that produced it.

The not-found state on the guest page cannot name a restaurant, because a table's
address does not carry one. That is a constraint on wording, not a defect: the
page tells a guest the address is not in use and points them at a person.

Two response schemas now describe the same menu, one with a table and one
without, and two static queries read the same rows by different keys. Neither is
the composition problem ADR 0008 named as the trigger for a query builder, and
neither is a disagreement between a schema and a type as ADR 0007 named for a
type provider. Both records' premises are one route and one query larger than
they were.
