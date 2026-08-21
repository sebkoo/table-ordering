# 0022. Take a check's inputs from the repository, not from the machine

- **Status:** accepted
- **Date:** 2026-08-21

## Context

CI rejected `77909c7` and every local run accepted it. The tree was identical,
the history was identical, and the checker was the same file.

```
77909c7   local pnpm verify      commit-message-policy  PASS  14 subjects
77909c7   fresh sibling clone    commit-message-policy  PASS  14 subjects
77909c7   CI                     commit-message-policy  FAIL  14 subjects, 1 violation
```

The violation named the commit's own sign-off trailer. `collectInput` built its
`allowedIdentity` from `git config --get user.email`, and
`commitMessageViolations` allowed a `Signed-off-by:` only when it carried that
address. The rule therefore read "a sign-off is allowed if it names whoever is
running this check". On the author's machine every trailer they would plausibly
write passes; on a machine where the setting is absent, none can. CI configures
no identity, so CI could never accept a sign-off from anyone.

Reproduced as a value diff inside one clone of `77909c7`, one variable changed:

```
$ node tools/check-conventions.ts
  commit-message-policy ........ PASS  14 subjects

$ GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null node tools/check-conventions.ts
  commit-message-policy ........ FAIL  14 subjects, 1 violation
```

The clone is what made it reproducible. `GIT_CONFIG_GLOBAL` and
`GIT_CONFIG_SYSTEM` do not reach a repository's own `.git/config`, and this
repository's carries a `user.email` of its own; a clone drops that and inherits
only the global file, which suppressing then removes.

Of the nine values `collectInput` collected, eight came from the tree or from
the history. One came from the machine, and it is the one that failed. That is
the shape of the defect, and it is wider than the rule that carried it: a check
that takes an input from its operator reports a fact about whoever ran it.

The commit-message policy has a second property that the machine-local identity
was never able to use. A sign-off is the one trailer `AGENTS.md` permits,
because it attributes the work to nobody but the author — and an identity read
from the machine cannot tell whether the address in the trailer is the author's,
which is precisely what the trailer claims.

## Decision

**`collectInput` reads the tree and the history and nothing else, and a
`Signed-off-by:` trailer is allowed when it names the commit's own author.**

The history check collects each commit's `%ae` alongside its message and judges
the two together, so the verdict is a property of the object and is identical
wherever it is computed. `%ae` rather than `%aE`: the rule asks what the commit
says about itself, not what a `.mailmap` would rewrite it to.

The scope is `Signed-off-by:` alone. `Co-Authored-By:`, `Reviewed-by:` and every
other `*-by:` trailer stay rejected however they are addressed. That is the
distinction rather than a simplification: a sign-off naming the commit's own
author attributes the work to nobody else, and a co-authorship trailer
attributes it to somebody else, which is the thing the policy exists to forbid.

The `commit-msg` hook asks `git var GIT_AUTHOR_IDENT` instead of
`git config --get user.email`. Before the commit exists there is nowhere else to
ask, but the two are not the same question: under `GIT_AUTHOR_EMAIL` or
`--author` the configured address is not the one the commit will carry, and a
hook reading the configuration would accept a sign-off in the name of somebody
who is not the author. The invariant in `AGENTS.md` carries that boundary
itself, rather than leaving it to this record: the identity a commit-to-be will
carry is part of that commit, as a flag the caller passes is part of the
question.

**The clone probe in `.claude/skills/land-a-change` runs with the environment
suppressed as well as the tree replaced.** That is the same decision, not a
second one. A check must give the same answer wherever it runs, and the step
that stands in for CI before a push has to run it the way CI will. It matters
beyond tidiness because of which pre-push check can see a new commit's message
at all: the hook sees it but runs with the author's own configuration; the suite
before the commit runs under CI's conditions but the commit does not exist yet;
the diff read cannot see a message, because a message is not in the diff. The
clone probe's own `pnpm verify` is the only one left, and until now it inherited
the machine's global configuration and so answered as the operator.

## Rejected alternatives

- **A named identity stated in a file in the tree.** Machine-independent, and it
  would have fixed the divergence completely. It lost on two counts. It puts a
  person's address into the tree as a new surface to maintain, and it answers a
  weaker question: a list of permitted signers allows any listed person to sign
  off any commit, so it could not catch signing off in somebody else's name --
  the one thing the trailer is for.
- **Forbid `Signed-off-by:` outright.** The strictest reading, and the only one
  that removes the identity input rather than relocating it. ADR 0004 requires a
  rule to arrive on a set where nothing is grandfathered, and one commit in this
  history carries a trailer. The option is therefore available only by rewriting
  a pushed commit, which the procedure forbids. It would also discard the one
  trailer `AGENTS.md` deliberately keeps.
- **Give CI a git identity in `ci.yml`.** One line, and the run goes green
  today. It lost because it makes every machine wear the same costume while the
  verdict stays a fact about the operator: the next machine without that setting
  gets the old answer, and the defect is hidden rather than removed.
- **Compare against the committer, or against either the author or the
  committer.** All fourteen commits have author equal to committer, so a second
  permitted value would be a guess about a variation nobody has observed, which
  `AGENTS.md` declines. `git commit -s` writes the committer's address, so if
  the two ever separate here this is the record to revisit.
- **Assert `commit-message-policy`'s verdict under the two environments, and
  stop there.** It catches this defect. It lost because the defect's class is
  "an input taken from the operator", not "this rule": a verdict assertion would
  have to be written again for every future field, which is the same as not
  having one. The condition compares the whole `ConventionInput`, so a field
  nobody has written yet is covered by construction.
- **Pass the environment to `collectInput` as a parameter.** It would let the
  condition vary the environment without touching `process.env`. It lost twice
  over: a parameter makes the environment look like an input, contradicting the
  invariant this same commit adds, and a parameter with a default is a path
  production never takes — `main` would go on reading the ambient environment
  while the condition exercised the argument.

## Consequences

The hook still asks the machine, and must. `git var GIT_AUTHOR_IDENT` resolves
from `user.email` when nothing overrides it, so on an ordinary commit the hook's
input is still the operator's configuration. What changed is the question: it
asks who this commit will be authored by, and the answer is the value git is
about to stamp into the object. The history check is the authority, and the
clone probe is what runs it under CI's conditions before a push. Nothing forces
that probe to be run, which is the same gap `README.md` already records for
`pnpm check-push`.

The condition that guards the invariant is narrower than the invariant. It
collects twice under two constructed environments differing in git
configuration, `HOME` and `TZ`. An input read from somewhere else on the machine
— a hostname, a path outside the repository — would pass it.

The sign-off rule now has two branches and one real subject. Fifteen commits,
one trailer, and it names its own author; the rejected branch is exercised by
fixtures and by no commit in this history.
