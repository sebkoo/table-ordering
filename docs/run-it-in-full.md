# Run it in full

This is the README's "Run it in full", moved here whole by
[ADR 0041](adr/0041-move-the-depth-under-the-rules-sight.md). Nothing in it
changed except the two record links and the two sentences that pointed at the
quickstart the README keeps; one paragraph was re-wrapped where that lengthened
it.

The rest of the walkthrough the README's "Run it" begins: the role the API
connects as, ordering and reading back with `curl`, a member of staff, the two
pages, and what the checks do.

The API connects as `table_ordering_app`, not as `table_ordering`. The
migration the README's quickstart applies creates that role and grants it
`usage` on the schema, which is why there is no step here for it. Against a
schema that predates that migration the connection still succeeds and the query
does not: with no `usage`, the schema drops out of the role's `search_path` and
PostgreSQL answers `relation "restaurant" does not exist`, which reads like a
missing table and is a missing grant.

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
([ADR 0024](adr/0024-report-what-each-test-file-cost.md)).

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
([ADR 0019](adr/0019-report-a-runs-warnings-without-asserting-them.md)). It
reads `1 warning` above because that run predates the action bump that ended it.

It needs `gh`. Without it the last two lines skip and name what is missing, and
`--require-environment` turns those skips into failures, which is what the
commit procedure passes.

`docker compose up -d` also starts Redis. Nothing connects to it yet, and it
publishes no host port.
