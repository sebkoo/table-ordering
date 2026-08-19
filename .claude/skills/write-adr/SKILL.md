---
name: write-adr
description: Use when recording an architecture decision in docs/adr - fills the repository template and refuses to finish without a populated Rejected alternatives section.
---

# Write an architecture decision record

## Template

Copy `docs/adr/0000-template.md`. That file is the only template; this skill does not carry one, because two templates drift apart.

## Numbering and naming

- Take the next unused four-digit number in `docs/adr/`.
- Name the file for the decision, in lowercase imperative: `0007-mint-table-sessions.md`.
- Numbers are never reused and records are never deleted. A decision that is later reversed gets a new record that supersedes the old one, and the old one is marked superseded rather than edited away.

## When to write one

Write a record in the commit that first introduces the decision's subject. A record written before there is any code to govern is a prediction, and it will be wrong in ways nobody can see yet.

## Required sections

All five, in this order. A record missing any of them is not finished.

1. **Title** — the decision, not the topic.
2. **Status** — proposed, accepted, or superseded by `NNNN`.
3. **Context** — what is true that forces a choice. External sources belong here, cited.
4. **Decision** — what was chosen, in the present tense.
5. **Rejected alternatives** — each alternative named, with the reason it lost.

## The rejected alternatives section

**Do not finish without it, and do not leave it empty.** Each entry names a real alternative and the specific reason it was not taken. "We considered other options" is not an entry.

If nothing was genuinely rejected, there was no decision to record, and the record should not exist.

An alternative with a strong case is written up with its strong case intact. A record that makes every rejected option look foolish is not a decision record, it is an argument, and it leaves the next reader unable to reopen the question when the constraints change.

## Register

State decisions and their reasons. Do not argue with an imagined critic, do not describe the record's own drafting, and do not justify a decision by pointing at the shape of another record.
