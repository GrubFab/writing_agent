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


class ApplyRequest(BaseModel):
    vault_path: str
    chapter_num: int
    title: str
    status: str = "draft"
    data: dict


class ProjectSwitchRequest(BaseModel):
    project_id: str


class NewProjectRequest(BaseModel):
    name: str
    vault_path: Optional[str] = None
    premise: Optional[str] = None
    init_git: bool = True


# ---------------------------------------------------------------------------
# Project Management Storage
# ---------------------------------------------------------------------------

CONFIG_DIR = Path.home() / ".writing_agent"
PROJECTS_FILE = CONFIG_DIR / "projects.json"
DEFAULT_PARENT_DIR = r"C:\Users\FSGee\Nextcloud\book"


def get_projects_data() -> dict:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if not PROJECTS_FILE.exists():
        initial = {
            "active_id": "cold",
            "projects": [
                {
                    "id": "cold",
                    "name": "Cold",
                    "path": str(Path(DEFAULT_VAULT).resolve()),
                    "created_at": datetime.now().isoformat(),
                    "last_opened": datetime.now().isoformat(),
                }
            ],
        }
        PROJECTS_FILE.write_text(json.dumps(initial, indent=2), encoding="utf-8")
        return initial

    try:
        data = json.loads(PROJECTS_FILE.read_text(encoding="utf-8"))
        if not data.get("projects"):
            data["projects"] = [{
                "id": "cold",
                "name": "Cold",
                "path": str(Path(DEFAULT_VAULT).resolve()),
                "created_at": datetime.now().isoformat(),
                "last_opened": datetime.now().isoformat(),
            }]
            data["active_id"] = "cold"
        return data
    except Exception:
        return {
            "active_id": "cold",
            "projects": [
                {
                    "id": "cold",
                    "name": "Cold",
                    "path": str(Path(DEFAULT_VAULT).resolve()),
                    "created_at": datetime.now().isoformat(),
                    "last_opened": datetime.now().isoformat(),
                }
            ],
        }


def save_projects_data(data: dict):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    PROJECTS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def get_active_project() -> dict:
    data = get_projects_data()
    active_id = data.get("active_id")
    for p in data.get("projects", []):
        if p.get("id") == active_id:
            return p
    if data.get("projects"):
        return data["projects"][0]
    return {
        "id": "default",
        "name": "My Novel",
        "path": DEFAULT_VAULT,
    }


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/config")
def get_config():
    """Return initial app configuration and active project."""
    active = get_active_project()
    return {
        "default_vault": active.get("path", DEFAULT_VAULT),
        "active_project": active,
        "default_base_url": DEFAULT_BASE_URL,
        "default_parent_dir": DEFAULT_PARENT_DIR,
    }


@app.get("/api/projects")
def list_projects():
    """List all registered novel projects."""
    data = get_projects_data()
    active = get_active_project()
    return {
        "active_id": active.get("id"),
        "active_project": active,
        "default_parent_dir": DEFAULT_PARENT_DIR,
        "projects": data.get("projects", []),
    }


@app.post("/api/projects/switch")
def switch_project(req: ProjectSwitchRequest):
    """Switch active working novel project."""
    data = get_projects_data()
    target = None
    for p in data.get("projects", []):
        if p.get("id") == req.project_id:
            target = p
            p["last_opened"] = datetime.now().isoformat()
            break

    if not target:
        raise HTTPException(status_code=404, detail="Project not found")

    data["active_id"] = req.project_id
    save_projects_data(data)
    return {"status": "ok", "active_project": target, "projects": data.get("projects", [])}


