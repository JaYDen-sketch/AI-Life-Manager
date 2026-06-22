const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
loadEnvFile(path.join(ROOT, ".env"));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.1-mini";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "taskOrder", "taskNotes", "nudges", "riskLevel"],
  properties: {
    summary: { type: "string" },
    taskOrder: {
      type: "array",
      items: { type: "string" }
    },
    taskNotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "note"],
        properties: {
          id: { type: "string" },
          note: { type: "string" }
        }
      }
    },
    nudges: {
      type: "array",
      items: { type: "string" }
    },
    riskLevel: {
      type: "string",
      enum: ["low", "medium", "high"]
    }
  }
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/plan") {
      await handleAiPlan(req, res);
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AI Life Manager running at http://${HOST}:${PORT}/`);
});

async function handleAiPlan(req, res) {
  if (!OPENAI_API_KEY) {
    sendJson(res, 503, {
      error: "AI is not configured. Set OPENAI_API_KEY before starting the server."
    });
    return;
  }

  const body = await readJsonBody(req);
  const plannerInput = sanitizePlannerInput(body);
  const aiPlan = await requestAiPlan(plannerInput);
  sendJson(res, 200, aiPlan);
}

async function requestAiPlan(plannerInput) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: "You are a practical life-planning assistant. Prioritize humane, realistic daily plans around energy, rest, meals, movement, and deadlines. Return only the requested JSON."
        },
        {
          role: "user",
          content: JSON.stringify(plannerInput)
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "life_manager_plan",
          strict: true,
          schema: responseSchema
        }
      }
    })
  });

  const data = await readOpenAiJson(response);
  if (!response.ok) {
    const message = getOpenAiErrorMessage(data);
    throw new Error(message);
  }

  const text = extractOutputText(data);

  if (!text) {
    throw new Error("The AI response did not include structured output.");
  }

  return normalizeAiPlan(JSON.parse(text), plannerInput.tasks);
}

function normalizeAiPlan(aiPlan, tasks) {
  const taskIds = new Set(tasks.map((task) => task.id));
  const taskOrder = aiPlan.taskOrder.filter((id) => taskIds.has(id));
  const missingIds = tasks.map((task) => task.id).filter((id) => !taskOrder.includes(id));
  const taskNotes = aiPlan.taskNotes
    .filter((item) => taskIds.has(item.id))
    .map((item) => ({ id: item.id, note: String(item.note).slice(0, 180) }));

  return {
    summary: String(aiPlan.summary).slice(0, 280),
    taskOrder: [...taskOrder, ...missingIds],
    taskNotes,
    nudges: aiPlan.nudges.map((nudge) => String(nudge).slice(0, 160)).slice(0, 4),
    riskLevel: aiPlan.riskLevel
  };
}

function sanitizePlannerInput(body) {
  const tasks = Array.isArray(body?.tasks) ? body.tasks.slice(0, 30) : [];
  return {
    energy: clamp(Number(body?.energy || 3), 1, 5),
    sleepHours: clamp(Number(body?.sleepHours || 7), 0, 14),
    wakeTime: safeTime(body?.wakeTime, "07:00"),
    sleepTime: safeTime(body?.sleepTime, "22:30"),
    focusStyle: ["balanced", "deep", "gentle"].includes(body?.focusStyle) ? body.focusStyle : "balanced",
    tasks: tasks.map((task) => ({
      id: String(task.id || ""),
      name: String(task.name || "").slice(0, 120),
      deadline: safeTime(task.deadline, "17:00"),
      minutes: clamp(Number(task.minutes || 30), 5, 240),
      energy: clamp(Number(task.energy || 2), 1, 3),
      importance: clamp(Number(task.importance || 2), 1, 4),
      done: Boolean(task.done)
    })),
    careBlocks: Array.isArray(body?.careBlocks) ? body.careBlocks.slice(0, 20) : [],
    localPlan: Array.isArray(body?.localPlan) ? body.localPlan.slice(0, 40) : []
  };
}

function serveStatic(req, res) {
  const requestedUrl = new URL(req.url, `http://${HOST}:${PORT}`);
  const pathname = requestedUrl.pathname === "/" ? "/index.html" : requestedUrl.pathname;
  const resolved = path.resolve(ROOT, `.${decodeURIComponent(pathname)}`);

  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(resolved, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const type = MIME_TYPES[path.extname(resolved)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 200000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readOpenAiJson(response) {
  const raw = await response.text();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    if (!response.ok) {
      return { error: { message: `OpenAI request failed with status ${response.status}` } };
    }
    throw new Error("OpenAI returned an invalid JSON response.");
  }
}

function getOpenAiErrorMessage(data) {
  const message = data?.error?.message || "OpenAI request failed";
  const code = String(data?.error?.code || data?.error?.type || "").toLowerCase();
  const looksLikeModelIssue = /model|unsupported|not_found|does not exist|invalid/i.test(`${message} ${code}`);

  if (looksLikeModelIssue) {
    return `${message}. Check OPENAI_MODEL; this app defaults to ${OPENAI_MODEL}.`;
  }

  return message;
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  const contentItems = Array.isArray(data?.output)
    ? data.output.flatMap((item) => Array.isArray(item.content) ? item.content : [])
    : [];

  return contentItems.find((content) => content.type === "output_text" && typeof content.text === "string")?.text;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function safeTime(value, fallback) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return fallback;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? value : fallback;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
