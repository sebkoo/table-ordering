# 0028. Check the window where it is restated, and leave the records alone

- **Status:** accepted
- **Date:** 2026-08-25

## Context

`OPEN_WINDOW` is `'2 hours'` in `services/api/src/features/order/sql.ts`. ADR
0027 shipped the sentence a guest reads when their table has nothing at it —
"No order has been sent from this table in the last two hours" — and recorded the
cost of it in the same breath:

> `apps/guest` does not depend on `services/api`, so the page cannot import that
> constant. **If the window moves to ninety minutes, the route changes, its
> conditions still pass — they import the constant and bracket whatever it says —
> and this page goes on telling a guest two hours, with nothing to go red.**

It also named the repair and deferred it: "What would close it is a repository
check that fails when `OPEN_WINDOW` moves and names every place restating it".
This is that check. By ADR 0004's rule it is one commit late — the first subject
arrived with the route, not with the page — and the cost that record puts on a
late rule is not paid here: the seven subjects it arrives at all comply.

**What the tree actually carries.** Read rather than carried forward, wrap-aware,
because a restatement can straddle a soft line break:

| where | restatements |
| --- | --- |
| `README.md` | 6 — lines 113, 119, 409, 580, 592, 604 |
| `apps/guest/src/features/order/placed.tsx` | 1 — `NOTHING_IN_WINDOW` |
| `services/api/src/features/order/order.test.ts` | 2 — comments on the window fixtures |
| `docs/adr/0026` | 3 |
| `docs/adr/0027` | 5, one of them a hypothetical value rather than the value |

Seventeen in all, plus the declaration itself. One of the seven governed sites is
split across two lines: `README.md:580` ends with `two` and 581 begins with
`hours`. A reader taking one line at a time finds six of seven and reports a
number that looks entirely reasonable.

**Two durations in these files are not the window.** `README.md:594` says
"parties can be minutes apart", a noun with no number in front of it. `sql.ts:96`
says "five minutes", in the paragraph above the value, and the order suite
carries `10 minutes`, `5 minutes`, `100 minutes` and `3 hours` as fixture ages.
Both facts constrain the selector rather than decorate it.

## Decision

**A convention rule, `open-window-restated`, reads `OPEN_WINDOW` from the file
that owns it and every duration in the documents that describe the system as it
stands, and requires each to say what the constant says.** Seventh rule; seven
subjects; `expectsSubjects: true`, so prose that stops restating the window
entirely is reported as a rule that inspected nothing.

**It reads two paths — `README.md` and `apps/guest/src/features/order/placed.tsx`
— and not a directory.** The file that owns the value also carries a duration
that is not it, so a selector aimed wider reports the value's own docblock.

**A mention is a number then the unit, matched across the file with its newlines
still in it.** The gap crosses a wrap, for the reason `readRunStepCommands`
already joins backslash continuations: a line-based reader both invents
violations and misses them, and here it would miss `README.md:580` while
reporting six subjects, which looks like success.

**The number vocabulary is wider than the one word in use.** Its job is to
recognise a *wrong* window as well as the right one: a sentence edited from two
hours to three hours has to arrive as a subject that disagrees, not as a subject
that disappeared. What it must reach is the numbers English writes as words, not
the windows this project might pick — and `minutes apart`, with no number in
front of it, is what it must still not read.

**The rule also asks whether it has a word for the window's own number**, and
reports the absence beside every mention. It never fires while the window is two
hours. That is not inert, in the way ADR 0004 defends `expectsSubjects`: it is
what keeps the vocabulary complete as values move, so that the sentence a moved
value leaves behind is still readable, and therefore still nameable, at the next
move.

**`docs/adr/` is outside the rule.** A record's window is a capture: it was true
of that decision on its date, and it stays valid afterwards for the same reason
every other capture in this repository does — `AGENTS.md` already says a capture
framed as history stays as written while only its values have moved. The
repository amends a record by appending a forward reference and never by
rewriting the decision, and `write-adr` states the mechanism for one that is
reversed: a new record supersedes it, and the old one is marked superseded rather
than edited away. This is narrower than the sentence in ADR 0027 that scheduled
the rule, which named "README and ADR 0026", and the narrowing is the decision.

