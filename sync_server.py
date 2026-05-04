from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote
import json
import mimetypes
import time


ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "lista_compartida.json"
DEFAULT_STATE = {"tasks": [], "archived": [], "completeMode": "ask"}


def normalize_state(value):
    value = value if isinstance(value, dict) else {}
    tasks = value.get("tasks") if isinstance(value.get("tasks"), list) else []
    archived = value.get("archived") if isinstance(value.get("archived"), list) else []
    return {
        "tasks": [normalize_task(task) for task in tasks],
        "archived": [normalize_task(task) for task in archived],
        "completeMode": value.get("completeMode") or "ask",
    }


def normalize_task(task):
    task = task if isinstance(task, dict) else {}
    task["details"] = task.get("details") if isinstance(task.get("details"), list) else []
    return task


def read_store():
    if not DATA_FILE.exists():
        return {"version": 0, "state": DEFAULT_STATE}
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        return {
            "version": int(data.get("version", 0)),
            "state": normalize_state(data.get("state")),
        }
    except Exception:
        return {"version": 0, "state": DEFAULT_STATE}


def write_store(state, version):
    payload = {"version": version, "state": normalize_state(state)}
    DATA_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def apply_action(state, action):
    action_type = action.get("type")

    if action_type == "setCompleteMode":
        state["completeMode"] = action.get("mode") or "ask"

    if action_type == "addTask" and isinstance(action.get("task"), dict):
        state["tasks"].append(normalize_task(action["task"]))

    if action_type == "addDetail":
        task = find_task(state["tasks"], action.get("taskId"))
        if task and isinstance(action.get("detail"), dict):
            task["details"].append(action["detail"])

    if action_type == "toggleDetail":
        task = find_task(state["tasks"], action.get("taskId"))
        detail = find_task(task.get("details", []), action.get("detailId")) if task else None
        if detail:
            detail["done"] = not bool(detail.get("done"))

    if action_type == "removeDetail":
        task = find_task(state["tasks"], action.get("taskId"))
        if task:
            task["details"] = [item for item in task.get("details", []) if item.get("id") != action.get("detailId")]

    if action_type == "completeTask":
        task_id = action.get("taskId")
        for index, task in enumerate(state["tasks"]):
            if task.get("id") == task_id:
                finished = state["tasks"].pop(index)
                if action.get("mode") == "archive":
                    finished["completedAt"] = int(time.time() * 1000)
                    state["archived"].append(finished)
                break

    if action_type == "deleteTask":
        collection_name = "archived" if action.get("archived") else "tasks"
        state[collection_name] = [
            task for task in state[collection_name] if task.get("id") != action.get("taskId")
        ]


def find_task(items, item_id):
    for item in items:
        if item.get("id") == item_id:
            return item
    return None


class SyncHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/state":
            self.send_json(read_store())
            return
        self.send_static_file()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length).decode("utf-8")
            payload = json.loads(body or "{}")
        except Exception:
            self.send_error(400, "Solicitud invalida")
            return

        store = read_store()

        if self.path == "/api/replace":
            updated = write_store(payload.get("state", DEFAULT_STATE), store["version"] + 1)
            self.send_json(updated)
            return

        if self.path == "/api/action":
            state = store["state"]
            apply_action(state, payload.get("action", {}))
            updated = write_store(state, store["version"] + 1)
            self.send_json(updated)
            return

        self.send_error(404, "No encontrado")

    def send_json(self, payload):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def send_static_file(self):
        request_path = unquote(self.path.split("?", 1)[0]).lstrip("/")
        if not request_path:
            request_path = "index.html"

        requested = (ROOT / request_path).resolve()
        if ROOT not in requested.parents and requested != ROOT:
            self.send_error(403, "No permitido")
            return

        if not requested.is_file():
            self.send_error(404, "Archivo no encontrado")
            return

        content = requested.read_bytes()
        content_type = mimetypes.guess_type(str(requested))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 4174), SyncHandler)
    print("Lista de pendientes sincronizada: http://127.0.0.1:4174/")
    print("Para otros dispositivos, usa http://IP-DE-ESTE-COMPUTADOR:4174/")
    server.serve_forever()
