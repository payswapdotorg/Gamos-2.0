# Gamos Phase-0 Contract 08 — Artifact & Evidence Contracts

- Status: **FROZEN (Phase 0)** — hash-protected governance control file
- Owner: Gamos TL

## 1. Principle

Every Gamos outcome produces **verifiable artifacts** and **reproducible evidence**,
consistent with how this repository itself is governed (evidence/ directories,
sha256-bound records, honest conditional states).

## 2. Artifact spec (schema `gamos/artifact@1`)

```ts
interface ArtifactSpec {
  kind: "source-file" | "build" | "render" | "screenshot" | "report" | "data-export";
  path: string;                    // workspace-relative
  producedBy: string;              // capability id
  sha256: string;                  // content hash at production time
  createdAt: string;               // ISO-8601 UTC
  reproducibility: {
    command?: string;              // how to regenerate (e.g. engine build cmd)
    environmentRef?: string;       // engine family + version (contract 04)
    deterministic: boolean;
  };
}
```

MUST rules:
1. Artifacts are ordinary workspace files produced through agent tools (Write/Edit or
   engine plugin outputs) — hashed and recorded in the plan's completion record
   (stored in existing conversation/workflow records).
2. Builds and renders MUST record the exact engine version and command line used.
3. Evidence bundles for milestone acceptance follow this repository's convention:
   `evidence/phase-<n>/` with JSON records + logs + screenshots, and explicit
   `conditional_states` entries for anything unavailable — **no mocked production
   integrations, fake engine availability, fake builds, or placeholder functionality**
   (architect's acceptance rule, verbatim).
4. Screenshots of app UI MUST come from the real application (web/desktop), never a
   status console (verified Phase B practice).

## 3. Session linkage

Artifacts reference the producing session id (`session.id` in the CLI store — verified)
so any claimed outcome is traceable to the full conversation transcript (model-io
rollout JSONL).
