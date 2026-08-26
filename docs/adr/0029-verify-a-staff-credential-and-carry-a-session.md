# 0029. Verify a staff credential with scrypt, and carry it as a session token

- **Status:** accepted
- **Date:** 2026-08-25

## Context

[ADR 0026](0026-read-a-tables-open-orders-by-its-printed-code.md) recorded the
finding that stopped the kitchen board: **nothing in this repository
distinguishes a staff request from a guest request.** Every handler read
`request.params` and nothing else; no header, cookie, session or token was read
anywhere in `apps/` or `services/`. That record rejected building the identity
there — "authentication built in a hurry as somebody else's prerequisite is
authentication built badly. It lands deliberately, when the board needs it" —
and the board is the next change, so this is that landing.

### What authorises a scope today

Nothing in the database does. `set_config('app.restaurant_id', $1, true)` is a
function call the application role may make with any value. What makes the guest
path safe is provenance rather than permission: the value comes from the row
`TABLE_FOR_CODE` returned for the code in the URL, and the request has no field
naming a restaurant for a caller to put one in.

So the policies are a tenancy boundary and the resolve is the authorisation
boundary, which is ADR 0026's own sentence read forwards: a tenancy boundary is
not an authorisation boundary. A staff credential has to reach the same
position — one query, no restaurant to scope by, and every statement after it
taking its restaurant from the row that query returned.

### What a credential store needs, and what is already here

The API workspace has two runtime dependencies, `fastify` and `pg`. Password
storage needs a memory-hard derivation, a constant-time comparison and a
cryptographic random source, and Node ships all three: `scrypt` (RFC 7914),
`timingSafeEqual` and `randomBytes`.

OWASP's Password Storage Cheat Sheet gives two minimum scrypt configurations:
N=2^17, r=8, p=1, or N=2^16, r=8, p=2. Measured on the machine this was written
on, at Node 24, they cost 309 ms and 291 ms respectively and both need about
128 MiB. Node's default `maxmem` is 32 MiB and rejects either with
`ERR_CRYPTO_INVALID_SCRYPT_PARAMS`.

## Decision

**A staff member signs in with an email and a password, and is answered a
session token and the identity it names.** `POST /staff/sessions` returns `201`
with `token`, the staff member's name, and their restaurant's slug and name.
`GET /staff/sessions/current` answers the same identity for a token carried as
`authorization: Bearer`.

**The email is unique across restaurants, not within one.** A sign-in carries no
other segment to disambiguate it, and it must not: a request that named a
restaurant would be a request that could name somebody else's. This is the same
decision `restaurant_table.code` already carries, for the same reason, and it is
what makes the restaurant a property of the row rather than of the request.

**A password is stored as a scrypt record and never as itself.** The record is
`scrypt$N$r$p$salt$key`, base64url, and carries the parameters it was made
with — read back from the record when a password is verified rather than from
the code, so the parameters can be raised without invalidating a row minted
under the old ones. **N=2^17, r=8, p=1, a 16-byte salt and a 32-byte key**, with
`maxmem` set explicitly. p is 1 rather than 2 because OpenSSL runs the
parallelism factor serially, so p>1 buys work without buying concurrency.

**The comparison is `timingSafeEqual`.** No test can see the difference between
it and `===` — both produce the same boolean — so this is stated here and in the
code and is not claimed as an acceptance condition. Saying that a test cannot
see it is the honest line.

**A sign-in that names an address no staff member uses runs a derivation
anyway**, against a record minted once per process over a value nobody holds,
and answers exactly what a wrong password answers. Without it, the time a
refusal takes is a way to ask which addresses have staff behind them.

**A session is a row, and the row holds the token's SHA-256 rather than the
token.** The token is 32 bytes from `randomBytes`, so it has no guessing space
to protect and a digest is enough; a memory-hard derivation would be paid on
every request instead of on every sign-in and would buy nothing. A dump of
`staff_session` therefore holds nothing anybody can present.

**The token travels in a header and never in a path or a query string**, which
is why the second address is `/staff/sessions/current` and not the token itself:
a path is written into every proxy log between the client and here.

**A session expires after twelve hours** — a shift. The interval lives beside
the statement that uses it in `services/api/src/features/staff/sql.ts`, and the
resolve carries `expires_at > now()` in its predicate rather than checking it
afterwards, so there is no state in which the row is in hand and the decision is
still to be made.

