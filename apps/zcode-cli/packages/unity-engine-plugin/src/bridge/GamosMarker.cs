// Gamos Unity bridge: typed scene operations (M2.1).
//
// Fixed, committed, reviewed template. Invoked by the unity-engine-plugin via:
//
//   Unity -batchmode -nographics -projectPath <root> -quit \
//     -executeMethod Gamos.Marker.AddCube \
//     -gamosParams <params.json> -gamosResult <result.json>
//
// Reads TYPED parameters from the JSON file named by -gamosParams, applies the
// operation through public Unity APIs only, and writes a JSON result file to
// the path named by -gamosResult. There is no reflection, no process
// spawning, no networking, and no file deletion: the input is data for one
// fixed, allowlisted operation (scene.add-cube). Scene paths must be relative
// "Assets/..." paths without ".." components (IsSafeRelativeAssetPath).

using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Gamos
{
    /// <summary>Reviewed typed scene operations for the Gamos engine plugin.</summary>
    public static class Marker
    {
        /// <summary>Default scene written/created when no scene path is given.</summary>
        private const string DefaultScenePath = "Assets/Scenes/GamosScene.unity";

        /// <summary>Typed parameters for scene.add-cube (deserialized with JsonUtility).</summary>
        [Serializable]
        private class AddCubeParams
        {
            public string name = "";
            public Vector3 location = new Vector3(0f, 0f, 0f);
            public Vector3 scale = new Vector3(1f, 1f, 1f);
            public string scenePath = "";
        }

        /// <summary>JSON result written for the engine layer to verify.</summary>
        [Serializable]
        private class AddCubeResult
        {
            public bool ok;
            public string operation;
            public string scenePath;
            public string createdObjectName;
            public bool saved;
            public string error;
        }

        /// <summary>-executeMethod entry point: scene.add-cube.</summary>
        public static void AddCube()
        {
            int exitCode;
            try
            {
                exitCode = RunAddCube();
            }
            catch (Exception exception)
            {
                WriteResult(new AddCubeResult
                {
                    ok = false,
                    operation = "scene.add-cube",
                    scenePath = "",
                    createdObjectName = "",
                    saved = false,
                    error = exception.Message,
                });
                Debug.LogError("Gamos Marker.AddCube failed: " + exception.Message);
                exitCode = 1;
            }
            EditorApplication.Exit(exitCode);
        }

        private static int RunAddCube()
        {
            string paramsPath = GamosArgs.Value("-gamosParams");
            string resultPath = GamosArgs.Value("-gamosResult");
            if (string.IsNullOrEmpty(paramsPath) || string.IsNullOrEmpty(resultPath))
            {
                throw new InvalidOperationException(
                    "missing -gamosParams <path> and/or -gamosResult <path> command-line arguments");
            }
            if (!File.Exists(paramsPath))
            {
                throw new FileNotFoundException("gamos params file not found", paramsPath);
            }

            AddCubeParams parameters = JsonUtility.FromJson<AddCubeParams>(File.ReadAllText(paramsPath));
            string scenePath = string.IsNullOrEmpty(parameters.scenePath)
                ? DefaultScenePath
                : parameters.scenePath.Replace('\\', '/');
            if (!IsSafeRelativeAssetPath(scenePath))
            {
                throw new InvalidOperationException(
                    "unsafe scene path: " + scenePath + " (must be a relative Assets/... path without '..')");
            }

            // The Unity process may be started from any working directory; the
            // project root is derived from Application.dataPath (= <root>/Assets).
            string projectRoot = Directory.GetParent(Application.dataPath).FullName;
            string absoluteScenePath = Path.Combine(projectRoot, scenePath);

            Scene scene = File.Exists(absoluteScenePath)
                ? EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single)
                : EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            GameObject cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.name = string.IsNullOrEmpty(parameters.name) ? "GamosCube" : parameters.name;
            cube.transform.localPosition = parameters.location;
            cube.transform.localScale = parameters.scale;

            string sceneDirectory = Path.GetDirectoryName(absoluteScenePath);
            if (!string.IsNullOrEmpty(sceneDirectory))
            {
                Directory.CreateDirectory(sceneDirectory);
            }
            bool saved = EditorSceneManager.SaveScene(scene, scenePath);

            WriteResult(new AddCubeResult
            {
                ok = saved,
                operation = "scene.add-cube",
                scenePath = scenePath,
                createdObjectName = cube.name,
                saved = saved,
                error = saved ? "" : "EditorSceneManager.SaveScene returned false for " + scenePath,
            });
            return saved ? 0 : 1;
        }

        /// <summary>
        /// A scene path must be relative, inside Assets/, and free of absolute
        /// roots and ".." components. Mirrors the TypeScript-side
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

        private static void WriteResult(AddCubeResult result)
        {
            string resultPath = GamosArgs.Value("-gamosResult");
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
        private static class GamosArgs
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
