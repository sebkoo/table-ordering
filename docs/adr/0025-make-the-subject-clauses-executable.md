# 0025. Check the subject clauses a program can decide, and say which one it cannot

- **Status:** accepted
- **Date:** 2026-08-21

## Context

`AGENTS.md` has stated four things about a commit subject since the bootstrap:
lowercase, imperative, under 50 characters, no Conventional Commits prefix.
None of them ran. The `commit-msg` hook and the `commit-message-policy` rule
share one predicate, and that predicate read trailers, URLs, generated-by lines
and emoji. A subject was whatever its author typed.

ADR 0004 says a rule about history cannot be deferred cheaply: history is
write-once, so a rule landing at commit three never governed commits one and
two, and the only way to make it govern them destroys the record it exists to
keep. That argument applies here in full, and this rule lands at commit
eighteen.

What decides whether that matters is not the argument but the set. All
seventeen subjects in history read against the prose, clause by clause:

- No subject contains an uppercase letter. `git log --format='%s' | grep '[A-Z]'`
  matches nothing.
- No subject contains a colon at all, so none carries a prefix.
- The longest is 48 characters — `report a run's timings from the log already
  read`.
- All seventeen read imperative.

So the rule arrives at a set that already complies, which is ADR 0004's
condition, and it arrives there by house style rather than by design: the set
was written before the rule. Nothing is grandfathered, no exception list opens,
and this was checked commit by commit rather than assumed.

One clause of the four is not decidable by a program. Mood is not a property of
a string. A suffix heuristic over-fires on `send`, `bound` and `pin`, which are
imperative and look like nothing in particular, and under-fires on any
past-tense verb it was not taught. A repository that states four rules of which
three run and one does not needs to say so, or a reader has learned nothing
from the fact that the file states them together.

## Decision

**Three clauses become conditions on the shared predicate, and mood stays
prose that `AGENTS.md` marks as unchecked.**

The three are a length bound read from the prose rather than chosen — "under
50" admits 49 — a Conventional Commits prefix matched by the specification's
grammar rather than by a list of type words, and lowercase.

**Lowercase means the whole subject, not its first character.** The two
readings differ in exactly one place, a capital that is not the first
character, and history resolves that place: the existing subjects write `ci`,
`os` and `http` where this repository's prose writes CI, OS and HTTP. The cost
is that a subject may carry no acronym and no proper noun — no `PostgreSQL`, no
`README`. Seventeen subjects manage it, so it is a house style and not an
accident, and it is recorded here so that a reader meets it before a rejected
commit does.

**The clauses live in the predicate, not in a second convention rule.** The
hook calls `commitMessageViolations` and nothing else, so a clause anywhere
else never reaches the commit it would have stopped, and reaching the hook is
the point: a bad subject caught in CI is already in history. A second rule
would have to call the same predicate and filter it, which is one predicate
reporting under two names. `commit-message-policy` still describes a rule
covering a message's trailers and its subject, so the name stays.

**The prefix pattern's type is `[A-Za-z]+`, and the narrowness is
load-bearing.** A trailer key is `[A-Za-z][A-Za-z0-9-]*`. Widening the type to
match would make the two patterns coincide, and then no one-line subject could
be trailer-shaped and accepted — which is the case that establishes a message's
only paragraph is not a trailer block. The cost is that a hyphenated
pseudo-prefix such as `check-push: read the log` passes.

## Rejected alternatives

- **A second rule, `commit-subject-policy`, beside the message rule.** Its case
  is real and it is about reading a failure: a subject violation and a trailer
  violation would report under names that tell them apart, instead of under one
  name whose detail line has to be read. It lost to the hook. The hook reaches
  exactly one function, so the clauses have to be in that function, and a rule
  that then re-derived them from the same output would be a second name for one
  predicate — the drift the shared predicate exists to prevent. That the rule
  count and the verdict-line count stay put is a consequence, not the argument.
- **Lowercase as a rule about the first character only.** The conventional
  reading of the phrase, and it is the more permissive one: it leaves room for
  a proper noun in a subject, which the chosen rule forbids outright. It lost
  because the seventeen subjects already resolve the ambiguity in the other
  direction at the only point where the readings differ, and a rule looser than
  the practice it records is not recording that practice.
- **An imperative-mood heuristic.** Some of the space is reachable: a
  dictionary of verb forms, or a suffix test for `-ed` and `-ing`. It lost
  because it is wrong in both directions on this repository's own subjects and
  because a check that is usually right about mood is worse than no check —
  it rejects good subjects, and a hook that rejects good subjects gets bypassed.
- **Scoping the rule to commits after this one.** It would let a stricter rule
  land without reading the set first. It lost because it was not needed: the
  set complies. It is also the worse shape in general — a rule with a date in
  it carries an exception nobody can see later, and a narrower rule with no
  exception is easier to read than a wide rule that quietly does not apply.
- **A clause forbidding a trailing full stop.** A real convention, and this
  repository follows it. It lost because `AGENTS.md` does not state it.
  Inventing a clause and dropping one are the same defect, and if a full stop
  should be forbidden that is a change to the prose first.
- **A clause requiring a non-empty subject.** Same reason. Git already refuses
  an empty message unless asked twice.
- **A prefix type widened to hyphens and digits.** It would catch
  `check-push: …`, which reads like a prefix. It lost because it would coincide
  with the trailer key grammar and take the trailer-block case with it.

## Consequences

A subject may not carry an acronym, a proper noun, or a colon-and-space after a
single word. The first two are the lowercase clause's cost, stated above. The
third is wider than "no Conventional Commits prefix" sounds: `psql: keep the
flag` is refused, and `stop psql dropping the flag` is not.

The rule's rejecting branch is reached by no commit in this repository and only
by fixtures, which is the same shape as the sign-off rule's rejected branch and
is recorded in README's limitations beside it.
