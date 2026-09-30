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

SYSTEM_PROMPT = """You are a meticulous story-bible assistant and perceptive literary editor for a novelist.
You will be given: (1) compact context about the story bible, existing characters, open plot
threads, and timeline, and (2) the full text of a new chapter draft.

Your mission:
1. Extract structured story tracking data (summary, POV, characters, timeline, threads, continuity flags).
2. Act as a discerning, "cibliste" editorial advisor:
   - Evaluate whether dialogue sounds spoken, authentic, and natural rather than literal or bookish.
   - Respect cultural and linguistic authenticity ("cibliste plutôt que sourcier") — avoiding translated clichés, anglicisms, or stiff literary exposition.
   - Offer 2-4 targeted, constructive propositions to polish cadence, rhythm, or dialogue, without imposing.

Respond with ONLY a single JSON object, no markdown fences, no commentary, matching exactly this schema:

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
  "continuity_flags": ["any inconsistency, contradiction, or question the author should check"],
  "editorial_suggestions": {
    "strengths": ["1-3 bullet points of what works effectively in this draft (tension, atmosphere, voice)"],
    "style_assessment": "2-3 sentences evaluating pacing, tone, and idiomatic flow against the story bible",
    "dialogue_coaching": [
      {
        "character": "character name",
        "original_line": "exact quote from dialogue",
        "critique": "why it feels stilted, out of register, or literal",
        "proposition": "a more natural, spoken, and authentic alternative"
      }
    ],
    "prose_propositions": [
      {
        "original_excerpt": "short phrase or sentence from the draft",
        "issue": "cliché, awkward rhythm, or stilted phrasing",
        "proposition": "suggested alternative enhancing flow or resonance"
      }
    ]
  }
}

Only include characters/threads that are actually relevant to THIS chapter.
Do not invent facts not present in the chapter text or the provided context.
If nothing applies to a list, return an empty list.

REASONING & CONTEXT INSTRUCTION:
You have a generous context window (+40k tokens). Keep your internal reasoning / chain-of-thought focused on analyzing the story draft, character arcs, and authentic spoken dialogue. Ensure you output the complete, unabbreviated JSON object covering all requested fields without cutting off."""


# ---------------------------------------------------------------------------
# Vault scaffolding
# ---------------------------------------------------------------------------

FOLDERS = ["00_Bible", "Characters", "Chapters", "Timeline", "Threads", "Log"]

