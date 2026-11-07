// Gamos Unity bridge: typed project build operations (M2.1).
//
// Fixed, committed, reviewed template. Invoked by the unity-engine-plugin via:
//
//   Unity -batchmode -nographics -projectPath <root> -quit \
//     -executeMethod Gamos.Build.BuildStandalone \
//     -gamosParams <params.json> -gamosResult <result.json>
//
// Reads TYPED parameters from the JSON file named by -gamosParams, applies the
// operation through public Unity APIs only, and writes a JSON result file to
// the path named by -gamosResult. There is no reflection, no process
// spawning, no networking, and no file deletion: the input is data for fixed,
// allowlisted operations (project.build with buildTarget StandaloneLinux64;
// scene.set-active-build-target). Scene paths must be relative "Assets/..."
// paths without ".." components.

using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Gamos
{
    /// <summary>Reviewed typed build operations for the Gamos engine plugin.</summary>
    public static class Build
    {
        /// <summary>
        /// The only build targets this bridge will ever build or activate.
        /// Anything else in the params file is an error, never a guess.
        /// </summary>
        private static readonly string[] AllowedBuildTargets = { "StandaloneLinux64" };

        /// <summary>Typed parameters for project.build (deserialized with JsonUtility).</summary>
        [Serializable]
        private class BuildStandaloneParams
        {
            public string buildTarget = "";
            public string[] scenes = new string[0];
        }

        /// <summary>Typed parameters for scene.set-active-build-target.</summary>
        [Serializable]
        private class SetBuildTargetParams
        {
            public string buildTarget = "";
        }

        /// <summary>JSON result written for the engine layer to verify.</summary>
        [Serializable]
        private class GamosBuildResult
        {
            public bool ok;
            public string operation;
            public string buildTarget;
            public string artifactPath;
            public long artifactBytes;
            public string buildResult;
            public long totalErrors;
            public string error;
        }

        /// <summary>-executeMethod entry point: project.build (StandaloneLinux64 player).</summary>
        public static void BuildStandalone()
        {
            int exitCode;
            try
            {
                exitCode = RunBuildStandalone();
            }
            catch (Exception exception)
            {
                WriteResult(new GamosBuildResult
                {
                    ok = false,
                    operation = "project.build",
                    buildTarget = "",
                    artifactPath = "",
                    artifactBytes = 0,
                    buildResult = "",
                    totalErrors = 0,
                    error = exception.Message,
                });
                Debug.LogError("Gamos Build.BuildStandalone failed: " + exception.Message);
                exitCode = 1;
            }
            EditorApplication.Exit(exitCode);
        }

        private static int RunBuildStandalone()
        {
            string paramsPath = GamosBuildArgs.Value("-gamosParams");
            string resultPath = GamosBuildArgs.Value("-gamosResult");
            if (string.IsNullOrEmpty(paramsPath) || string.IsNullOrEmpty(resultPath))
            {
                throw new InvalidOperationException(
                    "missing -gamosParams <path> and/or -gamosResult <path> command-line arguments");
            }
            if (!File.Exists(paramsPath))
            {
                throw new FileNotFoundException("gamos params file not found", paramsPath);
            }

            BuildStandaloneParams parameters =
                JsonUtility.FromJson<BuildStandaloneParams>(File.ReadAllText(paramsPath));
            if (!IsAllowedBuildTarget(parameters.buildTarget))
            {
                throw new InvalidOperationException(
                    "buildTarget not in the allowlist [StandaloneLinux64]: " + parameters.buildTarget);
            }
            if (parameters.scenes == null || parameters.scenes.Length == 0)
            {
                throw new InvalidOperationException(
                    "no scenes to build: the project must contain at least one Assets/**/*.unity scene");
            }
            foreach (string scene in parameters.scenes)
            {
                if (!IsSafeRelativeAssetPath(scene))
                {
                    throw new InvalidOperationException(
                        "unsafe scene path in the build list: " + scene);
                }
            }

            // The Unity process may be started from any working directory; the
            // project root is derived from Application.dataPath (= <root>/Assets).
            string projectRoot = Directory.GetParent(Application.dataPath).FullName;
            string buildDir = Path.Combine(projectRoot, "Builds", parameters.buildTarget);
            Directory.CreateDirectory(buildDir);
            string outputPath = Path.Combine(buildDir, "GamosBuild");

            BuildReport report = BuildPipeline.BuildPlayer(
                parameters.scenes,
                outputPath,
                BuildTarget.StandaloneLinux64,
                BuildOptions.None);

            bool succeeded = report.summary.result == UnityEditor.BuildResult.Succeeded;
            long artifactBytes = 0;
            if (succeeded && File.Exists(outputPath))
            {
                artifactBytes = new FileInfo(outputPath).Length;
            }

            WriteResult(new GamosBuildResult
            {
                ok = succeeded,
                operation = "project.build",
                buildTarget = parameters.buildTarget,
                artifactPath = succeeded ? outputPath : "",
                artifactBytes = artifactBytes,
                buildResult = report.summary.result.ToString(),
                totalErrors = (long)report.summary.totalErrors,
                error = succeeded ? "" : "BuildPipeline.BuildPlayer result: " + report.summary.result,
            });
            return succeeded ? 0 : 1;
        }

        /// <summary>-executeMethod entry point: scene.set-active-build-target.</summary>
        public static void SetActiveBuildTarget()
        {
            int exitCode;
            try
            {
                exitCode = RunSetActiveBuildTarget();
            }
            catch (Exception exception)
            {
                WriteResult(new GamosBuildResult
                {
                    ok = false,
                    operation = "scene.set-active-build-target",
                    buildTarget = "",
                    artifactPath = "",
                    artifactBytes = 0,
                    buildResult = "",
                    totalErrors = 0,
                    error = exception.Message,
                });
                Debug.LogError("Gamos Build.SetActiveBuildTarget failed: " + exception.Message);
                exitCode = 1;
            }
            EditorApplication.Exit(exitCode);
        }

        private static int RunSetActiveBuildTarget()
        {
            string paramsPath = GamosBuildArgs.Value("-gamosParams");
            string resultPath = GamosBuildArgs.Value("-gamosResult");
            if (string.IsNullOrEmpty(paramsPath) || string.IsNullOrEmpty(resultPath))
            {
                throw new InvalidOperationException(
                    "missing -gamosParams <path> and/or -gamosResult <path> command-line arguments");
            }
            if (!File.Exists(paramsPath))
            {
                throw new FileNotFoundException("gamos params file not found", paramsPath);
            }

            SetBuildTargetParams parameters =
                JsonUtility.FromJson<SetBuildTargetParams>(File.ReadAllText(paramsPath));
            if (!IsAllowedBuildTarget(parameters.buildTarget))
            {
                throw new InvalidOperationException(
                    "buildTarget not in the allowlist [StandaloneLinux64]: " + parameters.buildTarget);
            }

            EditorUserBuildSettings.activeBuildTarget = BuildTarget.StandaloneLinux64;

            WriteResult(new GamosBuildResult
            {
                ok = true,
                operation = "scene.set-active-build-target",
                buildTarget = parameters.buildTarget,
                artifactPath = "",
                artifactBytes = 0,
                buildResult = "",
                totalErrors = 0,
                error = "",
            });
            return 0;
        }

        private static bool IsAllowedBuildTarget(string buildTarget)
        {
            return !string.IsNullOrEmpty(buildTarget)
                && Array.IndexOf(AllowedBuildTargets, buildTarget) >= 0;
        }

        /// <summary>
        /// A scene path must be relative, inside Assets/, and free of absolute
        /// roots and ".." components (mirrors the TypeScript-side guard).
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

        private static void WriteResult(GamosBuildResult result)
        {
            string resultPath = GamosBuildArgs.Value("-gamosResult");
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
        private static class GamosBuildArgs
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
