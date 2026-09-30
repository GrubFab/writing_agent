// Writing Agent Frontend Application
let currentVault = "C:\\Users\\FSGee\\Nextcloud\\book\\Cold\\vault\\MyNovelVault";
let currentProject = { id: "cold", name: "Cold", path: currentVault };
let currentBaseUrl = "http://localhost:1234/v1";
let isProcessing = false;
let stagedAnalysis = null;

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Load initial projects & config
  await loadProjects();
  checkLmStudioModels();
  loadVaultData();
  checkChapterExists();

  setupEventListeners();
});

// ---------------------------------------------------------------------------
// Projects Management
// ---------------------------------------------------------------------------

async function loadProjects() {
  try {
    const res = await fetch("/api/projects");
    if (res.ok) {
      const data = await res.json();
      if (data.active_project) {
        currentProject = data.active_project;
        currentVault = data.active_project.path;
      }
      renderProjectsDropdown(data.projects || [], data.active_id);
    }
  } catch (e) {
    console.warn("Could not load projects:", e);
  }
  updateVaultDisplay();
}

function renderProjectsDropdown(projects, activeId) {
  const listEl = document.getElementById("project-dropdown-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  projects.forEach(p => {
    const item = document.createElement("div");
    item.className = `project-item ${p.id === activeId ? 'active' : ''}`;
    item.innerHTML = `
      <div class="project-item-info">
        <span class="project-item-title">${escapeHtml(p.name)}</span>
        <span class="project-item-path" title="${escapeHtml(p.path)}">${escapeHtml(p.path)}</span>
      </div>
      ${p.id === activeId ? '<span style="color:var(--accent); font-weight:bold;">✓</span>' : ''}
    `;
    item.addEventListener("click", () => switchProject(p.id));
    listEl.appendChild(item);
  });
}

async function switchProject(projectId) {
  try {
    const res = await fetch("/api/projects/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId }),
    });
    if (res.ok) {
      const data = await res.json();
      currentProject = data.active_project;
      currentVault = data.active_project.path;
      updateVaultDisplay();
      renderProjectsDropdown(data.projects, data.active_project.id);
      closeProjectDropdown();
      loadVaultData();
      checkChapterExists();
    }
  } catch (err) {
    alert("Failed to switch project: " + err.message);
  }
}

function updateVaultDisplay() {
  const projNameEl = document.getElementById("current-project-name");
  const vaultLabelEl = document.getElementById("current-vault-label");

  if (projNameEl && currentProject) {
    projNameEl.textContent = currentProject.name || "Project";
  }
  if (vaultLabelEl) {
    vaultLabelEl.textContent = currentVault;
    vaultLabelEl.title = currentVault;
  }
}

function closeProjectDropdown() {
  const dd = document.getElementById("project-dropdown");
  if (dd) dd.style.display = "none";
}

function toggleProjectDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById("project-dropdown");
  if (dd) {
    dd.style.display = dd.style.display === "none" ? "flex" : "none";
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
// Chapter Existence Check
// ---------------------------------------------------------------------------

async function checkChapterExists() {
  const chInput = document.getElementById("input-chapter-num");
  if (!chInput) return;
  const chNum = parseInt(chInput.value) || 1;
  const indicator = document.getElementById("chapter-exists-indicator");
  if (!indicator) return;

  try {
    const res = await fetch(`/api/chapter/check?vault_path=${encodeURIComponent(currentVault)}&chapter_num=${chNum}`);
    if (res.ok) {
      const data = await res.json();
      indicator.style.display = "block";
      if (data.exists) {
        indicator.className = "chapter-status-indicator exists";
        indicator.textContent = `⚠️ Chapter ${chNum} already in vault (will update in-place)`;
      } else {
        indicator.className = "chapter-status-indicator new";
        indicator.textContent = `✨ New Chapter ${chNum}`;
      }
    }
  } catch (e) {
    indicator.style.display = "none";
  }
}

// ---------------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------------

function setupEventListeners() {
  // Project selector dropdown toggle
  const projBadge = document.getElementById("project-badge");
  if (projBadge) {
    projBadge.addEventListener("click", toggleProjectDropdown);
  }

  // Close dropdown on click outside
  document.addEventListener("click", (e) => {
    const wrapper = document.querySelector(".project-selector-wrapper");
    if (wrapper && !wrapper.contains(e.target)) {
      closeProjectDropdown();
    }
  });

  // Open New Project Modal
  const btnOpenModal = document.getElementById("btn-open-new-project-modal");
  if (btnOpenModal) {
    btnOpenModal.addEventListener("click", (e) => {
      e.stopPropagation();
      closeProjectDropdown();
      openNewProjectModal();
    });
  }

  const btnSidebarNew = document.getElementById("btn-sidebar-new-project");
  if (btnSidebarNew) {
    btnSidebarNew.addEventListener("click", openNewProjectModal);
  }

  // Close Modal buttons
  const btnCloseModal = document.getElementById("btn-close-modal");
  const btnCancelModal = document.getElementById("btn-cancel-modal");
  if (btnCloseModal) btnCloseModal.addEventListener("click", closeNewProjectModal);
  if (btnCancelModal) btnCancelModal.addEventListener("click", closeNewProjectModal);

  // Submit New Project
  const btnSubmitNew = document.getElementById("btn-submit-new-project");
  if (btnSubmitNew) {
    btnSubmitNew.addEventListener("click", submitNewProject);
  }

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

  // Chapter number change listener
  const chInput = document.getElementById("input-chapter-num");
  if (chInput) {
    chInput.addEventListener("input", checkChapterExists);
    chInput.addEventListener("change", checkChapterExists);
  }

  // Staged Review Action buttons
  const btnApply = document.getElementById("btn-apply-to-vault");
  if (btnApply) {
    btnApply.addEventListener("click", handleApplyToVault);
  }

  const btnDiscard = document.getElementById("btn-discard-staged");
  if (btnDiscard) {
    btnDiscard.addEventListener("click", handleDiscardStaged);
  }

  // Process Chapter Button
  document.getElementById("btn-process").addEventListener("click", handleProcessChapter);
}

// ---------------------------------------------------------------------------
// Chapter Processing Stream (Analysis & Staging)
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

  const maxTokensEl = document.getElementById("select-max-tokens");
  const maxTokens = maxTokensEl ? (parseInt(maxTokensEl.value) || 16384) : 16384;

  // Setup UI for processing
  isProcessing = true;
  const btnProcess = document.getElementById("btn-process");
  const btnProcessText = document.getElementById("btn-process-text");
  btnProcess.disabled = true;
  btnProcessText.textContent = "Analyzing Chapter Draft...";

  const pipelineSection = document.getElementById("pipeline-section");
  const progressFill = document.getElementById("progress-fill");
  const consoleStream = document.getElementById("console-stream");
  const resultsSection = document.getElementById("results-section");

  pipelineSection.style.display = "flex";
  resultsSection.style.display = "none";
  progressFill.style.width = "5%";
  consoleStream.textContent = `Starting story agent analysis pipeline (max tokens: ${maxTokens.toLocaleString()})...\n`;

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
      max_tokens: maxTokens,
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
    alert("Analysis failed: " + err.message);
  } finally {
    isProcessing = false;
    btnProcess.disabled = false;
    btnProcessText.textContent = "Analyze Chapter Draft";
  }
}

