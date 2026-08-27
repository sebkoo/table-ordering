# 0037. Produce the demo from a script in the tree, and publish it as a release asset

- **Status:** accepted
- **Date:** 2026-08-27

## Context

ADR 0032 put three stills of the two pages in the README, and named in the same
record the thing they cannot do:

> **A short GIF of the loop.** The loop is the product, and three stills only
> imply the motion between them. It lost on size: a legible loop at this width
> runs to several megabytes against the 45,217 bytes the three captures cost
> together, in a repository whose only other binary is the lockfile — two orders
> of magnitude, for a story the stills already tell in sequence.

The roadmap is complete. The loop the stills imply — a guest sends a round from
the code on their table, a member of staff signs in, the round is on the board and
is cleared from it — now runs end to end, and nothing in this repository shows it
moving.

That rejection was scoped to an asset in the tree, priced against the bytes the
three captures cost. It says nothing about an artifact that is never committed,
and this record does not supersede it: what it decides is where a moving picture
lives, which is a question ADR 0032 did not reach.

Two other things ADR 0032 decided bear directly on this one. It rejected a capture
script in `tools/`:

> It lost on what it would be: the only file under `tools/` with no test beside
> it, because what it emits is pixels nothing asserts on, and `feature-has-test`
> does not reach that directory to say so. A tool whose output no condition reads
> is a tool whose breakage is invisible.

And it rejected a third-party image host, because "a README image on somebody
else's origin is a request to somebody else's origin, which is the thing both of
these pages refuse".

### What the machine can encode

Probed by command before any format was chosen, because what is available here
decides most of this record. Playwright ships its own ffmpeg —
`n7.0.1-playwright-build-1011`, configured `--disable-everything` — and it reports:

| Probe | Output |
| --- | --- |
| `-encoders` | `png`, `libvpx` (VP8). Nothing else. |
| `-muxers` | `image2`, `webm`. Nothing else. |
| `-demuxers` | `image2pipe`, `matroska,webm` |
| `-filters` | `crop`, `pad`, `scale`, `trim`, `format`, `hflip`, `vflip`, `transpose`, `null` |
| `-protocols` | `file`, `pipe` |

No GIF encoder and no GIF muxer. No concat demuxer and no concat filter. No
`hstack`, `vstack` or `overlay`. On this machine `ffmpeg`, `gifsicle`, `convert`
and `magick` are all absent from the path, so the bundled build is the whole of
what is available without installing something.

Three questions close on that table rather than on argument: the format can only
be VP8 in webm; two clips cannot be joined; and two pages cannot be composed side
by side.

The recorder's own invocation matters for a fourth:

```
-r 25 -c:v vp8 -qmin 0 -qmax 50 -crf 8 -deadline realtime -speed 8 -b:v 1M
-threads 1 -vf pad=W:H:0:0:gray,crop=W:H:0:0
```

`W` and `H` are fixed when recording starts. A frame smaller than them is padded
with gray from the top left; a larger one is cropped. So the viewport cannot move
during a take, and the video size has to equal it.

## Decision

**The tree holds the producer; a release holds the product.** `tools/record-demo.ts`
records the loop, and the webm it writes is attached to a release when one exists
and is never committed. The tree gains no binary bytes, so ADR 0032's size
rejection is respected rather than superseded, and nothing is fetched from another
origin, so its hosting rejection is respected too.

**The take is planned before it is driven, and the plan is what a condition
reads.** The viewport, the video size, the destination, the two budgets and the
ordered acts are exported values, and `tools/__tests__/record-demo.test.ts` holds
five conditions on them: that the video size equals the viewport, that the
destination resolves outside the repository root, that the planned waits already
fit the duration budget, that the take opens the guest page at its printed code
and then the board, and that no act settles for less than the floor. This is the
answer to ADR 0032's objection. It is not that the pixels are asserted on — they
are not, and no program compares a picture with the page it shows — but that the
part of a recorder which can silently rot is the plan, and the plan is values.

**One take, one context, one viewport at 900×620**, which is the screen viewport
ADR 0032 already pins for the board, reused rather than invented. Both pages are
`max-width` columns centred in whatever width they are given, and neither carries
a media query, so one viewport renders both as they render anywhere; the guest's
column simply sits in gutters.

**Two budgets, one number each: 45 seconds and 6,000,000 bytes.** The second
follows from `-b:v 1M`, which cannot exceed it over the first. The planned waits
are checked against the duration budget by a condition, but that check is a lower
bound and not the budget: a take also spends time navigating, loading and acting,
so what settles it is the measured duration of a real run. An overrun is re-cut.

**The password moment is held by values read from the run.** ADR 0032 captured the
sign-in with the field filled and masked by the browser, and said the rule about a
secret in a page was demonstrated rather than dodged. A moving picture is a
stronger claim, because the value is typed on camera. The producer reads the
field's type before it types anything and refuses the take unless it is
`password`, then reads the rendered document afterwards and records whether the
typed value is on the node. It is, and that is the expected answer: the field is
controlled, so the value the person is typing is in the page by definition. That
is not the secret the page was handed -- the token is, and `staff.browser.test.ts`
already holds it against the document, both storages, the cookie jar and the
address bar. What keeps the password out of the picture is the masking, and what
keeps it out of the artifact is the search below. After the take, the file's bytes
are searched for the password, and the same search is run against a string known
to be in the container so that a count of zero means the search worked rather than
that it looked for the wrong thing.

