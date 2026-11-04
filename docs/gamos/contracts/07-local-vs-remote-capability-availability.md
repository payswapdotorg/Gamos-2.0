# Gamos Phase-0 Contract 07 — Local vs Remote Capability Availability

- Status: **FROZEN (Phase 0)** — hash-protected governance control file
- Owner: Gamos TL

## 1. Principle

Capability availability is a **first-class, explicit state** — never a silent failure
and never a mocked success. This mirrors both the architect's rule and the verified
upstream behavior (providers report Ready/Not-ready; models report selectable or not).

## 2. Availability spec (schema `gamos/availability@1`)

```ts
type AvailabilitySpec =
  | { state: "local";    detail: string }                        // engine present, headless OK
  | { state: "local-display-required"; displayServer: boolean }  // needs X/wayland session
  | { state: "remote";   endpoint: string; latencyHint?: "fast" | "batch" }
  | { state: "unavailable"; reason: string; remedy?: string };
```

MUST rules:
1. Every capability record carries an availability spec evaluated at **plan time**
   using contract 04 discovery + runtime probes (display server present; engine version
   in range).
2. `unavailable` MUST carry a human-readable reason and, where possible, a remedy
   (e.g. "install Unity 2022.3 LTS; see unity.com/download").
3. Degradation is explicit: a capability MAY declare a `degradesTo` alternative
   capability (e.g. GUI editor step → headless batch equivalent) — the substitution is
   logged in the conversation and requires user approval when permissions differ.
4. Remote capabilities (future render farms / cloud builders) use the existing
   source-server/connection-profile infrastructure (`sourceServers`, `connectionProfiles`
   in settings — verified present) — no new remote transport.

## 3. Truth-in-evidence

Every GamePlan completion record MUST list, per step: capability id, availability state
used, and artifact refs (contract 08). Plans MAY NOT claim success for steps that ran
in `unavailable` states.
