# 0023. Mint a submission id per send, and keep it until the API answers

- **Status:** accepted
- **Date:** 2026-08-21

## Context

`POST /tables/:code/orders` takes a submission id from whoever is sending and
makes a repeat of that id one order: `unique (restaurant_id, submission_id)` with
`insert ... on conflict do nothing`, answering the second send `201` with the
first send's order id and writing nothing further (ADR 0021).

That is a guarantee about a repeat, and it is silent about what a repeat is. The
client decides that, and the decision is not visible in any status code. If one
id named a guest's whole visit, their second round would carry the first id, the
API would answer with the first order, and the second round's food would never be
written — a real order id, a `201`, and nothing anywhere to notice. If one id
names a single send, a send whose answer was lost can be repeated exactly and a
new round gets a new order.

What is true and forces the choice:

- A guest orders on their own phone, over a restaurant's wifi. A send that times
  out is not a send that failed, and the guest cannot tell the two apart. They
  will retry, and many of them will reload the page first.
- The guest page is the first client. It is not the last: a second device at the
  same table, and a kitchen board that drops off the network and reconnects, are
  both on the roadmap, and both will retry.
- Nothing reads an order. There is no route that answers "did this land", so a
  client cannot ask, and a reloaded page has only what it stored.
- The API refuses a submission id that arrives at a different table with `409`,
  because answering it with the existing order would hand a guest at one table a
  confirmation for food going to another.

## Decision

**One id names one send.** It is minted when the guest sends, stored with the
lines it was minted for, and retired as soon as the API answers — whatever it
answers. A second round mints a fresh one.

**It lives in `sessionStorage`, keyed by the table's printed code.** It has to
outlive a reload, because a guest whose send is in doubt reloads. It must not
outlive the visit: a pending submission found by the same phone at the next meal
would offer to send food nobody is waiting for. A tab is the closest thing the
platform has to one visit. Keying it by the code is what stops a guest who moves
tables from carrying an id to a table it does not belong to.

**While a send is unresolved the choices are frozen, and the pending is retried
as written.** An unresolved send may have reached the server, so minting a new id
for edited lines would order everything twice. A guest who wants neither closes
the tab, which takes the stored submission with it.

**An answer resolves the send, including a refusal.** On any 4xx nothing was
written at that table — a 404 and a 422 roll back, and a 409 leaves the other
table's order untouched — so there is no outstanding send for a new id to
duplicate. The pending is retired and the page stays orderable, which is what
lets a guest whose item came off the menu drop it and send the rest.

**The id is minted from `crypto.getRandomValues`, never `crypto.randomUUID`.**
`randomUUID` is exposed only in a secure context. This is software a restaurant
hosts itself, and a server on the room's own network over plain HTTP is the
likeliest first deployment — where the menu would load, the guest would choose,
and the send would die. There is no fallback between the two, because a second
path that only the other kind of origin takes is a path nothing runs. It is a
UUID rather than a shorter token because the schema decides: `submission_id` is
`uuid` and the route admits only the hyphenated hex shape.

**Possession of the printed code is the whole authorisation, and ADR 0014's
clause on that is superseded.** That record said whatever later lets a guest send
an order "has to establish that right itself rather than infer it from possession
of a code". Nothing does. The route accepts a send from anyone holding the code
and the page adds no right of its own, which is how a paper menu on a table
works: anyone sitting in the room may order at the table they are sitting at. The
conditions that would reopen it are named rather than left implicit — an order
that moves money, or a code that stops being printed in public view.

## Rejected alternatives

- **`localStorage`.** It survives a reload as well, and it survives a closed tab,
  which is the case a phone in a pocket produces. That is exactly the problem: a
  pending submission outliving the visit offers a later guest — or the same guest
  at a later meal — an order nobody is waiting for. `sessionStorage` gives up a
  deduplication to avoid a wrong order.
- **The URL.** It needs no storage API, survives a reload for free, and is
  visible for debugging. Rejected because a URL is shared: a guest who forwards
  the link hands somebody else their submission id, and the address a printed card
  carries stops being the whole of what a table has.
- **In memory, minted again after a reload.** The simplest thing that works while
  nothing goes wrong. It loses precisely the case the id exists for — the guest
  who reloads because their send is in doubt then sends a new id, and an order
  that did land is ordered twice.
- **One id per visit, minted once when the page opens.** Fewer moving parts and no
  retirement rule. It makes every round after the first unrecordable: the API
  answers the second round with the first round's order and writes none of it.
- **A server-minted id, returned before the order is sent.** It cannot be
  forgotten by a client and needs no storage. It destroys what the id is for: an
  id fetched again on retry is a different id, so a retry becomes a second order,
  which is the failure `on conflict do nothing` exists to prevent.
- **A hash of the lines as the key.** ADR 0021 rejected this at the API and the
  client's reason is the same one from the other side: a table ordering the same
  round twice is a real thing that happens, and a hash makes it indistinguishable
  from a resend.
- **Resending a pending submission automatically when the page loads.** It would
  close the loop without the guest doing anything. Rejected because a guest who
  put their phone down and came back has not asked for their order to be sent, and
  a page that sends on load takes that decision from them.
- **A terminal state for a refused send.** Smaller: a refusal ends the page's
  usefulness and says so. It strands a guest whose item came off the menu with a
  page that can order nothing else, when nothing was written and there is nothing
  to protect.

## Consequences

**A guest who opens the printed code a second time can produce two orders for one
round.** A second opening does not share the first's storage, so it mints its own
id. That is indistinguishable from a table ordering the same round twice, which
is why no client can decide it and why nothing here tries to.

**`409` is unreachable from this page.** The stored id is keyed by the table's
code, so it cannot travel to another table. The status is still handled, because
this is not the last client, but no condition claims a path to it and none is
built.

**A page cannot tell a guest which item was refused.** The route's 422 says an
item on the order is not on that menu, not which one, so the page says the menu
may have changed and points at a member of staff.