@app.post("/api/projects/new")
def create_new_project(req: NewProjectRequest):
    """Create a new novel project, scaffold vault, and init git automatically."""
    clean_name = req.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Project name is required")

    # Determine vault directory
    if req.vault_path and req.vault_path.strip():
        vault_dir = Path(req.vault_path.strip()).expanduser().resolve()
    else:
        # Default into Nextcloud book directory
        folder_slug = wa.slugify(clean_name)
        vault_dir = (Path(DEFAULT_PARENT_DIR) / clean_name / "vault" / f"{folder_slug}_vault").resolve()

    # 1. Scaffold vault structure
    wa.init_vault(vault_dir)

    # 2. If premise provided, save it to 00_Bible/premise.md
    if req.premise and req.premise.strip():
        premise_file = vault_dir / "00_Bible" / "premise.md"
        premise_file.write_text(f"# Premise\n\n{req.premise.strip()}\n", encoding="utf-8")

    # 3. Automatic Git Init
    if req.init_git and not (vault_dir / ".git").exists():
        try:
            subprocess.run(["git", "init"], cwd=vault_dir, check=True, capture_output=True)
            subprocess.run(["git", "add", "-A"], cwd=vault_dir, check=True, capture_output=True)
            subprocess.run(["git", "commit", "-m", f"Initial vault for {clean_name}"], cwd=vault_dir, check=True, capture_output=True)
        except Exception as e:
            print(f"Warning: git init had issue: {e}")

    # 4. Save to projects registry
    data = get_projects_data()
    project_id = wa.slugify(clean_name).lower()
    # Check for uniqueness
    existing_ids = {p.get("id") for p in data.get("projects", [])}
    unique_id = project_id
    counter = 1
    while unique_id in existing_ids:
        counter += 1
        unique_id = f"{project_id}_{counter}"

    new_proj = {
        "id": unique_id,
        "name": clean_name,
        "path": str(vault_dir),
        "created_at": datetime.now().isoformat(),
        "last_opened": datetime.now().isoformat(),
    }

    data["projects"].append(new_proj)
    data["active_id"] = unique_id
    save_projects_data(data)

    return {
        "status": "ok",
        "message": f"Project '{clean_name}' created and initialized at {vault_dir}",
        "project": new_proj,
        "projects": data["projects"],
    }


@app.delete("/api/projects/{project_id}")
def remove_project(project_id: str):
    """Remove project from registry (does not delete vault files on disk)."""
    data = get_projects_data()
    projects = [p for p in data.get("projects", []) if p.get("id") != project_id]
    if len(projects) == len(data.get("projects", [])):
        raise HTTPException(status_code=404, detail="Project not found")

    data["projects"] = projects
    if data.get("active_id") == project_id and projects:
        data["active_id"] = projects[0]["id"]

    save_projects_data(data)
    return {"status": "ok", "projects": data["projects"]}


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


@app.get("/api/chapter/check")
def check_chapter_status(vault_path: str = DEFAULT_VAULT, chapter_num: int = 1):
    """Check if a chapter already exists in the vault."""
    v_path = Path(vault_path).expanduser().resolve()
    exists = wa.chapter_exists(v_path, chapter_num)
    return {"exists": exists, "chapter_num": chapter_num}


@app.post("/api/apply")
def apply_chapter_to_vault(req: ApplyRequest):
    """Applies reviewed and approved chapter data to the vault and commits to Git."""
    v_path = Path(req.vault_path).expanduser().resolve()
    if not v_path.exists():
        raise HTTPException(status_code=404, detail=f"Vault path does not exist: {v_path}")

    try:
        res = wa.apply_chapter_data(
            vault_path=v_path,
            chapter_num=req.chapter_num,
            title=req.title,
            status=req.status,
            data=req.data,
        )
        return {
            "status": "ok",
            "message": f"Chapter {req.chapter_num} ('{req.title}') applied to vault and committed to Git!",
            "details": res,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/process")
async def process_chapter_stream(req: ProcessRequest):
    """Stream progress of chapter analysis via Server-Sent Events (does NOT write vault files until approved)."""
    async def event_generator() -> AsyncGenerator[str, None]:
        # 1. Validation
        yield json.dumps({
            "step": "validate",
            "progress": 15,
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

        already_exists = wa.chapter_exists(v_path, req.chapter_num)

        # 2. Context Gathering
        yield json.dumps({
            "step": "context",
            "progress": 35,
            "message": "Gathering context from 00_Bible, Characters, Timeline, Threads...",
        })
        await asyncio.sleep(0.1)

        context = wa.gather_context(v_path)

        # 3. Model Invocation
        yield json.dumps({
            "step": "llm_start",
            "progress": 55,
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
            "progress": 85,
            "message": "Structured story data & editorial propositions extracted successfully.",
            "data": data,
        })
        await asyncio.sleep(0.1)

        # 4. Ready for author review (vault files remain untouched until author approves)
        yield json.dumps({
            "step": "ready_for_review",
            "progress": 100,
            "message": f"Draft analysis complete for Chapter {req.chapter_num}! Review remarks below and approve when ready.",
            "already_exists": already_exists,
            "staged_data": {
                "vault_path": str(v_path),
                "chapter_num": req.chapter_num,
                "title": req.title,
                "status": req.status or "draft",
                "data": data,
            },
            "result": {
                "summary": data.get("summary", ""),
                "pov": data.get("pov_character", "unclear"),
                "characters": data.get("characters", []),
                "timeline_events": data.get("timeline_events", []),
                "threads": data.get("threads", []),
                "continuity_flags": data.get("continuity_flags", []),
                "editorial_suggestions": data.get("editorial_suggestions", {}),
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
