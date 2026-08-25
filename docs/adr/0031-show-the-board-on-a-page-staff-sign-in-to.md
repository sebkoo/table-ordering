# 0031. Show the board on a page staff sign in to, and hold the token in memory alone

- **Status:** accepted
- **Date:** 2026-08-25

## Context

[ADR 0029](0029-verify-a-staff-credential-and-carry-a-session.md) built the staff
identity and declared the wait that followed it:

> **Two addresses exist that no client calls.** The board's API is the next
> change and consumes the resolve; the board's page is the one after and
> consumes `GET /staff/sessions/current`. That is a two-commit gap … and it is
> stated so it can be checked rather than assumed.

[ADR 0030](0030-read-the-restaurants-open-orders-from-the-staff-session.md)
closed the first half and repeated the second: "The board's page consumes both
`GET /staff/sessions/current` and this address, and it is the next change." This
is that change, and it is the client for both.

### Two deferrals whose triggers fire here

ADR 0029's table deferred six things. Two of them named this page:

| Deferred | What ends it |
| --- | --- |
| Signing out, and revoking a session | the first staff client, which needs a way to close one |
| A cookie rather than a header | the first staff page in a browser, where `HttpOnly` starts being worth its CSRF cost |

Both triggers have fired. A fired trigger re-deferred without a successor is
drift, so each is decided below and each is given the fact that would reopen it.

### What a page adds that `curl` did not

Nothing about the API changes here. What changes is that the token stops being a
value an operator pastes and becomes a value a program holds — which is the
first time this repository has to answer where a bearer credential lives in a
browser, and what a page shows when the answer to a request is a refusal rather
than data.

## Decision

**The page is its own workspace, `apps/staff`.** ADR 0030 rejected putting a
credentialed route in the guest-facing router because it would place two
authentication models in one file; the same objection holds one level up, where
it would place them in one bundle. The client half of the staff slice is
`apps/staff/src/features/staff/`, named for the slice its server half is named
for, which is what the layout rule in `AGENTS.md` asks for.

**`verify` gains `typecheck-staff` and `test-staff`, and a run prints fifteen
verdict lines rather than thirteen.** `vitest.config.ts` splits projects by what
a suite needs outside this repository, and this suite needs what the guest suite
needs — a PostgreSQL and a browser. That rule says what makes a split necessary,
not what makes one forbidden: a project of its own gives each page suite a step
line, a per-file report and a probe reason naming its own workspace, and the
alternative was renaming a step that every log in this repository's history
carries.

**The page holds a token and nothing else.** The sign-in answers a token *and* an
identity; the identity in that body is discarded, and the page asks
`GET /staff/sessions/current` who the token names. An identity remembered from
the request that minted a session is a claim about a session the page cannot
re-check, and the name written over a board has to be an answer about the same
thing the board is an answer about. This is also what makes the read-back route
a consumer rather than a courtesy: it is the only source of what the page says
about who is signed in.

**The token lives in memory.** Not `localStorage`, not `sessionStorage`, not a
cookie, not a URL, a query string or an attribute. A reload therefore signs staff
out. One condition reads the rendered document, both storages, the cookie jar and
the address bar and looks for the token the page actually carried — taken off the
request it made with it, because nothing else can observe a value held in memory.

**A cookie is re-deferred, and its successor trigger is written down.** The
prize of `HttpOnly` is keeping the token out of reach of script; a token that is
never stored denies a script anything persistent by a different route. Taking the
cookie would have decided four things at once — CSRF for an ambient credential,
`Secure` on a development server with no TLS, a route to clear it, and
revocation. **It reopens with the first staff client that must survive a reload
with nobody present — an unattended display in a kitchen — or the first staff
request that writes to an order.**

**Signing out is re-deferred, and it shares that trigger.** With the token in
memory, discarding it *is* the close: a reload or a closed tab ends this client's
session, and the row expires on its own. What a route would add is ending a
session **somebody else** holds — a manager closing a shift, a lost device — or
ending one before its expiry matters. **It reopens with the first session that
outlives its holder's client**, which is the same gate the cookie is behind, or
with the first person who needs to end a session that is not theirs.

