# 0032. Show both pages in the README as dated captures, and defer the check that would hold them

- **Status:** accepted
- **Date:** 2026-08-25

## Context

Both surfaces this product promises now exist: the page a guest opens from the
code printed on their table, and the board a member of staff signs in to. The
README describes each in prose and sketches each in ASCII, and shows neither.
For a reader who will never run `docker compose`, that file is the whole of the
product.

A screenshot is a restatement of a running program that no program compares with
the program. This repository prices that class carefully everywhere else: the
window a guest reads is restated in two files and a rule reads the constant and
fails every sentence that disagrees (ADR 0028), and a run step's flag is checked
in the README rather than described. An image is the same shape with no rule
behind it.

`AGENTS.md` already governs one honest form of an uncomparable restatement:

> A capture framed as history stays as written while only its values have moved.
> When its shape has moved, the label dates nothing a reader can use, and it is
> recaptured or removed.

That is what a `check-push` transcript in the README is, and what the two run
ids in `tools/__tests__/check-push.test.ts` are. A picture of a page can be the
same kind of object, and this record is about making it one rather than leaving
it as an undated claim.

Two constraints come from elsewhere in the tree. `open-window-restated` reads
`README.md`, so any prose added here — captions and alt text included — joins its
subject set the moment it contains a duration. And every file under `tools/` has
a test beside it: five sources, five tests, one to one.

## Decision

**The README carries three captures of the running product, in `docs/images/`,
referenced by relative path.** The guest's page with a round sent, the board's
sign-in, and the board itself — the loop, as three stills.

**Each caption names the revision the capture was taken at, and that revision is
`a8f828f`, this commit's parent.** That is the revision whose `apps/guest` and
`apps/staff` rendered the pixels; this commit changes no application code, so a
caption naming this commit's own sha would date the picture to a tree that did
not produce it. The revision appears in the caption and not in the filename:
two copies of a value need a third rule saying which one wins, and the caption is
the copy a reader sees.

**Captions name the surface and the revision, and carry no count and no
duration.** A duration would join `open-window-restated`'s subjects; a count is a
restatement that goes stale the moment anything is recaptured. Alt text is prose
about the product — what a reader who cannot see the picture would have seen —
under the same two prohibitions.

**The images are captured from the product, not drawn.** The API against a
schema built by the four real migrations, the fixture the run steps seed, a
credential produced by running the mint as a program, and the orders placed
through the guest page rather than inserted. What a later capture has to match,
since nothing in the tree reproduces it:

- Viewports `390×844` for the phone and `900×620` for the screen, each then
  shrunk to the bottom of `main` so the picture is the page and not the empty
  rest of a screen. `deviceScaleFactor: 1`, `colorScheme: 'light'`, `locale:
  'en-GB'` — all three explicit, because both pages declare `color-scheme: light
  dark` and the `£` follows the locale.
- The README's own fixture, plus a second table so the board has more than one
  table on it.
- Table 7 sends a round, then another; the other table sends one. The board is
  read after all three have landed.
- The schema was built by `psql` against the port `compose.yaml` publishes,
  rather than through `docker compose exec`, because compose was not on the
  machine the capture was taken on. It is the same container, the same
  migrations and the same flag; only the way in differs, and a later capture
  taken the way the run steps are written reaches the same database.

**The sign-in is captured with the password field filled, and masked by the
browser.** The rule about a secret in a page is demonstrated rather than dodged.
It discloses the length of a password that is destroyed with the capture schema,
which is the whole of what it costs.

**The captions are held by this record and by review, and by nothing
executable.** No program compares a picture with the page it shows. Saying that
is the honest line, in the same place ADR 0029 says a test cannot see the
difference between `timingSafeEqual` and `===`.

**The check is deferred, not judged infeasible.** A caption's revision resolves
against history, and a rule could require every image reference to name one, to
resolve, and to carry alt text — it would fail before this commit on zero
subjects and pass after on three, which is the shape ADR 0004 asks for. What is
missing is a second writer: a caption-drift check built before anything has ever
been recaptured polices a variation nobody has observed. **It lands with the
first recapture, or with the first image a later commit adds.**

## Rejected alternatives

- **A capture script committed under `tools/`.** It has the stronger case on
  reproducibility: the viewport and the fixture would be pinned in a program
  rather than in the prose above, and a recapture would be a command rather than
  a reading. It lost on what it would be: the only file under `tools/` with no
  test beside it, because what it emits is pixels nothing asserts on, and
  `feature-has-test` does not reach that directory to say so. A tool whose
  output no condition reads is a tool whose breakage is invisible. The
  reproducibility it would have bought is written into this record instead.
- **A rule holding the captions, landing here.** The case is real and is the
  same one ADR 0004 makes: a convention arrives with the commit that creates its
  first subject, and this commit creates three. It lost on the trigger above —
  the drift it would catch cannot happen until something is recaptured — and on
  change size: the rule, its fixtures and its subject count are a second
  behaviour, and this commit is one.
- **A short GIF of the loop.** The loop is the product, and three stills only
  imply the motion between them. It lost on size: a legible loop at this width
  runs to several megabytes against the 45,217 bytes the three captures cost
  together, in a repository whose only other binary is the lockfile — two orders
  of magnitude, for a story the stills already tell in sequence.
- **A third-party image host.** It keeps the bytes out of the tree entirely. It
  lost because a README image on somebody else's origin is a request to somebody
  else's origin, which is the thing both of these pages refuse and the
  repository's own description ends by promising; and because it rots on a
  schedule this repository does not control.
- **Mockups, or a DOM edited until it looked right.** Cheaper, and they would
  photograph better. They lost because a picture of something the product does
  not do is the one failure a caption cannot repair: the reader has no way to
  tell, and every other honesty in this file would be worth less for it.
