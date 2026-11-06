import { defineConfig } from "vitest/config";

// 根单测引用固定项目入口；缺失此文件会在发现公共测试前直接终止。
export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: "gamos-domain",
    include: ["test/**/*.test.ts"],
    // 与 cua-placeholder 相同的隔离分组约定：低 worker 数、独立 group。
    maxWorkers: 1,
    sequence: { groupOrder: 2 },
  },
});