**Four states, partitioned by what a person can do next.** `signed-out`,
`refused`, `unreachable`, `signed-in` on `data-staff`; `loading`, `empty`,
`ready`, `unavailable` on `data-board`. The board region exists only under
`signed-in`, because an empty board is an artefact of a signed-in read and
drawing one for somebody who has not signed in would say a restaurant has nothing
open without having asked about a restaurant.

**A refusal is shown in the API's own words.** The route's `401` schema requires
an `error` string, so the only sentence that can reach the page is the server's;
an answer the page cannot read is `unreachable` instead, which is a different
state with a different remedy. A `401` at the board is not a board that could not
be read — it is the session ending — so it returns the page to the form, while
every other failure is `unavailable` and the session survives.

**The board asks once, when a session opens.** Not on a timer. A board that
polled would be a second decision about how a screen stays current, and the
change that makes one current is the change that argues for it.

**The page states no duration.** The guest's empty state carries `OPEN_WINDOW`'s
value because a guest is deciding whether to order the same round twice; a
kitchen is reading a queue. `open-window-restated` inspects README and the guest
page, so a duration written here would be invisible to that rule rather than
checked by it — and the invariant is that a value the server owns is restated
only where a check compares the restatement with the value.

**The suite runs the credential mint rather than importing it.** Each staff row's
record comes from spawning `services/api/src/features/staff/credential.ts` and
reading its two streams, so the password every sign-in types is one the mint
really minted. That is the posture this suite already takes towards the
migrations, which it reads as files, and it is the first thing to exercise the
mint's own half — which README has listed as reached by no test since ADR 0029.

## Rejected alternatives

- **A staff route inside `apps/guest`.** Thirteen verdict lines instead of
  fifteen, no second workspace, no second `package.json`, and the browser is
  already installed for that suite. This is the cheapest answer by a wide margin.
  Rejected because it puts a credentialed surface in the bundle a guest
  downloads, which is ADR 0030's objection at the bundle rather than the router,
  and because `apps/guest/vite.config.ts` refused a `/staff` proxy rule on the
  ground that no client needed one. That premise has changed — the client exists
  — and it is a different client, on a different audience's page, which is the
  boundary `apps/guest` is named for.
- **One vitest project for both page suites, with `test-guest` renamed.** The
  config's own rule is that projects split by what a suite needs outside this
  repository, and these two need exactly the same things, so this is what that
  sentence most plainly implies. Rejected because the rename is not free: every
  CI log this repository has produced carries `test-guest`, `check-push` reads
  those logs, and two fixtures in `tools/__tests__/check-push.test.ts` are dated
  captures of them. Adding a step leaves every existing name true; renaming one
  makes a set of historical logs describe steps that no longer exist.
- **Taking the cookie now.** `HttpOnly` is the only thing that puts a token out
  of reach of a script on the page, and a bearer token in a browser is exactly
  what it is for — this is the strongest case against what was chosen, and
  ADR 0029 said so when it deferred it. Rejected because it arrives with four
  decisions rather than one: an ambient credential needs a CSRF answer, `Secure`
  needs TLS that development does not have, a cookie needs a route to clear it,
  and a session that survives a reload needs revocation to mean something. The
  trigger above names the fact that makes all four worth deciding together.
- **`sessionStorage`, keyed per tab, as the guest's pending submission already
  is.** It survives a reload, which a kitchen screen wants, and it would make
  `GET /staff/sessions/current` load-bearing on every mount rather than once per
  sign-in. Rejected because it weakens the condition that makes this page worth
  trusting: with the token stored, "no secret in the page, its storage, its
  cookies or its URL" becomes "no secret except this one, here", and the reader
  has to take the exception on faith. The guest's stored value is a submission
  id, which authorises nothing; a session token authorises every read a
  restaurant's staff can make for twelve hours.
- **Reading the identity out of the sign-in's answer, and not calling
  `GET /staff/sessions/current` at all.** One request fewer per sign-in, and the
  body already carries the name. Rejected because it makes the page's heading a
  claim about a session rather than an answer from one, and because the
  alternative leaves a route this repository shipped with no consumer at all —
  which is the shape ADR 0029 rejected when it declined to ship a sign-in with no
  way to present the session.