**`staff` and `staff_session` carry no policy.** A policy on either would have to
be satisfied before the scope it defines could be known, because the credential
is what says which restaurant the request is for. They are resolve tables, in
the position `restaurant`, `restaurant_table` and `menu_item` already hold. What
ties a session to one restaurant is a composite foreign key,
`(staff_id, restaurant_id)` referencing `staff (id, restaurant_id)`.

That list folds two different things together, and
[ADR 0033](0033-read-the-menu-under-a-policy.md) draws the line it loses.
`restaurant` and `restaurant_table` are resolve tables in the sense this
paragraph means and cannot carry a policy. `menu_item` is resolved through by
nothing: it is read after a scope already exists, on the guest's path and on the
board's, so its position here was historical rather than structural. It carries
a policy from `0005`. What this paragraph says about `staff` and `staff_session`
is unaffected and stands as written.

**The operator mints a credential.** There is no admin route, exactly as there
is none for a restaurant, a table or a menu item. Running
`services/api/src/features/staff/credential.ts` prints a record on stdout and,
once, a generated password on stderr, so the record can be captured by the run
step while the password reaches no pipe, no file and no shell history. The
password is generated rather than chosen, for the reason a table's code is: a
value a person picks is a value somebody else can guess, and nothing in the
schema or the route can tell the two apart afterwards.

### What this does not decide

Each of these is deferred with the thing that ends it, so a later reader is
looking at a decision rather than an omission.

| Deferred | What ends it |
| --- | --- |
| Signing out, and revoking a session | the first staff client, which needs a way to close one |
| Renewal, and rotation | the first session that expires while somebody is looking at a board |
| A cookie rather than a header | the first staff page in a browser, where `HttpOnly` starts being worth its CSRF cost |
| Rate limiting a sign-in | a deployment; nothing is deployed |
| Changing a password, resetting one, locking an account | an admin surface, which does not exist |
| Roles within a restaurant | the first thing staff can do that not all staff should |

**No staff request reads an order yet**, so nothing here demonstrates that a
staff scope reaches only its own restaurant's rows. What is demonstrated is the
layer above it: a credential minted for one restaurant answers that restaurant
and never the other, across two seeded restaurants. The order-row version of
that condition lands with the read that needs it, which is the board's API.
Between this change and that one, the claim is unpinned, and it is named here
rather than left to be discovered.

## Rejected alternatives

- **A hashing dependency: `argon2`, `@node-rs/argon2`, `bcrypt`, `bcryptjs`.**
  Argon2id is what OWASP puts first, and a well-maintained binding is a
  reasonable thing to depend on. Rejected because scrypt is OWASP's second line
  rather than a fallback, it is in the standard library at the recommended
  parameters, and the API workspace has two runtime dependencies. A third,
  native or otherwise, is a supply-chain surface bought for a primitive already
  present.
- **A signed stateless token, with no session table.** No row to write, no row
  to read, and nothing to clean up. Rejected because the signing key would need
  a home nothing in this repository has, and because a signed token cannot be
  revoked: the only way to end one early is to rotate the key, which ends every
  session at once. A row can be deleted.
- **A cookie rather than a bearer header.** `HttpOnly` puts the token out of
  reach of any script on the page, which a bearer token in a browser's storage
  is not — this is the strongest case against what was chosen. Rejected for now
  because there is no staff page: the token's only holder today is an operator's
  `curl`, a cookie would arrive with a CSRF question and no client to answer it,
  and development has no TLS for `Secure`. It reopens with the first staff page,
  and that is written above rather than left implicit.
- **An opaque secret printed for each staff member, with no password**, in the
  shape a table's code already takes. It is smaller: no derivation, no sign-in,
  no session table. Rejected because it is a permanent bearer secret with no
  expiry, no way to end it but deleting the row, and no separation between the
  thing a person knows and the thing their client holds.
- **A `for all` policy on `staff_session`.** Rejected because the digest resolve
  runs before any scope exists, so a `using` clause reading `app.restaurant_id`
  would raise on every read; and writing `current_setting(..., true)` to get past
  that would make an unscoped read answer with no rows rather than be refused,
  which is the failure `0003`'s `::uuid` cast exists to produce loudly.
