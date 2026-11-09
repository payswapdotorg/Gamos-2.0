# M4 Zero-Cost Delivery Record

| Field | Value |
|---|---|
| Status | Preparation artifact (permitted pre-activation work) |
| Milestone | M4 — Godot & Unreal plugins |
| Roadmap state at authoring | `planned` / blocked (unchanged by this document) |
| Controlling input | Maintainer handoff "Gamos M4 — Final TL Handoff — Zero-Spend Delivery Mandate" (2026-11-09) |
| Baseline | `gamos/development` @ `48ce1fd3` |
| Branch | `gamos/m4-zero-cost-delivery` (stacked on `gamos/m4-capability-contracts` @ `eebcf6b7`, which stacks on `gamos/m4-delivery-plan` @ `36897b65`) |
| Merge policy | NOT merged; merge is a post-activation order-0 decision, together with the other two preparation artifacts |
| What this is | The zero-spend mandate recorded into the repository, the zero-cost status map for every M4 element, the reproducible zero-cost Godot environment recipe with this session's verification, and the TL reporting discipline |
| What this is NOT | Not an activation, not an implementation, not a gate claim, not a spending request |

---

## §1 Mandate acceptance

The maintainer's final TL handoff — "Gamos M4 — Final TL Handoff — Zero-Spend Delivery
Mandate" — is accepted as the controlling delivery mandate for M4. Its baseline table was
independently re-verified at receipt and matches the repository state exactly:

| Item | State (re-verified) |
|---|---|
| `gamos/development` | `48ce1fd3` |
| `gamos/m4-capability-contracts` | `eebcf6b7` on remote |
| `gamos/m4-delivery-plan` | `36897b65` on remote |
| Governance CI | run `42703013035`, completed successfully (all three required jobs) |
| Preparation artifacts | Both pushed; **neither merged** into development |
| M4 implementation | Not authorized to begin |
| M4 roadmap state | `planned` / blocked |

Two honest scope notes carried forward from the mandate itself:

1. The successful governance run is associated with commit `eebcf6b7` (the capability
   contracts docs-only tree). It does not independently prove any future implementation
   step or any engine gate.
2. The dashboard verification evidence is a captured healthy window (clean lint, page/API
   200, complete browser snapshot, zero console errors, saved screenshot). It is not proof
   that the development server remains continuously available — the sandbox reaper removes
   `node_modules` and terminates the server between windows.

**Why this document exists.** The zero-spend constraint arrived through the chat channel.
This sandbox has been reset nine times; chat context does not survive resets, but
repository documents and the persistent backup zone do. Recording the mandate here makes
it bind all future M4 work — the TL, Workers A/B/C, and any successor session — without
depending on conversation history.

## §2 The zero-spend constraint (binding rules)

The available budget for new purchases is **zero**. Effective from the mandate and for the
remainder of M4 delivery:

1. Do not ask the maintainer to purchase Unity, Unreal, Godot, development tools, plugins,
   assets, subscriptions, API credits, cloud services, or other products.
2. Do not introduce paid dependencies into the implementation or the acceptance criteria.
3. Do not enable pay-as-you-go services, paid trials, automatic renewals, or resources
   that can incur charges.
4. Do not consume a provider's free credits in a way that creates a later billing
   obligation.
5. Do not assume that a service is free merely because it has a free tier — verify limits,
   billing requirements, and renewal conditions before relying on it.
6. Do not create CI or deployment arrangements that can generate unexpected costs.
7. Do not use licensing workarounds, unauthorized copies, or other non-compliant approaches
   to avoid purchasing a license.
8. Use free and open-source tools, locally operated infrastructure, and genuinely
   available free entitlements. If an otherwise desirable feature requires spending money,
   record it as unavailable under the current constraint and design a compliant
   alternative where possible.
9. The architecture must not make payment a prerequisite for continuing development.
10. If a task would incur a charge: stop before provisioning or executing it, record the
    blocker, and propose a zero-cost alternative. Do not ask the maintainer to fund it.

## §3 Zero-cost status map for every M4 element

