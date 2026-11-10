# Gamos Godot bridge: read scene node properties back through the ENGINE's
# own loader (data-only, fixed committed template). This is the read-back
# authority for scene modification verification: the caller loads the saved
# scene in THIS fresh engine process and asserts the applied values — an exit
# code from the modifying run alone never proves a mutation.
#
# Invocation shape (argument array, never a shell):
#   godot --headless --path <projectRoot> --script scene_inspect.gd \
#         -- <input.json> <report.json>
#
# Input JSON (frozen typed shape, validated in TypeScript before the spawn):
#   {"scenePath": "res://scene.tscn",
#    "queries": [{"nodePath": "Box", "property": "position"}]}
extends SceneTree

const MARKER: String = "GAMOS_GODOT_REPORT:"
const MAX_QUERIES: int = 128
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

	var report: Dictionary = _inspect_scene(input)
	_write_report(report_path, report)
	quit(0 if report.get("ok", false) else 1)


func _inspect_scene(input: Dictionary) -> Dictionary:
	if not input.has("scenePath") or not (input["scenePath"] is String):
		return {"ok": false, "error": "bridge-input-missing-scenePath"}
	var scene_res: String = str(input["scenePath"])
	if not _is_res_path(scene_res) or not scene_res.ends_with(".tscn"):
		return {"ok": false, "error": "bridge-scene-path-invalid", "scenePath": scene_res}
	var queries: Variant = input.get("queries", [])
	if not (queries is Array) or queries.is_empty() or queries.size() > MAX_QUERIES:
		return {"ok": false, "error": "bridge-queries-invalid"}

	var scene: PackedScene = load(scene_res) as PackedScene
	if scene == null:
		return {"ok": false, "error": "bridge-scene-load-failed", "scenePath": scene_res}
	var instance: Node = scene.instantiate()
	if instance == null:
		return {"ok": false, "error": "bridge-scene-instantiate-failed", "scenePath": scene_res}

	var results: Array = []
	for query in queries:
		if not (query is Dictionary):
			results.append({"error": "query-not-an-object"})
			continue
		if not query.has("nodePath") or not (query["nodePath"] is String):
			results.append({"error": "query-missing-nodePath"})
			continue
		var node_path: String = str(query["nodePath"])
		var node: Node = instance.get_node_or_null(node_path)
		if node == null:
			results.append({"nodePath": node_path, "error": "node-not-found"})
			continue
		if not query.has("property") or not (query["property"] is String):
			results.append({"nodePath": node_path, "error": "query-missing-property"})
			continue
		var property: String = str(query["property"])
		if not ALLOWED_PROPERTIES.has(property):
			results.append({"nodePath": node_path, "error": "property-not-allowed", "property": property})
			continue
		results.append({
			"nodePath": node_path,
			"property": property,
			"value": _to_json(node.get(property)),
		})
	return {"ok": true, "results": results}


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


func _is_res_path(candidate: String) -> bool:
	return candidate.begins_with("res://") and candidate.length() > 7 and not candidate.contains("..")


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
