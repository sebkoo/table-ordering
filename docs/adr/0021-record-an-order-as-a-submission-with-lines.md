# 0021. Record an order as a submission with lines, and nothing else

- **Status:** accepted
- **Date:** 2026-08-21

## Context

The roadmap row is "Order submission that tolerates retries", and the README has
said since the menu landed what that means: "Sending it twice, from a flaky
connection or a second tab, will produce one order rather than two, and that is
where a sitting starts being recorded."

A guest orders on a phone, in a room with the network a restaurant happens to
have. A send that times out is not a send that failed, and the guest cannot tell
the two apart. So the client will resend, and the question is not whether it does
but what the second send produces.

Everything else about an order is a guess. Nothing reads an order yet — the
kitchen board is a later roadmap row, staff visibility is later still, and payment
is deliberately outside the product's promise. Every column added now is a column
the next schema change has to carry and the next reader has to account for.

ADR 0014 left one thing due here. It rejected minting a sitting when a guest
arrives, because "it is a row written here and read by nothing until order
submission exists", and closed: "the sitting lands with order submission."

## Decision

An order is a restaurant, a table, a submission id, a time, and one or more lines
of an item and a quantity.

**The submission id is the client's, and it is what makes a resend one order.**
`unique (restaurant_id, submission_id)`, and a resend answers `201` with the same
order id as the first send. The same status and the same body both times: a client
that retries cannot act on the difference, and an API that reported one would be
inviting it to.

**A submission id arriving at a different table is refused with `409`, not
honoured.** That is a collision, not a retry. Answering it with the existing order
would be correct at the restaurant boundary and wrong at the table boundary — a
guest sitting at one table would be handed a confirmation for food going to
another, with no way to tell.

**A line carries a quantity.** Without one, three coffees is three identical rows,
the line has no natural key at all, and collapsing them becomes the kitchen's
problem later. `check (quantity > 0)` in the schema, with the upper bound at the
route's JSON Schema where ADR 0007 puts what a request may say.

**There is no sitting row.** ADR 0014's obligation is answered rather than
inherited: what that record wanted from a sitting was something to attach an order
to, and the table row already is one. A code names a table, a table names a
restaurant, and an order names both.

**There is no status, no lifecycle, and no money on the order.**

## Rejected alternatives

- **A sitting or table-session row, as ADR 0014 anticipated.** It is the shape the
  kitchen and staff views will want: one visit, several orders, a close. Rejected
  because nothing here reads it. The order already names the table and the time it
  was placed, which is everything a sitting could be reconstructed from, and a row
  that groups nothing is a row every later change has to keep true. It lands with
  the first view that can close a table.
- **A price and name snapshot on each line.** The strongest case of anything
  rejected here, and it is a one-way door: a menu price that moves leaves an old
  order unpriceable, and a name that changes leaves an old ticket unreadable. It
  is not taken now because the door costs nothing to leave open — nothing is
  deployed and there are no rows to lose — and because it is a claim about what an
  order is *for*, which the first thing that shows an order's money will be able to
  make on evidence. That trigger now carries a second reason; see Consequences.
- **No quantity, expressing two of something as two lines.** Fewer columns, and it
  is what a till roll looks like. Rejected because the aggregation has to happen
  somewhere and doing it in the kitchen view means every later reader repeats it.
- **A hash of the request body as the idempotency key, instead of a client-minted
  id.** It needs nothing from the client and cannot be forgotten. Rejected because
  it makes two genuinely separate identical orders — the same table ordering the
  same round twice — indistinguishable from a resend, which is a real thing that
  happens in a restaurant.
- **Answering a resend `200` and a first send `201`.** Conventional, and it tells
  a caller what happened. Rejected because a client that retries cannot act on the
  difference: it does not know whether its first send arrived, which is why it
  retried, and a status that varies invites it to branch on something meaningless.
- **Orders as an append-only event log.** It would make the retry question fall
  away, since appending the same event twice is detectable and nothing is ever
  updated. Rejected as a shape chosen before there is a reader: the first thing
  that reads an order is a kitchen ticket, which wants current state, and building
  the projection before the projection has a consumer is the abstraction AGENTS.md
  rules out.

## Consequences

**A menu item that has been ordered cannot be removed from the menu.** The line's
foreign key to `menu_item` has no `on delete` clause, so the action is `NO ACTION`.
Observed rather than reasoned:

```
delete from menu_item where id = ...
ERROR:  update or delete on table "menu_item" violates foreign key constraint
        "table_order_line_menu_item_id_restaurant_id_fkey" on table "table_order_line"
```

and deleting the whole restaurant is refused with the same message, because the
cascade into `menu_item` is blocked before the cascade into `table_order` can clear
the lines. For a menu that changes seasonally that bites long before anything about
money does. The repair is the snapshot rejected above, which makes the key
droppable — so that decision's trigger carries two reasons now, and only one of them
is money.

**A resend carrying the same submission id but different lines returns the first
order's id and does not record the new lines.** That is ordinary idempotency-key
semantics: the key identifies the request, and the server returns what the request
produced. Nothing compares the lines.

**An order has no reader.** Nothing in the repository selects one except the
conditions that assert it was written. That is the state the kitchen board arrives
into, and it is why the response carries the order's id and nothing else.

An order has one from
[ADR 0026](0026-read-a-tables-open-orders-by-its-printed-code.md), which reads a
table's own orders back by the code printed on it. That record bounds the read
in time, and its window is a proxy for the sitting rejected above — so that
alternative's trigger now has a second reason as well as a second reader.
