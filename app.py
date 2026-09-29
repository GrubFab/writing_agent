"""
Writing Agent Web Application & Visual Dashboard

Provides a local web interface with live step-by-step visual streaming,
model auto-detection from LM Studio, vault inspection, and draft editing.
"""

import argparse
import asyncio
import json
import os
import subprocess
import sys
import webbrowser
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator, Optional

import requests
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

import writing_agent as wa

app = FastAPI(title="Writing Agent Dashboard", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DEFAULT_VAULT = os.environ.get(
    "WRITING_AGENT_VAULT",
    r"C:\Users\FSGee\Nextcloud\book\Cold\vault\MyNovelVault"
)
DEFAULT_BASE_URL = os.environ.get(
    "LM_STUDIO_BASE_URL",
    "http://localhost:1234/v1"
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class VaultInitRequest(BaseModel):
    vault_path: str
    init_git: bool = True


class ProcessRequest(BaseModel):
    vault_path: str
    chapter_num: int
    title: str
    status: str = "draft"
    model: str
    base_url: str = DEFAULT_BASE_URL
    draft_text: Optional[str] = None
    draft_file: Optional[str] = None


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/config")
def get_config():
    """Return initial app configuration and defaults."""
    return {
        "default_vault": DEFAULT_VAULT,
        "default_base_url": DEFAULT_BASE_URL,
    }


@app.get("/api/models")
def list_models(base_url: str = DEFAULT_BASE_URL):
    """Fetch loaded models from LM Studio."""
    clean_url = base_url.rstrip("/")
    try:
        resp = requests.get(f"{clean_url}/models", timeout=3)
        resp.raise_for_status()
        data = resp.json()
        models = [m["id"] for m in data.get("data", [])]
        return {"online": True, "models": models}
    except requests.exceptions.RequestException:
        return {
            "online": False,
            "models": [],
            "error": f"Cannot connect to LM Studio at {clean_url}. Is the server running?",
        }


@app.get("/api/vault")
def inspect_vault(vault_path: str = DEFAULT_VAULT):
    """Inspect and return the contents of an Obsidian vault."""
    v_path = Path(vault_path).expanduser().resolve()
    if not v_path.exists():
        return {
            "exists": False,
            "path": str(v_path),
            "message": "Vault directory does not exist on disk."
        }

    is_git = (v_path / ".git").exists()

    # Bible files
    bible_dir = v_path / "00_Bible"
    bible_files = []
    if bible_dir.exists():
        for f in sorted(bible_dir.glob("*.md")):
            bible_files.append({
                "name": f.name,
                "title": f.stem.replace("_", " ").title(),
                "content": f.read_text(encoding="utf-8"),
            })

    # Characters
    chars_dir = v_path / "Characters"
    characters = []
    if chars_dir.exists():
        for f in sorted(chars_dir.glob("*.md")):
            text = f.read_text(encoding="utf-8")
            overview = text.split(wa.AUTO_MARK_START)[0].strip() if wa.AUTO_MARK_START in text else text
            updates = ""
            if wa.AUTO_MARK_START in text and wa.AUTO_MARK_END in text:
                updates = text.split(wa.AUTO_MARK_START, 1)[1].split(wa.AUTO_MARK_END, 1)[0].strip()
            characters.append({
                "name": f.stem,
                "filename": f.name,
                "overview": overview[:500],
                "updates": updates,
            })

    # Timeline
    timeline_file = v_path / "Timeline" / "timeline.md"
    timeline_rows = []
    if timeline_file.exists():
        lines = timeline_file.read_text(encoding="utf-8").splitlines()
        for line in lines:
            line_str = line.strip()
            if line_str.startswith("|") and not line_str.startswith("|---") and not "Order / Date" in line_str:
                parts = [p.strip() for p in line_str.strip("|").split("|")]
                if len(parts) >= 3 and parts[0]:
                    timeline_rows.append({
                        "order": parts[0],
                        "event": parts[1] if len(parts) > 1 else "",
                        "characters": parts[2] if len(parts) > 2 else "",
                        "chapter": parts[3] if len(parts) > 3 else "",
                    })

    # Threads
    threads_file = v_path / "Threads" / "threads.md"
    threads_rows = []
    if threads_file.exists():
        lines = threads_file.read_text(encoding="utf-8").splitlines()
        for line in lines:
            line_str = line.strip()
            if line_str.startswith("|") and not line_str.startswith("|---") and not "Status" in line_str:
                parts = [p.strip() for p in line_str.strip("|").split("|")]
                if len(parts) >= 3 and parts[0]:
                    threads_rows.append({
                        "name": parts[0],
                        "status": parts[1] if len(parts) > 1 else "",
                        "note": parts[2] if len(parts) > 2 else "",
                        "chapter": parts[3] if len(parts) > 3 else "",
                    })

    # Chapters
    chapters_dir = v_path / "Chapters"
    chapters = []
    if chapters_dir.exists():
        for f in sorted(chapters_dir.glob("*.md")):
            chapters.append({
                "name": f.name,
                "content": f.read_text(encoding="utf-8"),
            })

    # Logs
    log_dir = v_path / "Log"
    logs = []
    if log_dir.exists():
        for f in sorted(log_dir.glob("*.md"), reverse=True)[:5]:
            logs.append({
                "date": f.stem,
                "content": f.read_text(encoding="utf-8"),
            })

    return {
        "exists": True,
        "path": str(v_path),
        "is_git": is_git,
        "stats": {
            "bible_count": len(bible_files),
            "characters_count": len(characters),
            "timeline_count": len(timeline_rows),
            "threads_count": len(threads_rows),
            "chapters_count": len(chapters),
        },
        "bible": bible_files,
        "characters": characters,
        "timeline": timeline_rows,
        "threads": threads_rows,
        "chapters": chapters,
        "recent_logs": logs,
    }


@app.post("/api/vault/init")
def initialize_vault(req: VaultInitRequest):
    """Scaffold a new or existing vault directory."""
    v_path = Path(req.vault_path).expanduser().resolve()
    wa.init_vault(v_path)
    if req.init_git and not (v_path / ".git").exists():
        try:
            subprocess.run(["git", "init"], cwd=v_path, check=True, capture_output=True)
            subprocess.run(["git", "add", "-A"], cwd=v_path, check=True, capture_output=True)
            subprocess.run(["git", "commit", "-m", "Initial vault"], cwd=v_path, check=True, capture_output=True)
        except Exception as e:
            return {"status": "ok", "message": f"Vault scaffolded, but git init had warning: {e}"}

    return {"status": "ok", "message": f"Vault scaffolded successfully at {v_path}"}


@app.post("/api/process")
async def process_chapter_stream(req: ProcessRequest):
    """Stream progress of chapter processing via Server-Sent Events."""
    async def event_generator() -> AsyncGenerator[str, None]:
        # 1. Validation
        yield json.dumps({
            "step": "validate",
            "progress": 10,
            "message": "Validating vault path and draft text...",
        })
        await asyncio.sleep(0.1)

        v_path = Path(req.vault_path).expanduser().resolve()
        if not v_path.exists():
            yield json.dumps({"step": "error", "error": f"Vault directory does not exist: {v_path}"})
            return

        # Chapter text resolution
        if req.draft_text and req.draft_text.strip():
            chapter_text = req.draft_text.strip()
        elif req.draft_file:
            f_path = Path(req.draft_file).expanduser().resolve()
            if not f_path.exists():
                yield json.dumps({"step": "error", "error": f"Draft file not found: {f_path}"})
                return
            chapter_text = f_path.read_text(encoding="utf-8")
        else:
            yield json.dumps({"step": "error", "error": "No draft content provided. Either paste text or select a file."})
            return

        # 2. Context Gathering
        yield json.dumps({
            "step": "context",
            "progress": 25,
            "message": "Gathering context from 00_Bible, Characters, Timeline, Threads...",
        })
        await asyncio.sleep(0.1)

        context = wa.gather_context(v_path)

        # 3. Model Invocation
        yield json.dumps({
            "step": "llm_start",
            "progress": 40,
            "message": f"Sending context and draft to LM Studio model '{req.model}'...",
        })
        await asyncio.sleep(0.1)

        try:
            loop = asyncio.get_event_loop()
            data = await loop.run_in_executor(
                None,
                wa.call_llm,
                req.base_url.rstrip("/"),
                req.model,
                context,
                chapter_text,
            )
        except Exception as e:
            yield json.dumps({"step": "error", "error": f"Model inference failed: {str(e)}"})
            return

        yield json.dumps({
            "step": "llm_done",
            "progress": 65,
            "message": "Structured story data extracted successfully.",
            "data": data,
        })
        await asyncio.sleep(0.1)

        # 4. Write Chapter Note
        yield json.dumps({
            "step": "saving_chapter",
            "progress": 75,
            "message": f"Writing Chapters/Chapter_{int(req.chapter_num):02d}.md...",
        })
        ch_note_path = wa.write_chapter_note(
            v_path,
            req.chapter_num,
            req.title,
            data.get("pov_character", "unclear"),
            req.status or "draft",
            data["summary"],
        )

        # 5. Characters
        chars_updated = []
        for c in data.get("characters", []):
            wa.update_character(v_path, c["name"], c.get("is_new", False), c["update"], req.chapter_num)
            chars_updated.append(c["name"])

        yield json.dumps({
            "step": "updating_characters",
            "progress": 82,
            "message": f"Updated {len(chars_updated)} character dossiers ({', '.join(chars_updated)}).",
            "characters": chars_updated,
        })

        # 6. Timeline
        if data.get("timeline_events"):
            wa.append_timeline_events(v_path, data["timeline_events"], req.chapter_num)
        yield json.dumps({
            "step": "updating_timeline",
            "progress": 88,
            "message": f"Appended {len(data.get('timeline_events', []))} timeline event(s).",
        })

        # 7. Threads
        if data.get("threads"):
            wa.update_threads(v_path, data["threads"], req.chapter_num)
        yield json.dumps({
            "step": "updating_threads",
            "progress": 92,
            "message": f"Updated {len(data.get('threads', []))} plot thread(s).",
        })

        # 8. Log and Git
        wa.append_log(v_path, req.chapter_num, req.title, data)
        wa.git_commit(v_path, f"Chapter {req.chapter_num}: {req.title}")

        yield json.dumps({
            "step": "complete",
            "progress": 100,
            "message": f"Chapter {req.chapter_num} processed and committed to Git!",
            "result": {
                "summary": data["summary"],
                "pov": data.get("pov_character", "unclear"),
                "characters": data.get("characters", []),
                "timeline_events": data.get("timeline_events", []),
                "threads": data.get("threads", []),
                "continuity_flags": data.get("continuity_flags", []),
            },
        })

    return EventSourceResponse(event_generator())


# ---------------------------------------------------------------------------
# Mount Static Frontend
# ---------------------------------------------------------------------------

if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
else:
    @app.get("/")
    def index():
        return HTMLResponse("<h1>Writing Agent</h1><p>Static files missing.</p>")


# ---------------------------------------------------------------------------
# Runner Helper
# ---------------------------------------------------------------------------

def launch_app(host="127.0.0.1", port=8000, window=True, open_browser=True):
    url = f"http://{host}:{port}"
    print(f"\n=======================================================")
    print(f" Writing Agent Dashboard running at: {url}")
    print(f"=======================================================\n")

    if open_browser:
        if window and sys.platform == "win32":
            edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
            if Path(edge_path).exists():
                try:
                    subprocess.Popen([edge_path, f"--app={url}"])
                except Exception:
                    webbrowser.open(url)
            else:
                webbrowser.open(url)
        else:
            webbrowser.open(url)

    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Writing Agent Visual Dashboard")
    parser.add_argument("--host", default="127.0.0.1", help="Host address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Port (default: 8000)")
    parser.add_argument("--no-browser", action="store_true", help="Do not open browser automatically")
    parser.add_argument("--no-window", action="store_true", help="Open regular browser instead of app window")
    args = parser.parse_args()

    launch_app(
        host=args.host,
        port=args.port,
        window=not args.no_window,
        open_browser=not args.no_browser,
    )