function resetSteps() {
  ["step-validate", "step-context", "step-llm", "step-review"].forEach(id => {
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
      setStepState("step-review", "active");
      break;
    case "ready_for_review":
      setStepState("step-review", "done");
      stagedAnalysis = event.staged_data;

      // Configure Staged Action Bar
      const bar = document.getElementById("staged-action-bar");
      if (bar) bar.classList.remove("applied");

      const stagedIcon = document.getElementById("staged-icon");
      if (stagedIcon) stagedIcon.textContent = "📋";

      const stagedTitle = document.getElementById("staged-title");
      if (stagedTitle) stagedTitle.textContent = `Staged Analysis — Chapter ${event.staged_data.chapter_num} Ready for Review`;

      const stagedDesc = document.getElementById("staged-desc");
      if (stagedDesc) stagedDesc.innerHTML = "Review remarks & propositions below. Vault files have <strong>not</strong> been touched yet.";

      const existsBadge = document.getElementById("staged-exists-badge");
      if (existsBadge) {
        if (event.already_exists) {
          existsBadge.style.display = "inline-block";
          const badgeCh = document.getElementById("badge-ch-num");
          if (badgeCh) badgeCh.textContent = event.staged_data.chapter_num;
        } else {
          existsBadge.style.display = "none";
        }
      }

      const btnApply = document.getElementById("btn-apply-to-vault");
      const btnText = document.getElementById("btn-apply-text");
      if (btnApply) btnApply.disabled = false;
      if (btnText) btnText.textContent = "Approve & Apply to Vault";

      if (event.result) {
        renderResults(event.result, false);
      }
      break;
    case "error":
      consoleStream.textContent += `\n❌ Error: ${event.error}\n`;
      break;
  }
}

// ---------------------------------------------------------------------------
// Apply Staged Analysis to Vault (Author Final Decision)
// ---------------------------------------------------------------------------

async function handleApplyToVault() {
  if (!stagedAnalysis) {
    alert("No staged chapter analysis available to apply.");
    return;
  }

  const btnApply = document.getElementById("btn-apply-to-vault");
  const btnText = document.getElementById("btn-apply-text");
  if (btnApply) btnApply.disabled = true;
  if (btnText) btnText.textContent = "Applying & Committing...";

  try {
    const res = await fetch("/api/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stagedAnalysis),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to apply to vault");
    }

    const data = await res.json();

    // Visual updates on success
    const bar = document.getElementById("staged-action-bar");
    if (bar) bar.classList.add("applied");

    const stagedIcon = document.getElementById("staged-icon");
    if (stagedIcon) stagedIcon.textContent = "🎉";

    const stagedTitle = document.getElementById("staged-title");
    if (stagedTitle) stagedTitle.textContent = `✓ Chapter ${stagedAnalysis.chapter_num} Approved & Applied to Vault`;

    const stagedDesc = document.getElementById("staged-desc");
    if (stagedDesc) stagedDesc.textContent = "Chapter note written, character dossiers & timeline updated in-place, and auto-committed to Git.";

    if (btnText) btnText.textContent = "✓ Applied to Vault";

    const gitBadge = document.getElementById("res-git-badge");
    if (gitBadge) gitBadge.style.display = "inline-flex";

    // Refresh vault data and chapter status indicator
    await loadVaultData();
    checkChapterExists();

    const consoleStream = document.getElementById("console-stream");
    if (consoleStream) {
      const time = new Date().toLocaleTimeString();
      consoleStream.textContent += `[${time}] ✓ Chapter ${stagedAnalysis.chapter_num} successfully applied to vault and committed to Git!\n`;
      consoleStream.scrollTop = consoleStream.scrollHeight;
    }
  } catch (err) {
    alert("Failed to apply to vault: " + err.message);
    if (btnApply) btnApply.disabled = false;
    if (btnText) btnText.textContent = "Approve & Apply to Vault";
  }
}

function handleDiscardStaged() {
  if (!stagedAnalysis) return;
  if (confirm(`Discard analysis for Chapter ${stagedAnalysis.chapter_num} without modifying the vault?`)) {
    stagedAnalysis = null;
    document.getElementById("results-section").style.display = "none";
    const consoleStream = document.getElementById("console-stream");
    if (consoleStream) {
      const time = new Date().toLocaleTimeString();
      consoleStream.textContent += `[${time}] [Author action] Staged analysis discarded. Vault was NOT modified.\n`;
    }
    resetSteps();
  }
}