STARTER_FILES = {
    "00_Bible/premise.md": "# Premise\n\n(Write your one-paragraph premise here.)\n",
    "00_Bible/themes.md": "# Themes\n\n- \n",
    "00_Bible/style_guide.md": "# Style guide\n\n## Narrative Stance\n- POV: Third person limited\n- Tense: Past\n- Tone: Immersive, grounded\n\n## Linguistic Charter (Cibliste vs Sourcier)\n- **Register & Voice**: Idiomatique, oralisé, langue vivante et incarnée (éviter les tournures artificielles ou calquées).\n- **Dialogues**: Rythme parlé naturel, syntaxe souple, sans lourdeurs livresques.\n- **Régionalismes / Terroir**: Vocabulaire ancré, expressions imagées locales si pertinent.\n- **Pièges à éviter**: Anglicismes masqués, tics de traduction (répétitions de soupirs, hochements de tête, fioritures d'exposition).\n",
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
# Context gathering (optimized for +40k context windows)
# ---------------------------------------------------------------------------

def gather_context(vault_path: Path, max_chars_per_section=25000) -> str:
    parts = []

    bible_dir = vault_path / "00_Bible"
    if bible_dir.exists():
        bible_files = sorted(bible_dir.glob("*.md"))
        if bible_files:
            bible_text = "\n\n".join(
                f"## {f.stem}\n{f.read_text(encoding='utf-8').strip()}" for f in bible_files
            )
            parts.append("### BIBLE\n" + bible_text[:max_chars_per_section])

    chars_dir = vault_path / "Characters"
    if chars_dir.exists():
        char_summaries = []
        for f in sorted(chars_dir.glob("*.md")):
            text = f.read_text(encoding="utf-8")
            overview = text.split(AUTO_MARK_START)[0].strip() if AUTO_MARK_START in text else text.strip()
            recent_update = ""
            if AUTO_MARK_START in text and AUTO_MARK_END in text:
                auto_block = text.split(AUTO_MARK_START, 1)[1].split(AUTO_MARK_END, 1)[0].strip()
                entries = re.findall(r"(### Chapter \d+[^\n]*\n[\s\S]*?)(?=(?:\n### Chapter |\Z))", auto_block)
                if entries:
                    recent_update = " | Latest: " + entries[-1].strip().replace("\n", " ")
            char_summaries.append(f"- **{f.stem}**: {overview[:800]}{recent_update[:400]}")
        if char_summaries:
            parts.append("### KNOWN CHARACTERS (dossiers & status)\n" + "\n".join(char_summaries)[:max_chars_per_section])

    threads_file = vault_path / "Threads" / "threads.md"
    if threads_file.exists():
        parts.append("### OPEN THREADS\n" + threads_file.read_text(encoding="utf-8")[:max_chars_per_section])

    timeline_file = vault_path / "Timeline" / "timeline.md"
    if timeline_file.exists():
        parts.append("### TIMELINE (chronological events)\n" + timeline_file.read_text(encoding="utf-8")[:max_chars_per_section])

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# LLM call & Robust JSON Extraction
# ---------------------------------------------------------------------------

def repair_truncated_json(candidate: str) -> dict:
    """Attempts to salvage and repair truncated or unclosed JSON by balancing brackets."""
    start = candidate.find("{")
    if start == -1:
        raise ValueError("No JSON object found in output.")
    text = candidate[start:]

    for i in range(len(text), 10, -1):
        sub = text[:i].rstrip()
        sub = re.sub(r',\s*$', '', sub)
        sub = re.sub(r':\s*"?$', '', sub)
        sub = re.sub(r',\s*"[^"]*"?$', '', sub)
        sub = re.sub(r'{\s*"[^"]*"?$', '{', sub)
        sub = re.sub(r',\s*$', '', sub)

        in_string = False
        escape = False
        open_brackets = []
        for char in sub:
            if escape:
                escape = False
                continue
            if char == '\\':
                escape = True
                continue
            if char == '"':
                in_string = not in_string
            elif not in_string:
                if char in '{[':
                    open_brackets.append(char)
                elif char in '}]':
                    if open_brackets:
                        open_brackets.pop()

        if in_string:
            sub += '"'

        for b in reversed(open_brackets):
            if b == '{':
                sub += '}'
            elif b == '[':
                sub += ']'

        try:
            parsed = json.loads(sub)
            if isinstance(parsed, dict) and ("summary" in parsed or "characters" in parsed):
                return parsed
        except Exception:
            continue

    raise ValueError("Could not repair truncated JSON.")


def extract_json(raw: str, finish_reason: str = None, model: str = "") -> dict:
    if not raw or not raw.strip():
        if finish_reason == "length":
            raise ValueError(
                f"Model token limit reached (finish_reason: 'length').\n\n"
                f"The model '{model}' spent all tokens on internal reasoning before outputting content.\n"
                f"Fix in LM Studio: increase Context Length or disable/reduce Thinking for this model."
            )
        raise ValueError("Model returned an empty response. Verify in LM Studio that the model is loaded properly.")

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

    # Try 4: attempt structured repair if output was truncated
    try:
        repaired = repair_truncated_json(cleaned)
        # Ensure minimum required fields exist
        if "summary" in repaired:
            repaired.setdefault("pov_character", "unclear")
            repaired.setdefault("characters", [])
            repaired.setdefault("timeline_events", [])
            repaired.setdefault("threads", [])
            repaired.setdefault("continuity_flags", [])
            repaired.setdefault("editorial_suggestions", {})
            return repaired
    except Exception:
        pass

    # Fallback diagnostics: if model hit token limit
    if finish_reason == "length":
        raise ValueError(
            f"Model token limit reached (finish_reason: 'length').\n\n"
            f"The model '{model}' spent its generation token budget (often on internal thinking/reasoning) and was cut off before finishing the JSON response.\n\n"
            f"To resolve this in LM Studio:\n"
            f"  1. Increase 'Context Length' in LM Studio for '{model}' (e.g. set to 8192 or 16384 in model settings).\n"
            f"  2. Or disable / reduce 'Thinking' in LM Studio's right-hand settings panel.\n"
            f"  3. Or select an instruct model (e.g. Mistral, Llama 3.1/3.3, Gemma 2) that outputs directly without burning tokens on internal monologue.\n\n"
            f"Truncated model output was:\n{raw[:300]}..."
        )

    # General parse error
    print("--- RAW MODEL OUTPUT (could not parse as JSON) ---")
    print(raw)
    raise ValueError(f"Failed to parse model output as JSON. Output was:\n{raw[:400]}")


def call_llm(base_url: str, model: str, context: str, chapter_text: str, max_tokens: int = 16384) -> dict:
    user_content = f"CONTEXT:\n{context}\n\n---\n\nNEW CHAPTER DRAFT:\n{chapter_text}"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.2,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }

    try:
        resp = requests.post(f"{base_url}/chat/completions", json=payload, timeout=600)
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

    return extract_json(raw, finish_reason=finish_reason, model=model)


