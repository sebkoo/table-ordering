# 0018. Pick a revision's newest run, and extract only a picking that fails silently

- **Status:** accepted
- **Date:** 2026-08-21

## Context

`pnpm check-push` reports on one workflow run. Which run that is has to be
chosen from what `gh run list` returns, and a revision can carry more than one:
a re-run, a re-dispatch. The list `gh` returned for `main` on 2026-08-20 holds
fourteen runs and two revisions with two runs each, so this is ordinary history
rather than a case anyone has to invent.

`gh` documents no ordering for that list. It emits newest first, and a choice
that takes the first match is therefore correct today by coincidence rather
than by rule.

The choice also sits below `check-push.ts`'s CLI banner, where no test reaches
it. That places it against a standing habit in this repository: `verify.ts`'s
`summaryLine` is unexported and unreached, and nothing here has ever been
extracted so that a test could reach it. A record that licensed extraction
generally would land while `summaryLine` sat on the wrong side of it, which
ADR 0004 forbids — a record arrives on a set that already complies, with
nothing grandfathered.

Two observations, kept apart from what this project concluded from them.

`gh run list --branch main --limit 30 --json databaseId,headSha,status,createdAt`
returned fourteen runs when thirty were asked for, and the message for a
revision it does not hold read `among the last 14 on main` — the count observed,
worn as though it were the window requested.

The guest page's `menu.tsx` splits a failed menu fetch two ways, and one branch
is reached by no condition. Which one was measured rather than reasoned about:
the acceptance suite serves the built client through `vite preview` with a
proxy at the API it started, and stopping that API leaves the proxy with no
upstream. Run against `vite@8.2.1`, with the upstream closed, the preview server
answers `HTTP/1.1 502 Bad Gateway`, `Content-Type: text/plain`, with an empty
body. So the page's `fetch` resolves, `response.status` is neither 400 nor 404,
and it is `menu.tsx`'s `: { kind: 'unreachable' }` that produces the state the
condition asserts. `menu.tsx`'s `.catch` is the branch nothing reaches.
Asserting `data-state="unreachable"` could never have separated the two, which
is the same defect as reporting a 404 and a failed fetch alike.

## Decision

**A revision's newest run is the one reported on, chosen by `createdAt` rather
than by position, and the choice is a pure function the suite drives.** The
newest, because `check-push` reports what CI most recently said about a
revision: a re-run exists because somebody did not believe the first one, so an
older PASS does not survive a newer verdict. Two runs tied on the newest
`createdAt` are a violation naming both, not a tie broken by run id. The count
asked for is carried beside the count returned, so "there is no such run" and
"this did not look far enough" are different messages.

**And a function is extracted so a test can reach it when a wrong answer from it
is silent — when the tool goes on to print a verdict that reads correct and is
about the wrong thing.** A function that assembles a string from values decided
elsewhere is not extracted; a wrong answer there shows in the first run that
produces it. The sharper form, which is what makes the rule decide cases rather
than describe one: **a picking whose result is then compared against the
declaration fails loudly; a picking whose result is only inspected for its own
internal consistency fails silently.**

Applied to every function below the banner, with the verdict recorded either
way. `probeGh`, `gh`, `checkRun`, `checkMetadata`, `checkPush` and `main` stay
where they are: each either decides nothing or reports its own failure on the
line a reader is already looking at. `readRemoteRef` is the one that had to be
answered rather than assumed — it does pick a line out of `git ls-remote`
output — and it stays too, because `push-arrived` compares what it picked
against the revision the declaration names, so a wrong answer prints both
values. Silence would require the wrong extraction to produce exactly the
declared revision.

Applied to `summaryLine`: **it stays unexported and unreached.** It decides
nothing — its verdict comes from `exitCode`, which is exported and tested, its
skipped list filters reports already asserted, its elapsed is passed in — and
its shape is pinned from the other end, by the `SUMMARY` pattern and the log
fixtures in `check-push.test.ts`, which carry `verify: PASS  8.4s` and the
`(skipped: …)` clause byte for byte. A defect in it turns `run-verified` red on
the next push.

Applied to two branches nothing reaches — `probeTcp`'s timeout, and the guest
page's `.catch` — the rule asks for no seam. Both sit in functions a test
already reaches; what is missing is a fixture that can produce the state, which
is a different remedy from an extraction.

## Rejected alternatives

- **Take the first match in the order `gh` returned.** The smallest change, and
  it is what the tool did. It lost twice over. It ties the answer to another
  project's undocumented behaviour, the way printing `2m27s` would tie this
  tool's timings to `gh`'s display format. And it cannot be checked: with the
  order load-bearing, a fixture holding the same runs the other way up has to
  expect the other run, so the suite would certify the dependency instead of
  forbidding it.
- **Take the oldest run for a revision.** It has the merit of stability — the
  answer stops moving once it is given. It lost because it inverts what the
  check is for. A revision whose run was re-run has a newer verdict, and
  reporting the older one lets a PASS outlive the FAIL that replaced it.
- **Break a tie on `createdAt` by run id.** It always answers, and it never
  asks anyone to think. It lost because it trades one undocumented property for
  another: nothing says GitHub's ids order the runs that carry them. A tie is
  two runs GitHub says began at the same moment, which is a fact about the data
  and not a case for this tool to resolve quietly.
- **Fail whenever a revision has more than one run.** It refuses the ambiguity
  outright, which is defensible where a wrong answer is expensive. It lost on
  the data: two of the fourteen runs' revisions carry two runs each, so this
  would fire on ordinary history and would have to be worked around
  immediately.
- **Inject the fetcher, so the suite drives the request too.** It would pin what
  is asked of `gh` — the branch, the limit, the field list — which the fixture
  now cannot see. It lost because it is a seam with one caller and no observed
  second one, which this repository treats as a guess about a variation nobody
  has met. The unpinned arguments are also loud rather than silent: a dropped
  field arrives as `undefined` and meets the date guard, and a wrong branch
  yields no match for the revision.
- **Extract only the equality that compares two revisions.** The smallest
  extraction, and it touches the line the earlier audit named. It lost because
  it closes nothing: what no test reached was the choosing, not the comparing,
  and the claim that the CLI half holds an unreachable comparison would have
  stayed true.
- **License extraction for testability in general.** Simpler to state and
  simpler to apply. It lost because it would land while `summaryLine` sat
  unextracted, which grandfathers a violation on the day the record arrives. A
  rule that does not discriminate between the two is a rule that has not been
  written yet.

## Consequences

`check-push` asks `gh run list` for one more field on a call it was already
making. A `--json` list that stops naming `createdAt` no longer degrades
quietly: the field arrives as `undefined` and the first real run fails naming
it, where an ordering would have sorted it somewhere and answered with a
straight face.

The fixture that holds the captured list the other way up is legitimate only
while `gh`'s ordering is undocumented. If `gh` ever documents newest-first, a
reversed list becomes a shape the collector cannot produce, and that condition
establishes nothing and comes out.

A tie on `createdAt` now stops the check rather than being resolved. Nobody has
seen one. If one arrives, this rule is what will have to be revisited, and the
violation names both runs so that the person revisiting it has the pair in
front of them.

The rule about extraction is narrow on purpose, and the narrowness costs
something: a function whose wrong answer is loud stays out of reach of the
suite, however easy reaching it would be. That is the price of a record that
arrives on a compliant set.
