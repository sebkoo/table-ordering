# 0033. Read the menu under a policy, and split the resolve from the read

- **Status:** accepted
- **Date:** 2026-08-26

## Context

The roadmap's last Planned row was *"Row-level security on a read, so a menu query
drops its scope too"*. Three records deferred it by name, and two of them said
what would end it.

[ADR 0020](0020-scope-a-write-with-row-level-security.md), which put the order
tables under policies:

> **The read path is not under a policy.** `restaurant`, `restaurant_table` and
> `menu_item` carry none, and the menu queries still scope themselves. That is its
> own roadmap row: bringing them under one means the code lookup and the menu read
> become two statements in a transaction, which is a change to the menu slice
> rather than to this one.

[ADR 0026](0026-read-a-tables-open-orders-by-its-printed-code.md), which made the
first read under a policy:

> **This is the first read in the repository under a policy.** It does not
> discharge the roadmap row that follows it: `restaurant`, `restaurant_table` and
> `menu_item` still carry none, and the menu queries still scope themselves.

Both are accurate on their dates and are left as written. The third is not, and it
is the reason this record exists.
[ADR 0029](0029-verify-a-staff-credential-and-carry-a-session.md), on the staff
tables:

> **`staff` and `staff_session` carry no policy.** A policy on either would have to
> be satisfied before the scope it defines could be known, because the credential
> is what says which restaurant the request is for. They are resolve tables, in
> the position `restaurant`, `restaurant_table` and `menu_item` already hold.

That sentence folds two different things into one list, and the distinction it
loses is the whole subject here.

- **A resolve table cannot carry a policy.** `restaurant`, `restaurant_table`,
  `staff` and `staff_session` are what a slug, a printed code and a credential are
  resolved *through*. A policy on one would have to be satisfied before the scope
  it defines could be known, which is circular. Writing
  `current_setting(..., true)` to escape the circle would make an unscoped read
  answer with no rows instead of being refused — the failure ADR 0020's `::uuid`
  cast exists to prevent.
- **`menu_item` is resolved through by nothing.** It is read *after* a scope
  exists, on both paths that read it: a guest's resolved printed code or slug, and
  a staff session's resolved row — `OPEN_ORDERS_IN_RESTAURANT` joins it for the
  item name on every board request. Its no-policy state was never structural. It
  was historical, and it survived three commits because nothing forced it.

What forced it was not a demonstration. Row-level security was demonstrated on a
write in ADR 0020 and on a read in ADR 0026; a third demonstration adds nothing.
What this row buys is **uniformity, and a bug class removed**: after it, no menu
query can forget its restaurant predicate, because the predicate is not the
query's job.

There is one obstacle, and the premise the roadmap row states hides it. The menu
routes did not merely carry a predicate — they carried **no transaction and no
scope at all**. Each was a bare `pool.query` whose single statement resolved *and*
read: the slug or the printed code sat in the `where` clause of the same select
that returned the items. Putting `menu_item` under a policy therefore forces the
split ADR 0020 predicted, and this change is larger than the row's wording implies.

## Decision

`menu_item` carries row-level security and one policy, added by
`0005-scope-the-menu-read.up.sql`:

```sql
alter table menu_item enable row level security;

create policy menu_item_scope on menu_item
  for select
  using (restaurant_id = current_setting('app.restaurant_id')::uuid);
```

The `using` clause is ADR 0020's, character for character, and for its reasons:
one-argument `current_setting` raises `42704` on a connection that has never been
scoped, and the `::uuid` cast raises `22P02` on the empty string the setting
reverts to afterwards, so a read that establishes no scope is refused rather than
answered with nothing.

**`for select`, and no write policy, and that asymmetry is a decision.** The
application role holds `select` on `menu_item` and nothing else — `0003`'s grant.
The one writer is the operator seeding a menu as the owner, in the README's run
step, and PostgreSQL does not bind a table's owner to its own policies. A
`with check` clause would therefore govern statements no grant permits and no
connection makes. Enabling row-level security is itself the refusal for the rest:
with no policy for insert, update or delete, the application role has none.

**The menu slice becomes a resolve and a read**, in the shape the order and board
reads already have. `RESTAURANT_FOR_SLUG` and `RESTAURANT_FOR_TABLE_CODE` each
answer the request's one query with no restaurant to scope by; the transaction is
then scoped from the row that resolve returned; and `MENU_ITEMS` names no
restaurant at all. The `LEFT JOIN` that told a restaurant-with-nothing-available
apart from a restaurant-that-does-not-exist retires with the fused statement: the
resolve answers existence and the read answers items, so the distinction is
structural rather than a null column somebody has to read correctly.

**The composite foreign keys are untouched, and are not replaced by this.** ADR
0020 rejected row-level security on `menu_item` *instead of*
`table_order_line_menu_item_id_restaurant_id_fkey`, and that rejection stands:
PostgreSQL runs referential-integrity checks as the table's owner, and those bypass
row security, so the foreign key would never consult a policy. This adds a policy
*beside* the key. The key still refuses a line naming another restaurant's item,
and it still does so on a path that forgets to set a scope.

