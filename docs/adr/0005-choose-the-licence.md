# 0005. Choose the AGPL-3.0 licence

- **Status:** accepted
- **Date:** 2026-08-19

## Context

This is server software that restaurants would reach over a network. The
licence question for that shape of software is not mainly about redistributing
copies, which rarely happens, but about someone modifying the software and
running the modified version as a service without ever distributing it. Most
copyleft licences do not reach that case; their obligations attach to
distribution, and running a service is not distribution.

The licence also has to be compatible with the project earning money, because
a project that cannot be funded does not get maintained.

## Decision

AGPL-3.0-only, with the full licence text in `LICENSE` and
`AGPL-3.0-only` declared in the root manifest.

The AGPL's section 13 attaches source-disclosure obligations to modified
versions offered over a network. That is the specific gap this project cares
about: a modified fork run as a hosted service owes its users the modified
source.

This does not decide how the project earns money, and it does not need to.
Managed hosting, support and integration work are available as revenue under
the AGPL exactly as they are under a permissive licence — plenty of
permissively licensed projects sell all three. What the AGPL adds is that a
competitor who improves the software and hosts it cannot keep the improvement
private.

## Rejected alternatives

- **MIT.** The most permissive and the most widely understood, and it would
  remove every adoption objection listed below. It also permits a hosted,
  modified, closed fork, which is the one case this project cares about most.
  It is worth being accurate about what MIT does not do: it does not remove
  the reason anyone would pay for hosting or support.
- **Apache-2.0.** Everything MIT offers plus an explicit patent grant, which
  is a genuine improvement for corporate adopters. Same gap on the network
  case.
- **MPL-2.0.** File-level copyleft, a real middle ground, and much easier for
  a company's legal review to approve. Its obligations still attach to
  distribution rather than to network use, so the hosted-fork case stays open.
- **Dual licensing: AGPL plus a paid commercial licence.** The obvious
  follow-on question, and the answer for now is timing rather than principle.
  A commercial exception is something you sell to an integrator who wants to
  embed the software in a closed product. There is nothing yet to embed and no
  integrator to sell to, so the exception would be terms without a customer.
  It can be added later; the AGPL alone is a complete and coherent state.

## Consequences

Some companies will not adopt AGPL software at all, as policy, without reading
what it requires. That cost is accepted.