| Element | Zero-cost status | Consequence for M4 delivery |
|---|---|---|
| Godot 4.2.2-stable | **Verified zero-cost** — MIT-licensed engine; sha256-pinned downloads from the official release channel; fully local execution | Primary implementation path (delivery-plan orders 1–3). No license, no entitlement question, no purchase anywhere in the path |
| Unreal Editor | **Conditional** — proceed only if a compliant editor and execution arrangement is available at no additional cost | Do not purchase seats, plugins, assets, or services; do not assume entitlement or royalty exemption without verifying current terms. If no compliant environment is available, preserve the implementation design and report M4-G2 as blocked. Never substitute mocks for the real-engine gate |
| Unity (M2 dependency) | **Existing dependency, not a spending request** | M2-G1 remains blocked unless the account holder and use case are genuinely eligible for Personal tier AND the actual execution arrangement complies with Unity's terms. Never manufacture a passing test via paid license, hosted runner, undocumented activation, or workaround |
| Marketplace plugins / proprietary assets | **Prohibited as required dependencies** | No required paid marketplace plugins or proprietary assets in implementation or acceptance criteria |
| Hosted databases / build products / model APIs / cloud services | **Prohibited as required dependencies** | Optional integrations must fail gracefully when the corresponding free, authorized resource is unavailable |
| CI / deployment | **Existing arrangements only** | The existing `gamos-governance` GitHub Actions workflow (free tier) remains the only CI surface. No new paid CI or deployment arrangements |

## §4 The reproducible zero-cost Godot environment