**A test suite's migration list is the full prefix**, `0001` through the newest.
`b895e42` set the opposite precedent, adding `0004` to `staff.test.ts` alone and
leaving the four suites that reach no staff table at `0001`–`0003`. That was
serviceable in its own terms and stays as written: `0004` is a `create` of tables
those suites never touch, so excluding it changed nothing they could observe.
`0005` is an `alter` of a table most of them join, which turns the same reasoning
into a silent failure mode — a suite whose list omits it passes against a schema
that exists nowhere, and no check can see the omission. The cost is milliseconds
of DDL against a stale schema nobody sees, so the rule going forward is the
checkable one rather than the judgment.

## Rejected alternatives

- **Leave the row Planned.** No code and no risk, and the mechanism is twice
  demonstrated already, so nothing is learned by a third. Rejected because the
  roadmap should not promise what the tree refuses, and the removed bug class is
  real even where the demonstration is not new.
- **A `for all` policy, for symmetry with `0003`.** It would make every policy in
  the schema read the same, which is worth something to a reader. Rejected because
  the `with check` half would govern statements no grant permits and no connection
  makes: a policy announcing security it does not provide, which is the class
  ADR 0020 itself rejected when it turned down a policy the foreign key would never
  consult.
- **`FORCE ROW LEVEL SECURITY` on `menu_item`.** It would close the owner
  exemption, which is the one hole in every policy this schema has. Rejected
  because the seed step is what creates a restaurant's first rows: requiring a
  scope there means the operator hand-writing the uuid the schema exists to derive
  from a row, before any row exists to derive it from.
- **Rewriting ADR 0029's sentence.** The cheapest repair, and it would leave one
  true statement where there is now a false one plus a pointer. Rejected because a
  record is never rewritten — it is pointed at or superseded, and a record that can
  be edited to stay true is a record that says nothing about its own date.
- **Keeping the fused menu statements and scoping them from a separate resolve.**
  A far smaller change: the `LEFT JOIN`, `availableItems` and both row types
  survive untouched. Rejected because the second statement would take the printed
  code from the caller *again*, and the invariant is that every query after the
  resolve is scoped by the row it returned and never by anything the caller sent.
- **Dropping `item.restaurant_id = line.restaurant_id` from the two order reads.**
  Full uniformity: after this change no statement anywhere would name a restaurant
  for `menu_item`. Rejected because no condition can tell a self-scoping statement
  from a policy-scoped one — both agree in every state, including the unscoped one
  where both raise — so the edit would land unverified. It is an unobservable
  change to two security-relevant statements, and those predicates were written
  for an invariant they still serve.
- **Continuing to choose each suite's migration list by what it reaches.** It is
  the standing precedent, it costs nothing to keep, and it keeps a suite's setup
  saying something about that suite. Rejected for the reason given above: with an
  `alter` in the sequence, an omission is silent.
- **A convention rule enforcing the full-prefix rule now.** It would have seven
  subjects today and would fail before this change and pass after — the shape
  ADR 0004 asks for. Rejected as a second behaviour in one commit. Its trigger is
  named instead: **the next migration**, `0006`, which is the first chance for the
  rule to be broken by a new list rather than by an old one.
- **Extracting `scoped` and `sqlstate` into a shared test helper.** `menu.test.ts`
  is the third copy of each. Rejected because `board.test.ts` set the duplication
  precedent deliberately when it was the second, and a shared module would be a
  file belonging to no slice — the seam is still a guess about a variation nobody
  has observed.

## Consequences

**A menu request is a transaction now.** Three statements and a pooled connection
held across them, where it was one statement on a pool. Nothing is deployed, so no
number is at risk; the cost is named here rather than discovered later.

**An unscoped menu read is refused rather than answered empty**, which is the
property the order and board reads already had and the menu did not.

**`restaurant` and `restaurant_table` still carry no policy, and still cannot.**
The claim this record narrows is about `menu_item` alone. The two resolve tables
keep the position ADR 0029 described, and the reason it gave for them is the
correct one.

**The application role can read every restaurant's menu rows only under a scope.**
It could read all of them unscoped before. That was never reachable through a
route, because the routes carried predicates; it is now unreachable through the
grant as well.

**Nothing holds the full-prefix rule but this record and review.** Seven suites
carry a list today and a program could compare each against the migrations
directory, but that program is deferred to `0006`. Until then a new suite can be
written with a short list and nothing goes red.

The convention rule this record deferred lands in
[ADR 0035](0035-check-a-suites-migration-list-against-the-directory.md). What was
deferred was written here as "**A convention rule enforcing the full-prefix rule
now.** … Its trigger is named instead: **the next migration**, `0006`, which is
the first chance for the rule to be broken by a new list rather than by an old
one." That trigger fired in ADR 0034 and the rule is the commit after it.

Two things there differ from what this record predicted. The subjects are **ten and
not seven**: three suites carry a `.down.sql` list beside the up list, which this
record did not count, and the rule covers both directions because the down lists
were the three nothing held. And the sentence above — "Seven suites carry a list
today and a program could compare each against the migrations directory" — is true
of the comparison and understates the collector: the ten lists are written under
three constant names, close two different ways and sit at two indents, so the
program had to be keyed on what an array holds rather than on what it is called.
