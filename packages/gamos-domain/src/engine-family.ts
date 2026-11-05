/**
 * Engine family vocabulary — shared by domain logic and IO adapters, so it
 * lives at the package root (outside the layer system, importable by both).
 */
export type EngineFamily = "unity" | "blender" | "babylon" | "godot" | "unreal" | "core";

const ENGINE_FAMILIES: readonly EngineFamily[] = Object.freeze([
  "unity",
  "blender",
  "babylon",
  "godot",
  "unreal",
  "core",
]);

export function isEngineFamily(value: unknown): value is EngineFamily {
  return typeof value === "string" && (ENGINE_FAMILIES as readonly string[]).includes(value);
}

export const ENGINE_FAMILY_LIST: readonly EngineFamily[] = ENGINE_FAMILIES;