# ---------------------------------------------------------------------------
# File merges
# ---------------------------------------------------------------------------

def slugify(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "_", name.strip()).strip("_")


def write_chapter_note(vault_path: Path, chapter_num, title, pov, status, summary, editorial_suggestions=None):
    path = vault_path / "Chapters" / f"Chapter_{int(chapter_num):02d}.md"
    parts = [
        f"""---
chapter: {chapter_num}
title: "{title}"
pov: "{pov}"
status: "{status}"
date_updated: {datetime.now().date().isoformat()}
---

## Summary
{summary}
"""
    ]

    if editorial_suggestions and isinstance(editorial_suggestions, dict):
        ed_parts = ["## Editorial Notes & Propositions\n"]
        strengths = editorial_suggestions.get("strengths", [])
        if strengths:
            ed_parts.append("### Strengths\n" + "\n".join(f"- {s}" for s in strengths) + "\n")

        style = editorial_suggestions.get("style_assessment")
        if style:
            ed_parts.append(f"### Style & Pacing Assessment\n{style}\n")

        dc = editorial_suggestions.get("dialogue_coaching", [])
        if dc:
            ed_parts.append("### Dialogue Coaching")
            for item in dc:
                char = item.get("character", "Character")
                orig = item.get("original_line", "")
                crit = item.get("critique", "")
                prop = item.get("proposition", "")
                ed_parts.append(f"- **{char}**: *\"{orig}\"*\n  - **Note**: {crit}\n  - **Proposition**: *\"{prop}\"*")
            ed_parts.append("")

        pp = editorial_suggestions.get("prose_propositions", [])
        if pp:
            ed_parts.append("### Prose & Rhythm Propositions")
            for item in pp:
                orig = item.get("original_excerpt", "")
                issue = item.get("issue", "")
                prop = item.get("proposition", "")
                ed_parts.append(f"- *\"{orig}\"* ({issue})\n  - **Proposition**: *\"{prop}\"*")
            ed_parts.append("")

        parts.append("\n".join(ed_parts))

    content = "".join(parts)
    path.write_text(content, encoding="utf-8")
    return path


def chapter_exists(vault_path: Path, chapter_num: int) -> bool:
    v_path = Path(vault_path).expanduser().resolve()
    ch_file = v_path / "Chapters" / f"Chapter_{int(chapter_num):02d}.md"
    return ch_file.exists()