- **Replacing the two ASCII sketches with the pictures.** The README would then
  carry one restatement per surface instead of two. It lost because the sketches
  do something the pictures cannot: they pin the exact strings, they read in a
  terminal and inside a diff, and each sits directly under the sentence that
  introduces it. The pictures answer a different question — what this looks like
  — and they answer it at the top, where a reader arrives.

## Consequences

`docs/images/` joins the tree, and no convention rule's collector walks it:
migrations come from `services/*/migrations`, features from
`{apps,services}/*/src/features`, jobs from `.github/workflows`, and both README
readers from `README.md` itself. The seven rules see three new files and report
the same subjects they did before.

The pictures will go stale, and that is provided for rather than prevented. A
caption pins each one to a revision, so a picture that no longer matches the page
is a fact about `a8f828f` instead of a false claim about today — until the shape
moves rather than the values, at which point `AGENTS.md` requires it to be
recaptured or removed.

Reading the README now costs a reader three image requests to GitHub. Nothing
this repository serves is affected: the invariant about origins is about the
pages, and these bytes are in the repository.

## Addendum, 2026-08-26

The trigger this record named has fired. What is above stays as it was written
on its own date; this section records what happened when it did.

**The deferred check is taken.** What was deferred, verbatim:

> The check is deferred, not judged infeasible. A caption's revision resolves
> against history, and a rule could require every image reference to name one, to
> resolve, and to carry alt text — it would fail before this commit on zero
> subjects and pass after on three, which is the shape ADR 0004 asks for. What is
> missing is a second writer: a caption-drift check built before anything has ever
> been recaptured polices a variation nobody has observed. **It lands with the
> first recapture, or with the first image a later commit adds.**

The recapture below is the first, so the rule lands with it rather than being
deferred a second time. The rejected alternative above — "A rule holding the
captions, landing here" — lost on that trigger and on change size, and the
trigger is what has now changed.

**The rule is `capture-caption-resolves`,** the ninth. It takes two collectors,
in the split this repository already uses for `migrationDirectory` against
`migrationLists` and `openWindow` against `windowMentions`: the authority arrives
as one list, the subjects as another, and the rule is what compares them.
`historyRevisions` is every commit's full sha, newest first, and null when the
repository is unborn — a collector of its own rather than a field on `Commit`,
which carries what the message policy asks about and nothing else.
`imageReferences` is every inline image whose target names a path in this
repository, with the paragraph that follows it and its soft wraps joined.

Per reference it asks four questions: that alt text is there, that the caption
names a revision, that it names exactly one, and that the one is a prefix of
exactly one sha. **Exactly one, not at least one.** A picture came from a single
revision, and a caption naming two dates nothing a reader can use — which is the
drift this rule is for, since a caption goes stale by gaining a revision rather
than by losing one. A prefix, not a containment: `8f828f7` occurs inside this
tree's own `a8f828f795…` without being its prefix, and a containment test would
call that resolved.

The revision is read as inline code — hex, seven to forty characters, between
backticks — and never sniffed out of prose. README carries about thirty
undelimited runs of seven or more hex characters in the UUIDs of its JSON
examples, and English supplies more: `defaced` and `effaced` are seven letters
drawn entirely from a to f. Inside a caption the backtick is what declares that a
token is a revision, and a rule reading prose instead would report violations
against words.

The history branch is asked first, and the order is load-bearing for the reason
`readme-status-date` gives: only that branch converts under `--require-history`,
so a rule that asked about the documents first would hide a missing history
behind a verdict nothing can turn red.

**The board is recaptured, and its caption names `0fe409d`.** That revision's
board carries both controls — a ticket can be cleared, and a round can be
recorded as paid — which is what ADR 0034 said a recapture had to wait for. The
other two captures are untouched and still name `a8f828f`: `git diff
a8f828f..0fe409d -- apps/` moves `board.tsx` alone, so the guest's page and the
sign-in render what they rendered. The fixture is the one this record pins, sent
in the order the board reads in, so the only difference in the pixels is the code
that made them.

**The counts move.** `verify` prints seventeen verdict lines where it printed
sixteen, and reports `9 checks` where it reported eight. The sentence above —
"The seven rules see three new files and report the same subjects they did
before" — was true of the tree it was written for; the rule count has moved twice
since, and this is the second.

**A shallow checkout would have broken the resolve clause, and does not.**
`.github/workflows/ci.yml` already fetches the whole history, with the reason
beside it: "The convention checks read commit history, so a shallow clone would
change what they are able to evaluate." That was read before this rule was
written rather than discovered by a red run, and it is quoted here so the next
reader knows the question was asked. A workflow that fetched depth 1 would need
either an explicit depth or a weaker clause, and neither was needed.

**What the rule still does not hold, and where it cannot see.** It holds a
caption's form and never its pixels. No program compares a picture with the page
it shows, so a caption naming a real revision above an image that revision never
rendered passes — the honest line, in the same place this record already put it.
The sentence above about collectors is still true as written: this one reads
documents, not `docs/images/`. Its path set is `README.md`, `AGENTS.md` and
`docs/adr/*.md`, so a picture added to `CLAUDE.md` or under `.claude/skills/` is
invisible, and what widens the set is the first picture that appears there rather
than a prediction about one — the posture ADR 0016, ADR 0028 and ADR 0035 take
with their own limits.

Reading the records is not the thing `AGENTS.md` rules out for
`open-window-restated`. That rule compares prose against a value that moves, so a
record it read would go red for having been written on its own date. This one
compares against history, which only ever grows: a revision that resolves today
resolves forever. The check is monotone, and the window's is not.
