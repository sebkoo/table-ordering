# 0007. Serve HTTP with Fastify, and validate at the boundary

- **Status:** accepted
- **Date:** 2026-08-19

## Context

The guest menu is the first route, so this is the commit where ADR 0002's
deferred web framework decision has a subject.

Judging that decision on the route it arrives with would be a mistake. One
`GET` that takes a slug from the path and returns rows needs almost nothing:
Node's own `node:http` serves it in about forty lines. The routes that decide
this are the ones this product exists for. Order submission has to tolerate a
retry, which means a `POST` with a body and an idempotency key. Kitchen updates
arrive concurrently. Every one of those routes has to accumulate a body, bound
its size, check the content type, turn malformed JSON into a 400 rather than a
500, validate the shape and types of what it was sent, and answer errors in a
form the guest client can act on.

Written by hand, that work does not arrive once. It arrives in each slice, and
each slice is required to be the smallest change that satisfies its acceptance
condition — an acceptance condition about orders, not about body parsing. The
boundary would be written thinly, repeatedly, by the change least interested in
it.

Fastify validates requests against JSON Schema with ajv and serialises
responses through `fast-json-stringify`, both declared per route.

## Decision

The API is a Fastify application. Route modules declare a JSON Schema for the
path parameters and for each response status, and the response schema is the
contract rather than a description of one: Fastify serialises through it, so a
column that starts coming back from a query cannot reach a guest unless the
schema names it.

`buildApp(pool)` in `services/api/src/main.ts` assembles the application and is
what the tests drive. The same file starts a listener when it is run directly,
so what a guest reaches and what the tests exercise cannot drift apart.

Schemas are written as plain JSON Schema. A TypeScript type provider is not
added yet.

## Rejected alternatives

- **`node:http`, no framework.** The strong case is real: no runtime
  dependency, nothing to learn, no lock-in, and the route this slice needs fits
  in a handful of lines. It was rejected on the cost above — routing, body
  parsing, size limits, malformed-body handling, validation and error shaping
  growing by hand, slice by slice, in changes whose acceptance conditions are
  about something else.
- **Express.** The largest ecosystem and the most familiar API. Validation is a
  separate library, response serialisation is not schema-driven, and its
  TypeScript types are a community package rather than the project's own.
- **Hono or h3.** Smaller, web-standard `Request`/`Response`, and portable to
  runtimes other than Node. The portability is the selling point and this is a
  self-hosted Node process, so it buys nothing here, and boundary validation is
  again an add-on rather than the default.
- **A TypeBox or Zod type provider now.** It would remove the duplication
  between a schema and the TypeScript type beside it. With one route the
  duplication is two small objects, and the provider is a dependency and an
  idiom to carry. Reconsider the first time a hand-written type and its schema
  disagree.

## Consequences

Route modules import from Fastify, so moving off it later is a rewrite of every
route rather than a change of adapter. Until a type provider lands, a response
schema and the TypeScript type of the value that satisfies it are maintained
side by side, and nothing checks that they agree.
