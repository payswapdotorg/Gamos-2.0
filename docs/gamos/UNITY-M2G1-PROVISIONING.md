# M2-G1 Unity Personal provisioning — licensing investigation and runbook

> **Authority note:** This document is subordinate to `docs/gamos/ROADMAP.json`
> (sole milestone authority), the frozen contracts, and repository governance.
> It records a licensing investigation ordered by the maintainer on
> 2026-11-07 ("We cannot afford a paid Unity subscription… Investigate and use
> Unity Personal… Do not weaken M2-G1, fabricate Unity availability, use a
> mocked editor, substitute another engine, or modify the roadmap's acceptance
> criteria to force M2 completion."). **M2-G1 remains NOT PASSING.** Nothing in
> this document claims otherwise.

**Status: M2-G1 BLOCKED — exact missing items listed in §7.**

---

## 1. What was verified, from where

All excerpts below are committed as evidence under
`evidence/phase-m2/unity-personal-investigation/` (see `manifest.json` there
for source URLs, SHA-256 hashes and retrieval timestamps). Retrieved
2026-11-07 from the Gamos dev sandbox via plain HTTPS. **UPDATE 2026-11-08
(M2-C, final-closure directive): the Unity Editor Software Terms EULA has
now been RETRIEVED AND RECORDED.** The 2026-11-07 pass could not reach
`https://unity.com/legal/software-terms` (bot/geo-blocked 404 shell);
the LIVE canonical location of the document was subsequently discovered
via the official Legal Information index (`https://unity.com/legal/eula`)
and retrieved successfully with plain HTTPS: `https://unity.com/legal/editor-terms-of-service/software`
(byte-identical with `https://unity.com/legal/terms-of-service/software`).
Verbatim excerpts of the decisive sections (§1.1, §2.1, §2.4, §2.5, §2.8)
are committed as `software-terms-excerpt.txt`. Every clause that matters
to build-machine licensing is now quoted verbatim; the previous
verified/unverified markings below are preserved for history, with the
former gap rows updated.

### 1.1 Unity Personal eligibility — VERIFIED (official pricing page)

From `unity.com/pricing` (verbatim, see `pricing-excerpt.txt`):

> "Unity Personal — Individuals, hobbyists, and small businesses using Unity
> to provide services to others are eligible to use Unity Personal if their
> respective clients, in the aggregate, have less than $200K USD of revenue or
> funds raised in the prior 12 months. Individuals, hobbyists, and small
> businesses using Unity but not providing services to a third party are
> eligible to use Unity Personal if (i) for small businesses, if their
> aggregate gross revenue and funding are less than $200K USD, or (ii) for
> individuals and hobbyists if the amount generated in connection with their
> use of Unity is less than $200K USD."

> "Unity Pro and Enterprise — Effective January 1, 2025 upon plan purchase or
> renewal: Unity Pro will be required for businesses with revenue or funding
> greater than $200K USD in the last 12 months, and for those who do work with
> them. Unity Enterprise will be required for businesses with revenue or
> funding greater than $25 million USD in the last 12 months."

> "Unity Industry — Unity Industry plan is required if you create applications
> outside of games or entertainment and your company's total finances exceed
> $1,000,000 USD."

**Application to Gamos (honest self-assessment, NOT a claim of eligibility):**

| Fact | Value | Source |
|---|---|---|
| Application domain | Games/entertainment (game-development harness) → the **Industry** plan does not apply | pricing page (verified) |
| License sought | Unity Personal, $0 | pricing page (verified) |
| Entity eligibility condition | payswapdotorg's aggregate gross revenue **and** funding for the trailing 12 months must be **< $200K USD**, and the org must not provide Unity-development services to clients whose aggregate revenue/funding is ≥ $200K USD | pricing page (verified) |
| Org revenue/funding figures | **NOT verifiable from the repository — MAINTAINER ATTESTATION REQUIRED** | — |

The docs activation FAQ adds (verified, `activation-faq-excerpt.txt`):

> "The free version of Unity can't be licensed by a commercial, educational,
> non-profit, or government entity whose gross revenues or budget exceeds the
> financial threshold identified in the Unity Editor Software Terms section of
> the Unity Terms of Service."

**Conclusion on task 1:** Unity Personal is *potentially* eligible for this
project at **$0**, but eligibility is an **organization-level fact that only
the maintainer can attest** (revenue + funding + client-work test). No
eligibility is assumed by this investigation.

### 1.2 How a Unity Personal license is activated — VERIFIED (official docs)

* Command-line/serial activation exists **only for Unity Pro serials**; the
  docs explicitly state: *"The following procedures don't apply to Unity
  Personal. To activate a license for Unity Personal, log in to the Unity
  Hub. To return a Personal license, log out of the Unity Hub."*
  (`cli-activation-excerpt.txt`). The same page acknowledges headless
  automated builds/tests as a legitimate CLI-activation use case — for Pro.
* Manual `.ulf` activation: *"you can activate your license manually if you
  have an assigned seat on a Unity Enterprise or Unity Industry subscription,
  or a legacy serial key"* (`manual-activation-excerpt.txt`) — i.e. **not a
  documented Personal path**.
* Linux Personal license file location:
  `~/.local/share/unity3d/Unity/Unity_lic.ulf` (`activation-faq-excerpt.txt`).
* Paid-commercial machine counts: *"one person to use Unity on two computers
  that they have exclusive use of"* — worded for **paid** licenses; the
  Personal machine-count clause lives in the Software Terms EULA (see §1.4).

### 1.3 Build machines / CI — what the official text actually says

| Statement | Status | Where |
|---|---|---|
| Build servers exist as a recognized deployment pattern ("you or your build server exceeds the login rate limit, which is 10 login attempts per minute") | VERIFIED | activation FAQ |
| Node-locked usage is "on the number of computers or operating systems **per Authorized User** as set forth in the Additional Terms and the Offering Identification" | VERIFIED (ToS) | `tos-authorized-user-excerpt.txt` |
| "Authorized Users" = identified individuals (employees/consultants/contractors) for whom a subscription was acquired | VERIFIED (ToS) | same |
| Floating (license-server) model — an organization-level, concurrency-based offering for "complex projects or larger organizations" | VERIFIED | `license-overview-excerpt.txt` |
| Unity's own hosted CI product (Unity Build Automation) is a separate paid offering | VERIFIED (pricing page feature tables) | `pricing-excerpt.txt` |
| **Software Terms §2.8 machine-count clause**: "you (and your Authorized Users) may install the Unity Editor on both a primary and a secondary computer or operating system, solely for your convenience, but only for use by a single person"; "only … one instance at any given time per seat"; additional installs only "upon deactivation of the Unity Editor installed on existing computers" (Unity's sole discretion) | **VERIFIED 2026-11-08 (retrieved)** | `software-terms-excerpt.txt` §2.8 |
| **Software Terms §2.8 cloud-execution clause**: "in no event may third party service providers directly or indirectly distribute, run or use the Unity Editor so that it is executed on or simulated by the cloud or a remote server and transmitted over the Internet or other network except where they are acting on your behalf as an Authorized User in accordance with this Section" | **VERIFIED 2026-11-08 (retrieved)** | `software-terms-excerpt.txt` §2.8 |
| **Software Terms §2.4 Build License**: a PAID special arrangement — "one (1) subscription to use Unity Pro … install that copy of Unity Pro on up to ten (10) internal build machines … for the sole purposes of publishing and distributing, but not creating, your Projects" (Pro-only; not a Personal path) | **VERIFIED 2026-11-08 (retrieved)** | `software-terms-excerpt.txt` §2.4 |
| **Software Terms §2.5 Unity Build Server**: "You may not use Unity Build Server with the Unity Personal tier of the Unity Software." | **VERIFIED 2026-11-08 (retrieved)** | `software-terms-excerpt.txt` §2.5 |

**Task 3 conclusion (corrected 2026-11-08 per the maintainer's §5 review
directive):** the Software Terms contain **no general grant permitting an
unattended build/CI machine to use a Personal license**. The only
build-machine-specific provisions are paid offerings (§2.4 Build License —
Pro-only; §2.5 Unity Build Server — explicitly excluding the Personal tier).
What §2.8 grants instead is installation "on both a primary and a secondary
computer or operating system … only for use by a single person", one
instance at a time per seat — **and that primary/secondary installation
clause does not, by itself, settle the separate-build-machine question.**
The distinction that matters:

* **A separate build machine requires a separate license** — Unity's
  official compliance FAQ position, as recorded by the maintainer's 2026-11-08
  review directive. A dedicated or unattended build/CI machine is NOT
  automatically covered by the Personal primary/secondary grant.
* **Unity Build Server cannot be used with Unity Personal** (Software Terms
  §2.5, recorded verbatim above).
* **GitHub-hosted runners are third-party cloud VMs**, not identified
  Authorized Users — running the editor there is NOT clearly permitted by
  §2.8 for a Personal seat. The community GameCI practice (generate a
  Personal `.ulf`, install it on ephemeral CI) is a THIRD-PARTY mechanism
  with no authorization in the recorded official text — **a community CI
  guide describing a technical mechanism is not licensing authority**
  (`gameci-community-reference.txt`, marked third-party, not Unity terms).
* **The Gamos use model is first-party development** (see §2.5 below):
  Unity would run locally for the eligible account holder developing the
  Gamos organization's own game project — not offered as a service to end
  users, no platform/SaaS/service-provider distribution of the editor. The
  Software Terms' first-party-project versus platform/service-provider
  distinction therefore does not disqualify the use model itself; the open
  question is solely the **machine arrangement**.
* **Preferred zero-cost arrangement:** the PRIMARY developer workstation of
  the eligible single user, attended and license-holder-operated (Unity Hub
  sign-in), where that is permitted and technically feasible — the machine
  the §2.8 grant most clearly covers. A dedicated or unattended build
  machine (including a self-hosted runner on a secondary machine) requires
  **Unity Compliance written clarification BEFORE any use** (§6 step 0).

This is the agent's honest reading of the now-recorded official text as
corrected by the maintainer's review directive; the maintainer remains the
licensing authority and should read `software-terms-excerpt.txt` (or the
live page) — and obtain Unity Compliance's written clarification where the
terms do not clearly authorize the proposed arrangement — before
activating anything.

### 1.4 Least-expensive compliant provisioning (task 2)

**$0** in all variants below — no purchase is made (per the maintainer
directive, no Pro/Enterprise/paid license will be bought):

1. Editor binary: Unity 6 (6000.0.23f1) Linux Editor — free direct download,
   official archive URL:
   `https://download.unity3d.com/download_unity/ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f/LinuxEditorInstaller/Unity.tar.xz`
   (revision hash taken from the committed fixture's
   `ProjectSettings/ProjectVersion.txt` so the editor matches the fixture
   project exactly). Note: from the Gamos sandbox this URL geo-redirects to a
   China CDN edge that currently 404s — recorded in `sandbox-capability.txt`;
   GitHub-hosted (US) runners are not affected by that redirect.
2. License: Unity Personal at $0, contingent on §1.1 attestation.
3. Runner hardware: existing machines only (task 4) — see §5.

## 2. Why the existing dev sandbox cannot host the editor (task 4)
Recorded honestly in `sandbox-capability.txt`: the sandbox's only persistent
filesystem has **3.7 GB free** (9.9 GB total) and 3.9 GB RAM; the Unity 6
Linux editor needs ~4 GB (tarball) + ~9–10 GB (extracted) ≈ **13 GB peak**,
which is arithmetically impossible there; the only other writable mounts are
~2 GB tmpfs (RAM-backed). No root. **The existing sandbox is therefore not a
candidate Unity runner; no new hardware is procured.**

Remaining existing-runner options:

* **GitHub-hosted `ubuntu-latest` (the repo's existing CI):** can host the
  editor binary (Blender-precedent CI provisioning — pre-approved, hash
  recorded), but **cannot host the license**: no Unity account credentials
  exist, credentials must stay out of Git/CI artifacts (maintainer rule 5),
  and the now-recorded Software Terms §2.8 cloud-execution clause does not
  clearly permit a third-party hosted cloud VM to run the editor for a
  Personal seat (see §1.3). The CI therefore continues to record the honest
  `unavailable-license` / `editor-present-unlicensed` states.
* **A maintainer-provisioned runner on the PRIMARY workstation (attended,
  license-holder-operated)**: the preferred zero-cost path — the arrangement
  the recorded §2.8 grant most clearly covers. A runner on any OTHER
  dedicated/unattended machine is a separate build machine (compliance FAQ:
  separate license) and stays blocked on Unity Compliance's written
  clarification — §6 runbook.

### 2.5 The Gamos use and execution model (recorded for licensing clarity)

The TL's honest record of how Unity would actually be used, per the
maintainer's §5 review directive (2026-11-08):

* **Who:** the eligible single user / account holder developing the Gamos
  organization's own first-party game project (the repository's fixtures and
  the M2-G1 evidence chain are that project's artifacts).
* **How:** Unity runs LOCALLY, on machines the account holder controls, for
  the account holder's own development, build and verification of that
  project. The editor is never offered as a service to end users; there is
  no platform, SaaS or service-provider distribution of the editor; no
  third party executes the editor on Gamos's behalf.
* **Machine arrangement (the open licensing question):** the **primary
  developer workstation** — attended, license-holder-operated — is the
  arrangement the §2.8 grant most clearly covers and is therefore the
  preferred zero-cost path. Any **dedicated or unattended build machine**
  (a separate box used only for CI/builds, including a self-hosted GitHub
  runner on a secondary machine) is a *separate build machine* in Unity's
  terms — which the compliance FAQ says requires a separate license — and
  is therefore NOT used until Unity Compliance provides written
  clarification that the proposed arrangement is covered by Personal.
* **Credentials and license material:** the Unity ID, Hub session and the
  `Unity_lic.ulf` file stay local to the authorized user's machine — never
  committed, never in repository secrets/variables, never in CI artifacts
  (directive rule 5, unchanged).

## 3. What this document records (and what the related commits change)

* **Does not change:** `docs/gamos/ROADMAP.json` (M2 stays `active`, M2-G1
  gate untouched), the M2 contracts, the plugin code, all Blender/Babylon
  work, the honest-skip behavior of the Unity integration suite.
* **PR #8 (2026-11-07) fixed a latent evidence-fidelity bug** in the
  `unity-engine-status` CI job: the job previously recorded
  `editor-verified` whenever `UNITY_EDITOR_PATH` merely pointed at an
  executable — an editor binary present but **unactivated** would have
  produced a fabricated pass-record. PR #8 derived the status from the
  suite's `editorLicensed=true/false` console markers instead, with the env
  var plumbed at job level, and added the `UNITY_RUNNER_LABEL`
  self-hosted-runner plumbing (unchanged since).
* **M2-A (final-closure directive, 2026-11-08) closed the remaining
  false-positive path** in the same job: the `editorLicensed=true` marker is
  printed after PREFLIGHT — before the real integration tests complete — so
  a licensed editor could pass preflight and then fail scene modification or
  the player build while the `always()` status step still recorded
  `editor-verified`. The job now runs the suite with dual reporters, captures
  the suite exit code independently of the tee pipeline (PIPESTATUS[0]), and
  a tested classifier (`packages/gamos-domain/src/domain/unity-gate-status.ts`
  + `scripts/gamos/m2-unity-gate-status.ts`) derives the gate status from
  machine-readable evidence ONLY: the suite's machine-evidence JSON, the
  vitest JSON per-test results (all required real-editor tests passed, none
  skipped), the captured exit code, and the retained log (contradiction
  checks). A licensed preflight followed by a failed suite now records
  `licensed-editor-integration-failed` — never a pass.
* **M2-B (2026-11-08) made the version contract exact**: the integration
  suite now enforces the fixture's pinned editor version (6000.0.23f1,
  revision ab2b18a5f80dcba39fd8f5ee57b07edc7c0f600f) exactly — an
  incompatible editor records `editor-present-version-incompatible`, never
  a licensed or verified state.
* **M2-C (2026-11-08, this update) closed the Software-Terms retrieval gap**
  (§1): the Unity Editor Software Terms is now recorded verbatim from its
  live canonical URL, and §1.3/§5/§7 reflect the actual clauses.
* **Records the investigation evidence** (this doc +
  `evidence/phase-m2/unity-personal-investigation/`).

## 4. Eligibility checklist (maintainer attestation)

Before any activation, the maintainer must attest ALL of:

1. payswapdotorg / the Gamos organization's **aggregate gross revenue and
   funding for the trailing 12 months < $200K USD**;
2. the organization does **not** provide Unity-development services to
   clients whose aggregate revenue/funding is ≥ $200K USD (else the client
   test applies);
3. the application is games/entertainment (it is — otherwise the Industry
   plan test would apply above $1M finances);
4. ~~(Task 1 of the directive: **read `https://unity.com/legal/software-terms`
   from a normal browser** and record the answer to: *how many machines may a
   Unity Personal license be used on, and is use on an unattended CI/build
   machine permitted?* — this is the clause the sandbox could not retrieve.)~~
   **UPDATED 2026-11-08:** the Unity Editor Software Terms has been retrieved
   from the live canonical URL and committed verbatim
   (`evidence/phase-m2/unity-personal-investigation/software-terms-excerpt.txt`:
   §1.1/§2.1/§2.4/§2.5/§2.8). The maintainer should still READ the excerpts
   (or the live page) and confirm the interpretation in §1.3 before any
   activation — the attestation that the interpretation is correct for this
   organization remains the maintainer's.

## 5. Runner decision matrix

| Option | Cost | Editor binary | Activation | Compliant? | Status |
|---|---|---|---|---|---|
| Existing dev sandbox | $0 | ❌ disk-infeasible (3.7G/9.9G free) | — | — | Rejected on capability (§2) |
| GitHub-hosted `ubuntu-latest` | $0 | ✅ (Blender precedent) | ❌ no credentials; §2.8 cloud-execution clause does not clearly permit third-party hosted VMs for a Personal seat — and a community CI guide describing the mechanism is not licensing authority | **Not permitted** for a Personal seat on the recorded text | Stays honest-unavailable (default) |
| Maintainer's PRIMARY workstation (attended, license-holder-operated) | $0 | ✅ (direct download) | ✅ Unity Hub sign-in by the eligible account | The arrangement §2.8 most clearly covers (primary computer, single person, one instance) | **Preferred zero-cost path** (§6) |
| Dedicated/unattended build machine (incl. self-hosted runner on a secondary machine) | $0 | ✅ | ✅ Hub sign-in possible | **NOT settled by §2.8 alone** — a separate build machine requires a separate license per the compliance FAQ; needs Unity Compliance WRITTEN clarification BEFORE use | Blocked on the clarification (§6 step 0) |

## 6. Unblock runbook (exact steps for the maintainer)

0. Complete the §4 attestation. Do **not** proceed if any answer fails.
   **Machine-arrangement gate (added 2026-11-08):** decide which machine the
   editor will run on —
   * **Preferred:** the **primary developer workstation**, attended and
     license-holder-operated (the arrangement §2.8 most clearly covers). No
     further licensing input is needed for this arrangement beyond the §4
     attestation and the maintainer's own reading of the recorded terms.
   * **Any dedicated or unattended build machine** (including a self-hosted
     GitHub runner on a secondary machine): **ask Unity Compliance for
     written clarification FIRST** that a Unity Personal seat may be used on
     a separate build machine in the proposed arrangement, and keep the
     answer with the evidence. The primary/secondary installation clause
     does not by itself authorize it (§1.3). Until such written
     clarification exists, this arrangement stays blocked — do not use it.
   * **Never** a GitHub-hosted runner with a Personal license merely because
     a community CI guide describes the technical mechanism.
1. On the chosen **existing, persistent machine** (Linux; ~15 GB free disk,
   desktop or Xvfb available for Unity Hub):
   * Install Unity Hub (official Linux package), sign in with the Unity ID of
     the eligible account, and install Editor **6000.0.23f1** (matching the
     fixture).
   * In Hub: *Preferences → Licenses → Add → Get a free personal license*
     (this is the verified official Personal activation path, §1.2). The
     license file lands at `~/.local/share/unity3d/Unity/Unity_lic.ulf` —
     **outside the repository and never committed, per directive rule 5**.
   * Verify headless operation:
     `Editor/Unity -batchmode -nographics -quit -logFile -` on any scratch
     project (or the repo fixture) — it must exit 0.
2. Register that machine as a GitHub **self-hosted runner** in this repo
   (Settings → Actions → Runners → New self-hosted runner; the runner token
   is ephemeral and never committed), tagged e.g. `gamos-unity`.
3. Set repository variables (Settings → Secrets and variables → Actions →
   Variables — variables, not secrets, so they stay inspectable/auditable and
   contain **no license material**):
   * `UNITY_RUNNER_LABEL = gamos-unity` → the `unity-engine-status` job now
     runs on that runner;
   * `UNITY_EDITOR_PATH = /opt/Unity/Hub/Editor/6000.0.23f1/Editor/Unity`
     (or the actual install path).
4. Push any change touching the m2-e2e paths (or run the workflow via
   `workflow_dispatch`). The job then: runs the real integration suite on the
   licensed editor; only the suite's own `editorLicensed=true` evidence flips
   the recorded status to `editor-verified` (post-fix behavior, §3).
5. M2-G1 closes only when that CI run passes with `editor-verified`; then the
   M2 evidence bundle (`evidence/roadmap/M2.json`) can be assembled per the
   roadmap validator's requirements (all five gates, hash-bound committed
   evidence).

**Credential hygiene (directive rule 5):** the Unity ID, password, Hub
session, and the `Unity_lic.ulf` file stay on the runner machine / in the
maintainer's custody. They are never committed, never placed in repository
variables/secrets that end up in logs, and never uploaded in CI artifacts.
The only CI-visible facts are the two repository variables above (a label and
a filesystem path — no secrets).

## 7. Explicit blocked statement (directive task 7)

**M2-G1 is BLOCKED.** Exactly what is missing, in dependency order:

1. **Maintainer eligibility attestation** (§4): org revenue/funding < $200K
   USD + no disqualifying client work. Not verifiable from the repository.
2. ~~**Software Terms verification** (§4 item 4): the Personal machine-count /
   build-machine clause in `https://unity.com/legal/software-terms` — could
   not be retrieved from this network (bot-blocked; recorded in
   `sandbox-capability.txt`).~~ **CLOSED 2026-11-08:** the Unity Editor
   Software Terms was retrieved from the live canonical URL and committed
   verbatim (§1.3, `software-terms-excerpt.txt`); the maintainer's
   confirmation of the recorded interpretation replaces the retrieval gap.
3. **Unity account + activation**: a Unity ID owned by the eligible
   organization/user and a Unity Personal activation performed via Unity Hub
   on the chosen runner machine. **No credentials exist in this environment,
   and none may be fabricated** (also directive rule 5: they must stay out of
   Git/CI artifacts).
4. **A licensed machine arrangement**: the existing sandbox is
   disk-infeasible (§2); GitHub-hosted runners are not permitted for a
   Personal seat on the recorded text (§1.3 — a community CI guide is not
   licensing authority). The **primary workstation** (attended,
   license-holder-operated) is the preferred zero-cost path and needs only
   the §4 attestation; any **dedicated or unattended build machine**
   (including a self-hosted runner on a secondary machine) additionally
   requires **Unity Compliance's written clarification that a Personal seat
   covers a separate build machine in the proposed arrangement** (§1.3,
   compliance-FAQ position recorded by the maintainer's 2026-11-08 review
   directive; §6 step 0) — until that exists, that arrangement stays
   blocked. Unity Build Server is not available with Personal (§2.5 of the
   Software Terms) and no paid license will be bought (standing directive).

The invocation layer itself is implemented and exercised (54/54 package tests
including scratch-verified conforming-editor emulation paths; discovery and
the typed invocation layer drive the licensed editor the moment one is
provisioned — the integration suite's own skip banner documents this). No
mock, no substitute engine, no roadmap change.

## 8. Reproducing this investigation

* Evidence excerpts + manifest:
  `evidence/phase-m2/unity-personal-investigation/` (SHA-256 in
  `manifest.json`).
* Retrieval method: plain `curl -L` HTTPS GETs on 2026-11-07 (pricing/ToS/
  docs/FAQ pages) and 2026-11-08 (the Unity Editor Software Terms from its
  live canonical URL, discovered via the official Legal Information index
  `unity.com/legal/eula`); HTML→text extraction locally; `agent-browser`
  was blocked by unity.com bot protection on the LEGACY
  `/legal/software-terms` URL (recorded) — the live canonical URLs above
  need no bypass and serve the document publicly.