def update_character(vault_path: Path, name, is_new, update_text, chapter_num):
    path = vault_path / "Characters" / f"{slugify(name)}.md"
    date = datetime.now().date().isoformat()
    clean_update = update_text.strip()
    entry = f"### Chapter {chapter_num} ({date})\n{clean_update}\n"

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
    pattern = rf"(### Chapter {chapter_num}\b[^\n]*\n)([\s\S]*?)(?=(?:\n### Chapter |\Z))"
    replacement = f"### Chapter {chapter_num} ({date})\n{clean_update}\n"

    if AUTO_MARK_START in text and AUTO_MARK_END in text:
        before, rest = text.split(AUTO_MARK_START, 1)
        auto_content, after = rest.split(AUTO_MARK_END, 1)

        if re.search(pattern, auto_content):
            new_auto = re.sub(pattern, lambda _: replacement, auto_content, count=1)
        else:
            new_auto = auto_content.rstrip() + f"\n\n{replacement}"

        new_text = f"{before}{AUTO_MARK_START}{new_auto.rstrip()}\n{AUTO_MARK_END}{after}"
    else:
        new_text = text.rstrip() + f"\n\n{AUTO_MARK_START}\n## Auto-updates\n\n{replacement}{AUTO_MARK_END}\n"

    path.write_text(new_text, encoding="utf-8")
    return path, False


def update_timeline_events(vault_path: Path, events, chapter_num):
    path = vault_path / "Timeline" / "timeline.md"
    text = path.read_text(encoding="utf-8") if path.exists() else STARTER_FILES["Timeline/timeline.md"]
    lines = text.splitlines()

    sep_idx = next((i for i, l in enumerate(lines) if l.strip().startswith("|---")), None)
    if sep_idx is None:
        lines = STARTER_FILES["Timeline/timeline.md"].splitlines()
        sep_idx = next(i for i, l in enumerate(lines) if l.strip().startswith("|---"))

    header_lines = lines[:sep_idx + 1]
    existing_rows = lines[sep_idx + 1:]

    first_ch_idx = None
    filtered_rows = []
    for r in existing_rows:
        stripped = r.strip()
        if not stripped.startswith("|"):
            continue
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        if len(cells) >= 4:
            row_ch = cells[3]
            if row_ch == str(chapter_num) or row_ch == f"Chapter {chapter_num}":
                if first_ch_idx is None:
                    first_ch_idx = len(filtered_rows)
                continue
        filtered_rows.append(stripped)

    new_rows = [
        f"| {e['order_or_date']} | {e['event']} | {', '.join(e.get('characters_involved', []))} | {chapter_num} |"
        for e in events
    ]

    if first_ch_idx is not None:
        final_rows = filtered_rows[:first_ch_idx] + new_rows + filtered_rows[first_ch_idx:]
    else:
        final_rows = filtered_rows + new_rows

    path.write_text("\n".join(header_lines + final_rows) + "\n", encoding="utf-8")


append_timeline_events = update_timeline_events


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


