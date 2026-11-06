#!/usr/bin/env node
/* eslint-disable max-lines -- Deterministic local model endpoint for the M1 acceptance journey. */
/**
 * Gamos M1 — deterministic local Anthropic-Messages endpoint (journey-owned).
 *
 * WHY THIS EXISTS (maintainer directive, 2026-11-06): the M1 acceptance journey
 * needs a model provider whose per-day request budget survives a full agentic
 * journey (main turns + tool loops + workflow subagents). OpenRouter's free
 * tier provides 50 free-model requests per day, which the real runs provably
 * exhaust mid-journey (run 42235226375 agent log: x-ratelimit-limit 50,
 * x-ratelimit-remaining 0, "free-models-per-day" 429 on every MJ4+ model turn
 * while MJ0–MJ3 were green), and the maintainer cannot add the 10 credits that
 * would unlock 1000/day. The directive therefore removes the paid-dependency:
 * the journey configures the app's REAL custom-provider surface (Settings →
 * Model provider → add provider → custom template → base URL + API key +
 * anthropic-messages format — the same UI path the repository's own upstream
 * E2E replay suite drives) against this local endpoint.
 *
 * HONESTY MODEL — read before changing anything:
 *   - This endpoint is a scripted deterministic model, NOT a real LLM. Every
 *     response below was authored by a human for the M1 journey's specific
 *     conversation shapes. It exists so the journey can verify the APP side of
 *     the model integration (provider configuration, session turns, streaming
 *     parse, tool-use round-trips, the dynamic-workflows skill gate, the
 *     CreateWorkflow approval gate, subagent scheduling, journal writes,
 *     resume/cancel, persistence) without an external paid inference provider.
 *   - It is the same class of test infrastructure as the repository's upstream
 *     replay fixtures (packages/desktop/test/e2e/helpers/upstream-replay-server.ts,
 *     fixtures/upstream/*.json): recorded/scripted model traffic driving the
 *     real application. No evidence produced against this endpoint may claim
 *     real-LLM authorship; the journey's evidence records the endpoint URL and
 *     this server writes a full request transcript (m1-local-model-transcript.jsonl)
 *     into the evidence directory so every model interaction is auditable.
 *   - The two workflow scripts it returns reference ONLY operations the journey
 *     itself staged (the fixture game project created by stage MJ2) and stay
 *     read-only (log / agent.ask / report), mirroring the reference GamePlan
 *     generator (packages/gamos-domain/src/domain/plan-workflow.ts) so the
 *     existing compiler accepts them unchanged.
 *
 * PROTOCOL: Anthropic Messages (the app's anthropic-messages provider type).
 *   - POST {base}/v1/messages[?...] — streaming (SSE) when body.stream === true,
 *     plain JSON otherwise (same response shapes the upstream replay server
 *     synthesizes — those shapes are proven against the app's client).
 *   - POST {base}/v1/messages/count_tokens — trivial estimate.
 *   - GET  {base}/v1/models — minimal Anthropic-style catalog.
 *   - GET  /healthz — readiness probe used by the journey.
 *
 * SCENARIO ENGINE: requests are matched on the LAST USER TEXT MESSAGE (the
 * "task") plus the tool-use history — the same discrimination the upstream
 * replay fixtures use (lastUserMessageIncludes / bodyIncludes). Matched in
 * order; anything unmatched falls through to a benign text response (sidecar
 * requests such as conversation titles must still complete).
 *
 * Env:
 *   M1_LOCAL_MODEL_PORT       — listen port (default 4371)
 *   M1_LOCAL_MODEL_DELAY_MS   — artificial response delay (default 300; lets
 *                               the UI render streaming/running states)
 *   M1_LOCAL_MODEL_TRANSCRIPT — JSONL request transcript path (evidence)
 */
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const PORT = Number(process.env.M1_LOCAL_MODEL_PORT ?? 4371);
const HOST = "127.0.0.1";
const DELAY_MS = Math.max(0, Number(process.env.M1_LOCAL_MODEL_DELAY_MS ?? 300));
const TRANSCRIPT = process.env.M1_LOCAL_MODEL_TRANSCRIPT ?? "";
const MODEL_ID = process.env.M1_LOCAL_MODEL_MODEL_ID ?? "gamos-m1-deterministic-model";
const STARTED_AT = new Date().toISOString();

