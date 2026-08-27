# Known limitations

This is the README's "Known limitations", moved here whole by
[ADR 0040](adr/0040-widen-the-windows-sight-to-the-documents.md). Nothing in it
changed except the eleven record links, which resolve from `docs/` now rather
than from the repository root.

- A guest who opens the printed code a second time can produce two orders for
  one round. The pending submission lives in `sessionStorage`, which a second
  opening does not share, so that opening mints an id of its own. It is
  indistinguishable from a table ordering the same round twice, which is a real
  thing a restaurant does, so no client can decide it.
- A send that has not resolved freezes the guest's choices until it does,
  because it may already have reached the kitchen and a new id for edited lines
  would order everything twice. The way out without retrying is to close the
  tab, which takes the stored submission with it.
- The page cannot say which item a refused order was refused for. The route
  answers `422` with the fact that an item on the order is not on that menu, and
  not with which one.
- Anyone holding a table's code can read what that table ordered in the last two
  hours. The code is printed in a public room and cannot be revoked without
  reprinting the card, so that reaches a passer-by who photographed it as well
  as the people sitting there. It is bounded to one table, adds no way to find
  another, and is dominated by the write the same code already allows — a
  stranger with the code can order to that table, which is the greater harm.
  It is still a disclosure, and the window is what bounds it.
- Nothing in the system can tell a code that was minted from one that was
  chosen. The schema accepts `table001`, the route's pattern constrains alphabet
  and length rather than choice, and the 48 bits `openssl rand -hex 6` produces
  come from an instruction in this file and nowhere else. The read above rests
  on that instruction having been followed.
- The two-hour window is a proxy for a sitting, not a substitute. A party
  arriving at a table the previous party left within the window sees the
  previous party's order. No window closes that, because parties can be minutes
  apart; the row that would is deferred to the first view that can close a
  table.
- The read carries no price, because an order records none. It does now record
  that an order was served, and only the board's read acts on it: for a guest
  "open" still means recent, so a round the kitchen has cooked is still on their
  page. That is deliberate, and the alternative is rejected out loud in
  [ADR 0034](adr/0034-clear-a-ticket-by-recording-when-it-was-served.md).
- **No page path records a payment against a ticket that has been served.** The
  board shows what is recent and not yet served, and the board is where ticket
  ids come from — so once the kitchen has sent a round out, the control that
  would record its payment is gone with the row. The address still reaches it:
  `POST /staff/orders/:id/paid` takes no window and no served clause, because
  those bound what a read discloses and not what may be written down. What is
  missing is a view, and the view that would have it is the one that settles a
  whole table
  ([ADR 0036](adr/0036-record-a-round-as-paid-and-gate-nothing-on-it.md)).
- A bill spanning several rounds cannot be settled in one act. Payment is
  recorded per order, which is the finest grain the schema has and the one a
  bill reconstructs from; a restaurant settles across a sitting, and there is no
  sitting row. That is not an oversight in this change — it is the row ADR 0021
  deferred to "the first view that can close a table", and recording that one
  round was paid for closes no table. A bill-level act arrives with the sitting.
- A payment cannot be un-recorded, and nothing records who took it or how. The
  column is a moment and the act writes it once; a second act answers as the
  first did and moves nothing. Reversing it needs a reason a payment goes back,
  which nobody has yet.
- The order records no amount and no currency, so nothing in the system says
  what was paid — only that something was. An amount would be a ledger, and a
  ledger needs the price snapshot ADR 0021 deferred before it could mean
  anything for an order placed before the menu moved.
- Nothing takes payment. There is no processor, no checkout and no card
  handling, and none is planned: routing a self-hosted restaurant's guests
  through a third party's flow is what "no third-party requests" rules out. How
  the money actually changes hands is outside this system, which is why what it
  offers is a fact to record rather than a flow to run.
- A ticket cannot be put back on the board. There is no un-serve: it would need a
  reason a ticket returns, and nobody has one yet. The row keeps the moment it
  was cleared, so the repair is a new decision rather than a lost fact.
