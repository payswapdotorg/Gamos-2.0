/**
 * Runtime self-check harness (PL-001 evidence).
 *
 * Run with: `node src/selfcheck.ts` (Node >= 24 type stripping).
 * Prints deterministic outputs that demonstrate the pure contract
 * functions work at runtime. No assertions — those live in tests.
 */

import {
  asAvatarId,
  asCommitSha,
  asGameId,
  asRegionId,
  asWorldId,
  asZoneId,
  asChunkId,
  assessAvatarCompatibility,
  canonicalRefPath,
  gameIdentityKey,
} from "./index.js";

const gameId = asGameId("game-alpha");
const worldId = asWorldId("world-primus");
const regionId = asRegionId("region-north");
const zoneId = asZoneId("zone-frost");
const chunkId = asChunkId("chunk-0-0");
const avatarId = asAvatarId("avatar-nova");
const sha = asCommitSha("b88e814755e9bd1efed6cb6f8e26f316bada1247");

if (
  gameId === undefined ||
  worldId === undefined ||
  regionId === undefined ||
  zoneId === undefined ||
  chunkId === undefined ||
  avatarId === undefined ||
  sha === undefined
) {
  console.error("selfcheck: fixture ids failed to parse");
  process.exitCode = 1;
} else {
  const identity = {
    id: gameId,
    displayName: "Game Alpha",
    kind: "game" as const,
    repository: { host: "github.com", owner: "payswapdotorg", repository: "game-alpha" },
    revision: { kind: "commit" as const, commit: sha },
    lineage: { head: sha, ancestors: [] },
  };
  console.log(`identity-key: ${gameIdentityKey(identity)}`);

  const chunkPath = canonicalRefPath({
    world: worldId,
    region: regionId,
    zone: zoneId,
    chunk: chunkId,
  });
  console.log(`chunk-path: ${chunkPath}`);

  const compatibility = assessAvatarCompatibility(
    {
      avatar: avatarId,
      capabilities: [
        { capability: "vision", requirement: "required" },
        { capability: "speech", requirement: "preferred" },
        { capability: "gaze", requirement: "optional" },
      ],
      portability: "portable",
      dataPolicy: { persistence: "persistent", crossGameMemory: true },
    },
    { denied: ["gaze"], approvalRequired: ["speech"], sandboxed: true },
  );
  console.log(
    `avatar-compat: compatible=${compatibility.compatible} degraded=[${compatibility.degraded.join(",")}]`,
  );
}
