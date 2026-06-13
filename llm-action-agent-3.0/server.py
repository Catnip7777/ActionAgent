#!/usr/bin/env python3
"""Local backend for LLM Action Agent — system file ops and shell commands."""

import hashlib
import hmac
import json
import os
import subprocess
import sys
import secrets
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import unquote, urlparse

HOST = "127.0.0.1"
PORT = 8765

# 优先从环境变量读取 Token；未设置时自动生成随机字符串
_DEFAULT_TOKEN = secrets.token_urlsafe(24)
TOKEN = os.environ.get("ACTION_AGENT_TOKEN", _DEFAULT_TOKEN)
ROOT = os.getcwd()
CONFIG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config")
PLUGINS_DIR = os.path.join(CONFIG_DIR, "plugins")
MEMORIES_DIR = os.path.join(CONFIG_DIR, "memories")
MAX_BODY = 10 * 1024 * 1024  # 10 MB

CONFIG_FILES = {
    "settings": "settings.json",
    "system_prompt": "system-prompt.txt",
    "api_key": "api-key.txt",
    "format": "format.json",
    "conversations": "conversations.json",
    "workspaces": "workspaces.json",
}


def ensure_config_dir():
    os.makedirs(CONFIG_DIR, exist_ok=True)
    os.makedirs(PLUGINS_DIR, exist_ok=True)
    os.makedirs(MEMORIES_DIR, exist_ok=True)


def read_config_file(key):
    ensure_config_dir()
    fname = CONFIG_FILES.get(key)
    if not fname:
        return None
    path = os.path.join(CONFIG_DIR, fname)
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def write_config_file(key, content):
    ensure_config_dir()
    fname = CONFIG_FILES.get(key)
    if not fname:
        raise ValueError("unknown config key")
    path = os.path.join(CONFIG_DIR, fname)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content if content is not None else "")
    return path


def load_all_config():
    ensure_config_dir()
    result = {"configDir": CONFIG_DIR, "files": {}}
    for key, fname in CONFIG_FILES.items():
        path = os.path.join(CONFIG_DIR, fname)
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                raw = f.read()
            if fname.endswith(".json"):
                try:
                    result[key] = json.loads(raw) if raw.strip() else {}
                except json.JSONDecodeError:
                    result[key] = raw
            else:
                result[key] = raw
            result["files"][fname] = path
    return result


def save_all_config(payload):
    ensure_config_dir()
    saved = []
    if "settings" in payload:
        write_config_file("settings", json.dumps(payload["settings"], ensure_ascii=False, indent=2))
        saved.append(CONFIG_FILES["settings"])
    if "systemPrompt" in payload:
        write_config_file("system_prompt", payload["systemPrompt"] or "")
        saved.append(CONFIG_FILES["system_prompt"])
    if "apiKey" in payload:
        write_config_file("api_key", payload["apiKey"] or "")
        saved.append(CONFIG_FILES["api_key"])
    if "format" in payload:
        write_config_file("format", json.dumps(payload["format"], ensure_ascii=False, indent=2))
        saved.append(CONFIG_FILES["format"])
    if "conversations" in payload:
        write_config_file("conversations", json.dumps(payload["conversations"], ensure_ascii=False, indent=2))
        saved.append(CONFIG_FILES["conversations"])
    if "workspaces" in payload:
        write_config_file("workspaces", json.dumps(payload["workspaces"], ensure_ascii=False, indent=2))
        saved.append(CONFIG_FILES["workspaces"])
    return saved


def write_token_to_config(token):
    """将 token 写入 settings.json，确保前后端一致"""
    ensure_config_dir()
    settings_path = os.path.join(CONFIG_DIR, CONFIG_FILES["settings"])
    if os.path.isfile(settings_path):
        try:
            with open(settings_path, "r", encoding="utf-8") as f:
                settings = json.load(f)
        except (json.JSONDecodeError, Exception):
            settings = {}
    else:
        settings = {}
    settings["backendToken"] = token
    with open(settings_path, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)


def json_response(handler, status, data):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    handler.end_headers()
    handler.wfile.write(body)