## Rejected alternatives

- **Reach into `docs/adr/`, as ADR 0027 scheduled.** Three of the restatements
  live there and the record that asked for this rule asked for them, which is a
  real case and the closest one. Rejected because the rule could then only go
  green by rewriting an accepted decision, which is the one edit this repository
  does not make to a record — and a rule whose only repair is forbidden is a rule
  that gets bypassed. ADR 0027's own "if the window moves to ninety minutes"
  would be a permanent violation, or an exemption written for a sentence rather
  than for a class.
- **Carry the window on the response, as `windowMinutes`, and format it on the
  page.** The only answer that makes the drift impossible rather than checked.
  ADR 0027 rejected it on four counts and none has moved; it also reaches the
  page and not README, where six of the seven restatements are.
- **A shared package holding the sentence, imported by both workspaces.** It
  removes the copy instead of checking it, which is the better shape when there
  is enough to put in it. Rejected because it is a workspace, a build and a
  version for one string — the seam ahead of its first implementation that ADR
  0004 refuses — and it still does not reach README.
- **A test in `apps/guest` importing `OPEN_WINDOW` across the workspace
  boundary.** Rejected already by ADR 0027, for a reason that has not changed: a
  test is not a reason to open a boundary the application does not cross. It also
  reaches one of the seven sites.
- **Match any `hours?` or `minutes?` in the two files, with no vocabulary at
  all.** By far the simplest selector, and it needs nothing taught. Rejected on
  the tree: `README.md` already carries "parties can be minutes apart", so the
  repair would be rewording README to suit the checker — the rule legislating the
  prose rather than checking a value.
- **A vocabulary of exactly the word the tree uses.** No guessing, and one entry
  is enough to read every subject that exists today. Rejected on the second
  direction of the break: a sentence edited to a wrong window in any other word
  would stop being a subject rather than become a failing one, and the rule would
  pass a wrong window by not recognising it.
- **Read the mentions line by line.** Every other reader in the checker that
  works on README does something like it. Rejected because `README.md:580` is
  wrapped mid-phrase, so this finds six of seven and reports a plausible number —
  the failure that is worse than no rule, because it looks like coverage.
- **Pin the sentences verbatim beside the value, and compare text rather than
  read a duration.** No vocabulary, no parsing, and it names each site. Rejected
  because it passes for an incoherent pin — a value moved while the pinned phrase
  is not — and it fails on any rewording that has nothing to do with the window,
  which makes it a rule about prose rather than about a value.

## Consequences

**The window has one place that reddens when it moves, and it names the lines to
edit.** A run that moves the constant to ninety minutes fails with seven
violations, each carrying the file, the line, what the sentence says and what the
constant says.

**Three restatements in `docs/adr/` are checked by nothing**, deliberately. They
are captures, and what a moved window owes them is a superseding record rather
than an edit.

**The rule reads two paths.** A restatement somewhere new is invisible to it, and
so is a wrong window written as a number word the vocabulary does not carry. Both
are recorded here and in README rather than hidden, in the same posture ADR 0016
takes towards the fence tag `run-step-single-transaction` depends on.

**`expectsSubjects` now has a rule whose zero case is reachable.** For the two
rules ADR 0004 shipped with it, the zero case is already a skip; here it is a
README that has stopped restating the window, and the runner reports that the
rule inspected nothing rather than that it found nothing wrong.

**The comments on the window fixtures in `order.test.ts` still restate the
value.** They sit beside code that imports the constant, and the condition they
annotate reddens on values when the window moves — the bracket is a hundred
minutes and three hours, and a ninety-minute window drops the first out of the
answer. Parsing comments for a value the file already imports is more machinery
than that risk warrants.
