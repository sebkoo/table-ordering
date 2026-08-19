# 0013. Bound the CI job in time, and take Chromium's system libraries from the runner image

- **Status:** accepted
- **Date:** 2026-08-19

## Context

Run `32303992200` has two attempts. The first ran fifteen minutes and twenty-one
seconds and was ended by a person, still inside the step that installs the
browser. The second passed in seven minutes and twelve seconds. The job declares
no `timeout-minutes`, so it runs under the platform default of six hours: there
was nothing to end the first attempt except somebody noticing it.

The second attempt's log says what the step was doing. Running
`playwright install --with-deps chromium`, apt reported every shared library
Chromium needs as already installed at the newest version — `libnss3`,
`libgbm1`, `libasound2t64`, `libdrm2`, `libxkbcommon0`, `libcups2t64`, the
`libatk` set, `libpango-1.0-0`, `libcairo2`, `libx11-6`, `xvfb`,
`libfontconfig1`, `libfreetype6`, `fonts-liberation` and
`fonts-noto-color-emoji`. It then installed nine packages, all of them fonts:

```
The following NEW packages will be installed:
  fonts-freefont-ttf fonts-ipafont-gothic fonts-tlwg-loma-otf fonts-unifont
  fonts-wqy-zenhei xfonts-cyrillic xfonts-encodings xfonts-scalable
  xfonts-utils
0 upgraded, 9 newly installed, 0 to remove and 16 not upgraded.
Fetched 21.1 MB in 6min 12s (56.6 kB/s)
```

That step took six minutes and thirty-five seconds of a seven-minute job. The
browser it exists to fetch came from `cdn.playwright.dev` in ten seconds.

Separate the observation from the inference. What the log reports is that on
this runner image, on this date, `--with-deps` installed no library and fetched
21MB of fonts for Japanese, Chinese, Thai and Cyrillic script over a mirror that
was serving at 56.6 kB/s. What this project concludes from it is that the flag
is buying nothing this repository's checks use, and is buying it from the slowest
thing in the run.

Every job that has ever completed here took 17s, 28s, 63s, 2m32s or 7m12s.

## Decision

**The job declares `timeout-minutes: 10`, and the browser is installed without
`--with-deps`.**

Ten minutes is chosen from the numbers above: it is above the slowest run that
has ever passed here, so it fails nothing this repository has actually
completed, and far below the stall that a person had to end. The bound is on the
job rather than on a step. One number then covers every step, including steps
added later, where a step's bound covers only the step it is written on and a
job can still stall in the gaps between them.

Dropping `--with-deps` moves Chromium's system libraries from apt to whatever
the runner image already carries. What makes that safe to depend on is not a
guarantee from the image, which this repository has none of, but the probe ADR
0011 already put in front of the guest suite: it launches Chromium and closes
it, and a browser that cannot start is reported as `chromium could not launch`
under `--require-environment`, which CI passes. A missing library therefore
arrives as a named failure rather than as a timeout.

ADR 0010 rejected `channel: 'chrome'` because the browser would then be whatever
version the image happened to carry. That reasoning is about the browser under
test, whose version stays pinned by the lockfile and by the `playwright install`
step. The libraries it links against are not under test, and their absence is
observed rather than silent.

**A convention rule, `workflow-job-timeout`, requires every job in
`.github/workflows` to declare a bound.** It asks whether one is declared, never
which one; the right number depends on what a job does and is decided in the
workflow, where the reasons sit beside it.

## Rejected alternatives

- **Keep `--with-deps`.** It is the reading of the documentation that cannot be
  wrong: the flag exists precisely so that a caller need not know what Chromium
  links against, and dropping it trades that for a property of an image somebody
  else updates. It costs six and a half minutes per run and puts a package
  mirror on the critical path of every check, which is the failure actually
  observed rather than one imagined.
- **Cache `~/.cache/ms-playwright`.** ADR 0010's consequences and the README both
  name this as the obvious next move, and it remains worth making. Measured
  against this run it addresses the wrong half: it would save the ten-second
  browser download and none of the six minutes and twelve seconds apt spent.
- **Raise apt's retry count, or pin a different mirror.** It keeps the flag and
  makes the observed stall less likely. It leaves the mirror in the path of every
  run for packages nothing here renders, and a retry against a mirror serving at
  56.6 kB/s is a slower run rather than a failed one.
- **Install a curated list of libraries with `apt-get` directly.** More explicit
  than the flag about what is required. It is still apt and still the mirror, and
  it adds a list that has to be kept in step with playwright's own as the browser
  moves.
- **A step timeout on the browser install instead of a job timeout.** It names
  the step in the failure, which the job timeout leaves to be read off the run.
  It bounds one step and lets a run stall in any other, and a step added later
  arrives with no bound at all.
- **Five minutes.** Roughly five times the expected job once the apt step is
  gone, and tighter feedback when something hangs. It sits below the seven-minute
  run that did pass, so a slow browser download, or this decision being reverted,
  would fail a run that would otherwise have finished.
- **A Playwright container image for the job.** ADR 0010 rejected it, and the
  reason still holds: it changes the image every check runs in, including the
  checks with nothing to do with a browser, and pins the toolchain to a vendor's
  base image.
- **The bound in `ci.yml` with no rule to require it.** One value, no checker
  change, and the number is visible where it applies. Nothing would then notice a
  second job arriving without one, which is the state this record was written
  from.
- **A rule that also caps the value.** It would stop a bound being raised to six
  hours to make a red run green. It would put a wall clock for jobs nobody has
  written into a checker that cannot know what they do, and the number it
  enforced would be a guess in exactly the way ADR 0004 rejects.

## Consequences

CI depends on the runner image carrying Chromium's shared libraries, and nothing
in this repository pins that. What catches the regression is the guest suite
failing by name, which is a slower signal than an install step failing but a
legible one.

The nine font packages are no longer installed. The guest page renders Latin
text and a `£`, and `fonts-liberation` is on the image, so nothing checked today
depends on them. A menu in a script the image has no font for would render
boxes, and no check here would say so; that is the problem menu translations
inherit when they land.

The job now fails at ten minutes. A suite that legitimately grows past it has to
raise the number deliberately, which is the intended cost.