def check_auth(handler):
    return True


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Action-Token")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            json_response(self, 200, {"ok": True, "version": "1.0"})
            return
        if path == "/config":
            if not check_auth(self):
                json_response(self, 401, {"error": "Unauthorized"})
                return
            try:
                json_response(self, 200, {"ok": True, **load_all_config()})
            except Exception as e:
                json_response(self, 500, {"error": str(e)})
            return
        if path == "/plugins":
            if not check_auth(self):
                json_response(self, 401, {"error": "Unauthorized"})
                return
            try:
                json_response(self, 200, {
                    "ok": True,
                    "plugins": list_plugins(),
                    "pluginsDir": PLUGINS_DIR,
                })
            except Exception as e:
                json_response(self, 500, {"error": str(e)})
            return
        if path.startswith("/plugins/"):
            if not check_auth(self):
                json_response(self, 401, {"error": "Unauthorized"})
                return
            name = unquote(path[len("/plugins/"):])
            try:
                plugin = read_plugin_by_name(name)
                json_response(self, 200, {"ok": True, "plugin": plugin})
            except FileNotFoundError:
                json_response(self, 404, {"error": "Plugin not found: " + name})
            except Exception as e:
                json_response(self, 500, {"error": str(e)})
            return
        if path == "/memories":
            if not check_auth(self):
                json_response(self, 401, {"error": "Unauthorized"})
                return
            try:
                json_response(self, 200, {
                    "ok": True,
                    "memories": list_memories(),
                    "memoriesDir": MEMORIES_DIR,
                })
            except Exception as e:
                json_response(self, 500, {"error": str(e)})
            return
        if path.startswith("/memories/"):
            if not check_auth(self):
                json_response(self, 401, {"error": "Unauthorized"})
                return
            name = unquote(path[len("/memories/"):])
            try:
                memory = read_memory_by_name(name)
                json_response(self, 200, {"ok": True, "memory": memory})
            except FileNotFoundError:
                json_response(self, 404, {"error": "Memory not found: " + name})
            except Exception as e:
                json_response(self, 500, {"error": str(e)})
            return
        json_response(self, 404, {"error": "Not found"})

    def do_POST(self):
        path = urlparse(self.path).path

        if path == "/config":
            if not check_auth(self):
                json_response(self, 401, {"error": "Unauthorized"})
                return
            length = int(self.headers.get("Content-Length", 0))
            if length > MAX_BODY:
                json_response(self, 413, {"error": "Body too large"})
                return
            raw = self.rfile.read(length)
            try:
                payload = json.loads(raw.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                json_response(self, 400, {"error": "Invalid JSON"})
                return
            try:
                saved = save_all_config(payload)
                json_response(self, 200, {"ok": True, "saved": saved, "configDir": CONFIG_DIR})
            except Exception as e:
                json_response(self, 500, {"error": str(e)})
            return

        if path == "/plugins":
            if not check_auth(self):
                json_response(self, 401, {"error": "Unauthorized"})
                return
            length = int(self.headers.get("Content-Length", 0))
            if length > MAX_BODY:
                json_response(self, 413, {"error": "Body too large"})
                return
            raw = self.rfile.read(length)
            try:
                payload = json.loads(raw.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                json_response(self, 400, {"error": "Invalid JSON"})
                return
            try:
                plugin = save_plugin(payload)
                json_response(self, 200, {"ok": True, "plugin": plugin})
            except Exception as e:
                json_response(self, 500, {"error": str(e)})
            return

        if path.startswith("/plugins/") and path.endswith("/delete"):
            if not check_auth(self):
                json_response(self, 401, {"error": "Unauthorized"})
                return
            name = unquote(path[len("/plugins/"):-len("/delete")])
            try:
                delete_plugin(name)
                json_response(self, 200, {"ok": True, "deleted": name})
            except FileNotFoundError:
                json_response(self, 404, {"error": "Plugin not found"})
            except Exception as e:
                json_response(self, 500, {"error": str(e)})
            return

        if path == "/memories":
            if not check_auth(self):
                json_response(self, 401, {"error": "Unauthorized"})
                return
            length = int(self.headers.get("Content-Length", 0))
            if length > MAX_BODY:
                json_response(self, 413, {"error": "Body too large"})
                return
            raw = self.rfile.read(length)
            try:
                payload = json.loads(raw.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                json_response(self, 400, {"error": "Invalid JSON"})
                return
            try:
                memory = save_memory(payload)
                json_response(self, 200, {"ok": True, "memory": memory})
            except Exception as e:
                json_response(self, 500, {"error": str(e)})
            return

        if path.startswith("/memories/") and path.endswith("/delete"):
            if not check_auth(self):
                json_response(self, 401, {"error": "Unauthorized"})
                return
            name = unquote(path[len("/memories/"):-len("/delete")])
            try:
                delete_memory(name)
                json_response(self, 200, {"ok": True, "deleted": name})
            except FileNotFoundError:
                json_response(self, 404, {"error": "Memory not found"})
            except Exception as e:
                json_response(self, 500, {"error": str(e)})
            return

        if path != "/action":
            json_response(self, 404, {"error": "Not found"})
            return

        if not check_auth(self):
            json_response(self, 401, {"error": "Unauthorized"})
            return

        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_BODY:
            json_response(self, 413, {"error": "Body too large"})
            return

        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            json_response(self, 400, {"error": "Invalid JSON"})
            return

        action_type = payload.get("type", "")
        try:
            result = dispatch(action_type, payload)
            json_response(self, 200, {"ok": True, "result": result})
        except PermissionError as e:
            json_response(self, 403, {"error": str(e)})
        except FileNotFoundError as e:
            json_response(self, 404, {"error": str(e)})
        except Exception as e:
            json_response(self, 500, {"error": str(e)})


def dispatch(action_type, payload):
    handlers = {
        "read_file": handle_read_file,
        "write_file": handle_write_file,
        "append_file": handle_append_file,
        "delete_file": handle_delete_file,
        "list_dir": handle_list_dir,
        "mkdir": handle_mkdir,
        "run_command": handle_run_command,
        "http_request": handle_http_request,
        "tencent_search": handle_tencent_search,
    }
    fn = handlers.get(action_type)
    if not fn:
        raise ValueError(f"Unknown action type: {action_type}")
    return fn(payload)


def resolve_path(path):
    root = os.path.abspath(ROOT)
    if not path or path == ".":
        return root
    expanded = os.path.expanduser(str(path).replace("/", os.sep))
    if os.path.isabs(expanded):
        resolved = os.path.abspath(expanded)
    else:
        resolved = os.path.abspath(os.path.join(root, expanded))
    if not _is_under_root(resolved, root):
        raise PermissionError(
            f"\u8def\u5f84\u8d85\u51fa\u5de5\u4f5c\u533a\u8303\u56f4: {path} (\u5141\u8bb8\u6839\u76ee\u5f55: {root})"
        )
    return resolved


def _is_under_root(path, root):
    try:
        return os.path.commonpath([os.path.abspath(path), os.path.abspath(root)]) == os.path.abspath(root)
    except ValueError:
        return False


def load_plugin_entry(filename):
    path = os.path.join(PLUGINS_DIR, filename)
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read()
    name = os.path.splitext(filename)[0]
    title = name
    meta_name = None
    meta_title = None
    for line in raw.splitlines()[:20]:
        if line.startswith("@name:"):
            meta_name = line[6:].strip()
        if line.startswith("@title:"):
            meta_title = line[7:].strip()
    if meta_name:
        name = meta_name
    if meta_title:
        title = meta_title
    use_preview = ""
    if "===USE===" in raw:
        use_preview = raw.split("===USE===", 1)[1].strip().split("\n")[0][:120]
    elif raw.strip().split("\n"):
        use_preview = raw.strip().split("\n")[-1][:120]
    return {
        "name": name,
        "filename": filename,
        "title": title,
        "usePreview": use_preview,
        "path": path,
    }


def read_plugin_by_name(name):
    ensure_config_dir()
    candidates = []
    if os.path.isfile(os.path.join(PLUGINS_DIR, name)):
        candidates.append(name)
    if os.path.isfile(os.path.join(PLUGINS_DIR, name + ".txt")):
        candidates.append(name + ".txt")
    for fname in os.listdir(PLUGINS_DIR):
        if fname.endswith(".txt"):
            entry = load_plugin_entry(fname)
            if entry and entry["name"] == name:
                candidates.append(fname)
    if not candidates:
        raise FileNotFoundError(name)
    path = os.path.join(PLUGINS_DIR, candidates[0])
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read()
    entry = load_plugin_entry(candidates[0])
    info = raw
    use = ""
    if "===INFO===" in raw and "===USE===" in raw:
        parts = raw.split("===USE===", 1)
        info = parts[0].split("===INFO===", 1)[-1].strip()
        use = parts[1].strip()
    elif raw.strip().split("\n"):
        lines = raw.strip().split("\n")
        info = "\n".join(lines[:-1]).strip()
        use = lines[-1].strip()
    entry["info"] = info
    entry["use"] = use
    entry["raw"] = raw
    return entry


def list_plugins():
    ensure_config_dir()
    plugins = []
    for fname in sorted(os.listdir(PLUGINS_DIR)):
        if fname.endswith(".txt"):
            entry = load_plugin_entry(fname)
            if entry:
                plugins.append(entry)
    return plugins


def sanitize_plugin_filename(name):
    safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in (name or "").strip())
    return safe or "plugin"


def build_plugin_file_content(payload):
    if payload.get("raw"):
        return payload["raw"]
    name = payload.get("name", "plugin")
    title = payload.get("title") or name
    info = payload.get("info") or ""
    use = payload.get("use") or ""
    lines = [f"@name: {name}", f"@title: {title}", "", "===INFO===", info, "===USE===", use]
    return "\n".join(lines)


def save_plugin(payload):
    ensure_config_dir()
    name = (payload.get("name") or "").strip()
    if not name:
        raise ValueError("name required")
    content = build_plugin_file_content(payload)
    fname = sanitize_plugin_filename(name) + ".txt"
    path = os.path.join(PLUGINS_DIR, fname)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return read_plugin_by_name(name)


def delete_plugin(name):
    ensure_config_dir()
    candidates = []
    if os.path.isfile(os.path.join(PLUGINS_DIR, name)):
        candidates.append(os.path.join(PLUGINS_DIR, name))
    if os.path.isfile(os.path.join(PLUGINS_DIR, name + ".txt")):
        candidates.append(os.path.join(PLUGINS_DIR, name + ".txt"))
    for fname in os.listdir(PLUGINS_DIR):
        if fname.endswith(".txt"):
            entry = load_plugin_entry(fname)
            if entry and entry["name"] == name:
                candidates.append(os.path.join(PLUGINS_DIR, fname))
    if not candidates:
        raise FileNotFoundError(name)
    os.remove(candidates[0])
    return True


def load_memory_entry(filename):
    path = os.path.join(MEMORIES_DIR, filename)
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read()
    name = os.path.splitext(filename)[0]
    title = name
    desc = ""
    meta_name = None
    meta_title = None
    meta_desc = None
    for line in raw.splitlines()[:20]:
        if line.startswith("@name:"):
            meta_name = line[6:].strip()
        if line.startswith("@title:"):
            meta_title = line[7:].strip()
        if line.startswith("@desc:"):
            meta_desc = line[6:].strip()
    if meta_name:
        name = meta_name
    if meta_title:
        title = meta_title
    if meta_desc:
        desc = meta_desc
    content_preview = ""
    if "===CONTENT===" in raw:
        content_preview = raw.split("===CONTENT===", 1)[1].strip().split("\n")[0][:120]
    elif raw.strip().split("\n"):
        content_preview = raw.strip().split("\n")[-1][:120]
    return {
        "name": name,
        "filename": filename,
        "title": title,
        "desc": desc,
        "contentPreview": content_preview,
        "path": path,
    }


def read_memory_by_name(name):
    ensure_config_dir()
    candidates = []
    if os.path.isfile(os.path.join(MEMORIES_DIR, name)):
        candidates.append(name)
    if os.path.isfile(os.path.join(MEMORIES_DIR, name + ".txt")):
        candidates.append(name + ".txt")
    for fname in os.listdir(MEMORIES_DIR):
        if fname.endswith(".txt"):
            entry = load_memory_entry(fname)
            if entry and entry["name"] == name:
                candidates.append(fname)
    if not candidates:
        raise FileNotFoundError(name)
    path = os.path.join(MEMORIES_DIR, candidates[0])
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read()
    entry = load_memory_entry(candidates[0])
    content = raw
    if "===CONTENT===" in raw:
        content = raw.split("===CONTENT===", 1)[1].strip()
    entry["content"] = content
    entry["raw"] = raw
    return entry


def list_memories():
    ensure_config_dir()
    memories = []
    for fname in sorted(os.listdir(MEMORIES_DIR)):
        if fname.endswith(".txt"):
            entry = load_memory_entry(fname)
            if entry:
                memories.append(entry)
    return memories


def sanitize_memory_filename(name):
    safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in (name or "").strip())
    return safe or "memory"


def build_memory_file_content(payload):
    if payload.get("raw"):
        return payload["raw"]
    name = payload.get("name", "memory")
    title = payload.get("title") or name
    desc = payload.get("desc") or ""
    content = payload.get("content") or ""
    lines = [f"@name: {name}", f"@title: {title}", f"@desc: {desc}", "", "===CONTENT===", content]
    return "\n".join(lines)


def save_memory(payload):
    ensure_config_dir()
    name = (payload.get("name") or "").strip()
    if not name:
        raise ValueError("name required")
    content = build_memory_file_content(payload)
    fname = sanitize_memory_filename(name) + ".txt"
    path = os.path.join(MEMORIES_DIR, fname)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return read_memory_by_name(name)


def delete_memory(name):
    ensure_config_dir()
    candidates = []
    if os.path.isfile(os.path.join(MEMORIES_DIR, name)):
        candidates.append(os.path.join(MEMORIES_DIR, name))
    if os.path.isfile(os.path.join(MEMORIES_DIR, name + ".txt")):
        candidates.append(os.path.join(MEMORIES_DIR, name + ".txt"))
    for fname in os.listdir(MEMORIES_DIR):
        if fname.endswith(".txt"):
            entry = load_memory_entry(fname)
            if entry and entry["name"] == name:
                candidates.append(os.path.join(MEMORIES_DIR, fname))
    if not candidates:
        raise FileNotFoundError(name)
    os.remove(candidates[0])
    return True


def handle_read_file(p):
    path = resolve_path(p.get("path"))
    if not os.path.isfile(path):
        raise FileNotFoundError(path)
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
    return {"path": path, "content": content, "size": len(content)}


def handle_write_file(p):
    path = resolve_path(p.get("path"))
    content = p.get("content", "")
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return {"path": path, "written": len(content)}


def handle_append_file(p):
    path = resolve_path(p.get("path"))
    content = p.get("content", "")
    with open(path, "a", encoding="utf-8") as f:
        f.write(content)
    return {"path": path, "appended": len(content)}


def handle_delete_file(p):
    path = resolve_path(p.get("path"))
    if os.path.isfile(path):
        os.remove(path)
    elif os.path.isdir(path):
        os.rmdir(path)
    else:
        raise FileNotFoundError(path)
    return {"path": path, "deleted": True}


def handle_list_dir(p):
    path = resolve_path(p.get("path", "."))
    if not os.path.isdir(path):
        raise FileNotFoundError(path)
    entries = []
    for name in sorted(os.listdir(path)):
        full = os.path.join(path, name)
        entries.append({
            "name": name,
            "type": "dir" if os.path.isdir(full) else "file",
            "size": os.path.getsize(full) if os.path.isfile(full) else None,
        })
    return {"path": path, "entries": entries}


def handle_mkdir(p):
    path = resolve_path(p.get("path"))
    os.makedirs(path, exist_ok=True)
    return {"path": path, "created": True}


def handle_run_command(p):
    cmd = p.get("command", "")
    if not cmd:
        raise ValueError("command is required")
    cwd = p.get("cwd")
    if cwd:
        cwd = resolve_path(cwd)
    timeout = min(int(p.get("timeout", 30)), 120)
    proc = subprocess.run(
        cmd,
        shell=True,
        capture_output=True,
        text=True,
        cwd=cwd,
        timeout=timeout,
        encoding="utf-8",
        errors="replace",
    )
    return {
        "command": cmd,
        "exit_code": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
    }


def handle_http_request(p):
    import urllib.request
    url = p.get("url", "")
    method = p.get("method", "GET").upper()
    headers = p.get("headers") or {}
    body = p.get("body")
    req = urllib.request.Request(url, data=body.encode("utf-8") if body else None, method=method)
    for k, v in headers.items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read().decode("utf-8", errors="replace")
        return {"status": resp.status, "body": data[:50000]}


# ===== Tencent Cloud TC3-HMAC-SHA256 =====
def _tc3_sign(secret_key, date, service, string_to_sign):
    def hmac_sha256(key, msg):
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()
    secret_date = hmac_sha256(("TC3" + secret_key).encode("utf-8"), date)
    secret_service = hmac_sha256(secret_date, service)
    secret_signing = hmac_sha256(secret_service, "tc3_request")
    return hmac.new(secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()


def handle_tencent_search(p):
    import json as _json, time, datetime
    cred_path = os.path.join(CONFIG_DIR, "tencent-credentials.json")
    if not os.path.isfile(cred_path):
        raise FileNotFoundError("请先在 config/tencent-credentials.json 中配置 secret_id 和 secret_key")
    with open(cred_path, "r", encoding="utf-8") as f:
        cred = _json.load(f)
    secret_id = (cred.get("secret_id") or "").strip()
    secret_key = (cred.get("secret_key") or "").strip()
    if not secret_id or not secret_key:
        raise ValueError("tencent-credentials.json 中的 secret_id 或 secret_key 为空，请填写")

    query = p.get("query") or p.get("q") or ""
    if not query:
        raise ValueError("query / q 参数必填")

    service = "wsa"
    host = "wsa.tencentcloudapi.com"
    endpoint = "https://" + host
    action = "SearchPro"
    version = "2025-05-08"
    algorithm = "TC3-HMAC-SHA256"
    timestamp = int(time.time())
    date = datetime.datetime.utcfromtimestamp(timestamp).strftime("%Y-%m-%d")

    body_dict = {"Query": query}
    mode = p.get("mode")
    if mode is not None:
        body_dict["Mode"] = int(mode)
    site = p.get("site")
    if site:
        body_dict["Site"] = site
    cnt = p.get("cnt")
    if cnt is not None:
        body_dict["Cnt"] = int(cnt)
    industry = p.get("industry")
    if industry:
        body_dict["Industry"] = industry
    from_time = p.get("from_time")
    if from_time is not None:
        body_dict["FromTime"] = int(from_time)
    to_time = p.get("to_time")
    if to_time is not None:
        body_dict["ToTime"] = int(to_time)

    payload = _json.dumps(body_dict, ensure_ascii=False)

    http_method = "POST"
    canonical_uri = "/"
    canonical_qs = ""
    ct = "application/json; charset=utf-8"
    canonical_headers = "content-type:%s\nhost:%s\nx-tc-action:%s\n" % (ct, host, action.lower())
    signed_headers = "content-type;host;x-tc-action"
    hashed_payload = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    canonical_request = "%s\n%s\n%s\n%s\n%s\n%s" % (
        http_method, canonical_uri, canonical_qs,
        canonical_headers, signed_headers, hashed_payload
    )

    credential_scope = date + "/" + service + "/" + "tc3_request"
    hashed_canonical = hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
    string_to_sign = "%s\n%s\n%s\n%s" % (algorithm, timestamp, credential_scope, hashed_canonical)

    signature = _tc3_sign(secret_key, date, service, string_to_sign)
    authorization = (algorithm + " " +
                     "Credential=" + secret_id + "/" + credential_scope + ", " +
                     "SignedHeaders=" + signed_headers + ", " +
                     "Signature=" + signature)

    import urllib.request
    req = urllib.request.Request(endpoint, data=payload.encode("utf-8"), method="POST")
    req.add_header("Authorization", authorization)
    req.add_header("Content-Type", ct)
    req.add_header("Host", host)
    req.add_header("X-TC-Action", action)
    req.add_header("X-TC-Timestamp", str(timestamp))
    req.add_header("X-TC-Version", version)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError("腾讯云搜索 API 请求失败 (HTTP %d): %s" % (e.code, err_body))
    except urllib.error.URLError as e:
        raise RuntimeError("腾讯云搜索 API 网络错误: %s" % str(e.reason))

    result = _json.loads(raw)
    response = result.get("Response", {})

    if "Error" in response:
        err = response["Error"]
        raise RuntimeError("腾讯云搜索错误 [%s]: %s" % (err.get("Code"), err.get("Message")))

    pages_raw = response.get("Pages", [])
    pages = []
    for item in pages_raw:
        if isinstance(item, str):
            try:
                pages.append(_json.loads(item))
            except _json.JSONDecodeError:
                pages.append({"raw": item})
        else:
            pages.append(item)

    return {
        "query": response.get("Query"),
        "version": response.get("Version"),
        "results": pages,
        "request_id": response.get("RequestId"),
        "result_count": len(pages),
    }


def main():
    global PORT, TOKEN, ROOT
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--port" and i + 1 < len(args):
            PORT = int(args[i + 1])
            i += 2
        elif args[i] == "--token" and i + 1 < len(args):
            TOKEN = args[i + 1]
            i += 2
        elif args[i] == "--root" and i + 1 < len(args):
            ROOT = os.path.abspath(args[i + 1])
            i += 2
        else:
            i += 1

    # 将 token 写入配置文件，供前端读取
    write_token_to_config(TOKEN)

    server = HTTPServer((HOST, PORT), Handler)
    print(f"LLM Action Agent backend running at http://{HOST}:{PORT}")
    print(f"Root:  {ROOT}")
    print(f"Config: {CONFIG_DIR}")
    if TOKEN == _DEFAULT_TOKEN:
        print(f"\U0001f511 Token（本次有效，重启变化）: {TOKEN}")
        print("   可通过环境变量 ACTION_AGENT_TOKEN 固定此 Token")
    else:
        print(f"Token: {TOKEN}")
    print("Press Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()