let served = 0;
let counter = 0;
const nextId = (prefix) => `${prefix}_local_${String(++counter).padStart(3, "0")}`;

function log(...args) {
  console.log(`[m1-local-model] ${args.join(" ")}`);
}

function transcript(entry) {
  if (!TRANSCRIPT) return;
  try {
    appendFileSync(TRANSCRIPT, `${JSON.stringify(entry)}\n`);
  } catch { /* evidence best-effort — never break the endpoint */ }
}

/* ------------------------------------------------------------------ */
/* Request parsing                                                     */
/* ------------------------------------------------------------------ */

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Text projection of one message's content (text parts + tool_result contents,
 * same semantics as the upstream replay server's readMessageContentText). */
function messageText(message) {
  if (!isRecord(message)) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!isRecord(part)) return "";
      if (typeof part.text === "string") return part.text;
      if (part.type === "tool_result") return messageContentText(part.content);
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function messageContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function messageHasToolResult(message) {
  if (!isRecord(message) || !Array.isArray(message.content)) return false;
  return message.content.some((part) => isRecord(part) && part.type === "tool_result");
}

/** Parsed view of the request messages used by every scenario matcher. */
function analyzeMessages(requestJson) {
  const messages = Array.isArray(requestJson?.messages) ? requestJson.messages : [];
  const toolUses = new Map(); // tool_use id -> tool name
  const toolUseNames = new Set();
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (isRecord(part) && part.type === "tool_use" && typeof part.name === "string") {
        toolUses.set(part.id, part.name);
        toolUseNames.add(part.name);
      }
    }
  }
  // Last user message that is NOT a tool_result carrier — the "task" text.
  let lastUserTaskText = "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!isRecord(message) || message.role !== "user") continue;
    if (!messageHasToolResult(message)) {
      lastUserTaskText = messageText(message);
      break;
    }
  }
  // The overall last message — is it a tool_result, and for which tools?
  let lastToolResult = null;
  const last = messages[messages.length - 1];
  if (isRecord(last) && last.role === "user" && messageHasToolResult(last)) {
    const names = [];
    for (const part of last.content) {
      if (isRecord(part) && part.type === "tool_result") {
        names.push({ name: toolUses.get(part.tool_use_id) ?? "(unknown)", text: messageContentText(part.content) });
      }
    }
    lastToolResult = { names };
  }
  return { lastUserTaskText, toolUseNames, lastToolResult, messageCount: messages.length };
}

/* ------------------------------------------------------------------ */
/* Scripted model output                                               */
/* ------------------------------------------------------------------ */

function extractWorkspaceRoot(taskText) {
  const found = taskText.match(/"root"\s*:\s*"([^"]+)"/);
  return found?.[1] ?? null;
}

function inspectionScript(workspaceRoot) {
  const ws = workspaceRoot ?? "the game project workspace";
  return [
    `// Gamos M1 journey — model-authored read-only inspection GamePlan (deterministic local endpoint).`,
    `// The script IS the GamePlan: compiled/executed/journaled by the existing ZCode`,
    `// Dynamic Workflow infrastructure (dwf_* journal, run pane, resume/cancel).`,
    `// Read-only plan: inspection/validation only — no writes, no git mutations, no`,
    `// engine execution (M1 constraint; native engine mutations arrive in M2).`,
    `log("Gamos M1 inspection workflow started (read-only)");`,
    `// step gamos-m1-step-1 — capability core/project.inspect (1.0.0)`,
    `const n_gamos_m1_step_1 = agent("gamos-m1-step-1", { system: ${JSON.stringify(
      "Gamos read-only capability executor. Inspect and report only; make no filesystem writes, no git mutations, no engine executions.",
    )} }).ask(${JSON.stringify(
      `Read-only inspection task: execute capability core/project.inspect (1.0.0) for the game project at ${ws}. Read-only: observe and report; do not modify anything. Report what you actually observed.`,
    )});`,
    `await n_gamos_m1_step_1;`,
    `log("Gamos M1 inspection step complete");`,
    `report({"planId":"m1-journey-plan","inspected":true});`,
    ``,
    `return { planId: "m1-journey-plan", inspected: true };`,
    ``,
  ].join("\n");
}

