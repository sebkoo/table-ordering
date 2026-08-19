# 0010. Observe the guest page in a real browser, and provision that browser explicitly

- **Status:** accepted
- **Date:** 2026-08-19

## Context

The guest page arrives with two conditions on it. It shows a restaurant's menu,
fetched from this application's own API. And a fresh load of it reaches no origin
but its own — no analytics, no telemetry, no remote font, no CDN asset, no
tracking beacon.

The second one decides how both are checked. What it guards against is a request
a running page makes, and a request is not an import. A rule that reads the
source for third-party packages passes while a `fetch` to a CDN inside a
dependency walks through it, in the same way a test built from inputs the real
collector cannot produce agrees with itself about a system nobody exercised.
Nothing that reads files can observe it. Something has to load the page and watch
what it asks for.

`tools/check-conventions.ts` is the wrong home for the same reason its own header
gives: its rules are pure functions of one collected input, and `collectInput`
resolves the outside world once, at the CLI entry point. A rule that had to
build, serve and drive a page would make the convention checker a test runner.

The other constraint is CI. It has run one step, `pnpm verify`, since the first
commit, and it already provisions PostgreSQL declaratively in `services:`.

## Decision

The guest page's acceptance conditions are a test, beside the code they govern,
and they run in Chromium. Playwright's library API drives the browser from inside
Vitest, so the repository keeps one test runner and one `pnpm test`.

The test owns the scenario end to end: a throwaway schema created from the
migration, the API started as a process against it, the client built by Vite, the
build served by Vite's preview server with one proxy rule pointing at that API,
and a browser navigating to it with a request collector attached before the first
navigation. Nothing in it stands in for anything.

It measures the built artefact, not the dev server. The dev server serves an
unbundled module graph no guest ever loads, and a remote URL that survives only
into built CSS would not appear there.

The browser is provisioned by an explicit command —
`pnpm --filter @table-ordering/guest exec playwright install chromium` — and by
one added step in CI. pnpm's default of not running a dependency's build scripts
is left in place, so installing dependencies does not download a browser.

## Rejected alternatives

- **jsdom or happy-dom, with a component test.** Fast, no binary to install, and
  it would check that the component renders what it was given. It cannot observe
  what a page requests, which is the whole of the second condition, and what it
  asserts about is a DOM implementation no guest runs.
- **Vitest browser mode.** It would reuse the runner already here and run the
  assertions in a real engine. The test then executes *inside* the page, which is
  the wrong side of the glass: watching every request a document makes, including
  the ones made before the test code runs, is something only the driver sees.
- **`@playwright/test` as the runner.** Better browser ergonomics — retrying
  assertions, traces, fixtures. It is a second test runner, a second reporter and
  a second command in `pnpm verify`, bought for one file.
- **Puppeteer.** Chromium only, which is all this needs, and a smaller surface.
  Playwright was taken for its request interception and for `install` being a
  first-class, pinnable command rather than an install-time download.
- **A rule in `tools/check-conventions.ts`.** One command, no browser, and it
  would run everywhere. It can only check the source, and the failure it would be
  written to prevent does not have to appear in the source.
- **A Playwright container image for the CI job.** It removes the install step by
  changing the image every check runs in, including the checks that have nothing
  to do with a browser, and it pins the toolchain to a vendor's base image.
- **`channel: 'chrome'`, using the runner's preinstalled Chrome.** No install
  step at all, and CI stays one command. The browser would then be whatever
  version the runner image happens to carry, updated by somebody else, which
  turns a green check into a statement about a moving target.
- **A `Content-Security-Policy` instead of an observation.** `default-src 'self'`
  would make the browser refuse a third-party request rather than merely report
  it, which is stronger for a real guest. A policy has to be served by whatever
  serves the page, and ADR 0009 leaves that undecided until there is a
  deployment. This is the first thing to add when there is one; it does not
  replace the observation, because a policy nobody watches fail is a claim too.

## Consequences

`pnpm verify` now needs a browser as well as a database. Without one it fails
rather than skips, for the reason the database already does: a check that excuses
itself on a missing dependency reports success for a system nobody exercised.

CI has two steps where it had one, and the second one downloads a browser on
every run. Caching it is the obvious next move and is not made here, because a
cache that is wrong is worse than a download that is slow.

Only Chromium is installed. The conditions are about what a page requests and
what it renders, not about engine differences, and a second engine would double
the install for a claim nothing has questioned.
