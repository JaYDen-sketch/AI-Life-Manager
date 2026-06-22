const STORAGE_KEY = "ai-life-manager-state-v1";

const careDefaults = [
  { id: "breakfast", name: "Breakfast", kind: "meal", time: "08:15", minutes: 25 },
  { id: "water1", name: "Water", kind: "hydrate", time: "10:30", minutes: 5 },
  { id: "move1", name: "Move", kind: "move", time: "11:30", minutes: 15 },
  { id: "lunch", name: "Lunch", kind: "meal", time: "13:00", minutes: 35 },
  { id: "rest1", name: "Rest", kind: "rest", time: "15:30", minutes: 20 },
  { id: "water2", name: "Water", kind: "hydrate", time: "16:45", minutes: 5 },
  { id: "move2", name: "Walk", kind: "move", time: "18:00", minutes: 20 },
  { id: "dinner", name: "Dinner", kind: "meal", time: "19:30", minutes: 35 },
  { id: "winddown", name: "Wind down", kind: "rest", time: "21:30", minutes: 25 }
];

const sampleTasks = [
  { id: crypto.randomUUID(), name: "Plan weekly priorities", deadline: "11:00", minutes: 35, energy: 2, importance: 3, done: false },
  { id: crypto.randomUUID(), name: "Deep work block", deadline: "14:30", minutes: 90, energy: 3, importance: 4, done: false },
  { id: crypto.randomUUID(), name: "Reply to messages", deadline: "17:00", minutes: 30, energy: 1, importance: 2, done: false },
  { id: crypto.randomUUID(), name: "Tidy desk reset", deadline: "20:00", minutes: 20, energy: 1, importance: 1, done: false }
];

const els = {
  todayLabel: document.querySelector("#todayLabel"),
  energyWord: document.querySelector("#energyWord"),
  energyPicker: document.querySelector("#energyPicker"),
  wakeTime: document.querySelector("#wakeTime"),
  sleepTime: document.querySelector("#sleepTime"),
  sleepHours: document.querySelector("#sleepHours"),
  focusStyle: document.querySelector("#focusStyle"),
  taskForm: document.querySelector("#taskForm"),
  taskName: document.querySelector("#taskName"),
  taskDeadline: document.querySelector("#taskDeadline"),
  taskMinutes: document.querySelector("#taskMinutes"),
  taskEnergy: document.querySelector("#taskEnergy"),
  taskImportance: document.querySelector("#taskImportance"),
  careToggles: document.querySelector("#careToggles"),
  careToggleTemplate: document.querySelector("#careToggleTemplate"),
  timeline: document.querySelector("#timeline"),
  taskList: document.querySelector("#taskList"),
  nextCard: document.querySelector("#nextCard"),
  nextTime: document.querySelector("#nextTime"),
  progressBar: document.querySelector("#progressBar"),
  progressLabel: document.querySelector("#progressLabel"),
  metrics: document.querySelector("#metrics"),
  completeNextButton: document.querySelector("#completeNextButton"),
  aiReplanButton: document.querySelector("#aiReplanButton"),
  aiStatus: document.querySelector("#aiStatus"),
  coachCard: document.querySelector("#coachCard"),
  replanButton: document.querySelector("#replanButton"),
  clearDoneButton: document.querySelector("#clearDoneButton"),
  notificationButton: document.querySelector("#notificationButton"),
  resetDemoButton: document.querySelector("#resetDemoButton")
};

