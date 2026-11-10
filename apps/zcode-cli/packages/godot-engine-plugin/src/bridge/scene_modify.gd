# Gamos Godot bridge: apply TYPED scene operations through explicit Godot
# API calls (data-only, fixed committed template).
#
# Invocation shape (argument array, never a shell):
#   godot --headless --path <projectRoot> --script scene_modify.gd \
#         -- <input.json> <report.json>
#
# The input JSON is a frozen typed-op payload:
#   {"scenePath": "res://scene.tscn",
#    "operations": [{"nodePath": "Box", "property": "position", "value": [1,2,3]}]}
#
# No user text is ever interpolated into GDScript source: the payload is read
# with JSON.parse_string and every operation is re-validated HERE against the
# same allowlist the TypeScript layer enforced (node-path grammar, property
# allowlist, JSON-safe typed values). The operation is ATOMIC: if ANY
# operation fails validation or resolution, NOTHING is applied and NOTHING is
# saved — a partial mutation is never written (the pre-mutation snapshot and
# the typed inverse data in the report are the recovery contract).
extends SceneTree

const MARKER: String = "GAMOS_GODOT_REPORT:"
const MAX_OPERATIONS: int = 64
const ALLOWED_PROPERTIES: Dictionary = {
        "position": "vec3",
        "rotation": "vec3",
        "scale": "vec3",
        "visible": "bool",
}

func _init() -> void:
        var user_args: PackedStringArray = OS.get_cmdline_user_args()
        if user_args.size() != 2:
                push_error("gamos-bridge: expected <input.json> <report.json> after --")
                quit(2)
                return
        var input_path: String = user_args[0]
        var report_path: String = user_args[1]

        var input: Variant = _read_json(input_path)
        if not (input is Dictionary):
                _write_report(report_path, {
                        "ok": false,
                        "error": "bridge-input-unreadable",
                        "path": input_path,
                })
                quit(3)
                return

        var report: Dictionary = _modify_scene(input)
        _write_report(report_path, report)
        quit(0 if report.get("ok", false) else 1)


func _modify_scene(input: Dictionary) -> Dictionary:
        if not input.has("scenePath") or not (input["scenePath"] is String):
                return {"ok": false, "error": "bridge-input-missing-scenePath"}
        var scene_res: String = str(input["scenePath"])
        if not _is_res_path(scene_res) or not scene_res.ends_with(".tscn"):
                return {"ok": false, "error": "bridge-scene-path-invalid", "scenePath": scene_res}
        var operations: Variant = input.get("operations", [])
        if not (operations is Array) or operations.is_empty() or operations.size() > MAX_OPERATIONS:
                return {"ok": false, "error": "bridge-operations-invalid"}

        var scene: PackedScene = load(scene_res) as PackedScene
        if scene == null:
                return {"ok": false, "error": "bridge-scene-load-failed", "scenePath": scene_res}
        var instance: Node = scene.instantiate()
        if instance == null:
                return {"ok": false, "error": "bridge-scene-instantiate-failed", "scenePath": scene_res}

        # Pass 1 — validate and resolve EVERY operation before touching anything.
        var resolved: Array = []
        var failures: Array = []
        for raw_op in operations:
                var failure: Dictionary = _validate_operation(raw_op, instance)
                if not failure.is_empty():
                        failures.append(failure)
                        continue
                var op: Dictionary = raw_op
                resolved.append({
                        "node": instance.get_node(str(op["nodePath"])),
                        "nodePath": str(op["nodePath"]),
                        "property": str(op["property"]),
                        "value": op["value"],
                })
        if not failures.is_empty():
                # ATOMIC: no apply, no save — the scene file is left byte-identical.
                return {"ok": false, "error": "bridge-operations-failed", "failures": failures, "applied": []}

        # Pass 2 — apply the validated operations and record the inverse data.
        var applied: Array = []
        for entry in resolved:
                var node: Node = entry["node"]
                var property: String = entry["property"]
                var previous: Variant = node.get(property)
                if ALLOWED_PROPERTIES[property] == "vec3":
                        var v: Array = entry["value"]
                        node.set(property, Vector3(float(v[0]), float(v[1]), float(v[2])))
                else:
                        node.set(property, entry["value"])
                applied.append({
                        "nodePath": entry["nodePath"],
                        "property": property,
                        "previousValue": _to_json(previous),
                        "value": _to_json(node.get(property)),
                })

        # Persist through the engine's own serializer.
        var packed: PackedScene = PackedScene.new()
        var pack_error: int = packed.pack(instance)
        if pack_error != Error.OK:
                return {"ok": false, "error": "bridge-scene-pack-failed", "code": pack_error, "applied": []}
        var save_error: int = ResourceSaver.save(packed, scene_res)
        if save_error != Error.OK:
                return {"ok": false, "error": "bridge-scene-save-failed", "code": save_error, "applied": []}
        return {"ok": true, "applied": applied, "failures": []}