function reviewScript() {
  return [
    `// Gamos M1 journey — model-authored read-only review GamePlan (cancel + resume target).`,
    `// Read-only plan: review and summarize only — no writes, no git mutations.`,
    `log("Gamos M1 review workflow started (read-only)");`,
    `// step gamos-m1-cancel-step — README review`,
    `const n_gamos_m1_cancel_step = agent("gamos-m1-cancel-step", { system: ${JSON.stringify(
      "Gamos read-only reviewer. Review and summarize only; make no filesystem writes, no git mutations, no engine executions.",
    )} }).ask(${JSON.stringify(
      "Read-only review task: review the README.md in the workspace and summarize it in about 300 words. Read-only: observe and report; do not modify anything. Report your summary.",
    )});`,
    `await n_gamos_m1_cancel_step;`,
    `log("Gamos M1 review step complete");`,
    `report({"planId":"m1-review-plan","reviewed":true});`,
    ``,
    `return { planId: "m1-review-plan", reviewed: true };`,
    ``,
  ].join("\n");
}

const INSPECTION_REPORT = [
  "Inspection complete (read-only — nothing was modified).",
  "Workspace observations for the game project:",
  "- ProjectSettings/ProjectVersion.txt reports m_EditorVersionWithRevision: 6000.0.23f1 (abcdef123456) — Unity 6000.0.23f1.",
  "- Assets/Scenes/main.unity is a Unity YAML main scene (m_Name: Main).",
  "- README.md states the project is a Gamos M1 journey read-only inspection target.",
  "Machine/engine state: no Unity, Blender, Godot or Unreal editor is installed on this machine (each family records installed:false with an explicit reason); the Babylon toolchain is available through the local Node runtime.",
  "Capability core/project.inspect executed read-only: structural inspection only, no filesystem writes, no git mutations, no engine execution. This report is the step's observed summary.",
].join("\n");

const WORKFLOW_LAUNCHED_TEXT = [
  "The read-only Dynamic Workflow has been launched in the background (status: backgrounded).",
  "The run executes the inspection subagent step, awaits it, and report()s the summary; its dwf_* run id and journal records are visible in the timeline and the run pane.",
  "The plan is read-only: log/agent.ask/report only — no file writes, no git mutations, no engine execution.",
].join("\n");

const REVIEW_SUMMARY_300 = [
  "README.md review summary (about 300 words, read-only).",
  "The workspace README.md is a single-line marker file: \"Gamos M1 journey project — read-only inspection target.\" Despite its brevity, the file carries three pieces of information that matter for this workflow.",
  "First, it identifies the workspace as a deliberately constructed journey fixture rather than a production game project: the project exists so that a read-only inspection capability can be exercised against a real directory containing real files, without risking any valuable content. Every other artifact in the workspace (ProjectSettings/ProjectVersion.txt pinning Unity 6000.0.23f1, the Assets/Scenes/main.unity YAML scene) serves the same purpose — a minimal but structurally faithful Unity project layout.",
  "Second, the phrase \"read-only inspection target\" is the operational contract for everything that touches this workspace. The inspection capability, the workflow subagents, and the plan that orchestrates them are all constrained to observe and report: no filesystem writes, no git mutations, and no engine execution. The README states that contract in the place a human reviewer would look first, which is exactly what a capability-driven plan should verify before it runs.",
  "Third, the file demonstrates the kind of ground truth a machine-observed gaming context works from: a real file on disk, read through the real project-discovery probes, with its content available as evidence. The structured context that reached this workflow records the same facts with provenance — detected engine family Unity, version 6000.0.23f1 parsed from ProjectVersion.txt, availability states for every engine family on this machine — so the plan's guards and its report can reference observations rather than assumptions.",
  "In short: the README is small, but it anchors the project's identity (a Gamos M1 fixture), its safety contract (read-only), and the evidentiary style of the whole milestone (machine-observed facts with provenance). This review modified nothing.",
].join("\n");

