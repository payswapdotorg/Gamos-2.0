/**
 * M3.1/M3.2 source leg — the manifest-ingredient surface of
 * `blender/asset.export` (typed-ops). Written FIRST (strict TDD RED):
 * the interchange settings, the bridge-config mapping and the media-type
 * classification do not exist yet.
 *
 * Pins the handoff §6/§7 requirements:
 * - declared coordinate/scale settings are part of the typed input
 *   (upAxis y|z; optional positive globalScale);
 * - GLTF + globalScale fails closed (the glTF exporter has no global scale
 *   setting — verified against Blender 4.1.1 operator parameters);
 * - the bridge config carries the abstract interchange settings (the bridge
 *   maps them to the per-exporter kwargs — never the other way around);
 * - artifact/dependent media types are classified deterministically for the
 *   cross-engine manifest.
 */

import { describe, expect, test } from "vitest";
import {
  AssetExportInput,
  buildExportBridgeConfig,
  dependentFileMediaType,
  exportArtifactMediaType,
} from "../src/typed-ops.js";

describe("asset export interchange settings (M3 manifest ingredients)", () => {
  test("accepts the optional interchange block with upAxis and a positive globalScale", () => {
    expect(
      AssetExportInput.safeParse({
        blendFile: "/ws/scene.blend",
        outputPath: "/ws/out/cube.fbx",
        format: "FBX",
        interchange: { upAxis: "y", globalScale: 2 },
      }).success,
    ).toBe(true);
    expect(
      AssetExportInput.safeParse({
        blendFile: "/ws/scene.blend",
        outputPath: "/ws/out/cube.obj",
        format: "OBJ",
        interchange: { upAxis: "z" },
      }).success,
    ).toBe(true);
    // Absent interchange stays valid (exporter defaults, still manifest-recorded).
    expect(
      AssetExportInput.safeParse({
        blendFile: "/ws/scene.blend",
        outputPath: "/ws/out/cube.fbx",
        format: "FBX",
      }).success,
    ).toBe(true);
  });

  test("rejects invalid upAxis values and non-positive/non-finite globalScale", () => {
    expect(
      AssetExportInput.safeParse({
        blendFile: "/ws/s.blend",
        outputPath: "/ws/out.fbx",
        format: "FBX",
        interchange: { upAxis: "x" },
      }).success,
    ).toBe(false);
    expect(
      AssetExportInput.safeParse({
        blendFile: "/ws/s.blend",
        outputPath: "/ws/out.fbx",
        format: "FBX",
        interchange: { upAxis: "y", globalScale: 0 },
      }).success,
    ).toBe(false);
    expect(
      AssetExportInput.safeParse({
        blendFile: "/ws/s.blend",
        outputPath: "/ws/out.fbx",
        format: "FBX",
        interchange: { upAxis: "y", globalScale: -1 },
      }).success,
    ).toBe(false);
    expect(
      AssetExportInput.safeParse({
        blendFile: "/ws/s.blend",
        outputPath: "/ws/out.fbx",
        format: "FBX",
        interchange: { upAxis: "y", globalScale: Number.NaN },
      }).success,
    ).toBe(false);
    expect(
      AssetExportInput.safeParse({
        blendFile: "/ws/s.blend",
        outputPath: "/ws/out.fbx",
        format: "FBX",
        interchange: { upAxis: "y", globalScale: "2" },
      }).success,
    ).toBe(false);
  });

  test("GLTF + globalScale fails closed — the glTF exporter has no global scale setting", () => {
    const parsed = AssetExportInput.safeParse({
      blendFile: "/ws/s.blend",
      outputPath: "/ws/out.glb",
      format: "GLTF",
      interchange: { upAxis: "y", globalScale: 2 },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message.includes("global scale"))).toBe(true);
    }
    // GLTF with only upAxis stays valid (export_yup mapping).
    expect(
      AssetExportInput.safeParse({
        blendFile: "/ws/s.blend",
        outputPath: "/ws/out.glb",
        format: "GLTF",
        interchange: { upAxis: "z" },
      }).success,
    ).toBe(true);
  });

  test("buildExportBridgeConfig carries the interchange settings and nulls them when absent", () => {
    expect(
      buildExportBridgeConfig({
        outputPath: "/ws/out/cube.fbx",
        format: "FBX",
        selection: ["Cube"],
        interchange: { upAxis: "y", globalScale: 2 },
      }),
    ).toEqual({
      outputPath: "/ws/out/cube.fbx",
      format: "FBX",
      selection: ["Cube"],
      interchange: { upAxis: "y", globalScale: 2 },
    });
    expect(
      buildExportBridgeConfig({ outputPath: "/ws/out/cube.glb", format: "GLTF" }),
    ).toEqual({
      outputPath: "/ws/out/cube.glb",
      format: "GLTF",
      selection: null,
      interchange: null,
    });
  });

  test("exportArtifactMediaType maps the reviewed formats deterministically", () => {
    expect(exportArtifactMediaType("FBX")).toBe("application/octet-stream");
    expect(exportArtifactMediaType("GLTF")).toBe("model/gltf-binary");
    expect(exportArtifactMediaType("OBJ")).toBe("text/plain");
  });

  test("dependentFileMediaType classifies sidecars by extension", () => {
    expect(dependentFileMediaType("mesh.mtl")).toBe("text/plain");
    expect(dependentFileMediaType("scene.bin")).toBe("application/octet-stream");
    expect(dependentFileMediaType("base.png")).toBe("image/png");
    expect(dependentFileMediaType("base.jpg")).toBe("image/jpeg");
    expect(dependentFileMediaType("base.webp")).toBe("image/webp");
    expect(dependentFileMediaType("base.tga")).toBe("image/x-tga");
    expect(dependentFileMediaType("base.bmp")).toBe("image/bmp");
    expect(dependentFileMediaType("base.exr")).toBe("image/x-exr");
    expect(dependentFileMediaType("unknown.xyz")).toBe("application/octet-stream");
  });
});