let state = loadState();
let reminderTimers = [];

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    return JSON.parse(saved);
  }

  return {
    energy: 3,
    wakeTime: "07:00",
    sleepTime: "22:30",
    sleepHours: 7,
    focusStyle: "balanced",
    aiPlan: null,
    careEnabled: Object.fromEntries(careDefaults.map((item) => [item.id, true])),
    tasks: sampleTasks
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function minutesFromTime(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function timeFromMinutes(total) {
  const normalized = ((total % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatTime(minutes) {
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(
    new Date(2026, 0, 1, Math.floor(minutes / 60), minutes % 60)
  );
}

function energyLabel(value) {
  return ["Low", "Soft", "Steady", "Strong", "Peak"][value - 1] || "Steady";
}

function careNudge(kind) {
  const copy = {
    meal: "Fuel before the next push.",
    move: "Change state, clear static, come back sharper.",
    rest: "Protect the battery before it asks loudly.",
    hydrate: "Small reset. Low friction, real payoff.",
    task: "Best fit for your current energy and deadlines."
  };
  return copy[kind] || copy.task;
}

function getEnergyCurve(minute) {
  const wake = minutesFromTime(state.wakeTime);
  const sleepDebt = Math.max(0, 7 - Number(state.sleepHours || 7)) * 0.3;
  const hoursAwake = (minute - wake) / 60;
  let curve = 3;

  if (hoursAwake < 1.5) curve = 2.2;
  else if (hoursAwake < 4.5) curve = 4.4;
  else if (hoursAwake < 7) curve = 3.4;
  else if (hoursAwake < 10) curve = 3;
  else if (hoursAwake < 13) curve = 2.5;
  else curve = 1.8;

  return Math.max(1, Math.min(5, curve + (state.energy - 3) * 0.55 - sleepDebt));
}

function scoreTask(task, slotStart) {
  const deadline = minutesFromTime(task.deadline);
  const urgency = Math.max(0, 8 - Math.max(0, deadline - slotStart) / 60);
  const slotEnergy = getEnergyCurve(slotStart);
  const energyNeed = Number(task.energy) + 1;
  const energyFit = 4 - Math.abs(slotEnergy - energyNeed);
  const latePenalty = slotStart + Number(task.minutes) > deadline ? -7 : 0;
  const styleBoost = state.focusStyle === "deep" && task.minutes >= 60 ? 1.2 : 0;
  const gentleBoost = state.focusStyle === "gentle" && task.energy <= 1 ? 1 : 0;
  const aiRank = state.aiPlan?.taskOrder?.indexOf(task.id) ?? -1;
  const aiBoost = aiRank >= 0 ? Math.max(0, state.tasks.length - aiRank) * 1.25 : 0;

  return Number(task.importance) * 3 + urgency + energyFit + styleBoost + gentleBoost + aiBoost + latePenalty;
}

function buildPlan() {
  const wake = minutesFromTime(state.wakeTime);
  const sleep = minutesFromTime(state.sleepTime);
  const dayEnd = sleep <= wake ? sleep + 1440 : sleep;
  const enabledCare = careDefaults
    .filter((item) => state.careEnabled[item.id])
    .map((item) => ({
      ...item,
      start: normalizeForDay(minutesFromTime(item.time), wake),
      end: normalizeForDay(minutesFromTime(item.time), wake) + item.minutes,
      done: Boolean(state.doneCare?.[item.id])
    }))
    .filter((item) => item.start >= wake && item.end <= dayEnd);

  const events = [...enabledCare].sort((a, b) => a.start - b.start);
  const unscheduled = state.tasks.map((task) => ({ ...task }));
  const blocks = [];
  let cursor = wake;
  const minFocus = state.focusStyle === "deep" ? 50 : state.focusStyle === "gentle" ? 25 : 35;

  for (const care of events) {
    fillTasks(blocks, unscheduled, cursor, care.start, minFocus);
    blocks.push({ ...care, source: "care" });
    cursor = Math.max(cursor, care.end);
  }

  fillTasks(blocks, unscheduled, cursor, dayEnd, minFocus);

  for (const task of unscheduled) {
    blocks.push({
      id: task.id,
      name: task.name,
      kind: "task",
      start: minutesFromTime(task.deadline),
      end: minutesFromTime(task.deadline) + Number(task.minutes),
      minutes: Number(task.minutes),
      source: "task",
      overflow: true,
      done: false,
      energy: task.energy,
      importance: task.importance,
      deadline: task.deadline
    });
  }

  return blocks.sort((a, b) => a.start - b.start);
}

function fillTasks(blocks, unscheduled, start, end, minFocus) {
  let cursor = start;
  while (cursor + minFocus <= end && unscheduled.length) {
    const fitTasks = unscheduled
      .filter((task) => Number(task.minutes) <= end - cursor)
      .sort((a, b) => scoreTask(b, cursor) - scoreTask(a, cursor));

    if (!fitTasks.length) break;

    const task = fitTasks[0];
    const taskIndex = unscheduled.findIndex((item) => item.id === task.id);
    unscheduled.splice(taskIndex, 1);
    blocks.push({
      ...task,
      kind: "task",
      source: "task",
      start: cursor,
      end: cursor + Number(task.minutes),
      done: false
    });
    cursor += Number(task.minutes) + 10;
  }
}

function normalizeForDay(minute, wake) {
  return minute < wake - 120 ? minute + 1440 : minute;
}

function render() {
  bindControls();
  renderCareToggles();
  const plan = buildPlan();
  renderTimeline(plan);
  renderTaskList();
  renderNext(plan);
  renderMetrics(plan);
  renderCoach();
  scheduleReminderTimers(plan);
  saveState();
}

function bindControls() {
  els.todayLabel.textContent = new Intl.DateTimeFormat([], { weekday: "short", month: "short", day: "numeric" }).format(new Date());
  els.energyWord.textContent = energyLabel(state.energy);
  els.wakeTime.value = state.wakeTime;
  els.sleepTime.value = state.sleepTime;
  els.sleepHours.value = state.sleepHours;
  els.focusStyle.value = state.focusStyle;
  els.taskDeadline.value ||= timeFromMinutes(Math.ceil((new Date().getHours() * 60 + new Date().getMinutes() + 120) / 15) * 15);

  document.querySelectorAll(".energy-dot").forEach((button) => {
    const active = Number(button.dataset.energy) === Number(state.energy);
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
}

function renderCareToggles() {
  els.careToggles.replaceChildren();
  for (const item of careDefaults) {
    const node = els.careToggleTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".toggle-copy").textContent = `${item.name} ${item.time}`;
    const input = node.querySelector("input");
    input.checked = Boolean(state.careEnabled[item.id]);
    input.addEventListener("change", () => {
      state.careEnabled[item.id] = input.checked;
      render();
    });
    els.careToggles.append(node);
  }
}

function renderTimeline(plan) {
  els.timeline.replaceChildren();
  if (!plan.length) {
    els.timeline.innerHTML = '<div class="empty-state">Add a task or turn on a care rhythm.</div>';
    return;
  }

  for (const block of plan) {
    const row = document.createElement("article");
    row.className = `time-block ${block.kind}${isDone(block) ? " done" : ""}`;

    const meta = [
      `${block.minutes} min`,
      block.kind,
      block.deadline ? `due ${block.deadline}` : null,
      block.overflow ? "needs room" : null
    ].filter(Boolean);

    row.innerHTML = `
      <div class="time">${formatTime(block.start)}<br>${formatTime(block.end)}</div>
      <div class="block-main">
        <p class="block-title">${escapeHtml(block.name)}</p>
        <div class="block-meta">${meta.map((item) => `<span class="pill">${item}</span>`).join("")}</div>
      </div>
      <div class="block-actions">
        <button class="mini-button" type="button" data-action="done" data-id="${block.id}" data-source="${block.source}" title="Done" aria-label="Done">OK</button>
        <button class="mini-button" type="button" data-action="delay" data-id="${block.id}" data-source="${block.source}" title="Later" aria-label="Later">+15</button>
      </div>
    `;
    els.timeline.append(row);
  }
}

function renderTaskList() {
  els.taskList.replaceChildren();
  if (!state.tasks.length) {
    els.taskList.innerHTML = '<div class="empty-state">No tasks yet.</div>';
    return;
  }

  for (const task of [...state.tasks].sort((a, b) => minutesFromTime(a.deadline) - minutesFromTime(b.deadline))) {
    const note = state.aiPlan?.taskNotes?.find((item) => item.id === task.id)?.note;
    const row = document.createElement("div");
    row.className = "task-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(task.name)}</strong>
        <span>${task.minutes} min - due ${task.deadline} - ${task.done ? "done" : energyLabel(Number(task.energy) + 1)}</span>
        ${note ? `<em>${escapeHtml(note)}</em>` : ""}
      </div>
      <button class="mini-button" type="button" data-action="remove-task" data-id="${task.id}" title="Remove" aria-label="Remove">X</button>
    `;
    els.taskList.append(row);
  }
}

function renderNext(plan) {
  const next = plan.find((block) => !isDone(block)) || plan[0];
  if (!next) {
    els.nextTime.textContent = "";
    els.nextCard.innerHTML = "<h3>Clear</h3><p>Your plan is empty.</p>";
    return;
  }

  els.nextTime.textContent = `${formatTime(next.start)}`;
  els.nextCard.dataset.id = next.id;
  els.nextCard.dataset.source = next.source;
  els.nextCard.innerHTML = `
    <h3>${escapeHtml(next.name)}</h3>
    <p>${careNudge(next.kind)}</p>
    <div class="block-meta"><span class="pill">${next.minutes} min</span><span class="pill">${next.kind}</span></div>
  `;
}

function renderMetrics(plan) {
  const doneCount = plan.filter(isDone).length;
  const progress = plan.length ? Math.round((doneCount / plan.length) * 100) : 0;
  const focusMinutes = plan.filter((block) => block.kind === "task").reduce((sum, block) => sum + Number(block.minutes), 0);
  const careMinutes = plan.filter((block) => block.kind !== "task").reduce((sum, block) => sum + Number(block.minutes), 0);
  const overflow = plan.filter((block) => block.overflow).length;
  const averageEnergy = plan.length
    ? (plan.reduce((sum, block) => sum + getEnergyCurve(block.start), 0) / plan.length).toFixed(1)
    : "0";

  els.progressBar.style.width = `${progress}%`;
  els.progressLabel.textContent = `${progress}%`;
  els.metrics.innerHTML = [
    ["Focus", `${focusMinutes}m`],
    ["Care", `${careMinutes}m`],
    ["Energy", averageEnergy],
    ["Conflicts", overflow]
  ]
    .map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function isDone(block) {
  if (block.source === "task") {
    return Boolean(state.tasks.find((task) => task.id === block.id)?.done);
  }
  return Boolean(state.doneCare?.[block.id]);
}

function markDone(id, source) {
  if (!id) return;
  if (source === "task") {
    const task = state.tasks.find((item) => item.id === id);
    if (task) task.done = true;
  } else {
    state.doneCare = { ...state.doneCare, [id]: true };
  }
  render();
}

function delayBlock(id, source) {
  if (source === "task") {
    const task = state.tasks.find((item) => item.id === id);
    if (task) task.deadline = timeFromMinutes(minutesFromTime(task.deadline) + 15);
    state.aiPlan = null;
  } else {
    const care = careDefaults.find((item) => item.id === id);
    if (care) care.time = timeFromMinutes(minutesFromTime(care.time) + 15);
  }
  render();
}

function clearCompleted() {
  state.tasks = state.tasks.filter((task) => !task.done);
  state.doneCare = {};
  state.aiPlan = null;
  render();
}

function resetDemo() {
  localStorage.removeItem(STORAGE_KEY);
  state = loadState();
  render();
}

function scheduleReminderTimers(plan) {
  reminderTimers.forEach(clearTimeout);
  reminderTimers = [];

  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  for (const block of plan.filter((item) => !isDone(item))) {
    const delayMinutes = block.start - nowMinutes;
    if (delayMinutes < 0 || delayMinutes > 180) continue;

    const timer = setTimeout(() => {
      new Notification(block.name, { body: `${block.minutes} minutes - ${careNudge(block.kind)}` });
    }, delayMinutes * 60 * 1000);
    reminderTimers.push(timer);
  }
}

function renderCoach() {
  if (!state.aiPlan) {
    els.coachCard.innerHTML = `
      <p>Use AI replan to ask for a task order, risk read, and nudges based on your energy.</p>
      <span class="risk-pill">local</span>
    `;
    return;
  }

  const nudges = state.aiPlan.nudges?.length
    ? `<ul>${state.aiPlan.nudges.map((nudge) => `<li>${escapeHtml(nudge)}</li>`).join("")}</ul>`
    : "";

  els.coachCard.innerHTML = `
    <p>${escapeHtml(state.aiPlan.summary)}</p>
    <span class="risk-pill ${state.aiPlan.riskLevel}">${escapeHtml(state.aiPlan.riskLevel)} risk</span>
    ${nudges}
  `;
}

function buildAiPayload(plan) {
  return {
    energy: state.energy,
    sleepHours: state.sleepHours,
    wakeTime: state.wakeTime,
    sleepTime: state.sleepTime,
    focusStyle: state.focusStyle,
    tasks: state.tasks,
    careBlocks: careDefaults.filter((item) => state.careEnabled[item.id]),
    localPlan: plan.map((block) => ({
      id: block.id,
      name: block.name,
      kind: block.kind,
      start: timeFromMinutes(block.start),
      end: timeFromMinutes(block.end),
      minutes: block.minutes,
      done: isDone(block),
      overflow: Boolean(block.overflow)
    }))
  };
}

async function aiReplan() {
  const plan = buildPlan();
  els.aiReplanButton.disabled = true;
  els.aiStatus.textContent = "Asking AI...";

  try {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAiPayload(plan))
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "AI replan failed");
    }

    state.aiPlan = data;
    state.tasks.sort((a, b) => {
      const aRank = data.taskOrder.indexOf(a.id);
      const bRank = data.taskOrder.indexOf(b.id);
      return (aRank === -1 ? 999 : aRank) - (bRank === -1 ? 999 : bRank);
    });
    els.aiStatus.textContent = "AI priorities applied";
    render();
  } catch (error) {
    els.aiStatus.textContent = error.message;
    renderCoach();
  } finally {
    els.aiReplanButton.disabled = false;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
}

els.energyPicker.addEventListener("click", (event) => {
  const button = event.target.closest("[data-energy]");
  if (!button) return;
  state.energy = Number(button.dataset.energy);
  state.aiPlan = null;
  render();
});

[els.wakeTime, els.sleepTime, els.sleepHours, els.focusStyle].forEach((input) => {
  input.addEventListener("change", () => {
    state.wakeTime = els.wakeTime.value;
    state.sleepTime = els.sleepTime.value;
    state.sleepHours = Number(els.sleepHours.value);
    state.focusStyle = els.focusStyle.value;
    state.aiPlan = null;
    render();
  });
});

els.taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.tasks.push({
    id: crypto.randomUUID(),
    name: els.taskName.value.trim(),
    deadline: els.taskDeadline.value,
    minutes: Number(els.taskMinutes.value),
    energy: Number(els.taskEnergy.value),
    importance: Number(els.taskImportance.value),
    done: false
  });
  state.aiPlan = null;
  els.taskName.value = "";
  render();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const { action, id, source } = button.dataset;
  if (action === "done") markDone(id, source);
  if (action === "delay") delayBlock(id, source);
  if (action === "remove-task") {
    state.tasks = state.tasks.filter((task) => task.id !== id);
    state.aiPlan = null;
    render();
  }
});

els.completeNextButton.addEventListener("click", () => {
  markDone(els.nextCard.dataset.id, els.nextCard.dataset.source);
});

els.replanButton.addEventListener("click", render);
els.aiReplanButton.addEventListener("click", aiReplan);
els.clearDoneButton.addEventListener("click", clearCompleted);
els.resetDemoButton.addEventListener("click", resetDemo);

els.notificationButton.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    els.notificationButton.textContent = "Not supported";
    return;
  }

  const result = await Notification.requestPermission();
  els.notificationButton.textContent = result === "granted" ? "Reminders on" : "Reminders off";
  render();
});

render();
