// Writing Agent Frontend Application
let currentVault = "C:\\Users\\FSGee\\Nextcloud\\book\\Cold\\vault\\MyNovelVault";
let currentBaseUrl = "http://localhost:1234/v1";
let isProcessing = false;

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Load initial config
  try {
    const confRes = await fetch("/api/config");
    if (confRes.ok) {
      const conf = await confRes.json();
      if (conf.default_vault) currentVault = conf.default_vault;
      if (conf.default_base_url) currentBaseUrl = conf.default_base_url;
    }
  } catch (e) {
    console.warn("Could not load config, using defaults:", e);
  }

  updateVaultDisplay();
  checkLmStudioModels();
  loadVaultData();

  setupEventListeners();
});

// ---------------------------------------------------------------------------
// UI & State Initializers
// ---------------------------------------------------------------------------

function updateVaultDisplay() {
  const badge = document.getElementById("current-vault-label");
  if (badge) {
    badge.textContent = currentVault;
  }
}

async function checkLmStudioModels() {
  const statusBadge = document.getElementById("status-badge");
  const statusText = document.getElementById("status-text");
  const selectModel = document.getElementById("select-model");

  statusText.textContent = "Checking LM Studio...";

  try {
    const res = await fetch(`/api/models?base_url=${encodeURIComponent(currentBaseUrl)}`);
    const data = await res.json();

    if (data.online && data.models && data.models.length > 0) {
      statusBadge.className = "status-badge online";
      statusText.textContent = `LM Studio Online (${data.models.length} model${data.models.length > 1 ? 's' : ''})`;

      selectModel.innerHTML = "";
      data.models.forEach((m, idx) => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        if (idx === 0) opt.selected = true;
        selectModel.appendChild(opt);
      });
    } else if (data.online) {
      statusBadge.className = "status-badge online";
      statusText.textContent = "LM Studio Online (No models loaded)";
      selectModel.innerHTML = '<option value="" disabled selected>No models loaded in LM Studio</option>';
    } else {
      statusBadge.className = "status-badge offline";
      statusText.textContent = "LM Studio Offline (Click to retry)";
      selectModel.innerHTML = '<option value="" disabled selected>Server offline (Start Server in LM Studio)</option>';
    }
  } catch (err) {
    statusBadge.className = "status-badge offline";
    statusText.textContent = "LM Studio Offline (Click to retry)";
    selectModel.innerHTML = '<option value="" disabled selected>Server unreachable</option>';
  }
}

