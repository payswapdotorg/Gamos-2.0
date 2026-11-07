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
2026-11-07 from the Gamos dev sandbox via plain HTTPS. **The sandbox could not
retrieve `https://unity.com/legal/software-terms` (the Unity Editor Software
Terms EULA): unity.com serves a bot/geo-blocked shell (HTTP 404) to this
network.** Every clause that matters to build-machine licensing therefore
carries an explicit verified/unverified marking below.

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

### 1.3 Build machines / CI — what the retrievable official text actually says

| Statement | Status | Where |
|---|---|---|
| Build servers exist as a recognized deployment pattern ("you or your build server exceeds the login rate limit, which is 10 login attempts per minute") | VERIFIED | activation FAQ |
| Node-locked usage is "on the number of computers or operating systems **per Authorized User** as set forth in the Additional Terms and the Offering Identification" | VERIFIED (ToS) | `tos-authorized-user-excerpt.txt` |
| "Authorized Users" = identified individuals (employees/consultants/contractors) for whom a subscription was acquired | VERIFIED (ToS) | same |
| Floating (license-server) model — an organization-level, concurrency-based offering for "complex projects or larger organizations" | VERIFIED | `license-overview-excerpt.txt` |
| Unity's own hosted CI product (Unity Build Automation) is a separate paid offering | VERIFIED (pricing page feature tables) | `pricing-excerpt.txt` |
| **The exact Unity Editor Software Terms clause on how many machines a Personal license may run on, and whether an unattended CI/builder machine may use a Personal license** | **NOT VERIFIABLE FROM THIS ENVIRONMENT — unity.com/legal/software-terms is bot/geo-blocked here; maintainer must read it from a normal browser** | — |

**Task 3 conclusion (honest):** a *properly activated* Unity Personal
installation is usable **by the eligible user who activated it, on their
machines, through the Unity Hub** (all verified). Whether that activation may
be *moved to / shared with an unattended self-hosted CI runner* is governed by
the Software Terms clause this investigation could not retrieve. The
community-standard practice (GameCI: generate a Personal `.ulf` via Unity Hub,
store it as a CI secret, install it on the runner — see
`gameci-community-reference.txt`, marked **third-party, not Unity terms**)
works mechanically, but **the repository cannot treat it as verified-compliant
until the maintainer reads the Software Terms and decides.** Until then, the
only fully-documented official path is: activate Unity Hub on the runner
machine itself with the eligible account (§6, Option A).

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
  and the Software-Terms position on Personal-on-ephemeral-CI is unverified
  (§1.3). The CI therefore continues to record the honest
  `unavailable-license` / `editor-present-unlicensed` states.
* **A maintainer-provisioned self-hosted runner** (any existing persistent
  machine where the maintainer can run Unity Hub once): the compliant free
  path — §6 runbook.

## 3. What this commit changes (and does not change)

* **Does not change:** `docs/gamos/ROADMAP.json` (M2 stays `active`, M2-G1
  gate untouched), the M2 contracts, the plugin code, all Blender/Babylon
  work, the honest-skip behavior of the Unity integration suite.
* **Fixes a latent evidence-fidelity bug in the `unity-engine-status` CI job**
  (`.github/workflows/gamos-m2-e2e.yml`): the job previously recorded
  `editor-verified` whenever `UNITY_EDITOR_PATH` merely pointed at an
  executable — an editor binary present but **unactivated** would have
  produced a fabricated pass-record (exactly what the maintainer's directive
  forbids). The job now derives the gate status **from the integration
  suite's own machine evidence** (`editorLicensed=true/false` markers,
  captured with the suite log into the uploaded artifact), and the env var is
  plumbed at job level so every step sees the same value.
* **Adds self-hosted-runner plumbing:** `runs-on` for the unity job reads the
  repository variable `UNITY_RUNNER_LABEL` (default `ubuntu-latest` — zero
  behavior change until the maintainer sets it), so the licensed-runner path
  is actually reachable without editing the workflow again.
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
4. (Task 1 of the directive: **read `https://unity.com/legal/software-terms`
   from a normal browser** and record the answer to: *how many machines may a
   Unity Personal license be used on, and is use on an unattended CI/build
   machine permitted?* — this is the clause the sandbox could not retrieve.)

## 5. Runner decision matrix

| Option | Cost | Editor binary | Activation | Compliant? | Status |
|---|---|---|---|---|---|
| Existing dev sandbox | $0 | ❌ disk-infeasible (3.7G/9.9G free) | — | — | Rejected on capability (§2) |
| GitHub-hosted `ubuntu-latest` | $0 | ✅ (Blender precedent) | ❌ no credentials; Software-Terms position unverified | Unverified | Stays honest-unavailable (default) |
| Maintainer self-hosted runner (existing machine) | $0 | ✅ | ✅ Unity Hub sign-in by the eligible account | Yes, per §1.2 verified docs | **The documented path** (§6) |

## 6. Unblock runbook (exact steps for the maintainer)

0. Complete the §4 attestation. Do **not** proceed if any answer fails.
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
2. **Software Terms verification** (§4 item 4): the Personal machine-count /
   build-machine clause in `https://unity.com/legal/software-terms` — could
   not be retrieved from this network (bot-blocked; recorded in
   `sandbox-capability.txt`).
3. **Unity account + activation**: a Unity ID owned by the eligible
   organization/user and a Unity Personal activation performed via Unity Hub
   on the chosen runner machine. **No credentials exist in this environment,
   and none may be fabricated** (also directive rule 5: they must stay out of
   Git/CI artifacts).
4. **A licensed runner**: the existing sandbox is disk-infeasible (§2);
   GitHub-hosted runners have no editor/credentials by default. A
   maintainer-provisioned existing machine per the §6 runbook is required.

The invocation layer itself is implemented and exercised (54/54 package tests
including scratch-verified conforming-editor emulation paths; discovery and
the typed invocation layer drive the licensed editor the moment one is
provisioned — the integration suite's own skip banner documents this). No
mock, no substitute engine, no roadmap change.

## 8. Reproducing this investigation

* Evidence excerpts + manifest:
  `evidence/phase-m2/unity-personal-investigation/` (SHA-256 in
  `manifest.json`).
* Retrieval method: plain `curl -L` HTTPS GETs on 2026-11-07; HTML→text
  extraction locally; `agent-browser` was blocked by unity.com bot protection
  (recorded), so unity.com legal pages beyond the server-rendered
  pricing/ToS were unreachable from this network.
