// Gamos Unity bridge: typed asset import (M3.1 target leg).
//
// Fixed, committed, reviewed template. Invoked by the unity-engine-plugin via:
//
//   Unity -batchmode -nographics -projectPath <root> -quit \
//     -executeMethod Gamos.AssetImport.ImportAsset \
//     -gamosParams <params.json> -gamosResult <result.json>
//
// Reads TYPED parameters from the JSON file named by -gamosParams, applies the
// operation through public Unity APIs only, and writes a JSON result file to
// the path named by -gamosResult. There is no reflection, no process
// spawning, no networking, and no file deletion: the input is data for one
// fixed, allowlisted operation (asset.import). Target asset paths and scene
// paths must be relative "Assets/..." paths without ".." components
// (IsSafeRelativeAssetPath).
//
// The bridge COPIES NOTHING ITSELF: the TypeScript engine stages the verified
// artifact bytes into the project BEFORE the batch run; this method only
// operates on the already-staged file (artifactStagedPath must equal
// <projectRoot>/<targetAssetPath>). A file existing on disk does NOT prove an
// import: the loaded-asset record (GUID + mesh/material/vertex counts through
// AssetDatabase) is the engine-query verification.

using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Gamos
{
    /// <summary>Reviewed typed asset-import operation for the Gamos engine plugin.</summary>
    public static class AssetImport
    {
        /// <summary>Default scene written/created when placeInScene has no scene path.</summary>
        private const string DefaultScenePath = "Assets/Scenes/GamosScene.unity";

        /// <summary>The name given to the instantiated scene object (placeInScene).</summary>
        private const string ImportedObjectName = "GamosImported";

        /// <summary>Typed parameters for asset.import (deserialized with JsonUtility).</summary>
        [Serializable]
        private class ImportAssetParams
        {
            public string artifactStagedPath = "";
            public string targetAssetPath = "";
            public bool placeInScene = false;
            public string scenePath = "";
        }

        /// <summary>JSON result written for the engine layer to verify.</summary>
        [Serializable]
        private class ImportAssetResult
        {
            public bool ok;
            public string operation;
            public string importedPath;
            public string targetAssetPath;
            public string guid;
            public string assetType;
            public int meshCount;
            public long vertexCount;
            public int materialCount;
            public string[] subAssetNames = new string[0];
            public bool placedInScene;
            public string instantiatedObjectName;
            public bool sceneSaved;
            public string scenePath;
            public string error;
        }

        /// <summary>-executeMethod entry point: asset.import.</summary>
        public static void ImportAsset()
        {
            int exitCode;
            try
            {
                exitCode = RunImportAsset();
            }
            catch (Exception exception)
            {
                WriteResult(new ImportAssetResult
                {
                    ok = false,
                    operation = "asset.import",
                    importedPath = "",
                    targetAssetPath = "",
                    guid = "",
                    assetType = "",
                    meshCount = 0,
                    vertexCount = 0,
                    materialCount = 0,
                    subAssetNames = new string[0],
                    placedInScene = false,
                    instantiatedObjectName = "",
                    sceneSaved = false,
                    scenePath = "",
                    error = exception.Message,
                });
                Debug.LogError("Gamos AssetImport.ImportAsset failed: " + exception.Message);
                exitCode = 1;
            }
            EditorApplication.Exit(exitCode);
        }

        private static int RunImportAsset()
        {
            string paramsPath = GamosImportArgs.Value("-gamosParams");
            string resultPath = GamosImportArgs.Value("-gamosResult");
            if (string.IsNullOrEmpty(paramsPath) || string.IsNullOrEmpty(resultPath))
            {
                throw new InvalidOperationException(
                    "missing -gamosParams <path> and/or -gamosResult <path> command-line arguments");
            }
            if (!File.Exists(paramsPath))
            {
                throw new FileNotFoundException("gamos params file not found", paramsPath);
            }

            ImportAssetParams parameters = JsonUtility.FromJson<ImportAssetParams>(File.ReadAllText(paramsPath));
            string targetAssetPath = (parameters.targetAssetPath ?? "").Replace('\\', '/');
            if (!IsSafeRelativeAssetPath(targetAssetPath))
            {
                throw new InvalidOperationException(
                    "unsafe target asset path: " + targetAssetPath + " (must be a relative Assets/... path without '..')");
            }

            // The Unity process may be started from any working directory; the
            // project root is derived from Application.dataPath (= <root>/Assets).
            string projectRoot = Directory.GetParent(Application.dataPath).FullName;
            string targetAbsolute = Path.GetFullPath(Path.Combine(projectRoot, targetAssetPath));

            // The bridge copies nothing itself: it only operates on the file the
            // TypeScript engine already staged, and refuses anything else.
            if (string.IsNullOrEmpty(parameters.artifactStagedPath))
            {
                throw new InvalidOperationException(
                    "missing artifactStagedPath (the engine stages the artifact bytes before the batch run)");
            }
            string stagedAbsolute = Path.GetFullPath(parameters.artifactStagedPath);
            if (!File.Exists(stagedAbsolute))
            {
                throw new FileNotFoundException(
                    "the engine-staged artifact was not found (staging happens before the batch run)",
                    stagedAbsolute);
            }
            if (!string.Equals(stagedAbsolute, targetAbsolute, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    "the staged path does not match the target asset path: " + stagedAbsolute + " != " + targetAbsolute);
            }

            // Import through the real AssetDatabase (forced re-import), then
            // VERIFY the import produced a loadable asset: a file existing on
            // disk does not prove anything.
            AssetDatabase.ImportAsset(targetAssetPath, ImportAssetOptions.ForceUpdate);
            GameObject loaded = AssetDatabase.LoadAssetAtPath<GameObject>(targetAssetPath);
            if (loaded == null)
            {
                WriteResult(new ImportAssetResult
                {
                    ok = false,
                    operation = "asset.import",
                    importedPath = targetAbsolute,
                    targetAssetPath = targetAssetPath,
                    guid = AssetDatabase.AssetPathToGUID(targetAssetPath),
                    assetType = "",
                    meshCount = 0,
                    vertexCount = 0,
                    materialCount = 0,
                    subAssetNames = new string[0],
                    placedInScene = false,
                    instantiatedObjectName = "",
                    sceneSaved = false,
                    scenePath = "",
                    error = "AssetDatabase.LoadAssetAtPath<GameObject> returned null for " + targetAssetPath
                        + " — a staged file alone does not prove an import",
                });
                return 1;
            }

            UnityEngine.Object[] subAssets = AssetDatabase.LoadAllAssetsAtPath(targetAssetPath);
            int meshCount = 0;
            long vertexCount = 0;
            int materialCount = 0;
            string[] subAssetNames = new string[subAssets.Length];
            for (int index = 0; index < subAssets.Length; index++)
            {
                UnityEngine.Object asset = subAssets[index];
                subAssetNames[index] = asset != null ? asset.name : "";
                Mesh mesh = asset as Mesh;
                if (mesh != null)
                {
                    meshCount += 1;
                    vertexCount += mesh.vertexCount;
                    continue;
                }
                if (asset is Material)
                {
                    materialCount += 1;
                }
            }

            string guid = AssetDatabase.AssetPathToGUID(targetAssetPath);
            // The main asset is a GameObject by construction (LoadAssetAtPath<GameObject>).
            string assetType = "GameObject";
            bool verified = !string.IsNullOrEmpty(guid) && meshCount > 0;
            if (!verified)
            {
                WriteResult(new ImportAssetResult
                {
                    ok = false,
                    operation = "asset.import",
                    importedPath = targetAbsolute,
                    targetAssetPath = targetAssetPath,
                    guid = guid,
                    assetType = assetType,
                    meshCount = meshCount,
                    vertexCount = vertexCount,
                    materialCount = materialCount,
                    subAssetNames = subAssetNames,
                    placedInScene = false,
                    instantiatedObjectName = "",
                    sceneSaved = false,
                    scenePath = "",
                    error = "the imported asset did not verify (guid=\"" + guid + "\", meshCount=" + meshCount
                        + ") — a non-empty GUID and at least one loaded mesh are required",
                });
                return 1;
            }

            // Optional scene integration: open (or create) the scene, place an
            // instance of the imported asset at the origin, save.
            bool placedInScene = false;
            string instantiatedObjectName = "";
            bool sceneSaved = false;
            string scenePath = "";
            if (parameters.placeInScene)
            {
                scenePath = string.IsNullOrEmpty(parameters.scenePath)
                    ? DefaultScenePath
                    : parameters.scenePath.Replace('\\', '/');
                if (!IsSafeRelativeAssetPath(scenePath))
                {
                    throw new InvalidOperationException(
                        "unsafe scene path: " + scenePath + " (must be a relative Assets/... path without '..')");
                }
                string absoluteScenePath = Path.Combine(projectRoot, scenePath);
                Scene scene = File.Exists(absoluteScenePath)
                    ? EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single)
                    : EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

                GameObject instance = UnityEngine.Object.Instantiate<GameObject>(loaded);
                instance.name = ImportedObjectName;
                instance.transform.localPosition = Vector3.zero;
                placedInScene = true;
                instantiatedObjectName = instance.name;

                string sceneDirectory = Path.GetDirectoryName(absoluteScenePath);
                if (!string.IsNullOrEmpty(sceneDirectory))
                {
                    Directory.CreateDirectory(sceneDirectory);
                }
                sceneSaved = EditorSceneManager.SaveScene(scene, scenePath);
                verified = verified && sceneSaved;
            }

            WriteResult(new ImportAssetResult
            {
                ok = verified,
                operation = "asset.import",
                importedPath = targetAbsolute,
                targetAssetPath = targetAssetPath,
                guid = guid,
                assetType = assetType,
                meshCount = meshCount,
                vertexCount = vertexCount,
                materialCount = materialCount,
                subAssetNames = subAssetNames,
                placedInScene = placedInScene,
                instantiatedObjectName = instantiatedObjectName,
                sceneSaved = sceneSaved,
                scenePath = scenePath,
                error = verified ? "" : "EditorSceneManager.SaveScene returned false for " + scenePath,
            });
            return verified ? 0 : 1;
        }

        /// <summary>
        /// A scene/asset path must be relative, inside Assets/, and free of
        /// absolute roots and ".." components. Mirrors the TypeScript-side
        /// isSafeRelativeAssetPath guard (defense in depth: the bridge never
        /// trusts the caller's validation).
        /// </summary>
        private static bool IsSafeRelativeAssetPath(string scenePath)
        {
            if (string.IsNullOrEmpty(scenePath))
            {
                return false;
            }
            if (Path.IsPathRooted(scenePath))
            {
                return false;
            }
            string normalized = scenePath.Replace('\\', '/');
            if (normalized.Contains(".."))
            {
                return false;
            }
            return normalized == "Assets" || normalized.StartsWith("Assets/");
        }

        private static void WriteResult(ImportAssetResult result)
        {
            string resultPath = GamosImportArgs.Value("-gamosResult");
            if (string.IsNullOrEmpty(resultPath))
            {
                return; // best effort: the engine also fails closed on the missing report
            }
            File.WriteAllText(resultPath, JsonUtility.ToJson(result, true));
        }

        /// <summary>
        /// Safe command-line argument lookup: plain index-based pair matching
        /// over System.Environment.GetCommandLineArgs() — never a shell, never
        /// re-parsed as code.
        /// </summary>
        private static class GamosImportArgs
        {
            public static string Value(string flag)
            {
                string[] args = System.Environment.GetCommandLineArgs();
                for (int index = 0; index < args.Length - 1; index++)
                {
                    if (string.Equals(args[index], flag, StringComparison.OrdinalIgnoreCase))
                    {
                        return args[index + 1];
                    }
                }
                return null;
            }
        }
    }
}