- Nothing records *who* cleared a ticket. The session resolves a staff row, so
  the value is in hand and is not written, because no view shows it and a column
  with no reader is one every later change has to keep true.
- There is no way to clear more than one ticket at a time. Nothing is deployed,
  so no kitchen has said its board is long enough to want one, and a bulk control
  is the one act here with no undo.
- The guest's page shows the table's orders as of the last time it asked, and it
  asks when the page opens and when a send from it lands. A round sent from
  another phone at the same table does not appear until this page sends or is
  reloaded, and nothing on the page says how old the list is.
- The empty list means nothing in the last two hours, not nothing ever, and the
  page says so in those words. That sentence restates a value the server owns —
  `OPEN_WINDOW` — in a workspace that cannot import it, and a convention rule is
  what holds the two together: it reads the constant and fails every sentence in
  this file and on that page that names a different window
  ([ADR 0028](adr/0028-check-the-window-where-it-is-restated.md)).
- That rule reads this file and the guest page, and nothing else. A window
  restated somewhere new is invisible to it, and so is one written as a number
  word it does not carry. The records in `docs/adr/` are outside it on purpose:
  each states what was decided on its date, and a decision that moves is
  superseded rather than rewritten.
- A caption is held to its form and never to its pixels. `capture-caption-resolves`
  reads every picture in this file, in `AGENTS.md` and in the records, and fails
  one that carries no alt text, one whose caption names no revision, one that
  names more than a single revision, and one whose revision resolves against no
  commit or against several. What no program does is compare a picture with the
  page it shows: a caption that names a real revision and shows something that
  revision never rendered passes, and only a reader catches it
  ([ADR 0032](adr/0032-show-both-pages-as-dated-captures.md)).
- That rule reads this file, `AGENTS.md` and `docs/adr/*.md`, and nothing else. A
  picture added to `CLAUDE.md` or under `.claude/skills/` is invisible to it, and
  what widens the set is the first picture that appears there rather than a
  prediction about one. It reads the records where `open-window-restated` may not,
  because history only ever grows: a revision that resolves today resolves
  forever, so a caption written on a record's own date does not go stale the way
  a restated value does.
- Nothing in this repository reproduces those pictures. They were taken by a
  script that was not committed, because it would be the only thing under
  `tools/` with no test beside it — what it emits is pixels nothing asserts on.
  What a later capture has to match is written into ADR 0032 instead: the
  viewport, the fixture, and the run steps it was taken from.
- A staff session cannot be ended by anybody but its holder. Closing the tab
  discards the token, which is the whole of the close a client can perform; the
  row stays open until it expires, and there is no revocation and no renewal. A
  token that has leaked is a token that works until then, and what would end it
  is a route ADR 0031 defers to the first session that outlives its holder's
  client.
- A password nobody wrote down is a staff member who needs a new row. The mint
  prints it once and stores only a value derived from it, and there is no reset
  and no way to change one.
- `staff` and `staff_session` carry no policy, and cannot: a policy on the table
  a credential is resolved through would have to be satisfied before the scope
  it defines could be known. What ties a session to one restaurant is a
  composite foreign key instead, and the application role can read every staff
  row in every restaurant — which is what resolving a credential that names no
  restaurant means.
- A staff credential reaching only its own restaurant's order rows is pinned at
  the order rows now, across four seeded restaurants, and not at the identity
  alone. What that comparison exercises is the policies rather than the composite
  key beside them: a session whose restaurant is not its staff member's is
  refused by the key, and would be refused by the resolve's two-column join even
  with the key gone. Both were run rather than reasoned about.
- A reload signs staff out. The board's page keeps its token in memory and
  writes it nowhere, so refreshing a screen means signing in again — and signing
  in is memory-hard by design, so each one asks the API for about a third of a
  second of CPU. That is the cost of the storage decision rather than an
  oversight, and ADR 0031 names the fact that would reverse it.
