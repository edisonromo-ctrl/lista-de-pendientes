const STORAGE_KEY = "lista-pendientes-v1";
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const PRIORITY_LABEL = { high: "Alta", medium: "Media", low: "Baja" };
const EMPTY_STATE = { tasks: [], archived: [], completeMode: "ask" };

const taskInput = document.querySelector("#taskInput");
const detailsInput = document.querySelector("#detailsInput");
const addButton = document.querySelector("#addButton");
const taskList = document.querySelector("#taskList");
const archiveList = document.querySelector("#archiveList");
const pendingCount = document.querySelector("#pendingCount");
const archiveCount = document.querySelector("#archiveCount");
const completeMode = document.querySelector("#completeMode");
const finishDialog = document.querySelector("#finishDialog");
const editDialog = document.querySelector("#editDialog");
const editTaskInput = document.querySelector("#editTaskInput");
const installButton = document.querySelector("#installButton");
const syncStatus = document.querySelector("#syncStatus");

let deferredInstallPrompt = null;
let pendingCompletionId = null;
let editingTaskId = null;
let editingArchived = false;
let state = loadLocalState();
let sharedMode = false;
let sharedVersion = 0;
let syncing = false;

function loadLocalState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return normalizeState(saved);
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

function normalizeState(value) {
  return {
    tasks: normalizeTasks(value?.tasks),
    archived: normalizeTasks(value?.archived),
    completeMode: value?.completeMode || "ask",
  };
}

function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.map((task) => ({
    ...task,
    details: Array.isArray(task.details) ? task.details : [],
    collapsed: Boolean(task.collapsed),
  }));
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function currentPriority() {
  return document.querySelector("input[name='priority']:checked").value;
}

function hasContent(value) {
  return Boolean(value.tasks.length || value.archived.length);
}

function setSyncStatus(text, mode = "local") {
  syncStatus.textContent = text;
  syncStatus.dataset.mode = mode;
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error("No se pudo sincronizar");
  return response.json();
}

async function syncFromServer({ seedLocal = false } = {}) {
  if (syncing) return;
  syncing = true;
  try {
    const remote = await requestJson("/api/state");
    sharedMode = true;

    if (seedLocal && !hasContent(remote.state) && hasContent(state)) {
      const seeded = await requestJson("/api/replace", {
        method: "POST",
        body: JSON.stringify({ state }),
      });
      sharedVersion = seeded.version;
      setSyncStatus("Sincronizado para dos dispositivos", "shared");
      return;
    }

    if (remote.version !== sharedVersion) {
      state = normalizeState(remote.state);
      sharedVersion = remote.version;
      saveLocalState();
      render();
    }
    setSyncStatus("Sincronizado para dos dispositivos", "shared");
  } catch {
    sharedMode = false;
    setSyncStatus("Modo local en este dispositivo", "local");
  } finally {
    syncing = false;
  }
}

async function commitAction(action) {
  applyAction(state, action);
  saveLocalState();
  render();

  try {
    const remote = await requestJson("/api/action", {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    sharedMode = true;
    state = normalizeState(remote.state);
    sharedVersion = remote.version;
    saveLocalState();
    render();
    setSyncStatus("Sincronizado para dos dispositivos", "shared");
  } catch {
    sharedMode = false;
    setSyncStatus("Guardado solo en este dispositivo", "local");
  }
}

function applyAction(target, action) {
  if (action.type === "setCompleteMode") {
    target.completeMode = action.mode || "ask";
    return;
  }

  if (action.type === "addTask") {
    target.tasks.push(action.task);
    return;
  }

  if (action.type === "addDetail") {
    const task = target.tasks.find((item) => item.id === action.taskId);
    if (task && action.detail) task.details.push(action.detail);
    return;
  }

  if (action.type === "editTask") {
    const collection = action.archived ? target.archived : target.tasks;
    const task = collection.find((item) => item.id === action.taskId);
    if (task) {
      task.text = action.text || task.text;
      task.priority = action.priority || task.priority;
    }
    return;
  }

  if (action.type === "toggleCollapsed") {
    const collection = action.archived ? target.archived : target.tasks;
    const task = collection.find((item) => item.id === action.taskId);
    if (task) task.collapsed = !Boolean(task.collapsed);
    return;
  }

  if (action.type === "toggleDetail") {
    const task = target.tasks.find((item) => item.id === action.taskId);
    const detail = task?.details.find((item) => item.id === action.detailId);
    if (detail) detail.done = !detail.done;
    return;
  }

  if (action.type === "removeDetail") {
    const task = target.tasks.find((item) => item.id === action.taskId);
    if (task) task.details = task.details.filter((item) => item.id !== action.detailId);
    return;
  }

  if (action.type === "completeTask") {
    const index = target.tasks.findIndex((task) => task.id === action.taskId);
    if (index < 0) return;
    const [task] = target.tasks.splice(index, 1);
    if (action.mode === "archive") {
      target.archived.push({ ...task, completedAt: Date.now() });
    }
    return;
  }

  if (action.type === "unarchiveTask") {
    const index = target.archived.findIndex((task) => task.id === action.taskId);
    if (index < 0) return;
    const [task] = target.archived.splice(index, 1);
    delete task.completedAt;
    target.tasks.push(task);
    return;
  }

  if (action.type === "deleteTask") {
    const collection = action.archived ? target.archived : target.tasks;
    const index = collection.findIndex((task) => task.id === action.taskId);
    if (index >= 0) collection.splice(index, 1);
  }
}

function addTask() {
  const text = taskInput.value.trim();
  const details = detailLines(detailsInput.value);
  if (!text) {
    taskInput.focus();
    return;
  }

  const task = {
    id: crypto.randomUUID(),
    text,
    details,
    priority: currentPriority(),
    createdAt: Date.now(),
  };

  taskInput.value = "";
  detailsInput.value = "";
  commitAction({ type: "addTask", task });
  taskInput.focus();
}

function detailLines(text) {
  return text
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      id: crypto.randomUUID(),
      text: line,
      done: false,
      createdAt: Date.now(),
    }));
}

function orderedTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const priorityGap = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    return priorityGap || a.createdAt - b.createdAt;
  });
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function render() {
  completeMode.value = state.completeMode;
  pendingCount.textContent = state.tasks.length;
  archiveCount.textContent = state.archived.length;

  taskList.innerHTML = "";
  archiveList.innerHTML = "";

  const sortedTasks = orderedTasks(state.tasks);
  if (!sortedTasks.length) {
    taskList.append(emptyState("No hay pendientes por ahora."));
  } else {
    sortedTasks.forEach((task) => taskList.append(taskElement(task, false)));
  }

  const archivedTasks = orderedTasks(state.archived);
  if (!archivedTasks.length) {
    archiveList.append(emptyState("Aun no hay tareas archivadas."));
  } else {
    archivedTasks.forEach((task) => archiveList.append(taskElement(task, true)));
  }
}

function emptyState(text) {
  const el = document.createElement("p");
  el.className = "empty";
  el.textContent = text;
  return el;
}

function taskElement(task, archived) {
  const article = document.createElement("article");
  article.className = `task ${task.priority}`;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = archived;
  checkbox.disabled = archived;
  checkbox.ariaLabel = `Marcar como terminada: ${task.text}`;
  checkbox.addEventListener("change", () => completeTask(task.id));

  const body = document.createElement("div");
  body.className = "task-body";

  const header = document.createElement("div");
  header.className = "task-content";

  const title = document.createElement("div");
  title.className = "task-title";
  title.textContent = task.text;

  const meta = document.createElement("small");
  meta.className = "task-meta";
  const detailCount = task.details?.length || 0;
  meta.textContent = `${PRIORITY_LABEL[task.priority]} - ${formatDate(task.createdAt)}${detailCount ? ` - ${detailCount} detalle${detailCount === 1 ? "" : "s"}` : ""}`;

  const tools = document.createElement("div");
  tools.className = "task-inline-tools";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "text-tool-button";
  editButton.textContent = "Editar";
  editButton.addEventListener("click", () => openEditTask(task.id, archived));
  tools.append(editButton);

  if (detailCount) {
    const collapseButton = document.createElement("button");
    collapseButton.type = "button";
    collapseButton.className = "text-tool-button";
    collapseButton.textContent = task.collapsed ? "Desplegar" : "Contraer";
    collapseButton.addEventListener("click", () => toggleCollapsed(task.id, archived));
    tools.append(collapseButton);
  }

  header.append(title, meta, tools);
  body.append(header, detailsElement(task, archived));

  const sideActions = document.createElement("div");
  sideActions.className = "task-actions";

  if (archived) {
    const restoreButton = document.createElement("button");
    restoreButton.type = "button";
    restoreButton.className = "restore-button";
    restoreButton.title = "Desarchivar pendiente";
    restoreButton.textContent = "R";
    restoreButton.addEventListener("click", () => unarchiveTask(task.id));
    sideActions.append(restoreButton);
  }

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-button";
  deleteButton.title = archived ? "Eliminar del archivo" : "Eliminar pendiente";
  deleteButton.textContent = "x";
  deleteButton.addEventListener("click", () => deleteTask(task.id, archived));
  sideActions.append(deleteButton);

  article.append(checkbox, body, sideActions);
  return article;
}