**The revision is the tag.** `capture-caption-resolves` holds every picture in the
documents to a caption naming a revision that resolves. It reads inline image
syntax in `README.md`, `AGENTS.md` and `docs/adr/*.md`, so a video is invisible to
it in principle and no video enters those files in practice. What replaces the
caption is the release: an asset hangs on a tag, and a tag is a revision. That is
the residue this decision leaves, and it is stated rather than hidden — a release
built from the wrong revision would carry a recording of code the tag does not
name, and no program here would say so.

## Rejected alternatives

- **A GIF.** ADR 0032's rejection stands on its own terms and is not reopened,
  but it is a rejection about bytes in the tree, and a release asset has none. The
  ground here is different and harder: there is no GIF encoder. The bundled ffmpeg
  reports zero gif encoders and zero gif muxers, and nothing on this machine
  supplies one. **Trigger to revisit:** a release asset that has to render where
  webm does not play.
- **Installing an encoder.** `gif2webp` and `img2webp` are on this machine, and a
  package manager would supply `ffmpeg` or `gifsicle` in a minute. Rejected
  because a producer in the tree has to run at the revision it is checked out at,
  and one that depends on what somebody installed once is reproducible on that
  machine rather than at that revision. The bundled binary arrives with a
  dependency the lockfile already pins. **Trigger:** a format the bundled build
  cannot write becoming necessary.
- **Two clips, one per page, concatenated.** It is the shape that would let the
  guest be recorded at a phone width and the board at a screen width, each looking
  like the thing it is. Rejected on a probe rather than on taste: the bundled
  ffmpeg has no concat demuxer and no concat filter, and its only protocols are
  `file` and `pipe`. **Trigger:** a build that carries either.
- **A side-by-side composition, both pages at once.** The strongest case of any
  alternative here — the loop is a relationship between two screens, and showing
  them together shows the relationship rather than implying it across a cut.
  Rejected because no stacking or overlay filter exists in the build, so it cannot
  be done without new tooling. **Trigger:** as above.
- **A phone viewport for the whole take.** The guest's page would look like what
  the product actually claims — a menu on a phone at a table. Rejected because the
  board is the other half of the loop and ADR 0032 pinned 900×620 for it after
  looking at it; a take that renders one page well and the other cramped has
  chosen which half of the loop matters. **Trigger:** a board that reads as well
  narrow as wide.
- **Playwright's action decorations.** `showActions` draws an animated cursor, which
  would make each click legible instead of leaving the viewer to infer it from a
  value changing. Rejected because it also draws an action title, at a fixed size
  and with no option to suppress it, which puts the automation tool's own
  vocabulary in the frame. What a stock recording writes into the container is
  unavoidable; what it paints into the picture is not. **Trigger:** a viewer who
  cannot tell that a click happened.
- **Chapter cards, or any narration.** The recorder offers them and they are the
  ordinary way to make a demo self-explanatory. Rejected because the product is
  the subject and a card is a caption that no check holds; the README already
  carries the prose. **Trigger:** a flow that cannot be followed without one.
- **Bytes in the tree.** Committing the webm would make the demo reproducible by
  checkout rather than by running anything, and would give it a caption the ninth
  rule could hold. Rejected on ADR 0032's arithmetic, which this shape avoids
  entirely rather than argues with. **Trigger:** a rule that can hold a moving
  picture's caption, and an asset small enough to sit beside the stills.
- **Uploading from the web editor.** Rejected on identity: an asset attached
  through a browser session carries whatever that session is, and this repository
  is careful about what its commits and its artifacts are authored by.
- **`playwright` as a root dependency.** It would let the producer import the
  package by name. Rejected because it declares a third copy of something the two
  workspaces that use it already pin, moves the lockfile, and undoes the care
  `tools/verify.ts` takes to reach a browser without the root depending on one.
  The producer resolves it through `apps/guest` instead, which is what that file
  already does for its browser probe.
- **No script at all, with the recipe written into this record.** This is what ADR
  0032 chose for the stills, and the case for repeating it is consistency: what a
  later capture has to match was written into prose and the tree stayed clean.
  Rejected because the two artifacts are not alike. A still's recipe is a viewport,
  a fixture and an ordering — four facts a person re-executes. A take is a
  timeline: which control at which moment, and how long the picture rests on each
  so a viewer can read it. Prose cannot carry a timeline faithfully, and a
  recording made from a description of one is a different recording.

## Consequences

`tools/` gains a file that is not a check and does not run in CI. It is not
collected by vitest, the workflow is untouched, and no convention rule reaches the
directory — but `typecheck` and `lint` both read it, so it is not free, and saying
it costs the pipeline nothing would be a hope rather than a prediction.

The demo has nowhere to live until a release exists. This commit makes none, and
writes no link to one: a link to a release that does not exist is a dead link. The
producer is demonstrated by running it, and what that run measured is reported
rather than committed.

A recording is bound to the revision it was taken at exactly as a still is, and
with less protection: there is no caption and no rule. The tag is the whole of the
binding, so a release whose asset was recorded from a different tree is a mistake
only a person catches.