## Re-validate one typed operation against the allowlist (defense in depth:
## the TypeScript layer validated the same contract before the spawn).
func _validate_operation(raw_op: Variant, instance: Node) -> Dictionary:
        if not (raw_op is Dictionary):
                return {"error": "operation-not-an-object"}
        var op: Dictionary = raw_op
        if not op.has("nodePath") or not (op["nodePath"] is String):
                return {"error": "operation-missing-nodePath"}
        var node_path: String = str(op["nodePath"])
        if not _is_node_path(node_path):
                return {"error": "node-path-invalid", "nodePath": node_path}
        if not op.has("property") or not (op["property"] is String):
                return {"error": "operation-missing-property"}
        var property: String = str(op["property"])
        if not ALLOWED_PROPERTIES.has(property):
                return {"error": "property-not-allowed", "property": property}
        if not op.has("value"):
                return {"error": "operation-missing-value"}
        var value: Variant = op["value"]
        if ALLOWED_PROPERTIES[property] == "vec3":
                if not (value is Array) or value.size() != 3:
                        return {"error": "value-not-vec3", "property": property}
                for component in value:
                        if not (component is float) and not (component is int):
                                return {"error": "value-not-numeric", "property": property}
                        if not is_finite(float(component)):
                                return {"error": "value-not-finite", "property": property}
        else:
                if not (value is bool):
                        return {"error": "value-not-bool", "property": property}
        if instance.get_node_or_null(node_path) == null:
                return {"error": "node-not-found", "nodePath": node_path}
        return {}


## Scene-relative node path grammar: identifier segments separated by "/",
## no leading slash, no "..", no empty segments, bounded depth.
func _is_node_path(node_path: String) -> bool:
        if node_path.is_empty() or node_path.length() > 256:
                return false
        if node_path.begins_with("/") or node_path.ends_with("/"):
                return false
        var segments: PackedStringArray = node_path.split("/")
        if segments.size() > 16:
                return false
        for segment in segments:
                if segment.is_empty() or segment == "." or segment == "..":
                        return false
                if not segment.is_valid_identifier():
                        return false
        return true


func _is_res_path(candidate: String) -> bool:
        return candidate.begins_with("res://") and candidate.length() > 7 and not candidate.contains("..")


func _to_json(value: Variant) -> Variant:
        if value is Vector3:
                var v: Vector3 = value
                return [v.x, v.y, v.z]
        if value is Vector2:
                var v2: Vector2 = value
                return [v2.x, v2.y]
        if value is bool or value is float or value is int:
                return value
        return str(value)


func _read_json(path: String) -> Variant:
        var f: FileAccess = FileAccess.open(path, FileAccess.READ)
        if f == null:
                return null
        var text: String = f.get_as_text()
        f.close()
        return JSON.parse_string(text)


func _write_report(report_path: String, report: Dictionary) -> void:
        var f: FileAccess = FileAccess.open(report_path, FileAccess.WRITE)
        if f == null:
                push_error("gamos-bridge: cannot write report " + report_path)
                return
        f.store_string(JSON.stringify(report))
        f.close()
        print(MARKER + report_path)