const FALLBACK_TEXT = "Understood — proceeding. (deterministic local endpoint)";

/* ------------------------------------------------------------------ */
/* Scenario table                                                      */
/* ------------------------------------------------------------------ */

function resolveScenario(requestJson) {
  const { lastUserTaskText, toolUseNames, lastToolResult } = analyzeMessages(requestJson);
  const task = lastUserTaskText;
  const lastMessageIsCreateWorkflowResult = Boolean(
    lastToolResult && lastToolResult.names.some((n) => n.name === "CreateWorkflow"),
  );

  // 1. MJ4 task, skill not yet loaded -> load the dynamic-workflows skill
  //    (CreateWorkflow rejects script submissions without it — error 428).
  if (task.includes("author the inspection plan as a Dynamic Workflow script") && !toolUseNames.has("Skill")) {
    return {
      scenario: "mj4-skill-load",
      toolUses: [{ name: "Skill", input: { skill: "dynamic-workflows" } }],
    };
  }
  // 2. MJ4 task, skill loaded, no CreateWorkflow yet -> author + launch the
  //    read-only inspection GamePlan.
  if (
    task.includes("author the inspection plan as a Dynamic Workflow script") &&
    toolUseNames.has("Skill") &&
    !toolUseNames.has("CreateWorkflow")
  ) {
    return {
      scenario: "mj4-create-workflow",
      toolUses: [{
        name: "CreateWorkflow",
        input: { name: "gamos-m1-inspection", script: inspectionScript(extractWorkspaceRoot(task)) },
      }],
    };
  }
  // 3. Inspection subagent (the GamePlan's gamos-m1-step-1 ask).
  if (task.includes("Read-only inspection task:")) {
    return { scenario: "inspection-subagent", text: INSPECTION_REPORT };
  }
  // 4. Continuation right after a CreateWorkflow tool result (backgrounded run)
  //    -> final turn text. Covers both the MJ4 and MJ7 launches.
  if (lastMessageIsCreateWorkflowResult) {
    return { scenario: "workflow-continuation", text: WORKFLOW_LAUNCHED_TEXT };
  }
  // 5. MJ7 task (fresh user text as the LAST message) -> author + launch the
  //    read-only review GamePlan (the cancellation + resume target).
  if (task.includes("Start one more read-only Dynamic Workflow") && !lastToolResult) {
    return {
      scenario: "mj7-create-workflow",
      toolUses: [{
        name: "CreateWorkflow",
        input: { name: "gamos-m1-review", script: reviewScript() },
      }],
    };
  }
  // 6. Review subagent (the review GamePlan's gamos-m1-cancel-step ask).
  if (task.includes("Read-only review task:")) {
    return { scenario: "review-subagent", text: REVIEW_SUMMARY_300 };
  }
  // 7. Anything else (sidecar requests — conversation titles, notifications,
  //    resume continuations the app injects) -> benign text so turns complete.
  return { scenario: "fallback-text", text: FALLBACK_TEXT };
}

/* ------------------------------------------------------------------ */
/* Anthropic Messages response synthesis (shapes copied from the      */
/* proven upstream replay server implementation)                      */
/* ------------------------------------------------------------------ */

function usage(inputTokens = 512, outputTokens = 64) {
  return {
    input_tokens: inputTokens,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: outputTokens,
    service_tier: "standard",
  };
}

function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function textSseBody(model, text) {
  return [
    sseEvent("message_start", {
      type: "message_start",
      message: {
        id: nextId("msg"),
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: usage(512, 0),
      },
    }),
    sseEvent("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }),
    sseEvent("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    }),
    sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
    sseEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: usage(512, 200),
    }),
    sseEvent("message_stop", { type: "message_stop" }),
  ].join("");
}