- **Polling the board, or a server-sent stream.** A kitchen board that never
  refreshes is a board somebody reloads, which under the decision above signs
  them out. This is the most uncomfortable consequence here. Rejected for the
  reason ADR 0027 rejected it for the guest: the first thing to need an open
  connection should be the change that argues for one, and a poll is a second
  decision about currency that this change has no evidence to make. It is what
  the roadmap's live-updates row is for, and it arrives with the reload question
  rather than before it.
- **Grouping the page by table**, `{ Table 7: [...] }`. It matches how a board is
  often drawn. Rejected for ADR 0030's reason, unchanged by the page existing:
  the flat list preserves the queue order the query establishes, and the grouped
  shape discards it and cannot rebuild it.
- **Showing how long a ticket has waited.** The first thing a kitchen asks.
  Rejected because the answer carries no `placed_at`; ADR 0030 named the change
  that shows waiting as the change that adds the field, and this is not it.
- **A sign-out control that discards the token.** Two lines, and it would let a
  person hand a screen to the next shift. Rejected because it would be a control
  that looks like a session ending and is not one — the row stays open and the
  token stays valid until it expires — and a control that overstates what it did
  is worse than no control while closing the tab does the same thing honestly.
- **Importing `hashPassword` into the suite instead of running the mint.** It is
  one import and it removes a child process from the fixture. Rejected because
  `apps/staff` does not depend on `services/api` and a test is not a reason to
  open a boundary the application does not cross — the same answer ADR 0027 gave
  when the guest suite wanted `OPEN_WINDOW`.
- **Restating the window on the board's empty state, and widening
  `open-window-restated` to read this file.** It would tell a kitchen what
  "nothing open" covers, which is a real question. Rejected because the sentence
  a kitchen needs is about a queue rather than about a bound, and because
  widening the rule buys a third checked copy of a value whose second copy
  ADR 0027 already recorded as a cost.
- **Page-authored copy for a refusal** — "that email and password do not match",
  written here. It reads the same today. Rejected because it is a restatement of
  a value this page does not own, which is the same class of drift as a duration:
  the API's wording can change and nothing would go red.
- **Two commits: the workspace and the sign-in, then the board.** It halves each
  diff and each half is a behaviour. Rejected because a page that authenticates
  in order to show nothing is the credential-with-no-consumer shape ADR 0029
  already rejected once, and because the repository's description has to start
  mentioning staff at the moment the board is *visible* — which binds the two
  halves into one change.

## Consequences

**A reload signs staff out, and every reload costs a derivation.** Signing in is
memory-hard by design, so a screen that is reloaded often is a screen asking the
API for about a third of a second of CPU each time. Nothing rate-limits it,
because nothing is deployed.

**Every page condition pays a real derivation**, because there is no way to put a
token into this page from outside it. Ten derivations run in the suite — one
mint, eight sign-ins and one refusal — and that is most of what the step costs.

**One condition here cannot be reddened by a mutation to this page.** The
condition that compares two restaurants' boards has no client-side failure to
catch: nothing on this page can name a restaurant, so no edit to it can make one
board show another's rows, and the negative half has no source to be fed from. It
is the page-level restatement of a claim `board.test.ts` pins across four seeded
restaurants, and what it adds is that the page renders its own answer and nothing
else. It is named here rather than left to be discovered.

**The sign-in response now carries a field with no reader.** `POST
/staff/sessions` answers `staff` and `restaurant` beside the token, and this page
discards both. Nothing is removed for it: the route's shape was decided in
ADR 0029 and a response narrowed for one client is a response decided by that
client.

**Two dated captures in `tools/__tests__/check-push.test.ts` are now read against
the step list of their own era.** Adding a step moved the shape those logs
describe. They are not rewritten — a capture of a run that never happened is
worth nothing — so the conditions that read them compare them with what `verify`
printed when they were taken, while the conditions about today's declaration go
on reading `expectedStepNames()`.

**Nothing here fires ADR 0021's price snapshot, its sitting, or the status
column.** This is the third view of a stored order. It shows no money, it closes
no table, and it marks nothing.
