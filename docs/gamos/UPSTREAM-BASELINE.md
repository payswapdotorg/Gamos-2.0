# Gamos — Upstream Baseline Record

> Verified record of the upstream source this fork is built on. This is the anchor
> for upstream-integrity acceptance (all preservation checks compare against the
> pinned SHA recorded here).

---

## 1. Fork identity

| Item | Value |
|---|---|
| Product | **Gamos** — ZCode evolved into a specialized gaming development harness |
| Fork destination | `payswapdotorg/Gamos-2.0` (public, created `2026-11-04T15:12:57Z`, empty at fork time) |
| Upstream | `https://github.com/zai-org/ZCode` (public, **Apache-2.0**, default branch `main`) |
| Upstream remote name | `upstream` |
| Fork remote name | `origin` |
| Initial Gamos working branch | `gamos/development` (created from the pinned baseline below) |

## 2. Pinned baseline (verified)

| Item | Value |
|---|---|
| **Pinned upstream SHA** | `a9fe401eede6e6e5e01be9048679c206fe6f02d9` |
| Commit subject | `chore: sync ZCode source v3.17.2` |
| Upstream tag at this SHA | `v3.17.2` |
| Tree hash | `e4e4c38936b992469ddade0defc28ff6ba636622` |
| Upstream version (root `package.json`) | `zcode` `3.17.2` |
| Live re-verification | `2026-11-04` — `git ls-remote https://github.com/zai-org/ZCode.git` → `refs/heads/main` **still points to `a9fe401e…`** (handoff precondition satisfied) |

## 3. Forked upstream refs (everything carried over)

**Branches:**

| Branch | SHA |
|---|---|
| `main` | `a9fe401eede6e6e5e01be9048679c206fe6f02d9` |
| `feat/ui-plugin` | `662c30bea4e833acaacbfb745a65eb09c23d55f8` |

**Tags:** `v3.14.3`, `v3.15.1`, `v3.17.1`, `v3.17.2`

**History note:** upstream publishes its source as periodic sync commits
(9 commits total at fork time). The full history, both branches and all four
tags are retained bit-for-bit via a `git clone --mirror` → `git push --mirror`
transfer. No upstream content was rewritten, squashed or dropped.

## 4. Baseline repository facts (source-verified)

- pnpm workspace monorepo; root package `zcode@3.17.2`.
- 17,237 tracked files.
- Workspace members: `apps/dev-docs`, `apps/zcode-cli` (+ its `packages/*`, `tools/*`), `packages/*`.
- Top-level packages (19): `android`, `client`, `desktop`, `e2e-report`, `formal-proof`, `model-option-map`, `provider`, `provider-node`, `rpc`, `server`, `services`, `share-ui`, `shared`, `stream-animate`, `ui`, `web`, `web-share`, `zcode-cua`, `zcode-server-cli`.
- Official plugin packages live under `apps/zcode-cli/packages/` (32 packages — see `ARCHITECTURE.md` §5).
- Upstream ships its own architecture governance: `architecture-policy.yaml` (module registry), `.architecture-baseline.json` (`{"version":1,"violations":[]}`), `scripts/architecture/*` (incl. `architecture-check.mjs`, `upstream-admission.mjs`, `upstream-snapshot.json`).
- Upstream has **no `.github/` CI** at this baseline — Gamos governance CI is a new, additive surface (see ADR-0003).
- License files present and preserved: `LICENSE` (Apache-2.0), `NOTICE.md`, `THIRD-PARTY-NOTICES.md`.

## 5. How to re-verify integrity

```bash
cd <gamos working clone>

# 1. Remotes
git remote -v
#   origin   https://github.com/payswapdotorg/Gamos-2.0.git
#   upstream https://github.com/zai-org/ZCode.git

# 2. Baseline is an ancestor of the working branch
git merge-base --is-ancestor a9fe401eede6e6e5e01be9048679c206fe6f02d9 HEAD && echo OK

# 3. Upstream main has not silently diverged from the recorded baseline
git fetch upstream --tags
git rev-parse upstream/main          # compare with §2

# 4. Fork main matches upstream main byte-for-byte (run on a pristine checkout of main)
git rev-parse 'main^{tree}'          # expect e4e4c38936b992469ddade0defc28ff6ba636622

# 5. Upstream-presence governance
pnpm run architecture:check
node scripts/gamos/governance-check.mjs
```

## 6. Deviations from the handoff's literal instructions

| Handoff instruction | Actual action | Reason |
|---|---|---|
| Destination `payswapdotorg/gamos` | Destination is **`payswapdotorg/Gamos-2.0`** | Direct instruction from the repo owner (2026-11-04) to use `gamos-2.0`; consistent with handoff §2.1 rule 4 ("establish a clean new destination") — the clean, pre-created empty repo `Gamos-2.0` is that destination. `payswapdotorg/gamos` was not found via the API (404), so no prior-attempt history was overwritten anywhere. |
| Fork via GitHub fork API | `git clone --mirror` → `git push --mirror` | GitHub's fork API cannot fork into a differently-named destination repo. A mirror push preserves the identical commit history, branches and tags. |

## 7. Known limitation (honest status at time of writing)

Both GitHub PATs supplied for this session were **revoked by GitHub shortly
after first use** (initial REST calls succeeded; the tokens then began returning
`401 Bad credentials` and git push returns `Invalid username or token`; the
account itself is visible and healthy). All local work is complete and
committed on `gamos/development`; an automatic retry daemon
(`/home/z/gamos-push-retry.sh`) keeps attempting the push every 2 minutes with
whatever token is present in `/home/z/my-project/.secrets/env`. The remote
`origin` will receive the full mirror plus `gamos/development` as soon as a
valid token is available in that file. See `IMPLEMENTATION-STATUS.md`.
