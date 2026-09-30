// Writing Agent Frontend Application
let currentVault = "C:\\Users\\FSGee\\Nextcloud\\book\\Cold\\vault\\MyNovelVault";
let currentProject = { id: "cold", name: "Cold", path: currentVault };
let currentBaseUrl = "http://localhost:1234/v1";
let isProcessing = false;
let stagedAnalysis = null;
let currentIteration = 1;

// Author Style DNA & Language Preferences
let allAuthors = [];
let activeAuthorIds = ["connelly", "clancy", "crichton", "suarez", "robinson"];
let activeLanguage = "en";

function updateWorkbenchWordCount() {
  const wbArea = document.getElementById("workbench-draft-text");
  const countSpan = document.getElementById("workbench-word-count");
  if (!wbArea || !countSpan) return;
  const text = wbArea.value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const chars = text.length;
  countSpan.textContent = `${words.toLocaleString()} words | ${chars.toLocaleString()} characters`;
}

function insertPropositionIntoWorkbench(prop, originalExcerpt) {
  const wbArea = document.getElementById("workbench-draft-text");
  if (!wbArea) return;

  const currentText = wbArea.value;
  if (originalExcerpt && currentText.includes(originalExcerpt)) {
    wbArea.value = currentText.replace(originalExcerpt, prop);
  } else {
    if (wbArea.value.trim()) {
      wbArea.value = wbArea.value.trim() + "\n\n" + prop;
    } else {
      wbArea.value = prop;
    }
  }

  updateWorkbenchWordCount();

  const wbPanel = document.getElementById("workbench-panel");
  if (wbPanel) {
    wbPanel.scrollIntoView({ behavior: "smooth" });
  }
  wbArea.style.borderColor = "var(--emerald)";
  setTimeout(() => { wbArea.style.borderColor = "var(--border)"; }, 1500);
}

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Load initial projects, authors & config
  await loadProjects();
  await loadAuthors();
  checkLmStudioModels();
  loadVaultData();
  checkChapterExists();

  setupEventListeners();
});

// ---------------------------------------------------------------------------
// Author Style DNA & Language Management
// ---------------------------------------------------------------------------

async function loadAuthors() {
  try {
    const res = await fetch("/api/authors");
    if (res.ok) {
      const data = await res.json();
      allAuthors = data.authors || [];
      if (currentProject && currentProject.authors) {
        activeAuthorIds = currentProject.authors;
      } else if (data.active_author_ids) {
        activeAuthorIds = data.active_author_ids;
      }
      if (currentProject && currentProject.language) {
        activeLanguage = currentProject.language;
      } else if (data.active_language) {
        activeLanguage = data.active_language;
      }

      const langSelect = document.getElementById("select-language");
      if (langSelect) langSelect.value = activeLanguage;

      renderAuthorChips();
    }
  } catch (e) {
    console.warn("Could not load authors:", e);
  }
}

function renderAuthorChips() {
  const container = document.getElementById("author-chips-container");
  const badge = document.getElementById("style-count-badge");
  const selectAdd = document.getElementById("select-add-author");
  if (!container) return;

  container.innerHTML = "";
  if (badge) {
    badge.textContent = `${activeAuthorIds.length} / 6 selected`;
  }

  // Render chips
  activeAuthorIds.forEach(aid => {
    const author = allAuthors.find(a => a.id === aid) || { id: aid, name: aid.replace("_", " "), genre: "Style Reference" };
    const chip = document.createElement("div");
    chip.className = "author-chip";
    chip.title = author.description || author.tagline || "";
    chip.innerHTML = `
      <span class="author-chip-name">${escapeHtml(author.name)}</span>
      <span class="author-chip-genre">${escapeHtml(author.genre ? '(' + author.genre.split('/')[0].trim() + ')' : '')}</span>
      <button class="author-chip-del" title="Remove ${escapeHtml(author.name)}">&times;</button>
    `;
    chip.querySelector(".author-chip-del").addEventListener("click", (e) => {
      e.stopPropagation();
      removeAuthor(aid);
    });
    container.appendChild(chip);
  });

  // Populate dropdown with available authors not yet selected
  if (selectAdd) {
    selectAdd.innerHTML = '<option value="" disabled selected>+ Add author style reference to mix (max 6)...</option>';
    if (activeAuthorIds.length >= 6) {
      selectAdd.disabled = true;
      selectAdd.title = "Maximum 6 authors selected in style DNA mix";
    } else {
      selectAdd.disabled = false;
      selectAdd.title = "Select an author to add to your style DNA";
      allAuthors.filter(a => !activeAuthorIds.includes(a.id)).forEach(a => {
        const opt = document.createElement("option");
        opt.value = a.id;
        opt.textContent = `${a.name} — ${a.tagline || a.genre}`;
        selectAdd.appendChild(opt);
      });
    }
  }
}

