"""Gamos blender bridge: export the scene (or a named selection) to OBJ/GLTF/FBX.

Fixed, committed template. Reads a JSON input file (argv after ``--``):

    {
      "outputPath": "...",
      "format": "OBJ"|"GLTF"|"FBX",
      "selection": ["Name"]|null,
      "interchange": {"upAxis": "y"|"z", "globalScale": 2.0}|null
    }

Uses the built-in exporters per format. GLTF exports binary .glb (Blender's
default); the actual written path is resolved and reported as ``writtenTo``.

The optional ``interchange`` block declares the coordinate/scale settings that
the caller wants APPLIED (M3 cross-engine manifest provenance):
- ``upAxis`` maps to the per-exporter axis settings (FBX ``axis_up``, OBJ
  ``up_axis``, glTF ``export_yup``); the forward axis stays the exporters'
  default ('-Z' / 'NEGATIVE_Z'), and the applied values are echoed in the
  report — they are observed, never assumed.
- ``globalScale`` (FBX/OBJ only; the glTF exporter has no global scale
  setting — the typed input layer rejects that combination, the bridge
  double-checks fail closed).

Dependent files: the exporter may write sidecar/dependent files next to the
primary artifact (e.g. OBJ ``.mtl`` material libraries, textures copied by
path_mode AUTO). The bridge snapshots the output directory before the export,
diffs it after, and reports every new file (excluding the primary artifact)
with size and sha256 — the engine layer re-verifies those records.
"""

import hashlib
import json
import os
import sys
import traceback

import bpy

MARKER = "GAMOS_BRIDGE_REPORT:"

ALLOWED_FORMATS = ("OBJ", "GLTF", "FBX")
ALLOWED_UP_AXES = ("y", "z")
MAX_DIRECTORY_SCAN = 4096
MAX_MATERIAL_NAMES = 64
HASH_CHUNK = 1024 * 1024


def bridge_argv():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def write_report(report_path, payload):
    with open(report_path, "w") as handle:
        json.dump(payload, handle)
    print(MARKER + report_path)
    sys.stdout.flush()


def set_selection(selection):
    """Select exactly the named objects (or everything when selection is None)."""
    if selection is not None:
        missing = [name for name in selection if name not in bpy.data.objects]
        if missing:
            raise ValueError("selection objects not found: %r" % (missing,))
    for obj in bpy.data.objects:
        obj.select_set(selection is None or obj.name in selection)
    if selection:
        active = bpy.data.objects.get(selection[0])
        if active is not None:
            try:
                bpy.context.view_layer.objects.active = active
            except Exception:  # noqa: BLE001 - non-fatal context tweak
                pass
    return bool(selection)


def parse_interchange(config):
    interchange = config.get("interchange")
    if interchange is None:
        return None
    if not isinstance(interchange, dict):
        raise ValueError("interchange must be an object or null")
    up_axis = interchange.get("upAxis")
    if up_axis not in ALLOWED_UP_AXES:
        raise ValueError("interchange.upAxis must be 'y' or 'z': %r" % (up_axis,))
    global_scale = interchange.get("globalScale")
    if global_scale is not None:
        if not isinstance(global_scale, (int, float)) or isinstance(global_scale, bool):
            raise ValueError("interchange.globalScale must be a number")
        global_scale = float(global_scale)
        if global_scale <= 0:
            raise ValueError("interchange.globalScale must be positive")
    return {"upAxis": up_axis, "globalScale": global_scale}


def apply_interchange(export_format, interchange):
    """Apply the declared settings through the real exporter kwargs and echo them.

    Returns the applied record for the report: what was actually passed to the
    exporter (axisUp/axisForward/globalScale), normalized to the manifest
    vocabulary (lowercase signed axis like '-z').
    """
    if interchange is None:
        up_axis = "y"
        global_scale = None
    else:
        up_axis = interchange["upAxis"]
        global_scale = interchange["globalScale"]
        if export_format == "GLTF" and global_scale is not None:
            raise ValueError("the glTF exporter has no global scale setting")

    if export_format == "OBJ":
        kwargs = {"up_axis": up_axis.upper(), "forward_axis": "NEGATIVE_Z"}
        if global_scale is not None:
            kwargs["global_scale"] = global_scale
        axis_forward = "-z"
    elif export_format == "FBX":
        kwargs = {"axis_up": up_axis.upper(), "axis_forward": "-Z"}
        if global_scale is not None:
            kwargs["global_scale"] = global_scale
        axis_forward = "-z"
    else:  # GLTF — binary .glb; export_yup converts to y-up
        kwargs = {"export_yup": up_axis == "y"}
        axis_forward = "z"

    return kwargs, {
        "axisUp": up_axis,
        "axisForward": axis_forward,
        "globalScale": global_scale if global_scale is not None else 1.0,
    }


