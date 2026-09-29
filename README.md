# Writing Agent

A small local agent that keeps a novel-writing vault (Obsidian-style folders)
up to date as you write, using a model running in LM Studio.

It does **not** write your prose. It reads a chapter you've already drafted
and extracts/updates the surrounding story bible: characters, timeline,
threads, and a per-chapter note.

## 1. Setup

```bash
pip install -r requirements.txt
```

In LM Studio:
- Load a model with a reasonably large context window (8k+ recommended, since
  each run sends your Bible + character summaries + threads + the full chapter text).
- Start the local server (Developer tab → Start Server). Note the model name
  shown in the server log — you'll pass it as `--model`.

## 2. Create your vault

```bash
python writing_agent.py init ~/MyNovelVault
cd ~/MyNovelVault
git init && git add -A && git commit -m "Initial vault"
```

This creates:
```
00_Bible/        premise.md, themes.md, style_guide.md, world_rules.md
Characters/      (empty — filled as you process chapters)
Chapters/        (empty)
Timeline/        timeline.md
Threads/         threads.md
Log/             (empty)
```

Fill in `00_Bible/*.md` by hand before you start — this is the context the
agent leans on most, so the more precise it is, the better its extraction.

**Git matters here**: the agent auto-commits after every chapter it
processes, provided the vault is a git repo. That gives you a full history —
`git diff`, `git log`, `git revert` — so nothing it writes is ever a
black box. If you skip `git init`, it still works, just without that safety net.

## 3. Process a chapter

```bash
python writing_agent.py process ~/MyNovelVault ./drafts/chapter12.txt \
  --chapter 12 --title "The Long Road" --model your-model-name-here
```

This will:
1. Send your Bible + known characters + open threads + recent timeline + the
   chapter text to the model.
2. Get back structured JSON (summary, character updates, timeline events,
   thread changes, continuity flags).
3. Write `Chapters/Chapter_12.md`.
4. Append to each mentioned character's file, inside a clearly marked
   "Auto-updates" section — your own written notes above that section are
   never touched.
5. Append rows to `Timeline/timeline.md` and update `Threads/threads.md`.
6. Append a dated entry to `Log/`.
7. Print any **continuity flags** the model noticed (e.g. "Chapter 12 says
   Marie has blue eyes; Chapter 3 said brown") — these are worth checking.
8. Commit everything to git.

Optional: `--status revised` or `--status final` (default is `draft`).

## 4. Using it day to day in Obsidian

Open the vault folder in Obsidian. Recommended plugins:
- **Dataview** — build live tables, e.g. all chapters where `status != final`,
  or all characters and their `first_appearance`, straight from the frontmatter
  this script writes.
- **Templates** — for any notes you still write by hand.

## 5. Extending it (with Antigravity, Claude Code, or by hand)

The script is intentionally simple and modular so it's easy to extend. Ideas,
roughly in order of usefulness:

- **Review-before-write mode**: dump the JSON to a `_pending/` file and only
  merge on a second `--apply` run, if you don't want to rely on git diffs.
- **Timeline sorting**: currently events are appended in processing order;
  you could parse in-story dates and keep the table sorted.
- **Character relationship graph**: extract relationships too, and render
  them as a Mermaid diagram in a note.
- **Chunking for long chapters**: if a chapter exceeds your model's context
  window, split it and merge the extracted JSON before writing.
- **A "query" command**: e.g. `python writing_agent.py ask "What does Marie
  know about the letter by chapter 10?"` — send the relevant timeline/character
  history to the model as a read-only Q&A mode.

If you hand this repo to Antigravity or Claude Code, point it at
`writing_agent.py` and describe the extension you want — the file structure
and JSON schema in the code comments give it what it needs to work from.
