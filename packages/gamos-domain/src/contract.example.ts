import type { GameSpec } from "./domain/game-spec.js";
import { createGameConcept } from "./domain/game-concept.js";
import { parseGameSpec } from "./domain/game-spec.js";

/**
 * 契约用法示例：从用户消息构造 GameConcept，引用一份上游 GameIR 文档作为
 * GameSpec，再为一次只读项目检查引用能力注册表解析结果。最小骨架，不含实现细节。
 */
export async function useGamosDomainSection(
  message: { text: string; sessionId: string; capturedAt: string },
  specInput: unknown,
  render: (summary: { conceptId: string; specVersion: string }) => void,
): Promise<{ dispose: () => void }> {
  // 1) 用户意图 → GameConcept（fail-closed：结构/溯源不合法直接抛错）。
  const concept = createGameConcept({
    conceptId: "concept-example",
    kind: "gaming",
    genre: ["arcade"],
    mechanics: [],
    platformPreferences: [],
    references: [],
    constraints: [],
    acceptanceExpectations: [],
    provenance: {
      origin: "user-message",
      sessionId: message.sessionId,
      capturedAt: message.capturedAt,
    },
  });
  // 2) GameSpec 必须逐字段兼容上游 GameIRDocument（多余字段=违规，不是扩展）。
  const spec: GameSpec = parseGameSpec(specInput);
  render({ conceptId: concept.conceptId, specVersion: spec.irVersion });
  // 3) 计划/验收/能力解析由调用方持有；本示例不保留任何运行时资源。
  return {
    dispose: () => {
      // 纯数据模块无可释放资源；保留钩子以对齐分区生命周期约定。
    },
  };
}
