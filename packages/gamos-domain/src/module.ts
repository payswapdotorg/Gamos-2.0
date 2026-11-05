/**
 * gamos-domain 模块清单：Gamos 纯游戏域包（roadmap M1.1–M1.4）。
 * 依赖声明与 architecture-policy.yaml 保持一致；对外只暴露 contract.ts。
 * 包含 PlayLiquid GameIR 的 pinned-commit vendor 副本（byte-exact，无本地改动）。
 */
export const gamosDomainModule = {
  id: "gamos-domain",
  requires: [],
  provides: ["gamos-domain-types", "gamos-capability-registry", "gamos-engine-discovery", "gamos-intent-resolution", "playliquid-gameir-vendor"],
  publicEntrypoints: ["contract.ts"],
} as const;