function toolUsesSseBody(model, toolUses) {
  const events = [
    sseEvent("message_start", {
      type: "message_start",
      message: {
        id: nextId("msg"),
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: usage(512, 0),
      },
    }),
  ];
  toolUses.forEach((toolUse, index) => {
    events.push(
      sseEvent("content_block_start", {
        type: "content_block_start",
        index,
        content_block: {
          type: "tool_use",
          id: nextId("toolu"),
          name: toolUse.name,
          input: {},
        },
      }),
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(toolUse.input) },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index }),
    );
  });
  events.push(
    sseEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: usage(512, 64 * toolUses.length),
    }),
    sseEvent("message_stop", { type: "message_stop" }),
  );
  return events.join("");
}

function textMessageBody(model, text) {
  return {
    id: nextId("msg"),
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: usage(512, 200),
  };
}

function toolUsesMessageBody(model, toolUses) {
  return {
    id: nextId("msg"),
    type: "message",
    role: "assistant",
    model,
    content: toolUses.map((toolUse) => ({
      type: "tool_use",
      id: nextId("toolu"),
      name: toolUse.name,
      input: toolUse.input,
    })),
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: usage(512, 64 * toolUses.length),
  };
}

/* ------------------------------------------------------------------ */
/* HTTP server                                                         */
/* ------------------------------------------------------------------ */

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  served += 1;
  try {
    if (req.method === "GET" && /\/healthz\/?$/.test(url)) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, model: MODEL_ID, started_at: STARTED_AT, requests_served: served }));
      return;
    }
    if (req.method === "GET" && /\/models\/?$/.test(url)) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        data: [
          {
            id: MODEL_ID,
            type: "model",
            display_name: "Gamos M1 Deterministic Model (local endpoint)",
            created_at: STARTED_AT,
          },
        ],
        has_more: false,
        first_id: MODEL_ID,
        last_id: MODEL_ID,
      }));
      return;
    }
    if (req.method === "POST" && /count_tokens/.test(url)) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ input_tokens: 256 }));
      return;
    }
    if (req.method === "POST" && /\/(v1\/)?messages/.test(url)) {
      const bodyText = await readRequestBody(req);
      let requestJson = null;
      try {
        requestJson = JSON.parse(bodyText);
      } catch {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "body is not valid JSON" } }));
        return;
      }
      const model = typeof requestJson?.model === "string" ? requestJson.model : MODEL_ID;
      const streaming = requestJson?.stream === true;
      const outcome = resolveScenario(requestJson);
      const kind = outcome.toolUses ? `tool_use:${outcome.toolUses.map((t) => t.name).join("+")}` : "text";
      transcript({
        at: new Date().toISOString(),
        path: url,
        scenario: outcome.scenario,
        response_kind: kind,
        stream: streaming,
        model,
        messages: analyzeMessages(requestJson).messageCount,
        last_user_task_excerpt: analyzeMessages(requestJson).lastUserTaskText.slice(0, 240),
      });
      log(`POST ${url} -> ${outcome.scenario} (${kind}, stream=${streaming})`);
      if (DELAY_MS > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
      if (streaming) {
        const body = outcome.toolUses ? toolUsesSseBody(model, outcome.toolUses) : textSseBody(model, outcome.text);
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        });
        res.end(body);
      } else {
        const body = outcome.toolUses ? toolUsesMessageBody(model, outcome.toolUses) : textMessageBody(model, outcome.text);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(body));
      }
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: `no handler for ${req.method} ${url}` } }));
  } catch (e) {
    log(`handler failed: ${e instanceof Error ? e.message : String(e)}`);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "local endpoint handler failure" } }));
    } else {
      res.destroy();
    }
  }
});

server.listen(PORT, HOST, () => {
  log(`deterministic local Anthropic-Messages endpoint listening on http://${HOST}:${PORT} (model=${MODEL_ID}, delay=${DELAY_MS}ms)`);
  log(`transcript: ${TRANSCRIPT || "(disabled)"}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    log(`received ${signal} — closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
