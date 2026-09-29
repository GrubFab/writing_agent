#!/usr/bin/env python3
"""
Writing Agent — keeps an Obsidian-style novel vault in sync as you write.

Talks to a local LM Studio server (OpenAI-compatible API) to extract
structured story data from a chapter draft, then merges it into:

    00_Bible/       (untouched by the agent — you write this by hand)
    Characters/     (agent appends to an "Auto-updates" section per character)
    Chapters/       (agent creates/overwrites the chapter's own note)
    Timeline/       (agent appends rows to timeline.md)
    Threads/        (agent updates a table in threads.md)
    Log/            (agent appends a dated entry describing what it did)

Usage:
    python writing_agent.py init /path/to/MyNovelVault
    python writing_agent.py process /path/to/MyNovelVault /path/to/chapter_draft.txt \
        --chapter 12 --title "The Long Road" --model your-model-name

Safety:
    This script does NOT ask for confirmation before writing files. Instead,
    run `git init` once inside your vault. The agent will auto-commit after
    each run (if the vault is a git repo), so every change is diffable and
    revertible with normal git commands (`git log`, `git diff`, `git revert`).
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import requests

DEFAULT_BASE_URL = "http://localhost:1234/v1"
AUTO_MARK_START = "<!-- AGENT:AUTO-UPDATES:START -->"
AUTO_MARK_END = "<!-- AGENT:AUTO-UPDATES:END -->"

SYSTEM_PROMPT = """You are a meticulous story-bible assistant for a novelist.
You will be given: (1) compact context about existing characters, open plot
threads, and recent timeline events, and (2) the full text of a new chapter
draft. Extract structured data about what happens in this chapter.

Respond with ONLY a single JSON object, no markdown fences, no commentary,
matching exactly this schema:

{
  "summary": "3-6 sentence summary of the chapter",
  "pov_character": "name or 'unclear'",
  "characters": [
    {"name": "string", "is_new": true/false, "update": "1-3 sentences: what we learn or what changes for this character in this chapter"}
  ],
  "timeline_events": [
    {"order_or_date": "string (in-story date if known, else 'Chapter N')", "event": "short description", "characters_involved": ["name", "..."]}
  ],
  "threads": [
    {"name": "short thread name, consistent with prior naming if this thread already exists", "status": "opened|advanced|closed", "note": "1-2 sentences"}
  ],
  "continuity_flags": ["any inconsistency, contradiction, or question the author should check"]
}

