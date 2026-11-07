import { describe, expect, it } from "vitest";
import { validatePluginProcessTrust } from "../src/domain/plugin-trust.js";

/**
 * Plugin trust and MCP process authority (directive §13 / contract 09 revision 2 — M1.6 TDD RED).
 *
 * The critical distinction: a permission prompt approving an MCP TOOL invocation
 * does not sandbox the MCP SERVER PROCESS — the process runs under OS-level
 * authority. Negative tests: nonexistent sandbox claims, undisclosed filesystem
 * access, undisclosed network access, credential-bearing environment exposure,
 * unresolved provenance, community plugins without least-privilege controls.
 *
 * "Sandboxed" wording is prohibited for MCP processes in any Gamos-authored
 * surface; a UI plugin sandbox claim is legal ONLY for the renderer-side UI
 * surface (contract 09 §2).
 */

function officialUiPlugin() {
  return {
    pluginId: "zcode-github",
    surfaces: ["ui"] as const,
    provenance: {
      publisher: "zcode-official" as const,
      source: {
        type: "marketplace",
        marketplaceId: "zcode-plugins-official",
        version: "0.1.4",
        sha256: "d".repeat(64),
      },
      surfaces: ["ui"],
    },
  };
}

function communityMcpPlugin(overrides: Record<string, unknown> = {}) {
  return {
    pluginId: "community-blender-mcp",
    surfaces: ["mcp"] as const,
    mcpServers: [{ name: "blender-bridge", entryPoint: "dist/mcp/server.js" }],
    provenance: {
      publisher: "community" as const,
      source: {
        type: "repository",
        repo: "example/community-blender-mcp",
        commitSha: "c".repeat(40),
        path: ".",
      },
      surfaces: ["mcp"],
      reviewRef: "PR #42 (TL-reviewed entry points)",
    },
    processRegime: {
      environmentMinimized: true,
      workingDirectoryContained: true,
      disclosures: {
        filesystem: "read/write within the OS user account scope; no path allow-list",
        network: "unrestricted outbound and loopback access",
        environment: "plugin-declared variables only (minimized spawn env)",
      },
    },
    ...overrides,
  };
}