- The board asks when a session opens and when an act from that page lands. An
  order placed between those is not on the screen until the next act or the next
  sign-in, and nothing on the page says how old the list is. It is the guest
  list's limitation with a worse consequence: a kitchen is the reader who most
  needs a current one.
- The board's page states no window at all, and `open-window-restated` does not
  read that workspace. A duration written into it would be invisible to the rule
  rather than checked by it, which is why none is written.
- One acceptance condition on that page cannot be made to fail by changing the
  page. It compares two restaurants' boards, and nothing in the client can name a
  restaurant, so no edit to it can make one board show another's rows. It is the
  page-level restatement of a claim `board.test.ts` pins across four seeded
  restaurants, and what it adds is that the page renders its own answer and
  nothing else.
- `POST /staff/sessions` answers a name and a restaurant beside the token, and
  the page discards both — it asks `GET /staff/sessions/current` instead, so what
  it shows is an answer about the token rather than a memory of the request that
  minted it. Those two fields now have no reader.
- The board shows no time. The answer carries no `placed_at`, so a page can say
  what order the tickets arrived in and not how long any of them has waited. The
  field lands with the first view that shows the waiting.
- One constant bounds two different disclosures. The guest's read is bounded
  because a printed code is public and cannot be revoked; the board's is bounded
  because a kitchen wants what is outstanding rather than a history. An order can
  be marked served now, which is where this line used to say they would separate
  — and they have not, because the two bounds have not needed different values.
  They separate with the first deployment that reports a ticket ageing off the
  board before its kitchen cleared it, or with the sitting ADR 0026 defers the
  guest's window to, whichever lands first. Neither is an argument; both are
  observations.
- The application role now holds `update` on two columns, one per act, so the
  privilege no longer tells the two acts apart. A statement recording a payment
  could set `served_at` instead and the grant would permit it; what keeps each
  act to its own column is its statement, and what the privilege still refuses —
  `restaurant_id`, `table_id`, `submission_id`, `placed_at` — it refuses with
  `42501` for a statement nobody read.
- Nothing tells a statement that re-scopes itself from one that leaves the job to
  the policy, and the two acts' updates are now a third and a fourth statement in
  that position: a
  `restaurant_id` predicate added to it reddens no condition in the tree. A predicate comparing `restaurant_id` with the transaction's scope
  would agree with the policy in every state, including the unscoped one where
  both raise, so no condition here can see the difference. The same holds for the
  second column on the board's join to `restaurant_table`, which the order's own
  composite key already guarantees.
- Signing in costs a memory-hard derivation, deliberately, so it spends about a
  third of a second of CPU and a few hundred megabytes. Nothing rate-limits it,
  because nothing is deployed.
- The mint's own half of `credential.ts` is now run by the staff page's suite,
  which spawns it and reads a record off one stream and a password off the other
  — so the split those two streams exist for is exercised rather than described.
  What is still not checked is the wording it prints them with.
- Row-level security covers an order and its lines, written, read, cleared and now
  recorded as paid, and a menu item on a read. Neither act needed a new policy:
  `0003`'s is `for all`, so it governs an update exactly as it governs a select. `restaurant` and `restaurant_table` carry no policy and cannot:
  they are what a slug and a printed code are resolved through, so a policy on
  either would have to be satisfied before the scope it defines could be known
  ([ADR 0033](adr/0033-read-the-menu-under-a-policy.md)).
- A menu request holds a pooled connection across three statements where it held
  one, because a resolve, a scope and a read cannot be one statement. Nothing is
  deployed, so no number is at risk; it is named because it is a real cost and not
  a free tidy-up.
- Every test suite applies the whole migration sequence, and a convention rule is
  what says so. A list chosen by which files a suite reaches was fine while every
  migration created something; an `alter` makes a short list silent, because the
  suite then passes against a schema that exists nowhere. There are **ten** such
  lists in seven files — seven `.up.sql` lists ascending and three `.down.sql`
  lists descending — and the rule compares each with `services/api/migrations`
  itself rather than with a number written down beside it
  ([ADR 0035](adr/0035-check-a-suites-migration-list-against-the-directory.md)).