- **A `for insert with check` policy on `staff_session`, with a permissive
  select policy beside it.** This is the strongest of the rejected alternatives
  and the circularity above does not dispose of it: the insert runs *after* the
  resolve, with the restaurant already known, so it could be checked against the
  transaction's scope. Its real prize is that the write invariant in `AGENTS.md`
  would not have had to widen, and widening an invariant is the more dangerous
  of the two edits. It was rejected on three things. First, on the only path
  that writes, the scope is set from `staff.restaurant_id` and the value
  inserted is `staff.restaurant_id`, so the check compares a value with itself
  and cannot fail — on the order write it is not a tautology, because the values
  come from the request body while the scope comes from the resolved row, and
  here there is no gap for it to stand in. Second, a policy can compare a column
  with the scope but cannot say that two columns of a row agree with each other,
  which is what the invariant actually is; only the composite key states that,
  and it holds under referential integrity, which runs as the table's owner and
  therefore holds for a path that forgets to set a scope. Third, it needs a
  `using (true)` select policy to keep the resolve working, which makes the
  table announce row-level security and not have it for reads.
- **The board's API in this commit**, so that a staff-scoped read of orders
  would land with the credential that scopes it. It would make the
  wrong-restaurant condition a comparison of order rows, which is stronger
  evidence than a comparison of identities. Rejected on the bundling ADR 0026
  rejected: secret handling and what a board discloses are two decision-heavy
  surfaces, and taken together the second gets decided by whoever is tired after
  the first.
- **Signing in with no way to present the session.** Smaller by a route and its
  conditions. Rejected because it mints a value nothing reads, leaves
  "recognisable on the next request" unproven, and makes the board wait on two
  commits of prerequisite rather than one.
- **The table and the mint alone, with no route.** The smallest thing that
  compiles, and the one split that is worse than shipping the whole beat: a
  table nothing verifies is weaker than a route nothing calls. The record's
  format would be asserted only by a test that also wrote it — both sides of the
  comparison produced by the same function — and the parameters would be fixed
  with nothing exercising a verify.

## Consequences

**Two addresses exist that no client calls.** The board's API is the next change
and consumes the resolve; the board's page is the one after and consumes
`GET /staff/sessions/current`. That is a two-commit gap, longer than the
one-commit gap `POST /tables/:code/orders` and `GET /tables/:code/orders` each
carried, and it is stated so it can be checked rather than assumed.

**A password nobody wrote down is a staff member who needs a new row.** The mint
prints it once and stores only the record, and there is no reset.

**A sign-in costs about a third of a second of CPU and about 128 MiB.** That is
the parameters working, and it is why the derivation runs on the thread pool
rather than on the event loop. It also makes the API test suite several seconds
slower, which is reported and asserted against nothing
([ADR 0024](0024-report-what-each-test-file-cost.md)).

**The application role can read every staff row in every restaurant**, because
that is what resolving a global credential means. It is the position it already
holds for `restaurant_table`, and it is why `credential` is a derived value
rather than anything presentable.

**A session cannot be closed.** It expires, and until then a token that has
leaked is a token that works. The client that can ask for a sign-out is the
thing that ends this.

The read this record was the prerequisite for is
[ADR 0030](0030-read-the-restaurants-open-orders-from-the-staff-session.md),
which consumes the resolve and closes the row named above: a staff scope reaching
only its own restaurant's order rows is pinned there, across four seeded
restaurants, and the mechanism it pins is the policies rather than the composite
key argued over here. That record also reports what the key could not be shown to
do: with the key dropped and a straddling session seeded anyway, the resolve's
two-column join refuses the token before the key would have been consulted. The
board's page is still the change after, so the second half of the gap above is
still open.

Two rows of the deferral table above have since fired, and both fired at the
same subject: the board's page,
[ADR 0031](0031-show-the-board-on-a-page-staff-sign-in-to.md). **A cookie rather
than a header** was re-deferred there rather than taken — the page holds its
token in memory and stores it nowhere, so there is no persisted value for
`HttpOnly` to protect and no ambient credential to answer for — and it now waits
on a staff client that must survive a reload with nobody present, or on the first
staff request that writes. **Signing out** was re-deferred beside it, because
discarding a token held in memory is what closing that client already does; what
a route would add is ending a session somebody else holds, and it waits on the
same gate. The remaining four rows are untouched.

The gap this record declared is closed. Both addresses now have a client: ADR
0030's board consumes the resolve, and ADR 0031's page consumes
`GET /staff/sessions/current` as the only thing it will say who is signed in
from.