function renderResults(result, isCommitted = false) {
  const resultsSection = document.getElementById("results-section");
  resultsSection.style.display = "block";

  // Summary & POV
  document.getElementById("res-summary-text").textContent = result.summary || "";
  document.getElementById("res-pov").textContent = result.pov || "Unclear";
  document.getElementById("res-git-badge").style.display = isCommitted ? "inline-flex" : "none";

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

  // Editorial Propositions
  const edContainer = document.getElementById("res-editorial-content");
  if (edContainer) {
    renderEditorialSuggestions(result.editorial_suggestions, edContainer);
  }

  // Scroll smoothly to results
  resultsSection.scrollIntoView({ behavior: "smooth" });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeQuotes(str) {
  if (!str) return "";
  return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, " ");
}

function renderEditorialSuggestions(ed, container) {
  container.innerHTML = "";
  if (!ed || (typeof ed !== 'object') || Object.keys(ed).length === 0) {
    container.innerHTML = '<div style="font-size:0.85rem; color:var(--text-faint);">No editorial propositions returned for this chapter.</div>';
    return;
  }

  // 1. Strengths
  if (ed.strengths && ed.strengths.length > 0) {
    const strBox = document.createElement("div");
    strBox.className = "explorer-card";
    strBox.style.borderColor = "rgba(16, 185, 129, 0.4)";
    strBox.style.background = "rgba(16, 185, 129, 0.05)";
    strBox.innerHTML = `
      <div class="explorer-card-title" style="color:var(--emerald);">
        <span>✨ Strengths & Highlights</span>
      </div>
      <ul style="margin-left: 1.25rem; font-size: 0.85rem; color: var(--text-main);">
        ${ed.strengths.map(s => `<li style="margin-bottom:0.25rem;">${escapeHtml(s)}</li>`).join("")}
      </ul>
    `;
    container.appendChild(strBox);
  }

  // 2. Style & Pacing Assessment
  if (ed.style_assessment) {
    const styleBox = document.createElement("div");
    styleBox.className = "explorer-card";
    styleBox.innerHTML = `
      <div class="explorer-card-title">
        <span>🎭 Style & Pacing Assessment</span>
      </div>
      <div class="explorer-card-desc" style="font-size:0.88rem; color:var(--text-main);">${escapeHtml(ed.style_assessment)}</div>
    `;
    container.appendChild(styleBox);
  }

  // 3. Dialogue Coaching
  if (ed.dialogue_coaching && ed.dialogue_coaching.length > 0) {
    const diaHeading = document.createElement("div");
    diaHeading.innerHTML = `<h4 style="margin: 0.8rem 0 0.4rem 0; font-size: 0.85rem; color: var(--text-muted); text-transform: uppercase;">🗣️ Dialogue Coaching ("Cibliste" / Authentic Orality)</h4>`;
    container.appendChild(diaHeading);

    ed.dialogue_coaching.forEach(d => {
      const card = document.createElement("div");
      card.className = "explorer-card";
      card.innerHTML = `
        <div class="explorer-card-title">
          <span>👤 ${escapeHtml(d.character || 'Character')}</span>
          <span class="badge badge-advanced">Dialogue</span>
        </div>
        <div style="font-size:0.85rem; color:var(--text-muted); font-style:italic; margin-bottom:0.4rem;">
          "${escapeHtml(d.original_line || '')}"
        </div>
        <div style="font-size:0.8rem; color:var(--amber); margin-bottom:0.4rem;">
          <strong>Critique:</strong> ${escapeHtml(d.critique || '')}
        </div>
        <div style="background:var(--bg-input); padding:0.5rem 0.75rem; border-radius:6px; border-left:3px solid var(--accent); display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:0.88rem; color:var(--emerald);">
            <strong>Proposition:</strong> "${escapeHtml(d.proposition || '')}"
          </div>
          <button class="btn-secondary copy-btn" style="padding:0.2rem 0.5rem; font-size:0.75rem;">📋 Copy</button>
        </div>
      `;
      const copyBtn = card.querySelector(".copy-btn");
      if (copyBtn && d.proposition) {
        copyBtn.addEventListener("click", () => {
          navigator.clipboard.writeText(d.proposition);
          copyBtn.textContent = "✓ Copied!";
          setTimeout(() => { copyBtn.textContent = "📋 Copy"; }, 2000);
        });
      }
      container.appendChild(card);
    });
  }

  // 4. Prose & Rhythm Propositions
  if (ed.prose_propositions && ed.prose_propositions.length > 0) {
    const proseHeading = document.createElement("div");
    proseHeading.innerHTML = `<h4 style="margin: 0.8rem 0 0.4rem 0; font-size: 0.85rem; color: var(--text-muted); text-transform: uppercase;">✍️ Prose, Cadence & Phrasing Propositions</h4>`;
    container.appendChild(proseHeading);

    ed.prose_propositions.forEach(p => {
      const card = document.createElement("div");
      card.className = "explorer-card";
      card.innerHTML = `
        <div class="explorer-card-title">
          <span style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(p.issue || 'Suggestion')}</span>
          <span class="badge badge-opened">Style</span>
        </div>
        <div style="font-size:0.85rem; color:var(--text-muted); font-style:italic; margin-bottom:0.4rem;">
          "${escapeHtml(p.original_excerpt || '')}"
        </div>
        <div style="background:var(--bg-input); padding:0.5rem 0.75rem; border-radius:6px; border-left:3px solid var(--accent); display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:0.88rem; color:var(--emerald);">
            <strong>Proposition:</strong> "${escapeHtml(p.proposition || '')}"
          </div>
          <button class="btn-secondary copy-btn" style="padding:0.2rem 0.5rem; font-size:0.75rem;">📋 Copy</button>
        </div>
      `;
      const copyBtn = card.querySelector(".copy-btn");
      if (copyBtn && p.proposition) {
        copyBtn.addEventListener("click", () => {
          navigator.clipboard.writeText(p.proposition);
          copyBtn.textContent = "✓ Copied!";
          setTimeout(() => { copyBtn.textContent = "📋 Copy"; }, 2000);
        });
      }
      container.appendChild(card);
    });
  }
}

