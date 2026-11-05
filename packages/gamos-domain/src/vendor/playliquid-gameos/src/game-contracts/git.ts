/**
 * R1 contract vocabulary: every game is a Git repository.
 *
 * This module defines the *types* that describe Git identity — commit shas,
 * refs, repository coordinates and lineage. It deliberately contains no Git
 * client, no process execution and no network access: executing Git is the
 * job of the git-lineage package and adapters, never of contracts.
 *
 * Pure module.
 */

import type { Brand } from "./brand.js";

/** Lowercase 40-hex commit id (SHA-1 object name, as used by Git). */
export type CommitSha = Brand<string, "CommitSha">;
/** A Git branch name, e.g. `main` or `work/PL-001`. */
export type BranchName = Brand<string, "BranchName">;
/** A Git tag name, e.g. `v1.0.0`. */
export type TagName = Brand<string, "TagName">;

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

/** Returns true when `text` is a canonical lowercase 40-hex commit sha. */
export function isCommitShaText(text: string): text is CommitSha {
  return COMMIT_SHA_PATTERN.test(text);
}

/** Parses and validates `text` as a {@link CommitSha}, or returns `undefined`. */
export function asCommitSha(text: string): CommitSha | undefined {
  return isCommitShaText(text) ? text : undefined;
}

/** Parses and validates `text` as a {@link BranchName}, or returns `undefined`. */
export function asBranchName(text: string): BranchName | undefined {
  return isValidBranchNameText(text) ? (text as BranchName) : undefined;
}

/** Parses and validates `text` as a {@link TagName}, or returns `undefined`. */
export function asTagName(text: string): TagName | undefined {
  return isValidTagNameText(text) ? (text as TagName) : undefined;
}

/**
 * Branch-name rules (subset of `git-check-ref-format` sufficient for the
 * GameOS vocabulary): 1..200 chars, no leading `-`, no `..`, no control
 * characters, no trailing `.lock`, and not the literal `HEAD`.
 */
export function isValidBranchNameText(text: string): boolean {
  if (text.length === 0 || text.length > 200) return false;
  if (text === "HEAD") return false;
  if (text.startsWith("-") || text.endsWith(".lock")) return false;
  if (text.includes("..") || text.includes("//")) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f ~^:?*[\\]/.test(text);
}

/** Tag names follow the same rules as branch names in this vocabulary. */
export function isValidTagNameText(text: string): boolean {
  return isValidBranchNameText(text);
}

/**
 * A pinned Git reference. The discriminated union keeps branch/tag/commit
 * intent explicit instead of encoding it into strings.
 */
export type GitRef =
  | { readonly kind: "branch"; readonly name: BranchName; readonly commit: CommitSha }
  | { readonly kind: "tag"; readonly name: TagName; readonly commit: CommitSha }
  | { readonly kind: "commit"; readonly commit: CommitSha };

/** Returns the commit pinned by any {@link GitRef} variant. */
export function gitRefCommit(ref: GitRef): CommitSha {
  return ref.commit;
}

/** Returns true when `value` is structurally a valid {@link GitRef}. */
export function isGitRef(value: unknown): value is GitRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  switch (ref.kind) {
    case "branch":
      return typeof ref.name === "string" && isValidBranchNameText(ref.name) && isCommitShaText(`${ref.commit}`);
    case "tag":
      return typeof ref.name === "string" && isValidTagNameText(ref.name) && isCommitShaText(`${ref.commit}`);
    case "commit":
      return isCommitShaText(`${ref.commit}`);
    default:
      return false;
  }
}

/**
 * Where a game repository lives. `host` is a DNS hostname (e.g.
 * `github.com`); owner/repository are the platform-specific path segments.
 * No URL parsing or network access happens here — this is coordinates only.
 */
export type GitRepositoryCoordinates = {
  readonly host: string;
  readonly owner: string;
  readonly repository: string;
};

const REPOSITORY_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Returns true when `value` is structurally valid {@link GitRepositoryCoordinates}. */
export function isGitRepositoryCoordinates(value: unknown): value is GitRepositoryCoordinates {
  if (typeof value !== "object" || value === null) return false;
  const coords = value as Record<string, unknown>;
  return (
    typeof coords.host === "string" &&
    coords.host.length > 0 &&
    coords.host.length <= 253 &&
    typeof coords.owner === "string" &&
    REPOSITORY_SEGMENT_PATTERN.test(coords.owner) &&
    typeof coords.repository === "string" &&
    REPOSITORY_SEGMENT_PATTERN.test(coords.repository)
  );
}

/** Canonical `owner/repository` slug for repository coordinates. */
export function canonicalRepositorySlug(coords: GitRepositoryCoordinates): string {
  return `${coords.owner}/${coords.repository}`;
}

/**
 * A fork point: where this game's history diverged from another repository.
 * Lock rule 34 — forks preserve lineage. This type is the preserved memory.
 */
export type ForkPoint = {
  readonly repository: GitRepositoryCoordinates;
  readonly commit: CommitSha;
};

/** Returns true when `value` is structurally a valid {@link ForkPoint}. */
export function isForkPoint(value: unknown): value is ForkPoint {
  if (typeof value !== "object" || value === null) return false;
  const fork = value as Record<string, unknown>;
  return isGitRepositoryCoordinates(fork.repository) && isCommitShaText(`${fork.commit}`);
}

/**
 * First-parent lineage of a game revision.
 *
 * `ancestors[0]` is the parent of `head`; each following entry is the
 * next first-parent, ascending history. Merge parents beyond the first
 * parent are represented by their own lineage documents, not flattened
 * here — keeping the chain linear makes deterministic comparison cheap.
 */
export type GameLineage = {
  readonly head: CommitSha;
  readonly ancestors: readonly CommitSha[];
  readonly forkPoint?: ForkPoint;
};

/** Returns true when `value` is structurally a valid {@link GameLineage}. */
export function isGameLineage(value: unknown): value is GameLineage {
  if (typeof value !== "object" || value === null) return false;
  const lineage = value as Record<string, unknown>;
  if (!isCommitShaText(`${lineage.head}`)) return false;
  if (!Array.isArray(lineage.ancestors)) return false;
  if (!lineage.ancestors.every((sha) => typeof sha === "string" && isCommitShaText(sha))) return false;
  if (lineage.forkPoint !== undefined && !isForkPoint(lineage.forkPoint)) return false;
  return true;
}

/** Returns true when `sha` is the head, an ancestor, or the fork point. */
export function lineageContainsCommit(lineage: GameLineage, sha: CommitSha): boolean {
  if (lineage.head === sha) return true;
  if (lineage.ancestors.includes(sha)) return true;
  return lineage.forkPoint !== undefined && lineage.forkPoint.commit === sha;
}
