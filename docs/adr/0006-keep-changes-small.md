# 0006. Keep changes small, and make the acceptance condition executable

- **Status:** accepted
- **Date:** 2026-08-19

## Context

The observation comes from *SWE-Bench Mobile: Can Large Language Model Agents
Develop Industry-Level Mobile Applications?* (Tian et al., arXiv:2602.09540),
which evaluated coding agents on 50 tasks in a production iOS codebase.

Two of its reported gradients are relevant. Task success fell from roughly 18%
on tasks touching one or two files to roughly 2% on tasks touching seven or
more, and from roughly 20% on patches under 50 lines to roughly 3% on patches
over 200. "Roughly" is doing real work in both sentences: the per-bin counts
are small and the paper's own confidence intervals on the small bins are wide,
so these are directions, not point estimates.

Its failure analysis is the more useful half. Missing feature flags accounted
for 54% of failures, missing data models for 22%, and incomplete file coverage
for 11 to 15%. The common thread is not that hard tasks are hard. It is that
most failures came from not touching everything the change required — the
work was incomplete rather than wrong, and nothing in the process made the
required surface visible before the change was attempted.

Keep the inference separate from the observation. **That study measures task
and patch complexity, not commit granularity.** It does not report anything
about how work should be divided into commits. Small commits are a local
engineering policy taken in light of the result, not a finding of the study.

## Decision

A normal change is one behaviour with one observable, executable acceptance
condition.

"Executable" is the load-bearing word, and it is what the failure analysis
argues for: an automated check that fails before the change and passes after
it forces the required surface to be named up front, where a sentence in a
description does not.

Prefer a small change surface: usually one or two files and around 200 changed
lines or fewer. These are heuristics, not invariants. A coherent change is not
split to satisfy them, and file count is not the goal.

The bootstrap commit is the exception. It establishes repository mechanics and
spans the bootstrap file set, because a toolchain cannot be introduced one
file at a time.

## Rejected alternatives

- **No size guidance at all.** Leaves the gradient above unaddressed, and
  leaves "is this change too big" as a matter of taste with nothing to appeal
  to when the answer is contested.
- **A hard file-count limit.** Turns a heuristic into a rule that can be
  satisfied by making the work worse: a coherent change gets split across
  commits that individually do not work, which is the opposite of an
  executable acceptance condition per change.
- **Size guidance without an acceptance condition.** Small and unverified is
  still unverified, and the failure analysis points at incompleteness rather
  than at size as the proximate cause.