def apply_chapter_data(vault_path: Path, chapter_num: int, title: str, status: str, data: dict) -> dict:
    """Apply approved chapter data to the vault and commit to git."""
    v_path = Path(vault_path).expanduser().resolve()
    if not v_path.exists():
        raise ValueError(f"Vault path does not exist: {v_path}")

    already_exists = chapter_exists(v_path, chapter_num)

    # 1. Write / Overwrite chapter note
    ch_path = write_chapter_note(
        v_path,
        chapter_num,
        title,
        data.get("pov_character", "unclear"),
        status or "draft",
        data.get("summary", ""),
        data.get("editorial_suggestions"),
    )

    # 2. Update characters in-place
    chars_updated = []
    for c in data.get("characters", []):
        c_path, is_new = update_character(v_path, c["name"], c.get("is_new", False), c["update"], chapter_num)
        chars_updated.append({"name": c["name"], "is_new": is_new, "file": str(c_path)})

    # 3. Update timeline in-place
    events = data.get("timeline_events", [])
    if events:
        update_timeline_events(v_path, events, chapter_num)

    # 4. Update threads in-place
    threads = data.get("threads", [])
    if threads:
        update_threads(v_path, threads, chapter_num)

    # 5. Append log
    append_log(v_path, chapter_num, title, data)

    # 6. Commit to Git
    commit_msg = f"Chapter {chapter_num}: {title}" + (" (updated)" if already_exists else "")
    git_commit(v_path, commit_msg)

    return {
        "status": "ok",
        "already_exists": already_exists,
        "chapter_note": str(ch_path),
        "characters_updated": chars_updated,
        "timeline_events_count": len(events),
        "threads_count": len(threads),
        "git_committed": (v_path / ".git").exists(),
    }


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
    max_tokens = getattr(args, "max_tokens", 16384) or 16384
    print(f"Calling local model for analysis & editorial review (max_tokens: {max_tokens})...")
    try:
        data = call_llm(args.base_url, args.model, context, chapter_text, max_tokens=max_tokens)
    except Exception as e:
        raise SystemExit(f"\nError: {e}")

    already_exists = chapter_exists(vault_path, args.chapter)

    # Display analysis results & editorial propositions first for review
    print("\n" + "=" * 62)
    print(f" CHAPTER {args.chapter}: {args.title} — EDITORIAL REVIEW")
    if already_exists:
        print(" (Note: Chapter already exists in vault; updates will apply in-place)")
    print("=" * 62)

    ed = data.get("editorial_suggestions")
    if ed and isinstance(ed, dict):
        if ed.get("strengths"):
            print("\n✨ Strengths:")
            for s in ed["strengths"]:
                print(f"  - {s}")
        if ed.get("style_assessment"):
            print(f"\n🎭 Style & Pacing Assessment:\n  {ed['style_assessment']}")
        if ed.get("dialogue_coaching"):
            print("\n🗣️ Dialogue Coaching:")
            for d in ed["dialogue_coaching"]:
                print(f"  - {d.get('character', 'Character')}: \"{d.get('original_line', '')}\"")
                print(f"    Critique: {d.get('critique', '')}")
                print(f"    Proposition: \"{d.get('proposition', '')}\"")
        if ed.get("prose_propositions"):
            print("\n✍️ Prose & Cadence Propositions:")
            for p in ed["prose_propositions"]:
                print(f"  - \"{p.get('original_excerpt', '')}\" ({p.get('issue', '')})")
                print(f"    Proposition: \"{p.get('proposition', '')}\"")

    print("\n" + "-" * 62)
    print("📋 Extracted Story Data:")
    print(f"- Summary: {data.get('summary', '')}")
    print(f"- POV: {data.get('pov_character', 'unclear')}")
    print(f"- Characters touched: {', '.join(c['name'] for c in data.get('characters', []))}")
    print(f"- Timeline events: {len(data.get('timeline_events', []))}")
    print(f"- Threads: {', '.join(t['name'] for t in data.get('threads', []))}")

    if data.get("continuity_flags"):
        print("\n⚠️  Continuity flags:")
        for f in data["continuity_flags"]:
            print(f"  - {f}")

    # Prompt user for final decision unless --yes was passed
    if not getattr(args, "yes", False):
        try:
            choice = input("\nApprove and apply these updates to the vault? [y/N]: ").strip().lower()
            if choice not in ("y", "yes"):
                print("Aborted. Vault was NOT modified.")
                return
        except (KeyboardInterrupt, EOFError):
            print("\nAborted. Vault was NOT modified.")
            return

    status = args.status or "draft"
    res = apply_chapter_data(vault_path, args.chapter, args.title, status, data)

    print(f"\n✓ Chapter {args.chapter} successfully applied to vault and committed to Git.")
    print(f"- {len(res['characters_updated'])} character dossier(s) updated in-place")
    print(f"- {res['timeline_events_count']} timeline event(s) merged in-place")
    print(f"- {res['threads_count']} plot thread(s) updated")


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
    p_proc.add_argument("--max-tokens", type=int, default=16384, help="Maximum completion tokens (default: 16384 for 40k+ models).")
    p_proc.add_argument("-y", "--yes", action="store_true", help="Automatically approve and apply changes without prompt.")

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
