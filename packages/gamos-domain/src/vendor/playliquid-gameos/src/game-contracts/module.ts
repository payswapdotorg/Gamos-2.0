/**
 * game-contracts 模块清单（PL-010 治理晋升）。
 * 依赖声明与 architecture-policy.yaml 保持一致；对外只暴露 src/index.ts。
 */
export const game_contractsModule = {
  id: "game-contracts",
  requires: [],
  provides: ["game-contracts"],
  publicEntrypoints: ["src/index.ts"],
} as const;