function detailsElement(task, archived) {
  const wrapper = document.createElement("div");
  wrapper.className = "sublist";
  if (task.collapsed) {
    wrapper.classList.add("collapsed");
    return wrapper;
  }

  if (task.details?.length) {
    const list = document.createElement("div");
    list.className = "subitems";
    task.details.forEach((item) => list.append(subitemElement(task.id, item, archived)));
    wrapper.append(list);
  }

  if (!archived) {
    const form = document.createElement("div");
    form.className = "subitem-form";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Agregar detalle";
    input.ariaLabel = `Agregar detalle a ${task.text}`;

    const add = document.createElement("button");
    add.type = "button";
    add.className = "add-detail-button";
    add.textContent = "+";
    add.title = "Agregar detalle";
    add.addEventListener("click", () => {
      addDetail(task.id, input.value);
      input.value = "";
      input.focus();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        addDetail(task.id, input.value);
        input.value = "";
      }
    });

    form.append(input, add);
    wrapper.append(form);
  }

  return wrapper;
}

function subitemElement(taskId, item, archived) {
  const row = document.createElement("div");
  row.className = "subitem";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = Boolean(item.done);
  checkbox.disabled = archived;
  checkbox.ariaLabel = `Marcar detalle como terminado: ${item.text}`;
  checkbox.addEventListener("change", () => toggleDetail(taskId, item.id));

  const text = document.createElement("span");
  text.textContent = item.text;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "delete-detail-button";
  remove.textContent = "x";
  remove.title = "Eliminar solo este detalle";
  remove.disabled = archived;
  remove.addEventListener("click", () => removeDetail(taskId, item.id));

  row.append(checkbox, text, remove);
  return row;
}

function addDetail(taskId, text) {
  const cleanText = text.trim();
  if (!cleanText) return;
  commitAction({
    type: "addDetail",
    taskId,
    detail: {
      id: crypto.randomUUID(),
      text: cleanText,
      done: false,
      createdAt: Date.now(),
    },
  });
}

function toggleDetail(taskId, detailId) {
  commitAction({ type: "toggleDetail", taskId, detailId });
}

function removeDetail(taskId, detailId) {
  commitAction({ type: "removeDetail", taskId, detailId });
}

function openEditTask(taskId, archived) {
  const collection = archived ? state.archived : state.tasks;
  const task = collection.find((item) => item.id === taskId);
  if (!task) return;

  editingTaskId = taskId;
  editingArchived = archived;
  editTaskInput.value = task.text;
  document.querySelectorAll("input[name='editPriority']").forEach((input) => {
    input.checked = input.value === task.priority;
  });
  editDialog.showModal();
  editTaskInput.focus();
}

function selectedEditPriority() {
  return document.querySelector("input[name='editPriority']:checked")?.value || "medium";
}

function saveEditedTask() {
  const text = editTaskInput.value.trim();
  if (!editingTaskId || !text) return;
  commitAction({
    type: "editTask",
    taskId: editingTaskId,
    archived: editingArchived,
    text,
    priority: selectedEditPriority(),
  });
}

function toggleCollapsed(taskId, archived) {
  commitAction({ type: "toggleCollapsed", taskId, archived });
}

function unarchiveTask(taskId) {
  commitAction({ type: "unarchiveTask", taskId });
}

function completeTask(taskId) {
  if (state.completeMode === "ask") {
    pendingCompletionId = taskId;
    finishDialog.showModal();
    return;
  }

  finishTask(taskId, state.completeMode);
}

function finishTask(taskId, mode) {
  commitAction({ type: "completeTask", taskId, mode });
}

function deleteTask(taskId, archived) {
  commitAction({ type: "deleteTask", taskId, archived });
}

addButton.addEventListener("click", addTask);

taskInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    addTask();
  }
});

completeMode.addEventListener("change", () => {
  commitAction({ type: "setCompleteMode", mode: completeMode.value });
});

finishDialog.addEventListener("close", () => {
  if (pendingCompletionId && finishDialog.returnValue) {
    finishTask(pendingCompletionId, finishDialog.returnValue);
  }
  pendingCompletionId = null;
  finishDialog.returnValue = "";
});

editDialog.addEventListener("close", () => {
  if (editDialog.returnValue === "save") {
    saveEditedTask();
  }
  editingTaskId = null;
  editingArchived = false;
  editDialog.returnValue = "";
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

render();
syncFromServer({ seedLocal: true });
setInterval(() => syncFromServer(), 2500);