This is the environment that delivery-plan order 2 ("establish a reproducible, zero-cost
local engine test environment") will use once M4 is legitimately active. The recipe is
fully pinned and was **re-executed and verified on a fresh environment this session**:

```
# 1. Engine binary — official release channel, sha256-pinned zip
curl -sSL --retry 3 -o godot.zip \
  "https://github.com/godotengine/godot/releases/download/4.2.2-stable/Godot_v4.2.2-stable_linux.x86_64.zip"
echo "69eb9881e1b82ab93924c83106a7c031497f252bc0c08e199e4da6380072d6ef  godot.zip" \
  | sha256sum --check --strict -
unzip -o -q godot.zip -d /home/z/engines/

# 2. Version assertion — fail closed on any mismatch
/home/z/engines/Godot_v4.2.2-stable_linux.x86_64 --version
#   MUST print exactly: 4.2.2.stable.official.15073afe3

# 3. Export templates — linux-only selective extraction (the full tpz is ~895 MB;
#    extracting only the linux pair keeps the footprint minimal)
curl -sSL --retry 3 -o /tmp/templates.tpz \
  "https://github.com/godotengine/godot/releases/download/4.2.2-stable/Godot_v4.2.2-stable_export_templates.tpz"
unzip -o -q /tmp/templates.tpz "templates/linux_release.x86_64" \
  "templates/linux_debug.x86_64" -d /tmp/tmpl/
mkdir -p ~/.local/share/godot/export_templates/4.2.2.stable
cp /tmp/tmpl/templates/linux_* ~/.local/share/godot/export_templates/4.2.2.stable/
```

**This session's verification evidence (2026-11-09, fresh sandbox after the 9th reset):**

- Zip sha256 `69eb9881e1b82ab93924c83106a7c031497f252bc0c08e199e4da6380072d6ef` — check
  passed (`--strict`); extraction produced the 100,234,608-byte binary.
- Uncompressed binary sha256 (recorded as a secondary pin so future sessions can verify
  without re-downloading): `11666450f64c4e90cfbf7b795bbd3b07aa52ea1afb6feb73d0b4fee876f72def`.
- Version assertion output: `4.2.2.stable.official.15073afe3` — exact match, exit 0.
- Layout note (honest correction): the Godot zip extracts a single top-level binary, not a
  directory. The environment layout is `/home/z/engines/godot-4.2.2-stable-linux-x64/
  Godot_v4.2.2-stable_linux.x86_64` (directory form) so both path conventions resolve.
- Export templates: NOT re-established this session — the ~895 MB tpz download exceeds
  what a single command window allows on this network path, and background downloads do
  not survive command boundaries in this sandbox (reaped). This is recorded honestly and
  changes nothing about readiness: the recipe above is pinned, is exactly the one that
  produced the real exported ELF during the readiness feasibility probes, and order 2 of
  the delivery plan — which runs only after legitimate activation — budgets the download
  as its first environment step. The engine binary itself (the execution authority for
  every non-export capability) is present and version-verified.

**Honest scope of this evidence.** It proves the zero-cost environment recipe is
reproducible on a fresh machine with pinned integrity. It is preparation, NOT acceptance
evidence: M4-G1 remains unpassed and unclaimed. The earlier Godot feasibility probes
(scene create/modify/verify via the headless SceneTree JSON bridge; real Blender OBJ →
`--import` with read-back; `--check-only` fail-closed on a broken script; `--export-release`
producing a real 62,214,272-byte ELF; exit-code-is-not-mutation discipline) remain
feasibility probes, exactly as relabeled by the corrected readiness document §4.1.

## §5 Effect on the delivery plan

The delivery ledger (`docs/gamos/M4-DELIVERY-PLAN.md`, branch `gamos/m4-delivery-plan`)
remains the execution contract. The zero-spend mandate refines it as follows:

- **Order 2** (reproducible zero-cost local engine test environment): the §4 recipe above,
  verified reproducible this session.
- **Orders 1–3** (Godot capability records, typed operations, Blender→Godot integration):
  unchanged — the Godot path is fully zero-cost by construction.
- **Order 6** (real Unreal editor integration): the existing entry gate ("maintainer-provided
  UE5 editor environment") now carries the additional zero-cost condition — proceed only if
  a compliant editor arrangement exists at no additional cost. Otherwise M4-G2 stays
  honestly blocked and the design is preserved for a future compliant environment.
- **Order 9** (five-engine regression): an unavailable Unity environment must not silently
  count as a passing Unity test (M4-G4 rule, unchanged).
- **No gate weakening, ever.** A missing engine, missing entitlement, missing endpoint,
  unavailable display, or unavailable free execution environment is a blocker to the
  corresponding real-engine gate. It is never permission to substitute a fixture and
  report success. The absence of funds never lowers any acceptance bar.

## §6 TL reporting discipline

Every TL report must distinguish:

1. Implemented versus merely designed.
2. Local feasibility probe versus actual acceptance evidence.
3. CI success versus real-engine success.
4. Preparation artifact pushed versus artifact merged.
5. Gate passed versus gate blocked.
6. Free entitlement verified versus entitlement merely assumed.
7. Dashboard verification captured in a healthy window versus current server availability.

For every claimed pass: identify the commit, the relevant source files, the test command
or CI run, and the evidence location. A green dashboard, a documentation statement, or a
successful mock is never a substitute for source-level and real-engine proof.

For any task that would incur a charge: stop before provisioning or executing it, record
the blocker, propose a zero-cost alternative, and do not ask the maintainer to fund it.

## §7 Honest not-list

This document:

- does NOT activate M4 — the milestone remains `planned` / blocked; all four activation
  conditions (M2 completion or a validly documented exception; an available active slot
  under the two-maximum limit; the committed roadmap transition passing the validators)
  remain unmet;
- does NOT authorize or begin any M4 production implementation — zero production code
  changes ride on this branch;
- does NOT claim any gate — M4-G1, M4-G2, M4-G3, M4-G4 are all unclaimed;
- does NOT request any purchase and does NOT authorize any license workaround;
- does NOT edit `ROADMAP.json`, evidence files, or any protected surface;
- does NOT weaken, reinterpret, or defer any requirement of the corrected readiness
  document, the delivery plan, or the capability contracts — all three remain binding in
  full, and this record is additive to them.

## §8 Branch policy

- This artifact lives on `gamos/m4-zero-cost-delivery`, stacked on
  `gamos/m4-capability-contracts` @ `eebcf6b7` (which stacks on `gamos/m4-delivery-plan`
  @ `36897b65`, based on `gamos/development` @ `48ce1fd3`).
- None of the three preparation branches is merged. Merging any of them into
  `gamos/development` is an order-0 decision that becomes available only after legitimate
  M4 activation.
- The three artifacts form a chain: the delivery ledger (what to do, in what order, with
  what evidence), the capability contracts (the field-level binding contracts the records
  must satisfy), and this record (the zero-cost constraint and environment recipe that
  bound how it may all be done).
