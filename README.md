# Writing Agent

A small local agent that keeps a novel-writing vault (Obsidian-style folders)
up to date as you write, using a model running in LM Studio.

It does **not** write your prose. It reads a chapter you've already drafted
and extracts/updates the surrounding story bible: characters, timeline,
threads, and a per-chapter note.

## 1. Setup

```bash
pip install -e .
```

This installs `writing-agent` (and `writing_agent`) as a standard command available in your terminal.

In LM Studio:
- Load a model with a reasonably large context window (8k+ recommended, since
  each run sends your Bible + character summaries + threads + the full chapter text).
- Start the local server (Developer tab → Start Server). Note the model name
  shown in the server log — you'll pass it as `--model`.

## 2. Create your vault

```bash
writing-agent init C:\Users\FSGee\Downloads\MyNovelVault
cd C:\Users\FSGee\Downloads\MyNovelVault
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
writing-agent process C:\Users\FSGee\Downloads\MyNovelVault ./drafts/chapter12.txt \
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

## 4. Visual Dashboard & Standalone App

Prefer a visual interface over the terminal? You can launch the interactive dashboard:

```bash
writing-agent app
```

Or simply **double-click** `run-app.bat`!

This opens a dedicated, distraction-free desktop window displaying:
- **Live LM Studio Status**: auto-detects loaded models directly from LM Studio.
- **Vault Explorer**: inspect your Characters, Timeline, Threads, and Bible notes with live updates.
- **Draft Editor**: write or paste chapter drafts directly with live word counts, or select a file path.
- **Live Activity Pipeline**: see step-by-step progress in real time (Context Gathering → LLM Analysis → Character Updates → Git Commit).
- **Results View**: instant summary, POV identification, and highlighted continuity flags.

---

## 5. Running with Docker

To run the application inside an isolated Docker container:

```bash
docker compose up -d
```

Open `http://localhost:8000` in your browser.

- Your vault is mounted at `/vault` and mapped to `C:/Users/FSGee/Nextcloud/book/Cold/vault/MyNovelVault` (configurable in `docker-compose.yml`).
- LM Studio on your host machine is reached via `http://host.docker.internal:1234/v1`.
- To stop the container: `docker compose down`.

---

## 6. Clean Removal & Uninstallation

If you ever wish to remove this program completely:

* **Windows**: Double-click `uninstall.bat` (or run `.\uninstall.ps1` in PowerShell).
* This removes:
  1. The `writing-agent` command executables from your system.
  2. The local virtual environment and package caches.
  3. Any Docker containers/images created for it.
  4. **Your novel vault in Nextcloud is never touched and remains intact.**

After running `uninstall.bat`, you can simply delete this `writing_agent` folder.

---

## 7. Using it day to day in Obsidian

Open your vault folder in Obsidian. Recommended plugins:
- **Dataview** — build live tables, e.g. all chapters where `status != final`,
  or all characters and their `first_appearance`, straight from the frontmatter
  this script writes.
- **Templates** — for any notes you still write by hand.