- That rule finds a list by what an array holds, not by what it is called, because
  the ten are written under three constant names, close two different ways and sit
  at two indents. A list written some other way would be invisible to it, so a
  second selector names any suite that applies migrations and yields no list it can
  read. What that still does not catch is a file losing one of two lists, which the
  other list satisfies; two conditions hold the census itself, by two keys that go
  blind to different things.
- **A menu item that has been ordered cannot be removed from the menu.** The
  order line's foreign key to `menu_item` is `NO ACTION`, so the delete is
  refused. Deleting the whole restaurant is refused too, and by the same
  constraint: the cascade into `menu_item` is blocked before the cascade into
  `table_order` can clear the lines. Both were run rather than reasoned about.
  For a menu that changes seasonally this bites long before anything about money
  does, and the repair is the price and name snapshot
  ([ADR 0021](adr/0021-record-an-order-as-a-submission-with-lines.md))
  which would make the key droppable.
- An order records no price. A menu price that moves leaves an older order
  unpriceable, which costs nothing while nothing is deployed and there are no
  rows to lose.
- A resend carrying the same submission id but different lines answers with the
  first order's id and does not record the new lines. Nothing compares them:
  the submission id identifies the request, and the answer is what that request
  produced.
- The application role's development password is a literal in
  `0003-create-table-order.up.sql`, public in this repository, and that
  migration creates the role in whatever database it is applied to. A deployment
  creates `table_ordering_app` itself, with a real secret, **before** running
  the migration — the migration's exception clause then finds it and leaves it
  alone — and passes its own connection string in `DATABASE_URL`.
- The down migration does not drop that role. A role is cluster-wide, so
  dropping it would reach every other schema in the same cluster.
- A table's code cannot be revoked without reprinting the card it is on, and
  nothing in the schema or the route makes a code hard to guess — the pattern
  would accept `table001`. That property lives entirely in how the code is
  minted, which is why the run steps above mint one rather than choose one.
- Nothing serves either built page in production. Both fetch the API at relative
  paths, which their dev servers and their acceptance tests each proxy; a
  deployment would have to route `/tables` and `/restaurants` to the API and
  answer `/t/<code>` and `/r/<slug>` with the guest's `index.html`, and route
  `/staff` to the API and answer everything else with the staff page's.
- A restaurant with nothing available gets a heading and an empty list. The page
  does not say that everything has sold out, though the API distinguishes it
  from a restaurant that does not exist.
- A restaurant, its menu items and its tables can only be created by writing
  SQL, as the run steps above show. There is no admin route and no seed.
- Nothing records which migrations a database has had applied, so a developer
  with an older clone has to know which ones they have run. That holds while
  every migration creates structure and re-applying one errors rather than
  changing anything; the runner arrives with the first deployment, or with the
  first migration that alters data
  ([ADR 0015](adr/0015-apply-the-second-migration-by-hand.md)).
- The database probe is a TCP connect. It answers whether something is
  accepting connections at the address the tests use, not whether that
  something is PostgreSQL, so a wrong service on the port fails the suites
  rather than skipping them. That is deliberate — a misconfiguration is not an
  absent dependency — but it does mean the skip is keyed on absence alone.
- CI downloads that browser on every run. Caching it is the obvious next move
  and has not been made.
- The per-file figures a run prints are durations of files that run in
  parallel, so they neither add up to their step's total nor stay under it: one
  run here put 11.9s of files inside a `test-guest` step that took 7.8s. No sum
  is printed, for that reason. A file costing under fifty milliseconds reads
  `0.0s`, which says only that it is below what the line can show.
- A file's figure is a property of the machine as much as of the file, so a
  local reading cannot answer a question about a CI one. `test-tools` runs in
  2.2–2.6s on CI and 28s here. Two runs back to back on an idle machine agree to
  within a few per cent; a first run after the machine has been busy does not —
  `menu.test.ts` read 2.3s cold and 0.3s warm, the same file either way.