async function loadVaultData() {
  try {
    const res = await fetch(`/api/vault?vault_path=${encodeURIComponent(currentVault)}`);
    const data = await res.json();

    if (!data.exists) {
      document.getElementById("stat-chapters").textContent = "!";
      document.getElementById("stat-characters").textContent = "!";
      document.getElementById("stat-threads").textContent = "!";
      document.getElementById("stat-timeline").textContent = "!";
      return;
    }

    // Stats
    document.getElementById("stat-chapters").textContent = data.stats.chapters_count || 0;
    document.getElementById("stat-characters").textContent = data.stats.characters_count || 0;
    document.getElementById("stat-threads").textContent = data.stats.threads_count || 0;
    document.getElementById("stat-timeline").textContent = data.stats.timeline_count || 0;

    // Characters
    const charsList = document.getElementById("characters-list");
    charsList.innerHTML = "";
    if (data.characters && data.characters.length > 0) {
      data.characters.forEach(c => {
        const card = document.createElement("div");
        card.className = "explorer-card";
        card.innerHTML = `
          <div class="explorer-card-title">
            <span>👤 ${c.name}</span>
          </div>
          <div class="explorer-card-desc">${c.overview || "(No overview written yet)"}</div>
          ${c.updates ? `<div style="margin-top:0.4rem; font-size:0.75rem; color:var(--accent); font-family:var(--font-mono);">${c.updates.split('\n')[0] || ''}</div>` : ''}
        `;
        charsList.appendChild(card);
      });
    } else {
      charsList.innerHTML = '<div style="font-size:0.8rem; color:var(--text-faint);">No characters yet. Process a chapter to auto-discover characters.</div>';
    }

    // Timeline
    const timeList = document.getElementById("timeline-list");
    timeList.innerHTML = "";
    if (data.timeline && data.timeline.length > 0) {
      data.timeline.forEach(t => {
        const card = document.createElement("div");
        card.className = "explorer-card";
        card.innerHTML = `
          <div class="explorer-card-title">
            <span style="color:var(--accent);">${t.order}</span>
            <span style="font-size:0.72rem; color:var(--text-faint);">Ch ${t.chapter}</span>
          </div>
          <div class="explorer-card-desc">${t.event}</div>
          ${t.characters ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.25rem;">👥 ${t.characters}</div>` : ''}
        `;
        timeList.appendChild(card);
      });
    } else {
      timeList.innerHTML = '<div style="font-size:0.8rem; color:var(--text-faint);">No timeline events recorded yet.</div>';
    }

    // Threads
    const threadList = document.getElementById("threads-list");
    threadList.innerHTML = "";
    if (data.threads && data.threads.length > 0) {
      data.threads.forEach(t => {
        const card = document.createElement("div");
        card.className = "explorer-card";
        const badgeClass = t.status === "opened" ? "badge-opened" : (t.status === "closed" ? "badge-closed" : "badge-advanced");
        card.innerHTML = `
          <div class="explorer-card-title">
            <span>🧶 ${t.name}</span>
            <span class="badge ${badgeClass}">${t.status}</span>
          </div>
          <div class="explorer-card-desc">${t.note}</div>
        `;
        threadList.appendChild(card);
      });
    } else {
      threadList.innerHTML = '<div style="font-size:0.8rem; color:var(--text-faint);">No open plot threads recorded yet.</div>';
    }

    // Bible
    const bibleList = document.getElementById("bible-list");
    bibleList.innerHTML = "";
    if (data.bible && data.bible.length > 0) {
      data.bible.forEach(b => {
        const card = document.createElement("div");
        card.className = "explorer-card";
        card.innerHTML = `
          <div class="explorer-card-title">
            <span>📜 ${b.title}</span>
          </div>
          <div class="explorer-card-desc">${b.content.slice(0, 300)}...</div>
        `;
        bibleList.appendChild(card);
      });
    } else {
      bibleList.innerHTML = '<div style="font-size:0.8rem; color:var(--text-faint);">No bible files found in 00_Bible.</div>';
    }

    // Recent Logs
    const logList = document.getElementById("recent-logs-list");
    if (data.recent_logs && data.recent_logs.length > 0) {
      logList.innerHTML = "";
      data.recent_logs.forEach(l => {
        const item = document.createElement("div");
        item.className = "explorer-card";
        item.innerHTML = `
          <div class="explorer-card-title" style="font-size:0.8rem; color:var(--accent);">📅 ${l.date}</div>
          <div class="explorer-card-desc" style="font-size:0.75rem;">${l.content.split('\n').slice(0, 3).join('\n')}</div>
        `;
        logList.appendChild(item);
      });
    }

  } catch (err) {
    console.error("Failed to load vault data:", err);
  }
}

// ---------------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------------

function setupEventListeners() {
  // Vault switch prompt
  document.getElementById("vault-badge").addEventListener("click", () => {
    const newPath = prompt("Enter full path to your Obsidian vault:", currentVault);
    if (newPath && newPath.trim()) {
      currentVault = newPath.trim();
      updateVaultDisplay();
      loadVaultData();
    }
  });

  // Status badge click to refresh
  document.getElementById("status-badge").addEventListener("click", checkLmStudioModels);
  document.getElementById("btn-refresh-models").addEventListener("click", checkLmStudioModels);

  // Vault reload button
  document.getElementById("btn-reload-vault").addEventListener("click", loadVaultData);

  // Scaffold vault button
  document.getElementById("btn-scaffold-vault").addEventListener("click", async () => {
    if (confirm(`Scaffold vault structure at:\n${currentVault}\n\nExisting files will NOT be overwritten.`)) {
      try {
        const res = await fetch("/api/vault/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vault_path: currentVault, init_git: true }),
        });
        const d = await res.json();
        alert(d.message || "Vault scaffolded.");
        loadVaultData();
      } catch (err) {
        alert("Failed to scaffold: " + err.message);
      }
    }
  });

  // Sidebar Tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.style.display = "none");

      btn.classList.add("active");
      const targetId = btn.getAttribute("data-tab");
      const target = document.getElementById(targetId);
      if (target) target.style.display = "block";
    });
  });

  // Result Tabs
  document.querySelectorAll(".result-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".result-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".res-pane").forEach(p => p.style.display = "none");

      btn.classList.add("active");
      const targetId = btn.getAttribute("data-res-tab");
      const target = document.getElementById(targetId);
      if (target) target.style.display = "block";
    });
  });

  // Draft mode toggles (Editor vs File)
  const btnModeEditor = document.getElementById("btn-mode-editor");
  const btnModeFile = document.getElementById("btn-mode-file");
  const viewEditor = document.getElementById("view-editor");
  const viewFile = document.getElementById("view-file");

  btnModeEditor.addEventListener("click", () => {
    btnModeEditor.classList.add("active");
    btnModeFile.classList.remove("active");
    viewEditor.style.display = "block";
    viewFile.style.display = "none";
  });

  btnModeFile.addEventListener("click", () => {
    btnModeFile.classList.add("active");
    btnModeEditor.classList.remove("active");
    viewFile.style.display = "block";
    viewEditor.style.display = "none";
  });

  // Word count tracker
  const draftEditor = document.getElementById("input-draft-text");
  const wordCountBadge = document.getElementById("word-count-badge");
  draftEditor.addEventListener("input", () => {
    const text = draftEditor.value.trim();
    const words = text ? text.split(/\s+/).length : 0;
    const chars = text.length;
    wordCountBadge.textContent = `${words.toLocaleString()} words | ${chars.toLocaleString()} characters`;
  });

  // Process Chapter Button
  document.getElementById("btn-process").addEventListener("click", handleProcessChapter);
}

// ---------------------------------------------------------------------------
// Chapter Processing Stream
// ---------------------------------------------------------------------------

async function handleProcessChapter() {
  if (isProcessing) return;

  const chNum = parseInt(document.getElementById("input-chapter-num").value) || 1;
  const title = document.getElementById("input-title").value.trim();
  const status = document.getElementById("input-status").value;
  const model = document.getElementById("select-model").value;
  const isEditorMode = document.getElementById("btn-mode-editor").classList.contains("active");
  const draftText = document.getElementById("input-draft-text").value.trim();
  const draftFile = document.getElementById("input-file-path").value.trim();

  if (!title) {
    alert("Please enter a chapter title.");
    document.getElementById("input-title").focus();
    return;
  }

  if (!model) {
    alert("Please select or start a model in LM Studio first.");
    return;
  }

  if (isEditorMode && !draftText) {
    alert("Please write or paste your chapter draft text.");
    document.getElementById("input-draft-text").focus();
    return;
  }

  if (!isEditorMode && !draftFile) {
    alert("Please provide the path to your draft file.");
    document.getElementById("input-file-path").focus();
    return;
  }

  // Setup UI for processing
  isProcessing = true;
  const btnProcess = document.getElementById("btn-process");
  const btnProcessText = document.getElementById("btn-process-text");
  btnProcess.disabled = true;
  btnProcessText.textContent = "Processing Chapter Draft...";

  const pipelineSection = document.getElementById("pipeline-section");
  const progressFill = document.getElementById("progress-fill");
  const consoleStream = document.getElementById("console-stream");
  const resultsSection = document.getElementById("results-section");

  pipelineSection.style.display = "flex";
  resultsSection.style.display = "none";
  progressFill.style.width = "5%";
  consoleStream.textContent = "Starting story agent pipeline...\n";

  // Reset steps
  resetSteps();

  try {
    const payload = {
      vault_path: currentVault,
      chapter_num: chNum,
      title: title,
      status: status,
      model: model,
      base_url: currentBaseUrl,
      draft_text: isEditorMode ? draftText : null,
      draft_file: !isEditorMode ? draftFile : null,
    };

    const response = await fetch("/api/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${await response.text()}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const raw = line.slice(6).trim();
          if (raw) {
            try {
              const event = JSON.parse(raw);
              handlePipelineEvent(event);
            } catch (e) {
              console.warn("Could not parse SSE JSON:", raw);
            }
          }
        }
      }
    }

  } catch (err) {
    consoleStream.textContent += `\n❌ Error: ${err.message}\n`;
    setStepState("step-validate", "error");
    alert("Processing failed: " + err.message);
  } finally {
    isProcessing = false;
    btnProcess.disabled = false;
    btnProcessText.textContent = "Process Chapter Draft";
    loadVaultData();
  }
}

function resetSteps() {
  ["step-validate", "step-context", "step-llm", "step-save"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = "step-card";
  });
}

function setStepState(stepId, state) {
  const el = document.getElementById(stepId);
  if (!el) return;
  if (state === "active") {
    el.className = "step-card active";
  } else if (state === "done") {
    el.className = "step-card done";
  } else if (state === "error") {
    el.className = "step-card";
    el.style.borderColor = "var(--rose)";
    el.style.color = "var(--rose)";
  }
}

function handlePipelineEvent(event) {
  const consoleStream = document.getElementById("console-stream");
  const progressFill = document.getElementById("progress-fill");

  if (event.progress) {
    progressFill.style.width = `${event.progress}%`;
  }

  if (event.message) {
    const time = new Date().toLocaleTimeString();
    consoleStream.textContent += `[${time}] ${event.message}\n`;
    consoleStream.scrollTop = consoleStream.scrollHeight;
  }

  // Update step highlights
  switch (event.step) {
    case "validate":
      setStepState("step-validate", "active");
      break;
    case "context":
      setStepState("step-validate", "done");
      setStepState("step-context", "active");
      break;
    case "llm_start":
      setStepState("step-context", "done");
      setStepState("step-llm", "active");
      break;
    case "llm_done":
      setStepState("step-llm", "done");
      setStepState("step-save", "active");
      break;
    case "complete":
      setStepState("step-save", "done");
      if (event.result) {
        renderResults(event.result);
      }
      break;
    case "error":
      consoleStream.textContent += `\n❌ Error: ${event.error}\n`;
      break;
  }
}

function renderResults(result) {
  const resultsSection = document.getElementById("results-section");
  resultsSection.style.display = "block";

  // Summary & POV
  document.getElementById("res-summary-text").textContent = result.summary || "";
  document.getElementById("res-pov").textContent = result.pov || "Unclear";
  document.getElementById("res-git-badge").style.display = "inline-flex";

  // Continuity flags
  const contAlert = document.getElementById("continuity-alert");
  const contList = document.getElementById("continuity-list");
  contList.innerHTML = "";
  if (result.continuity_flags && result.continuity_flags.length > 0) {
    contAlert.style.display = "block";
    result.continuity_flags.forEach(flag => {
      const li = document.createElement("li");
      li.textContent = flag;
      contList.appendChild(li);
    });
  } else {
    contAlert.style.display = "none";
  }

  // Character updates
  const charList = document.getElementById("res-characters-list");
  charList.innerHTML = "";
  if (result.characters && result.characters.length > 0) {
    result.characters.forEach(c => {
      const card = document.createElement("div");
      card.className = "explorer-card";
      card.innerHTML = `
        <div class="explorer-card-title">
          <span>👤 ${c.name}</span>
          ${c.is_new ? '<span class="badge badge-opened">NEW CHARACTER</span>' : '<span class="badge badge-advanced">UPDATED</span>'}
        </div>
        <div class="explorer-card-desc">${c.update}</div>
      `;
      charList.appendChild(card);
    });
  } else {
    charList.innerHTML = '<div style="font-size:0.8rem; color:var(--text-faint);">No characters updated in this chapter.</div>';
  }

  // Timeline events
  const timeList = document.getElementById("res-timeline-list");
  timeList.innerHTML = "";
  if (result.timeline_events && result.timeline_events.length > 0) {
    result.timeline_events.forEach(e => {
      const card = document.createElement("div");
      card.className = "explorer-card";
      card.innerHTML = `
        <div class="explorer-card-title">
          <span style="color:var(--accent);">${e.order_or_date}</span>
        </div>
        <div class="explorer-card-desc">${e.event}</div>
        ${e.characters_involved && e.characters_involved.length > 0 ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.25rem;">👥 ${e.characters_involved.join(', ')}</div>` : ''}
      `;
      timeList.appendChild(card);
    });
  } else {
    timeList.innerHTML = '<div style="font-size:0.8rem; color:var(--text-faint);">No timeline events recorded.</div>';
  }

  // Threads
  const thrList = document.getElementById("res-threads-list");
  thrList.innerHTML = "";
  if (result.threads && result.threads.length > 0) {
    result.threads.forEach(t => {
      const card = document.createElement("div");
      card.className = "explorer-card";
      const badgeClass = t.status === "opened" ? "badge-opened" : (t.status === "closed" ? "badge-closed" : "badge-advanced");
      card.innerHTML = `
        <div class="explorer-card-title">
          <span>🧶 ${t.name}</span>
          <span class="badge ${badgeClass}">${t.status}</span>
        </div>
        <div class="explorer-card-desc">${t.note}</div>
      `;
      thrList.appendChild(card);
    });
  } else {
    thrList.innerHTML = '<div style="font-size:0.8rem; color:var(--text-faint);">No plot threads updated.</div>';
  }

  // Scroll smoothly to results
  resultsSection.scrollIntoView({ behavior: "smooth" });
}