describe("validatePluginProcessTrust — trust/provenance validation (M1.6)", () => {
  it("accepts an official UI-only plugin (renderer sandbox surface, no MCP process)", () => {
    const result = validatePluginProcessTrust(officialUiPlugin());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trust.surfaces).toEqual(["ui"]);
      expect(result.trust.mcpProcess).toBeUndefined();
    }
  });

  it("accepts a community MCP plugin WITH the least-privilege regime + full disclosures + review", () => {
    const result = validatePluginProcessTrust(communityMcpPlugin());
    expect(result.ok).toBe(true);
    if (result.ok && result.trust.mcpProcess) {
      expect(result.trust.mcpProcess.executionRegime).toBe("community-minimized");
      expect(result.trust.mcpProcess.environmentMinimized).toBe(true);
    }
  });

  it("NEGATIVE: an MCP server claiming a nonexistent sandbox is rejected (prohibited wording)", () => {
    const result = validatePluginProcessTrust(
      communityMcpPlugin({
        processRegime: {
          environmentMinimized: true,
          workingDirectoryContained: true,
          disclosures: {
            filesystem: "sandboxed — the plugin sandbox contains filesystem access",
            network: "sandboxed network access",
            environment: "sandboxed environment",
          },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("sandbox-claim");
      expect(result.reason).toContain("MCP");
    }
  });

  it("NEGATIVE: undisclosed filesystem access — MCP declaration missing the filesystem disclosure", () => {
    const result = validatePluginProcessTrust(
      communityMcpPlugin({
        processRegime: {
          environmentMinimized: true,
          workingDirectoryContained: true,
          disclosures: {
            network: "unrestricted outbound and loopback access",
            environment: "plugin-declared variables only",
          },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("disclosure-missing-filesystem");
  });

  it("NEGATIVE: undisclosed network access — MCP declaration missing the network disclosure", () => {
    const result = validatePluginProcessTrust(
      communityMcpPlugin({
        processRegime: {
          environmentMinimized: true,
          workingDirectoryContained: true,
          disclosures: {
            filesystem: "read/write within the OS user account scope",
            environment: "plugin-declared variables only",
          },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("disclosure-missing-network");
  });

  it("NEGATIVE: undisclosed environment access — MCP declaration missing the environment disclosure", () => {
    const result = validatePluginProcessTrust(
      communityMcpPlugin({
        processRegime: {
          environmentMinimized: true,
          workingDirectoryContained: true,
          disclosures: {
            filesystem: "read/write within the OS user account scope",
            network: "unrestricted outbound and loopback access",
          },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("disclosure-missing-environment");
  });

  it("NEGATIVE: credential-bearing environment exposure without a reviewed need is rejected", () => {
    const result = validatePluginProcessTrust(
      communityMcpPlugin({
        mcpServers: [
          { name: "blender-bridge", entryPoint: "dist/mcp/server.js", declaredEnvVars: ["OPENROUTER_API_KEY", "BLENDER_PATH"] },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("credential-env-unreviewed");
      expect(result.reason).toContain("OPENROUTER_API_KEY");
    }
  });

  it("credential-bearing env vars pass only with an explicit reviewed need declaration", () => {
    const result = validatePluginProcessTrust(
      communityMcpPlugin({
        mcpServers: [
          {
            name: "blender-bridge",
            entryPoint: "dist/mcp/server.js",
            declaredEnvVars: ["OPENROUTER_API_KEY", "BLENDER_PATH"],
            credentialEnvNeedsReviewed: true,
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("NEGATIVE: unresolved provenance — a plugin without a provenance ref is rejected (fail closed)", () => {
    const result = validatePluginProcessTrust({
      pluginId: "mystery-plugin",
      surfaces: ["ui"] as const,
      provenance: undefined as never,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("provenance-missing");
  });

  it("NEGATIVE: community mcp-carrying plugin without a reviewRef is rejected (contract 09 §4.3)", () => {
    const result = validatePluginProcessTrust(
      communityMcpPlugin({
        provenance: {
          publisher: "community" as const,
          source: {
            type: "repository",
            repo: "example/community-blender-mcp",
            commitSha: "c".repeat(40),
            path: ".",
          },
          surfaces: ["mcp"],
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("community-review-missing");
  });

  it("NEGATIVE: community MCP process missing least-privilege controls fails closed (env minimization)", () => {
    const result = validatePluginProcessTrust(
      communityMcpPlugin({
        processRegime: {
          environmentMinimized: false,
          workingDirectoryContained: true,
          disclosures: {
            filesystem: "read/write within the OS user account scope",
            network: "unrestricted outbound and loopback access",
            environment: "full spawn environment inheritance",
          },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("least-privilege-missing");
      expect(result.reason).toContain("environment");
    }
  });

  it("NEGATIVE: community MCP process missing working-directory containment fails closed", () => {
    const result = validatePluginProcessTrust(
      communityMcpPlugin({
        processRegime: {
          environmentMinimized: true,
          workingDirectoryContained: false,
          disclosures: {
            filesystem: "read/write within the OS user account scope",
            network: "unrestricted outbound and loopback access",
            environment: "plugin-declared variables only",
          },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("least-privilege-missing");
  });

  it("community full-privilege execution requires an EXPLICIT user approval of that regime (never silent)", () => {
    const result = validatePluginProcessTrust(
      communityMcpPlugin({
        processRegime: {
          environmentMinimized: false,
          workingDirectoryContained: false,
          fullAuthorityUserApproval: { approvedAt: "2026-11-05T22:00:00Z", regime: "community-full" },
          disclosures: {
            filesystem: "read/write within the OS user account scope",
            network: "unrestricted outbound and loopback access",
            environment: "full spawn environment inheritance",
          },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.trust.mcpProcess) {
      expect(result.trust.mcpProcess.executionRegime).toBe("community-full-approved");
    }
  });

  it("NEGATIVE: surfaces/content mismatch — mcpServers content without the mcp surface declaration", () => {
    const result = validatePluginProcessTrust(
      communityMcpPlugin({ surfaces: ["ui"] as const }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("surfaces-mismatch");
  });

  it("NEGATIVE: surfaces/content mismatch — mcp surface declared with no mcpServers content", () => {
    const result = validatePluginProcessTrust(
      communityMcpPlugin({ mcpServers: [] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("surfaces-mismatch");
  });

  it("official MCP plugins run under the honest full-privilege baseline with disclosures", () => {
    const result = validatePluginProcessTrust({
      pluginId: "zcode-official-engine-bridge",
      surfaces: ["mcp"] as const,
      mcpServers: [{ name: "bridge", entryPoint: "dist/mcp/server.js" }],
      provenance: {
        publisher: "zcode-official" as const,
        source: {
          type: "marketplace",
          marketplaceId: "zcode-plugins-official",
          version: "1.0.0",
          sha256: "e".repeat(64),
        },
        surfaces: ["mcp"],
      },
      processRegime: {
        environmentMinimized: false,
        workingDirectoryContained: false,
        disclosures: {
          filesystem: "read/write within the OS user account scope; no path allow-list",
          network: "unrestricted outbound and loopback access",
          environment: "full spawn environment inheritance",
        },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.trust.mcpProcess) {
      expect(result.trust.mcpProcess.executionRegime).toBe("official-full");
    }
  });
});
