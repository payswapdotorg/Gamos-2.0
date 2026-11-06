# Worker C — GameOS, Package/Artifact Contracts, PlayLiquid Alignment

- Reports to: Gamos TL.
- Branch: gamos/worker-c; integrate through TL-reviewed PRs into gamos/development.
- Active scope and gate IDs: read docs/gamos/ROADMAP.json.
- M1/M6/M7 scope activates only when the canonical dependency gates permit it.

## Scope

Deliver the GameOS packaging and platform capabilities assigned in ROADMAP.json:
package graph, artifact/evidence contracts, durable project/world registry,
content-addressed artifact storage, previews, releases, publishing, player access,
creator/community functions and PaySwap alignment.

PlayLiquid alignment reuses delivery conventions and the pinned GameIR source
without reintroducing the retired sandbox console or duplicating runtime/services.
Large binaries belong in suitable object storage, not Git history.

## TDD and evidence per vertical slice

1. Add failing tests for package identity, dependency graph, storage addressing,
   hash integrity, reproducibility, tenancy and access policy before implementation.
2. Implement minimal GREEN behavior; add negative tests for cross-tenant access,
   missing artifacts, hash mismatch, permission denial, expired entitlements,
   publishing rollback and release revocation.
3. Produce real package/build artifacts through a real engine path where available.
   Otherwise report the exact unavailable/conditional state and a reproducible path;
   do not claim a required engine gate passed.
4. Test real preview/publishing/player journeys against configured platform services.
   Record who authorized, account scope and channel separately from repository
   governance. PaySwap retains all financial execution and accounting authority.
5. Record artifact SHA-256, tested commit, commands, environment and CI run URL.

## Boundaries

- Packaging executes through agent file/exec tools and the existing permission
  path (contract 06).
- Release-scope publishing requires the user's target-platform account entitlement
  and authorization. It does NOT require or consume a repository governance record.
  Repository governance authorizes changes to this codebase only; it cannot grant
  a user a publishing entitlement.
- PaySwap remains responsible for payment intent, provider routes, authorization,
  ledger, execution, settlement, refunds, disputes and reconciliation.
- No new installer/Electron packaging stack; retain ZCode packaging infrastructure.
- No in-memory placeholders for durable production services and no simulated
  publish/paid/settled states.

## Definition of done

Implement and test the assigned real artifact/package/platform capability; provide
real integration evidence and tenant/authorization failure tests; separate
publishing entitlements from repo governance; satisfy ROADMAP.json gate IDs and
pass TL integration review.