def snapshot_directory(directory):
    """Bounded snapshot of the file names directly inside ``directory``."""
    try:
        entries = os.listdir(directory)
    except OSError:
        entries = []
    if len(entries) > MAX_DIRECTORY_SCAN:
        raise RuntimeError(
            "export directory too large to scan for dependent files (%d > %d entries): %r"
            % (len(entries), MAX_DIRECTORY_SCAN, directory)
        )
    return set(name for name in entries if os.path.isfile(os.path.join(directory, name)))


def file_sha256(file_path):
    digest = hashlib.sha256()
    with open(file_path, "rb") as handle:
        while True:
            chunk = handle.read(HASH_CHUNK)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def collect_dependent_files(directory, before, primary):
    """Diff the directory snapshot; hash every new file that is not the primary artifact."""
    dependent = []
    after = snapshot_directory(directory)
    for name in sorted(after - before):
        full_path = os.path.join(directory, name)
        if os.path.abspath(full_path) == os.path.abspath(primary):
            continue
        size = os.path.getsize(full_path)
        if size <= 0:
            continue
        dependent.append({"path": full_path, "bytes": size, "sha256": file_sha256(full_path)})
    return dependent


def collect_material_names(selection):
    """Material names referenced by the exported objects (deduplicated, bounded)."""
    names = []
    seen = set()
    objects = [bpy.data.objects[name] for name in selection] if selection else list(bpy.data.objects)
    for obj in objects:
        for slot in getattr(obj, "material_slots", []):
            material = slot.material
            if material is not None and material.name not in seen:
                seen.add(material.name)
                names.append(material.name)
                if len(names) >= MAX_MATERIAL_NAMES:
                    return names
    return names


def main():
    argv = bridge_argv()
    if len(argv) < 2:
        raise SystemExit("usage: blender -b <file> --python export_asset.py -- <config.json> <report.json>")
    config_path, report_path = argv[0], argv[1]
    with open(config_path) as handle:
        config = json.load(handle)

    export_format = config.get("format")
    if export_format not in ALLOWED_FORMATS:
        raise ValueError("unsupported export format: %r" % (export_format,))
    output_path = config.get("outputPath")
    if not isinstance(output_path, str) or not output_path:
        raise ValueError("missing outputPath")

    selection = config.get("selection")
    if selection is not None and not isinstance(selection, list):
        raise ValueError("selection must be a list of object names")
    selected_only = set_selection(selection)

    interchange = parse_interchange(config)
    kwargs, applied = apply_interchange(export_format, interchange)

    output_dir = os.path.dirname(os.path.abspath(output_path))
    before = snapshot_directory(output_dir)

    if export_format == "OBJ":
        bpy.ops.wm.obj_export(filepath=output_path, export_selected_objects=selected_only, **kwargs)
    elif export_format == "GLTF":
        bpy.ops.export_scene.gltf(filepath=output_path, use_selection=selected_only, **kwargs)
    elif export_format == "FBX":
        bpy.ops.export_scene.fbx(filepath=output_path, use_selection=selected_only, **kwargs)

    base, ext = os.path.splitext(output_path)
    candidates = [output_path, output_path + ".glb", base + ".glb", base + ".bin"]
    written = next((candidate for candidate in candidates if os.path.exists(candidate)), None)
    if written is None:
        raise RuntimeError("export did not produce an artifact at %r" % (output_path,))
    if os.path.getsize(written) <= 0:
        raise RuntimeError("export artifact is empty: %r" % (written,))

    dependent_files = collect_dependent_files(output_dir, before, written)

    write_report(
        report_path,
        {
            "ok": True,
            "writtenTo": written,
            "bytes": os.path.getsize(written),
            "format": export_format,
            "selection": selection,
            "blenderVersion": bpy.app.version_string,
            "unitScale": bpy.context.scene.unit_settings.scale_length,
            "applied": applied,
            "dependentFiles": dependent_files,
            "materialNames": collect_material_names(selection),
        },
    )


try:
    main()
except SystemExit:
    raise
except Exception as exc:  # noqa: BLE001 - report every failure to the engine
    argv = bridge_argv()
    if len(argv) >= 2:
        try:
            write_report(argv[1], {"ok": False, "error": "%s: %s" % (type(exc).__name__, exc), "traceback": traceback.format_exc()})
        except Exception:  # noqa: BLE001 - best effort only
            pass
    sys.stderr.write("export_asset bridge failed: %s\n" % (exc,))
    sys.exit(1)