Only include characters/threads that are actually relevant to THIS chapter.
Do not invent facts not present in the chapter text or the provided context.
If nothing applies to a list, return an empty list."""


# ---------------------------------------------------------------------------
# Vault scaffolding
# ---------------------------------------------------------------------------

FOLDERS = ["00_Bible", "Characters", "Chapters", "Timeline", "Threads", "Log"]

STARTER_FILES = {
    "00_Bible/premise.md": "# Premise\n\n(Write your one-paragraph premise here.)\n",
    "00_Bible/themes.md": "# Themes\n\n- \n",
    "00_Bible/style_guide.md": "# Style guide\n\n- POV: \n- Tense: \n- Tone: \n",
    "00_Bible/world_rules.md": "# World rules\n\n- \n",
    "Timeline/timeline.md": "# Timeline\n\n| Order / Date | Event | Characters | Chapter |\n|---|---|---|---|\n",
    "Threads/threads.md": "# Threads\n\n| Thread | Status | Last update | Chapter |\n|---|---|---|---|\n",
}


def init_vault(vault_path: Path):
    for folder in FOLDERS:
        (vault_path / folder).mkdir(parents=True, exist_ok=True)
    for rel_path, content in STARTER_FILES.items():
        full = vault_path / rel_path
        if not full.exists():
            full.write_text(content, encoding="utf-8")
    print(f"Vault scaffolded at {vault_path}")
    if not (vault_path / ".git").exists():
        print("Tip: run `git init` inside this folder so the agent's changes are diffable/revertible.")


# ---------------------------------------------------------------------------
# Context gathering (kept compact — this is not a RAG system, just summaries)
# ---------------------------------------------------------------------------

def gather_context(vault_path: Path, max_chars_per_section=4000) -> str:
    parts = []

    bible_dir = vault_path / "00_Bible"
    if bible_dir.exists():
        bible_text = "\n\n".join(
            f"## {f.stem}\n{f.read_text(encoding='utf-8')}" for f in sorted(bible_dir.glob("*.md"))
        )
        parts.append("### BIBLE\n" + bible_text[:max_chars_per_section])

    chars_dir = vault_path / "Characters"
    if chars_dir.exists():
        char_summaries = []
        for f in sorted(chars_dir.glob("*.md")):
            text = f.read_text(encoding="utf-8")
            overview = text.split(AUTO_MARK_START)[0]
            char_summaries.append(f"- {f.stem}: {overview.strip()[:300]}")
        if char_summaries:
            parts.append("### KNOWN CHARACTERS (name: short overview)\n" + "\n".join(char_summaries)[:max_chars_per_section])

    threads_file = vault_path / "Threads" / "threads.md"
    if threads_file.exists():
        parts.append("### OPEN THREADS\n" + threads_file.read_text(encoding="utf-8")[-max_chars_per_section:])

    timeline_file = vault_path / "Timeline" / "timeline.md"
    if timeline_file.exists():
        parts.append("### RECENT TIMELINE (tail)\n" + timeline_file.read_text(encoding="utf-8")[-max_chars_per_section:])

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# LLM call
# ---------------------------------------------------------------------------

def extract_json(raw: str) -> dict:
    if not raw or not raw.strip():
        raise ValueError("Model returned an empty response. Check if max_tokens was reached or if the model supports the prompt.")

    # Remove <think>...</think> tags if reasoning model used them
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", raw).strip()
    if not cleaned:
        cleaned = raw.strip()

    # Try 1: direct parse
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Try 2: extract from markdown ```json ... ``` code blocks
    markdown_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
    if markdown_match:
        try:
            return json.loads(markdown_match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Try 3: find outermost { ... }
    first_brace = cleaned.find("{")
    last_brace = cleaned.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        json_candidate = cleaned[first_brace : last_brace + 1]
        try:
            return json.loads(json_candidate)
        except json.JSONDecodeError:
            pass

    # Fallback log and error
    print("--- RAW MODEL OUTPUT (could not parse as JSON) ---")
    print(raw)
    raise ValueError(f"Failed to parse model output as JSON. Output was:\n{raw[:400]}")


def call_llm(base_url: str, model: str, context: str, chapter_text: str) -> dict:
    user_content = f"CONTEXT:\n{context}\n\n---\n\nNEW CHAPTER DRAFT:\n{chapter_text}"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.2,
        "max_tokens": 4096,
        "response_format": {"type": "json_object"},
    }

    try:
        resp = requests.post(f"{base_url}/chat/completions", json=payload, timeout=300)
        # If model does not support response_format, retry without it
        if resp.status_code == 400 and "response_format" in resp.text:
            payload.pop("response_format", None)
            resp = requests.post(f"{base_url}/chat/completions", json=payload, timeout=300)
        resp.raise_for_status()
    except requests.exceptions.ConnectionError:
        raise ConnectionError(
            f"Could not connect to LM Studio at '{base_url}'.\n"
            "Please ensure LM Studio is running and the local server has been started:\n"
            "  1. Open LM Studio\n"
            "  2. Go to the Developer tab (or Local Server icon <-> on the left)\n"
            "  3. Select your model and click 'Start Server'\n"
        )
    except requests.exceptions.HTTPError:
        raise RuntimeError(f"LM Studio API returned an error ({resp.status_code}): {resp.text}")

    data = resp.json()
    choices = data.get("choices", [])
    if not choices:
        raise ValueError(f"LM Studio returned no choices in response: {data}")

    choice = choices[0]
    msg = choice.get("message", {})
    raw = msg.get("content") or ""
    reasoning = msg.get("reasoning_content") or ""
    finish_reason = choice.get("finish_reason")

    # If content is empty but reasoning is present (common in DeepSeek R1 / QwQ)
    if not raw.strip() and reasoning.strip():
        raw = reasoning

    if not raw.strip():
        if finish_reason == "length":
            raise ValueError(
                "Model hit the token limit (max_tokens) before generating the answer.\n"
                "Try using a model with a larger context window, or check if the model's reasoning/thinking consumed all tokens."
            )
        raise ValueError(
            "Model returned an empty response. Verify in LM Studio that the model is loaded properly and not out of memory."
        )

    return extract_json(raw)


# ---------------------------------------------------------------------------
# File merges
# ---------------------------------------------------------------------------

def slugify(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "_", name.strip()).strip("_")


def write_chapter_note(vault_path: Path, chapter_num, title, pov, status, summary):
    path = vault_path / "Chapters" / f"Chapter_{int(chapter_num):02d}.md"
    content = f"""---