async function addAuthor(authorId) {
  if (activeAuthorIds.length >= 6) {
    alert("You can select a maximum of 6 reference authors for the style blend.");
    return;
  }
  if (!activeAuthorIds.includes(authorId)) {
    activeAuthorIds.push(authorId);
    renderAuthorChips();
    await savePreferences();
  }
}

async function removeAuthor(authorId) {
  activeAuthorIds = activeAuthorIds.filter(id => id !== authorId);
  renderAuthorChips();
  await savePreferences();
}

async function resetCoreBlend() {
  activeAuthorIds = ["connelly", "clancy", "crichton", "suarez", "robinson"];
  renderAuthorChips();
  await savePreferences();
}

async function savePreferences() {
  if (!currentProject || !currentProject.id) return;
  try {
    await fetch("/api/projects/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: currentProject.id,
        language: activeLanguage,
        authors: activeAuthorIds,
      }),
    });
    currentProject.language = activeLanguage;
    currentProject.authors = activeAuthorIds;
  } catch (e) {
    console.warn("Could not save preferences:", e);
  }
}

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
        if (data.active_project.language) activeLanguage = data.active_project.language;
        if (data.active_project.authors) activeAuthorIds = data.active_project.authors;
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
      if (data.active_project.language) {
        activeLanguage = data.active_project.language;
        const langEl = document.getElementById("select-language");
        if (langEl) langEl.value = activeLanguage;
      }
      if (data.active_project.authors) {
        activeAuthorIds = data.active_project.authors;
        renderAuthorChips();
      }
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
    const statFin = document.getElementById("stat-finished");
    if (statFin) statFin.textContent = data.stats.finished_count || 0;
    document.getElementById("stat-characters").textContent = data.stats.characters_count || 0;
    document.getElementById("stat-threads").textContent = data.stats.threads_count || 0;
    document.getElementById("stat-timeline").textContent = data.stats.timeline_count || 0;

    // Finished Chapters
    const finList = document.getElementById("finished-chapters-list");
    if (finList) {
      finList.innerHTML = "";
      if (data.finished_chapters && data.finished_chapters.length > 0) {
        data.finished_chapters.forEach(fc => {
          const card = document.createElement("div");
          card.className = "finished-chapter-card";
          card.innerHTML = `
            <div class="explorer-card-title">
              <span>📖 ${escapeHtml(fc.title)}</span>
              <span class="badge badge-closed">FINAL</span>
            </div>
            <div class="finished-chapter-meta">
              <span>${(fc.word_count || 0).toLocaleString()} words</span>
              <button class="btn-sm-text btn-preview-fin">👁️ Preview</button>
            </div>
            <div class="fin-preview-content" style="display:none; margin-top:0.6rem; padding-top:0.6rem; border-top:1px solid var(--border); font-size:0.8rem; color:var(--text-muted); max-height:220px; overflow-y:auto; white-space:pre-wrap;">${escapeHtml(fc.content)}</div>
          `;
          const prevBtn = card.querySelector(".btn-preview-fin");
          const prevContent = card.querySelector(".fin-preview-content");
          prevBtn.addEventListener("click", () => {
            const isHidden = prevContent.style.display === "none";
            prevContent.style.display = isHidden ? "block" : "none";
            prevBtn.textContent = isHidden ? "Hide" : "👁️ Preview";
          });
          finList.appendChild(card);
        });
      } else {
        finList.innerHTML = '<div style="font-size:0.8rem; color:var(--text-faint);">No finished chapters yet. Set status to "final" when approving to save finalized manuscripts in this dossier.</div>';
      }
    }

    // Editorial Memory & Learned Skills
    const memEditor = document.getElementById("editorial-memory-editor");
    if (memEditor && data.editorial_memory) {
      memEditor.value = data.editorial_memory;
    }

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

  // Language Selector
  const selectLang = document.getElementById("select-language");
  if (selectLang) {
    selectLang.addEventListener("change", (e) => {
      activeLanguage = e.target.value;
      savePreferences();
    });
  }

  // Author Style DNA Mixer
  const btnCoreBlend = document.getElementById("btn-core-blend");
  if (btnCoreBlend) {
    btnCoreBlend.addEventListener("click", resetCoreBlend);
  }

  const selectAddAuthor = document.getElementById("select-add-author");
  if (selectAddAuthor) {
    selectAddAuthor.addEventListener("change", (e) => {
      if (e.target.value) {
        addAuthor(e.target.value);
        e.target.value = "";
      }
    });
  }

  // Custom Author Modal
  const modalAuthor = document.getElementById("modal-custom-author");
  const btnOpenAuthor = document.getElementById("btn-open-custom-author");
  const btnCloseAuthor = document.getElementById("btn-close-author-modal");
  const btnCancelAuthor = document.getElementById("btn-cancel-author-modal");
  const btnSubmitAuthor = document.getElementById("btn-submit-custom-author");

  if (btnOpenAuthor && modalAuthor) {
    btnOpenAuthor.addEventListener("click", () => {
      document.getElementById("custom-author-name").value = "";
      document.getElementById("custom-author-genre").value = "";
      document.getElementById("custom-author-desc").value = "";
      modalAuthor.style.display = "flex";
      document.getElementById("custom-author-name").focus();
    });
  }
  const closeAuthorModal = () => { if (modalAuthor) modalAuthor.style.display = "none"; };
  if (btnCloseAuthor) btnCloseAuthor.addEventListener("click", closeAuthorModal);
  if (btnCancelAuthor) btnCancelAuthor.addEventListener("click", closeAuthorModal);

  if (btnSubmitAuthor) {
    btnSubmitAuthor.addEventListener("click", async () => {
      const name = document.getElementById("custom-author-name").value.trim();
      const genre = document.getElementById("custom-author-genre").value.trim();
      const desc = document.getElementById("custom-author-desc").value.trim();
      if (!name) { alert("Please enter the author's name."); return; }
      if (!desc) { alert("Please describe their craft traits and stylistic DNA."); return; }

      try {
        const res = await fetch("/api/authors/custom", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, genre, description: desc }),
        });
        if (res.ok) {
          const d = await res.json();
          allAuthors = d.authors;
          if (d.author && !activeAuthorIds.includes(d.author.id)) {
            if (activeAuthorIds.length < 6) {
              activeAuthorIds.push(d.author.id);
            }
          }
          renderAuthorChips();
          await savePreferences();
          closeAuthorModal();
        } else {
          const err = await res.json();
          alert("Error: " + (err.detail || "Could not save custom author"));
        }
      } catch (err) {
        alert("Failed to save author: " + err.message);
      }
    });
  }

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
  document.getElementById("btn-process").addEventListener("click", () => handleProcessChapter(null));

  // Quit / Shutdown Application
  const btnQuit = document.getElementById("btn-quit-app");
  if (btnQuit) {
    btnQuit.addEventListener("click", async () => {
      if (confirm("Are you sure you want to stop the Writing Agent server and close the application?")) {
        try {
          await fetch("/api/shutdown", { method: "POST" });
        } catch (_) {}
        document.body.innerHTML = `
          <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; background:#0c0e14; color:#f3f4f6; font-family:sans-serif; text-align:center;">
            <div style="font-size:3.5rem; margin-bottom:1rem;">👋</div>
            <h2 style="margin-bottom:0.5rem; font-size:1.6rem;">Writing Agent Shut Down</h2>
            <p style="color:#9ca3af; max-width:440px; font-size:0.95rem; line-height:1.5;">The local server process has stopped cleanly. You may now close this window or tab.</p>
          </div>
        `;
        try { window.close(); } catch (_) {}
      }
    });
  }

  // Iterative Polish Workbench Actions
  const wbText = document.getElementById("workbench-draft-text");
  if (wbText) {
    wbText.addEventListener("input", updateWorkbenchWordCount);
  }

  const btnWbClear = document.getElementById("btn-workbench-clear");
  if (btnWbClear) {
    btnWbClear.addEventListener("click", () => {
      if (wbText && confirm("Clear the workbench text?")) {
        wbText.value = "";
        updateWorkbenchWordCount();
      }
    });
  }

  const btnWbSync = document.getElementById("btn-workbench-sync-main");
  if (btnWbSync) {
    btnWbSync.addEventListener("click", () => {
      const mainEditor = document.getElementById("input-draft-text");
      if (mainEditor && wbText) {
        mainEditor.value = wbText.value;
        const words = wbText.value.trim() ? wbText.value.trim().split(/\s+/).length : 0;
        const chars = wbText.value.trim().length;
        const badge = document.getElementById("word-count-badge");
        if (badge) badge.textContent = `${words.toLocaleString()} words | ${chars.toLocaleString()} characters`;
        btnWbSync.textContent = "✓ Synced!";
        setTimeout(() => { btnWbSync.textContent = "⬆ Sync to Main Draft"; }, 2000);
      }
    });
  }

  const btnWbReanalyze = document.getElementById("btn-workbench-reanalyze");
  if (btnWbReanalyze) {
    btnWbReanalyze.addEventListener("click", () => {
      const wbDraft = wbText ? wbText.value.trim() : "";
      if (!wbDraft) {
        alert("Please paste or write your rectified text extract or chapter draft in the workbench.");
        if (wbText) wbText.focus();
        return;
      }
      const notesEl = document.getElementById("workbench-revision-notes");
      const revNotes = notesEl ? notesEl.value.trim() : "";
      currentIteration += 1;
      handleProcessChapter(null, {
        iteration: currentIteration,
        revisionNotes: revNotes,
        draftText: wbDraft,
      });
    });
  }

  // Save Editorial Memory
  const btnSaveMem = document.getElementById("btn-save-editorial-memory");
  if (btnSaveMem) {
    btnSaveMem.addEventListener("click", async () => {
      const memEditor = document.getElementById("editorial-memory-editor");
      if (!memEditor) return;
      btnSaveMem.textContent = "Saving...";
      try {
        const res = await fetch("/api/vault/editorial-memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vault_path: currentVault, content: memEditor.value }),
        });
        if (res.ok) {
          btnSaveMem.textContent = "✓ Saved!";
          setTimeout(() => { btnSaveMem.textContent = "💾 Save Edits"; }, 2000);
        } else {
          throw new Error(await res.text());
        }
      } catch (err) {
        alert("Could not save editorial memory: " + err.message);
        btnSaveMem.textContent = "💾 Save Edits";
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Chapter Processing Stream (Analysis & Staging)
// ---------------------------------------------------------------------------

async function handleProcessChapter(authorClarifications = null, polishOptions = null) {
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

  const effectiveDraftText = polishOptions ? polishOptions.draftText : (isEditorMode ? draftText : null);
  const effectiveDraftFile = (!polishOptions && !isEditorMode) ? draftFile : null;
  const iteration = polishOptions ? (polishOptions.iteration || currentIteration) : (authorClarifications ? currentIteration : 1);
  currentIteration = iteration;
  const revisionNotes = polishOptions ? polishOptions.revisionNotes : null;

  if (!effectiveDraftText && !effectiveDraftFile) {
    alert("Please write or paste your chapter draft text.");
    document.getElementById("input-draft-text").focus();
    return;
  }

  const maxTokensEl = document.getElementById("select-max-tokens");
  const maxTokens = maxTokensEl ? (parseInt(maxTokensEl.value) || 16384) : 16384;
  const langEl = document.getElementById("select-language");
  const language = langEl ? langEl.value : activeLanguage;

  // Setup UI for processing
  isProcessing = true;
  const btnProcess = document.getElementById("btn-process");
  const btnProcessText = document.getElementById("btn-process-text");
  const btnReanalyzeText = document.getElementById("btn-workbench-reanalyze-text");
  btnProcess.disabled = true;
  if (polishOptions) {
    btnProcessText.textContent = `Re-analyzing (Pass #${iteration})...`;
    if (btnReanalyzeText) btnReanalyzeText.textContent = `Re-analyzing (Pass #${iteration})...`;
  } else if (authorClarifications) {
    btnProcessText.textContent = "Re-evaluating with Clarifications...";
  } else {
    btnProcessText.textContent = "Analyzing Chapter Draft...";
  }

  const pipelineSection = document.getElementById("pipeline-section");
  const progressFill = document.getElementById("progress-fill");
  const consoleStream = document.getElementById("console-stream");
  const resultsSection = document.getElementById("results-section");

  pipelineSection.style.display = "flex";
  resultsSection.style.display = "none";
  progressFill.style.width = "5%";

  const iterLabel = iteration > 1 ? ` [Polish Pass #${iteration}]` : "";
  const clarifMsg = authorClarifications ? ` (incorporating ${authorClarifications.length} author clarification(s))` : "";
  consoleStream.textContent = `Starting story agent analysis pipeline${iterLabel} (lang: ${language}, max tokens: ${maxTokens.toLocaleString()})${clarifMsg}...\n`;

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
      draft_text: effectiveDraftText,
      draft_file: effectiveDraftFile,
      max_tokens: maxTokens,
      language: language,
      authors: activeAuthorIds,
      author_clarifications: authorClarifications,
      iteration: iteration,
      revision_notes: revisionNotes,
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
    const btnReanalyzeText = document.getElementById("btn-workbench-reanalyze-text");
    if (btnReanalyzeText) btnReanalyzeText.textContent = "Re-analyze Rectified Draft (Next Polish Pass)";
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

  // Collect any typed continuity clarifications before submitting
  const contContainer = document.getElementById("continuity-cards-container");
  if (contContainer && stagedAnalysis && stagedAnalysis.data) {
    const cards = contContainer.querySelectorAll(".continuity-card");
    if (cards.length > 0) {
      const clarifs = [];
      cards.forEach(c => {
        const descEl = c.querySelector(".continuity-flag-desc");
        const flagText = descEl ? (descEl.getAttribute("data-flag-text") || descEl.textContent.trim()) : "";
        const input = c.querySelector(".continuity-text-input");
        const select = c.querySelector(".continuity-status-select");
        clarifs.push({
          flag: flagText,
          clarification: input ? input.value.trim() : "",
          resolution: select ? select.value : "Clarified",
        });
      });
      stagedAnalysis.data.continuity_clarifications = clarifs;
    }
  // Collect latest draft text and iteration from workbench
  const wbText = document.getElementById("workbench-draft-text");
  if (wbText && wbText.value.trim() && stagedAnalysis) {
    stagedAnalysis.chapter_text = wbText.value.trim();
  }
  if (stagedAnalysis) {
    stagedAnalysis.iteration = currentIteration;
    const stSelect = document.getElementById("input-status");
    if (stSelect) stagedAnalysis.status = stSelect.value;
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

  // Update Iterative Workbench
  if (result.iteration) {
    currentIteration = result.iteration;
  }
  const badgeIter = document.getElementById("workbench-iteration-badge");
  if (badgeIter) {
    badgeIter.textContent = `Pass #${currentIteration}`;
  }

  const wbDraft = document.getElementById("workbench-draft-text");
  if (wbDraft) {
    if (result.draft_text) {
      wbDraft.value = result.draft_text;
    } else if (!wbDraft.value.trim()) {
      const mainDraft = document.getElementById("input-draft-text");
      if (mainDraft && mainDraft.value.trim()) {
        wbDraft.value = mainDraft.value.trim();
      }
    }
    updateWorkbenchWordCount();
  }

  // Interactive Continuity flags & Author clarifications
  const contAlert = document.getElementById("continuity-alert");
  const contContainer = document.getElementById("continuity-cards-container");
  if (contContainer) contContainer.innerHTML = "";

  const flags = result.continuity_flags || [];
  if (flags.length > 0) {
    contAlert.style.display = "flex";

    // Prepare initial clarifications structure
    if (stagedAnalysis && stagedAnalysis.data) {
      if (!stagedAnalysis.data.continuity_clarifications) {
        stagedAnalysis.data.continuity_clarifications = flags.map(f => ({
          flag: typeof f === 'string' ? f : (f.flag || ''),
          clarification: typeof f === 'object' ? (f.clarification || '') : '',
          resolution: typeof f === 'object' ? (f.resolution || 'Clarified') : 'Clarified',
        }));
      }
    }

    flags.forEach((f, idx) => {
      const flagText = typeof f === 'string' ? f : (f.flag || '');
      const existing = (stagedAnalysis && stagedAnalysis.data && stagedAnalysis.data.continuity_clarifications && stagedAnalysis.data.continuity_clarifications[idx]) || {};
      const existingClarif = existing.clarification || '';
      const existingRes = existing.resolution || 'Clarified';

      const card = document.createElement("div");
      card.className = "continuity-card";
      card.innerHTML = `
        <div class="continuity-flag-desc" data-flag-text="${escapeQuotes(flagText)}">
          <strong>Flag ${idx + 1}:</strong> ${escapeHtml(flagText)}
        </div>
        <div class="continuity-input-row">
          <input type="text" class="continuity-text-input" placeholder="Type your answer / clarification for this flag (e.g. cover story, intentional misdirection, etc.)..." value="${escapeHtml(existingClarif)}">
          <select class="continuity-status-select">
            <option value="Clarified" ${existingRes === 'Clarified' ? 'selected' : ''}>Clarified / Canon</option>
            <option value="Misdirection" ${existingRes === 'Misdirection' ? 'selected' : ''}>Intentional Misdirection</option>
            <option value="To Fix" ${existingRes === 'To Fix' ? 'selected' : ''}>To Fix in Draft</option>
            <option value="Dismiss" ${existingRes === 'Dismiss' ? 'selected' : ''}>False Alarm / Dismiss</option>
          </select>
        </div>
      `;

      const input = card.querySelector(".continuity-text-input");
      const select = card.querySelector(".continuity-status-select");

      const updateStaged = () => {
        if (stagedAnalysis && stagedAnalysis.data) {
          if (!stagedAnalysis.data.continuity_clarifications) {
            stagedAnalysis.data.continuity_clarifications = [];
          }
          stagedAnalysis.data.continuity_clarifications[idx] = {
            flag: flagText,
            clarification: input.value.trim(),
            resolution: select.value,
          };
        }
      };

      input.addEventListener("input", updateStaged);
      select.addEventListener("change", updateStaged);

      contContainer.appendChild(card);
    });

    // Wire up Re-evaluate button
    const btnReevaluate = document.getElementById("btn-reevaluate-clarifications");
    if (btnReevaluate) {
      btnReevaluate.onclick = () => {
        const clarifications = [];
        const cards = contContainer.querySelectorAll(".continuity-card");
        cards.forEach((c, i) => {
          const descEl = c.querySelector(".continuity-flag-desc");
          const flagText = descEl ? (descEl.getAttribute("data-flag-text") || descEl.textContent.trim()) : "";
          const input = c.querySelector(".continuity-text-input");
          const select = c.querySelector(".continuity-status-select");
          clarifications.push({
            flag: flagText,
            clarification: input ? input.value.trim() : "",
            resolution: select ? select.value : "Clarified",
          });
        });
        handleProcessChapter(clarifications);
      };
    }
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
          <div style="display:flex; gap:0.35rem; align-items:center;">
            <button class="btn-secondary copy-btn" style="padding:0.2rem 0.5rem; font-size:0.75rem;">📋 Copy</button>
            <button class="btn-use-prop use-prop-btn" title="Replace or insert this proposition in your Polish Workbench">✏️ Use in Draft</button>
          </div>
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
      const useBtn = card.querySelector(".use-prop-btn");
      if (useBtn && d.proposition) {
        useBtn.addEventListener("click", () => {
          insertPropositionIntoWorkbench(d.proposition, d.original_line);
          useBtn.textContent = "✓ In Draft!";
          setTimeout(() => { useBtn.textContent = "✏️ Use in Draft"; }, 2000);
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
          <div style="display:flex; gap:0.35rem; align-items:center;">
            <button class="btn-secondary copy-btn" style="padding:0.2rem 0.5rem; font-size:0.75rem;">📋 Copy</button>
            <button class="btn-use-prop use-prop-btn" title="Replace or insert this proposition in your Polish Workbench">✏️ Use in Draft</button>
          </div>
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
      const useBtn = card.querySelector(".use-prop-btn");
      if (useBtn && p.proposition) {
        useBtn.addEventListener("click", () => {
          insertPropositionIntoWorkbench(p.proposition, p.original_excerpt);
          useBtn.textContent = "✓ In Draft!";
          setTimeout(() => { useBtn.textContent = "✏️ Use in Draft"; }, 2000);
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