// ---------------------------------------------------------------------------
// Project Creation Modal Handlers
// ---------------------------------------------------------------------------

function openNewProjectModal() {
  const modal = document.getElementById("modal-new-project");
  if (modal) {
    modal.style.display = "flex";
    document.getElementById("new-proj-name").value = "";
    document.getElementById("new-proj-vault-path").value = "";
    document.getElementById("new-proj-premise").value = "";
    document.getElementById("new-proj-name").focus();
  }
}

function closeNewProjectModal() {
  const modal = document.getElementById("modal-new-project");
  if (modal) modal.style.display = "none";
}

async function submitNewProject() {
  const nameInput = document.getElementById("new-proj-name");
  const pathInput = document.getElementById("new-proj-vault-path");
  const premiseInput = document.getElementById("new-proj-premise");
  const gitInput = document.getElementById("new-proj-git");

  const name = nameInput.value.trim();
  if (!name) {
    alert("Please provide a novel/project title.");
    nameInput.focus();
    return;
  }

  const btnSubmit = document.getElementById("btn-submit-new-project");
  btnSubmit.disabled = true;
  btnSubmit.textContent = "Creating Vault & Git...";

  try {
    const res = await fetch("/api/projects/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name,
        vault_path: pathInput.value.trim() || null,
        premise: premiseInput.value.trim() || null,
        init_git: gitInput.checked,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to create project");
    }

    const data = await res.json();
    currentProject = data.project;
    currentVault = data.project.path;
    closeNewProjectModal();
    updateVaultDisplay();
    renderProjectsDropdown(data.projects, data.project.id);
    loadVaultData();
    checkChapterExists();
    alert(`🎉 Novel project "${name}" created!\n\nVault initialized at:\n${currentVault}`);
  } catch (err) {
    alert("Could not create project: " + err.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = "🚀 Create Project & Vault";
  }
}


