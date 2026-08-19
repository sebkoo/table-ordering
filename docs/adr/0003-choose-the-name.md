# 0003. Choose the name: describe now, brand later

- **Status:** accepted
- **Date:** 2026-08-19

## Context

Three separate things get confused when a project is named. **Copyright**
covers the code and the documents. **Trademark** covers a source-identifying
brand. **Product-name collision** is a market and search problem that can
exist without either. Only the second and third are naming questions.

`table-ordering` is a generic descriptive slug, not a cleared brand, and no
clearance is claimed for it: "table ordering" is a saturated category term
already used as product language by several active products. A descriptive
slug carries no source-identifying claim, and correspondingly it carries the
maximum search and semantic collision surface. That cost is discoverability,
not legal exposure, and it is cheapest to change while the repository has no
stars, forks or dependents.

## Decision

The repository is named `table-ordering`, describing what the software does.
A brand is chosen at the first release, when there is a releasable product to
brand and the rename is still cheap. A brand must clear three conditions
before it is used: no live registered trademark in Nice class 9, 35, 42 or 43;
no active product in restaurant ordering, point of sale or hospitality using
the name; and no active product in that category trading under a near token —
a plural, a one-letter edit, a homophone, or the dominant element of a
composite mark. The third condition exists because an exact-token search is
not a clearance: the collision that matters most is usually a competitor
selling the same product to the same buyer under a word one letter away.

That gate is an engineering heuristic for avoiding an expensive mistake. It is
not legal advice and it is not a substitute for a trademark attorney if this
project is ever commercialised.

## Rejected alternatives

- **Choose a brandable name now.** Every candidate that carried meaning in the
  restaurant domain collided with an active product in that domain, and a
  rename costs an afternoon while the repository has no dependents.
- **Never brand; keep the category term as the product name.** A category term
  is not a product name. It cannot be defended, and it cannot be found.
