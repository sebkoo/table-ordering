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
