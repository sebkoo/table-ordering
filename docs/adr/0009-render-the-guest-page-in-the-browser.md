# 0009. Render the guest page in the browser, from a React application Vite builds

- **Status:** accepted
- **Date:** 2026-08-19

## Context

The menu has been JSON on an endpoint since ADR 0007. This is the first code a
guest looks at, so the question of how a page is produced has a subject.

What is true and forces the choice. A guest arrives from a code on a table, on
their own phone, over a restaurant's wifi, with nothing installed and no account.
The page is read only today. The pages this product exists for are not: an order
that has to survive a retry and a second tab, and a kitchen board that has to
drop off the network and pick up where it left off. Both of those are client
state that outlives a request, and neither is a document.

Two things a server-rendered page would normally win are not in play here. A
table's URL is not indexed and has no search traffic. And the payload is a few
dozen rows, so the fetch the client makes is small.

What is in play is first paint. A client-rendered page shows a shell, then the
menu one round trip later, and a guest on bad wifi sees the gap.

## Decision

The guest page is a client-rendered React application, built by Vite, in
`apps/guest`. It is a thin client: it asks the application's own API for the
menu and renders the answer.

The request goes to a relative path, `/restaurants/<slug>/menu`, so the page and
the API are on one origin and there is no origin to configure. In development
`vite.config.ts` proxies that prefix to the API. The restaurant's slug comes
from the URL, `/r/<slug>`, so one build serves every restaurant.

Three things are deliberately not added. There is no router library: one segment
read from `location.pathname` is not routing. There is no package holding the
request and response shape: the client declares the shape it consumes, and the
response schema the route serialises through, plus the browser test that reads
what was rendered, are what keep the two honest. There is no
`@vitejs/plugin-react`: Vite's own transform handles this JSX, and Fast Refresh
is a Babel pipeline bought to preserve state this page does not have.

## Rejected alternatives

- **Server-rendered React** — Next.js or Remix, or `react-dom/server` behind the
  existing Fastify service. The strong case is real and it is about the guest:
  the first paint arrives with the menu in it, there is no blank frame and no
  fetch waterfall, and a menu is exactly the kind of read a server can render
  whole. It was rejected because the payoff is one round trip on a small payload,
  while the cost is a second rendering runtime — its own build, its own
  deployment shape, its own hydration rules — carried by every later slice, and
  every one of those slices is client state that has to be reconciled with the
  server anyway.
- **Plain HTML templating from Fastify.** The smallest thing that satisfies this
  commit: no bundle, no build step, no `apps/guest` at all, and the page would be
  a handler and a template beside the route that already exists. It was rejected
  on where it leads rather than on what it costs here. The next behaviours are an
  order that survives a retry and a board that reconnects, and templating reaches
  them by accumulating hand-written DOM updates inside changes whose acceptance
  conditions are about orders — the same argument ADR 0007 made about body
  parsing, one layer up.
- **Hand-written DOM, no framework.** This page is about thirty lines of
  `createElement` and it would need no dependency at all. Same trajectory as the
  templating option, without a library to hand the state problem to when it
  arrives.

## Consequences

First paint is a shell and the menu arrives one fetch later. If that ever shows
up as a real complaint from a real table, it is the reason to reopen this.

The page fetches a relative path, so whatever serves the build in production has
to route `/restaurants` to the API and serve `index.html` for `/r/<slug>`. That
is the dev server today and the preview server in the acceptance test. Nothing
serves it in production, because nothing deploys this yet, and this is the
constraint that forces that decision rather than leaving it to be discovered.

There is React code now, so the cost ADR 0002 accepted when it chose Biome over
ESLint is live: React Compiler's lint rules have no Biome equivalent and nothing
in this repository enforces them.