chapter: {chapter_num}
title: "{title}"
pov: "{pov}"
status: "{status}"
date_updated: {datetime.now().date().isoformat()}
---

## Summary
{summary}
"""
    path.write_text(content, encoding="utf-8")
    return path


def update_character(vault_path: Path, name, is_new, update_text, chapter_num):
    path = vault_path / "Characters" / f"{slugify(name)}.md"
    date = datetime.now().date().isoformat()
    entry = f"\n### Chapter {chapter_num} ({date})\n{update_text}\n"

    if not path.exists():
        content = f"""---
name: "{name}"
first_appearance: "Chapter {chapter_num}"
status: alive
---

## Overview
(Write your manual notes on {name} here — the agent will not touch this section.)

{AUTO_MARK_START}
## Auto-updates
{entry}{AUTO_MARK_END}
"""
        path.write_text(content, encoding="utf-8")
        return path, True

    text = path.read_text(encoding="utf-8")
    if AUTO_MARK_START in text and AUTO_MARK_END in text:
        before, rest = text.split(AUTO_MARK_START, 1)
        _, after = rest.split(AUTO_MARK_END, 1)
        new_text = before + AUTO_MARK_START + "\n## Auto-updates\n" + \
            rest.split(AUTO_MARK_END, 1)[0].split("## Auto-updates\n", 1)[-1] + entry + AUTO_MARK_END + after
    else:
        new_text = text.rstrip() + f"\n\n{AUTO_MARK_START}\n## Auto-updates\n{entry}{AUTO_MARK_END}\n"

    path.write_text(new_text, encoding="utf-8")
    return path, False


def append_timeline_events(vault_path: Path, events, chapter_num):
    path = vault_path / "Timeline" / "timeline.md"
    rows = [f"| {e['order_or_date']} | {e['event']} | {', '.join(e.get('characters_involved', []))} | {chapter_num} |" for e in events]
    with path.open("a", encoding="utf-8") as f:
        f.write("\n".join(rows) + ("\n" if rows else ""))


def update_threads(vault_path: Path, threads, chapter_num):
    path = vault_path / "Threads" / "threads.md"
    text = path.read_text(encoding="utf-8") if path.exists() else STARTER_FILES["Threads/threads.md"]
    date = datetime.now().date().isoformat()

    lines = text.splitlines()
    header_idx = next((i for i, l in enumerate(lines) if l.strip().startswith("|---")), None)
    if header_idx is None:
        lines = STARTER_FILES["Threads/threads.md"].splitlines()
        header_idx = next(i for i, l in enumerate(lines) if l.strip().startswith("|---"))

    existing = {}
    for i in range(header_idx + 1, len(lines)):
        cells = [c.strip() for c in lines[i].strip("|").split("|")]
        if len(cells) >= 1 and cells[0]:
            existing[cells[0].lower()] = i

    for t in threads:
        row = f"| {t['name']} | {t['status']} | {t['note']} ({date}) | {chapter_num} |"
        key = t["name"].lower()
        if key in existing:
            lines[existing[key]] = row
        else:
            lines.append(row)

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def append_log(vault_path: Path, chapter_num, title, data):
    log_dir = vault_path / "Log"
    log_path = log_dir / f"{datetime.now().date().isoformat()}.md"
    lines = [f"## Chapter {chapter_num} — {title} (processed {datetime.now().strftime('%H:%M')})", ""]
    lines.append(f"- Summary: {data['summary']}")
    lines.append(f"- POV: {data.get('pov_character', 'unclear')}")
    lines.append(f"- Characters touched: {', '.join(c['name'] for c in data.get('characters', []))}")
    lines.append(f"- Timeline events added: {len(data.get('timeline_events', []))}")
    lines.append(f"- Threads updated: {', '.join(t['name'] for t in data.get('threads', []))}")
    flags = data.get("continuity_flags", [])
    if flags:
        lines.append("- ⚠️ Continuity flags:")
        lines.extend(f"  - {f}" for f in flags)
    lines.append("")

    with log_path.open("a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def git_commit(vault_path: Path, message: str):
    if not (vault_path / ".git").exists():
        return
    try:
        subprocess.run(["git", "add", "-A"], cwd=vault_path, check=True, capture_output=True)
        subprocess.run(["git", "commit", "-m", message], cwd=vault_path, check=True, capture_output=True)
        print("Committed changes to git.")
    except subprocess.CalledProcessError as e:
        out = e.stdout.decode() if e.stdout else ""
        if "nothing to commit" not in out:
            print(f"Git commit skipped/failed: {out}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def process_chapter(args):
    vault_path = Path(args.vault).expanduser().resolve()
    if not vault_path.exists() or not vault_path.is_dir():
        raise SystemExit(
            f"\nError: Vault directory not found: {args.vault}\n"
            f"Resolved path: {vault_path}\n"
            "Please check the path or run 'writing-agent init <vault>' first."
        )

    chapter_path = Path(args.chapter_file).expanduser().resolve()
    if not chapter_path.exists():
        raise SystemExit(
            f"\nError: Chapter file not found: {args.chapter_file}\n"
            f"Resolved path: {chapter_path}\n"
            "Please provide the path to your actual chapter draft text file (e.g. .\\chapter1.txt or C:\\path\\to\\draft.txt)."
        )

    chapter_text = chapter_path.read_text(encoding="utf-8")

    context = gather_context(vault_path)
    print("Calling local model...")
    try:
        data = call_llm(args.base_url, args.model, context, chapter_text)
    except Exception as e:
        raise SystemExit(f"\nError: {e}")

    status = args.status or "draft"
    write_chapter_note(vault_path, args.chapter, args.title, data.get("pov_character", "unclear"), status, data["summary"])

    for c in data.get("characters", []):
        update_character(vault_path, c["name"], c.get("is_new", False), c["update"], args.chapter)

    if data.get("timeline_events"):
        append_timeline_events(vault_path, data["timeline_events"], args.chapter)

    if data.get("threads"):
        update_threads(vault_path, data["threads"], args.chapter)

    append_log(vault_path, args.chapter, args.title, data)

    git_commit(vault_path, f"Chapter {args.chapter}: {args.title}")

    print(f"\nDone. Chapter {args.chapter} processed.")
    print(f"- {len(data.get('characters', []))} character note(s) updated")
    print(f"- {len(data.get('timeline_events', []))} timeline event(s) added")
    print(f"- {len(data.get('threads', []))} thread(s) updated")
    if data.get("continuity_flags"):
        print("- ⚠️  Continuity flags — check the log:")
        for f in data["continuity_flags"]:
            print(f"    - {f}")


def main():
    parser = argparse.ArgumentParser(description="Local writing agent for an Obsidian-style novel vault.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init", help="Scaffold a new vault.")
    p_init.add_argument("vault", help="Path to the vault folder (created if missing).")

    p_proc = sub.add_parser("process", help="Process a chapter draft and update the vault.")
    p_proc.add_argument("vault", help="Path to the vault folder.")
    p_proc.add_argument("chapter_file", help="Path to the chapter draft text file.")
    p_proc.add_argument("--chapter", type=int, required=True, help="Chapter number.")
    p_proc.add_argument("--title", required=True, help="Chapter title.")
    p_proc.add_argument("--status", default=None, help="draft|revised|final (default: draft)")
    p_proc.add_argument("--model", required=True, help="Model name as loaded in LM Studio.")
    p_proc.add_argument("--base-url", dest="base_url", default=DEFAULT_BASE_URL, help=f"LM Studio API base URL (default: {DEFAULT_BASE_URL})")

    p_app = sub.add_parser("app", help="Launch the Visual Web Dashboard / Window.")
    p_app.add_argument("--host", default="127.0.0.1", help="Host address (default: 127.0.0.1)")
    p_app.add_argument("--port", type=int, default=8000, help="Port (default: 8000)")
    p_app.add_argument("--vault", default=None, help="Default vault path")
    p_app.add_argument("--no-browser", action="store_true", help="Do not open browser/window automatically")
    p_app.add_argument("--no-window", action="store_true", help="Open regular browser tab instead of dedicated app window")

    args = parser.parse_args()

    if args.command == "init":
        init_vault(Path(args.vault).expanduser().resolve())
    elif args.command == "process":
        process_chapter(args)
    elif args.command == "app":
        from app import launch_app
        if args.vault:
            os.environ["WRITING_AGENT_VAULT"] = str(Path(args.vault).expanduser().resolve())
        launch_app(
            host=args.host,
            port=args.port,
            window=not args.no_window,
            open_browser=not args.no_browser,
        )


if __name__ == "__main__":
    main()