- A test step whose per-file report cannot be read fails, though its suite
  passed and its exit code was 0. That is deliberate: a check that could not
  gather its evidence has established nothing, and an instrument that stops
  working quietly is worse than one that fails loudly. It does mean a
  temporary-directory problem, or a vitest release that changes the report's
  shape, reddens a run over something other than the code.
- `verify` reads that report from a temporary file, and the part of `verify.ts`
  that writes, reads and removes it is reached by no test — the same boundary as
  `check-push`'s CLI half below. What the arguments are and what the reading
  says are both checked; the six lines that carry a file between them are not.
- Nothing forces `pnpm check-push` to be run. It is a step in the commit
  procedure, not a gate, so a push nobody checked is indistinguishable from one
  that passed.
- `pnpm check-push` reports a run's warning annotations without asserting that
  there are none, so a run that started carrying one is a number on a line
  somebody has to read rather than a check that fails. That is deliberate, and
  the reasoning is in ADR 0019.
- `pnpm check-push` needs GitHub to still hold the run's log. Logs are retained
  for a limited period, and after that the run cannot be verified this way. The
  check reports that the log could not be read, rather than reporting a run that
  printed nothing it recognised.
- `pnpm check-push`'s CLI half is reached by no test. It fetches the run list,
  the log, the job times and each job's annotation count, and parses each, and
  no fixture can see which arguments those calls carry. The boundary between
  that half and the tested one is drawn by a header comment and nothing else, so
  code can cross it without anything noticing.
- `readme-status-date`'s subject count has never been observed independently of
  `commit-message-policy`'s: every commit so far has touched README. The first
  commit that leaves README alone is the first run that can tell them apart.
- The sign-off rule has three outcomes and real commits reach two of them. Most
  commits carry no trailer at all, and every `Signed-off-by:` in history names
  its own author, which is the allowed branch. The rejected branch — a sign-off
  naming somebody else — is reached by no commit at all, only by fixtures.
  Nothing is grandfathered, and that is why: the trailers that exist comply.
  This is the same shape as the bullet above.
- The subject rule's rejecting branch is reached by no commit either. All
  seventeen subjects that existed when it landed were lowercase throughout, at
  most 48 characters, and carried no colon, so it arrived at a set that already
  complied and every rejection it has ever made was of a fixture. That is now
  three places where a branch is told apart by fixtures and never by a real
  subject.
- Of the four things `AGENTS.md` says about a subject line, three are checked
  and one is not. Imperative mood is not decidable by a program, so nothing
  enforces it and no run will ever go red over it. The file says which is
  which, because a document stating four rules of which three run is worse than
  one that says so ([ADR 0025](adr/0025-make-the-subject-clauses-executable.md)).
- The prefix clause matches the Conventional Commits grammar, whose type is
  letters. A hyphenated pseudo-prefix — `check-push: read the log` — passes.
  Widening the type would make it coincide with the trailer key grammar and
  would take a case with it, which is the trade recorded in ADR 0025.
- The invariant is wider than the check that guards it. `collectInput` is
  checked by collecting twice under two constructed environments that differ in
  the operator's git configuration, in `HOME` and in `TZ`. An input read from
  somewhere else on the machine — a hostname, a path outside the repository, a
  variable nobody thought to vary — passes that check. It catches the class of
  input that produced the divergence in
  [ADR 0022](adr/0022-take-a-checks-inputs-from-the-repository.md), not
  every way a check could learn something about its operator.
- The convention checker carries nine rules. The rest arrive with the code they
  govern, so that each rule shows up to a set of subjects that already comply.
- `compose.yaml` carries development credentials inline, and starts a Redis
  that nothing connects to.
- `pnpm install` modifies git configuration in your clone, as described above.
- AGPL-3.0 rules this out for some companies as a matter of policy. That is a
  deliberate trade, not an oversight.
- The name is a description, not a brand. The first release did not change it,
  and the gate that now binds is in
  [ADR 0003](adr/0003-choose-the-name.md): before `v1.0.0`, or before this
  repository has stars, forks or dependents.
