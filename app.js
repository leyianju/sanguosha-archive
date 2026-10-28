/* 桃园卡册 · SANGUOSHA ARCHIVE */

(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const READ_ONLY = window.SANGUOSHA_READONLY === true;

  const THEME_KEY = "sanguosha-theme";
  const THEME_CHOICES = ["auto", "light", "dark"];
  const THEME_MEDIA = matchMedia("(prefers-color-scheme: dark)");
  const RARITIES = ["D", "C", "B", "A", "S", "SS", "SSS"];
  const RARITY_RANK = { D: 0, C: 1, B: 2, A: 3, S: 4, SS: 5, SSS: 6 };

  const FACTION_COLORS = {
    魏: "#6b9bc2",
    蜀: "#7faa6d",
    吴: "#c16b5f",
    群: "#c3a66e",
    神: "#a587c9",
    其他: "#8b8578",
  };

  const FOLDER_LABELS = {
    all: "全部",
    "2304": "标准 2304",
    SP: "SP",
    TE: "TE",
    "2304-特殊": "特殊",
  };
  const FOLDER_ORDER = ["2304", "TE", "SP", "坤坤杀", "红星星火"];

  const state = {
    cards: [],
    attachments: [],
    folders: {},
    filtered: [],
    folder: "all",
    faction: "",
    prefix: "",
    rarity: "",
    q: "",
    sort: "id",
    detailId: null,
    editId: null,
    editMode: "edit",
    editImageData: "",
    editImageName: "",
    attachmentId: null,
    attachmentBack: false,
    viewerIndex: 0,
    viewerOpen: false,
    loadError: "",
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[char]));
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function icon(name) {
    return `<svg class="icon"><use href="#icon-${name}"></use></svg>`;
  }

  function factionColor(faction) {
    return FACTION_COLORS[faction] || FACTION_COLORS.其他;
  }

  function normalizeRarity(value) {
    const rarity = String(value || "").trim().toUpperCase();
    return RARITIES.includes(rarity) ? rarity : "C";
  }

  function hpLabel(card) {
    const current = card.hp;
    const maximum = card.hp_max ?? current;
    const armor = Number(card.armor) || 0;
    let text;
    if (current == null && maximum == null) text = "HP —";
    else if (current == null || current === maximum) text = `${maximum} HP`;
    else text = `${current} / ${maximum} HP`;
    if (armor > 0) text += ` + ${armor} 护甲`;
    return text;
  }

  async function deleteCard(id) {
    if (READ_ONLY) return;
    const card = state.cards.find((item) => item.id === id);
    if (!card) return;
    const attachments = state.attachments.filter((item) => item.owner_id === id).length;
    const extra = attachments ? `\n名下 ${attachments} 张附属牌也会一起删除。` : "";
    if (!window.confirm(`确定删除「${card.name}」？${extra}`)) return;
    try {
      const response = await fetch(`api/cards/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `删除失败（HTTP ${response.status}）`);
      state.cards = state.cards.filter((item) => item.id !== id);
      state.attachments = state.attachments.filter((item) => item.owner_id !== id);
      if (state.detailId === id) closeDetail();
      render();
      toast(`「${card.name}」已删除${attachments ? `，同时删除 ${attachments} 张附属牌` : ""}。`, "success", "卡牌已删除");
    } catch (error) {
      toast(error.message, "error", "删除失败");
    }
  }

  function seriesLabel(series) {
    if (series === "2304-特殊") return "特殊编号";
    return folderName(series) || series || "标准";
  }

  function skillHtml(skill) {
    const rich = String(skill && skill.text_html || "").trim();
    return rich || escapeHtml(skill && skill.text || "");
  }

  function sourceTypeLabel(type) {
    return {
      self: "本卡",
      variant: "同名",
      general: "武将",
      attachment: "附加牌",
      classic: "经典",
    }[type] || "来源";
  }

  function skillRefsHtml(skill, card) {
    const refs = ((card.skill_refs || {})[skill.name] || [])
      .filter((ref) => ref.source_type !== "classic");
    if (!refs.length) return "";
    return `<div class="skill-refs">引用：${refs.map((ref) => {
      const target = ref.source_type === "classic" ? "" : `data-source-id="${escapeHtml(ref.source_id)}"`;
      const label = `${ref.name} · ${ref.source_name || ref.source_title || ""}（${sourceTypeLabel(ref.source_type)}）`;
      return `<button type="button" class="skill-ref" ${target} title="${escapeHtml(ref.source_text || label)}">${escapeHtml(label)}</button>`;
    }).join("")}</div>`;
  }

  function normalizeFolders(raw) {
    const folders = {};
    if (!raw || typeof raw !== "object") return folders;
    Object.entries(raw).forEach(([key, value]) => {
      if (typeof value === "string") {
        folders[key] = { name: value, parent: null };
      } else if (value && typeof value === "object") {
        folders[key] = {
          name: String(value.name || key),
          parent: value.parent ? String(value.parent) : null,
        };
      }
    });
    return folders;
  }

  function folderName(key) {
    const value = state.folders[key];
    const name = value && typeof value === "object" ? value.name : value;
    return name || FOLDER_LABELS[key] || key || "未命名分册";
  }

  function folderParent(key) {
    const value = state.folders[key];
    return value && typeof value === "object" && value.parent ? value.parent : null;
  }

  function folderPath(key) {
    const labels = [];
    const seen = new Set();
    let cursor = key;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      labels.unshift(folderName(cursor));
      cursor = folderParent(cursor);
    }
    return labels.join(" / ");
  }

  function folderDescendantKeys(key) {
    const result = new Set([key]);
    let changed = true;
    while (changed) {
      changed = false;
      Object.keys(state.folders).forEach((candidate) => {
        if (!result.has(candidate) && result.has(folderParent(candidate))) {
          result.add(candidate);
          changed = true;
        }
      });
    }
    return result;
  }

  function folderDefs() {
    const keys = [...new Set([
      ...Object.keys(state.folders),
      ...state.cards.map((card) => card.series).filter(Boolean),
    ])];
    keys.forEach((key) => {
      if (!state.folders[key]) state.folders[key] = { name: key, parent: null };
    });
    const known = new Set(keys);
    const children = new Map();
    keys.forEach((key) => {
      const parent = folderParent(key);
      const bucket = parent && known.has(parent) && parent !== key ? parent : "";
      if (!children.has(bucket)) children.set(bucket, []);
      children.get(bucket).push(key);
    });
    const sortKeys = (list) => list.sort((a, b) => {
      const ai = FOLDER_ORDER.indexOf(a);
      const bi = FOLDER_ORDER.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return folderName(a).localeCompare(folderName(b), "zh-CN");
    });
    const defs = [{ key: "all", label: "全部", icon: "grid", depth: 0 }];
    const walk = (parent, depth) => {
      sortKeys(children.get(parent) || []).forEach((key) => {
        defs.push({ key, label: folderName(key), icon: "book", depth });
        walk(key, depth + 1);
      });
    };
    walk("", 0);
    return defs;
  }

  function cardMatchesFolder(card, folder) {
    return folder === "all" || folderDescendantKeys(folder).has(card.series);
  }

  function cardMatchesQuery(card, query) {
    if (!query) return true;
    const needle = query.toLocaleLowerCase();
    const chunks = [
      card.name,
      card.title,
      card.id,
      card.series,
      card.faction,
      card.prefix,
      card.rarity,
      card.quote,
      ...Object.values(card.skill_refs || {}).flatMap((refs) =>
        (refs || []).flatMap((ref) => [ref.name, ref.source_name, ref.source_title])),
      ...(card.skills || []).flatMap((skill) => [skill.name, skill.text]),
    ];
    return chunks.join(" ").toLocaleLowerCase().includes(needle);
  }

  function sortCards(cards) {
    const copy = cards.slice();
    if (state.sort === "name") {
      copy.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-CN"));
    } else if (state.sort === "title") {
      copy.sort((a, b) => String(a.title).localeCompare(String(b.title), "zh-CN"));
    } else if (state.sort === "rarity") {
      copy.sort((a, b) => {
        const diff = (RARITY_RANK[normalizeRarity(b.rarity)] || 0) - (RARITY_RANK[normalizeRarity(a.rarity)] || 0);
        return diff || String(a.id).localeCompare(String(b.id), "zh-CN", { numeric: true });
      });
    } else {
      copy.sort((a, b) => String(a.id).localeCompare(String(b.id), "zh-CN", { numeric: true }));
    }
    return copy;
  }

  function computeFiltered() {
    const query = state.q.trim();
    state.filtered = sortCards(state.cards.filter((card) =>
      cardMatchesFolder(card, state.folder) &&
      (!state.faction || card.faction === state.faction) &&
      (!state.prefix || card.prefix === state.prefix) &&
      (!state.rarity || normalizeRarity(card.rarity) === state.rarity) &&
      cardMatchesQuery(card, query)
    ));
  }

  function countBy(predicate) {
    return state.cards.filter(predicate).length;
  }

  function renderStats() {
    const factions = [...new Set(state.cards.map((card) => card.faction).filter(Boolean))];
    const skills = state.cards.reduce((sum, card) => sum + (card.skills || []).length, 0);
    const ids = state.cards.map((card) => card.id).sort((a, b) =>
      String(a).localeCompare(String(b), "zh-CN", { numeric: true }));
    $("#statTotal").textContent = state.cards.length;
    $("#statFactions").textContent = factions.length ? factions.join(" / ") : "—";
    $("#statSkills").textContent = skills;
    $("#statRange").textContent = ids.length ? `${ids[0]} — ${ids[ids.length - 1]}` : "—";
    $("#statAttachments").textContent = state.attachments.length || "—";
  }

  function renderFolderTabs() {
    const host = $("#folderTabs");
    const defs = folderDefs();
    if (!defs.some((folder) => folder.key === state.folder)) state.folder = "all";
    host.innerHTML = defs.map((folder) => {
      const subtree = folder.key === "all" ? null : folderDescendantKeys(folder.key);
      const count = folder.key === "all"
        ? state.cards.length
        : countBy((card) => subtree.has(card.series));
      const active = state.folder === folder.key;
      const depth = Number(folder.depth) || 0;
      const branch = depth ? `<span class="folder-branch">↳</span>` : "";
      return `
        <button type="button" class="folder-tab ${active ? "active" : ""}" data-folder="${escapeHtml(folder.key)}"
          style="--folder-depth:${depth}" aria-pressed="${active}">
          ${icon(folder.icon || "book")}
          ${branch}<span>${escapeHtml(folder.label)}</span>
          <b>${count}</b>
        </button>`;
    }).join("");
  }

  function renderFactionOptions() {
    const select = $("#factionFilter");
    const current = state.faction;
    const factions = [...new Set(state.cards.map((card) => card.faction).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "zh-CN"));
    select.innerHTML = `<option value="">全部势力</option>${factions.map((faction) =>
      `<option value="${escapeHtml(faction)}">${escapeHtml(faction)}</option>`).join("")}`;
    select.value = current;
  }

  function renderPrefixOptions() {
    const select = $("#prefixFilter");
    if (!select) return;
    const counts = new Map();
    state.cards.forEach((card) => {
      const prefix = String(card.prefix || "").trim();
      if (prefix) counts.set(prefix, (counts.get(prefix) || 0) + 1);
    });
    const prefixes = [...counts.keys()].sort((a, b) => a.localeCompare(b, "zh-CN"));
    if (state.prefix && !prefixes.includes(state.prefix)) state.prefix = "";
    select.innerHTML = `<option value="">全部前缀</option>${prefixes.map((prefix) =>
      `<option value="${escapeHtml(prefix)}">${escapeHtml(prefix)} · ${counts.get(prefix)}</option>`).join("")}`;
    select.value = state.prefix;
  }

  function renderRarityOptions() {
    const select = $("#rarityFilter");
    if (!select) return;
    const counts = new Map(RARITIES.map((rarity) => [rarity, 0]));
    state.cards.forEach((card) => {
      const rarity = normalizeRarity(card.rarity);
      counts.set(rarity, (counts.get(rarity) || 0) + 1);
    });
    select.innerHTML = `<option value="">全部稀有度</option>${RARITIES.map((rarity) =>
      `<option value="${rarity}">${rarity} · ${counts.get(rarity) || 0}</option>`).join("")}`;
    select.value = state.rarity;
  }

  function renderCards() {
    const grid = $("#cardGrid");
    if (state.loadError) {
      grid.innerHTML = "";
      $("#emptyState").hidden = false;
      $("#emptyState h3").textContent = "卡册没有打开";
      $("#emptyState p").textContent = state.loadError;
      return;
    }
    if (!state.filtered.length) {
      grid.innerHTML = "";
      $("#emptyState").hidden = false;
      $("#emptyState h3").textContent = "没有找到这张卡";
      $("#emptyState p").textContent = "换个关键词，或者回到全部卡册。";
      return;
    }
    $("#emptyState").hidden = true;
    grid.innerHTML = state.filtered.map((card, index) => {
      const skills = card.skills || [];
      const attachmentCount = state.attachments.filter((item) => item.owner_id === card.id).length;
      const factionTint = factionColor(card.faction);
      return `
        <article class="card-item" style="--i:${index % 12};--faction-color:${factionTint}">
          <button type="button" class="card-open" data-card-id="${escapeHtml(card.id)}"
            aria-label="打开卡牌：${escapeHtml(card.name)} ${escapeHtml(card.title)}">
            <span class="card-frame">
              <img src="${escapeHtml(card.thumb)}" alt="${escapeHtml(card.name)}的卡面"
                loading="${index < 12 ? "eager" : "lazy"}" decoding="async">
              <span class="rarity-edge rarity-${normalizeRarity(card.rarity)}"></span>
            </span>
            <span class="card-caption">
              <span class="card-name">${card.prefix ? `<span class="name-prefix">${escapeHtml(card.prefix)}</span>` : ""}${escapeHtml(card.name)}</span>
              <span class="card-title">${escapeHtml(card.title)}</span>
              <span class="card-rarity-mark rarity-${normalizeRarity(card.rarity)}" title="稀有度 ${normalizeRarity(card.rarity)}">${normalizeRarity(card.rarity)}</span>
              ${card.prefix ? `<span class="card-prefix">前缀 · ${escapeHtml(card.prefix)}</span>` : ""}
              <span class="card-id">${escapeHtml(card.id)}</span>
            </span>
            <span class="card-meta">
              <i class="faction-dot"></i>
              <span>${escapeHtml(card.faction || "其他")}</span>
              <span class="hp-meta">· ${escapeHtml(hpLabel(card))}</span>
              <span class="skill-count">· ${skills.length} 技能</span>
              ${attachmentCount ? `<span class="attachment-count">· ${attachmentCount} 附件</span>` : ""}
            </span>
          </button>
        </article>`;
    }).join("");
  }

  function renderSummary() {
    const total = state.filtered.length;
    const prefix = state.folder !== "all" ? `「${folderPath(state.folder)}」` : "";
    const filtered = Boolean(state.q || state.faction || state.prefix || state.rarity || state.folder !== "all");
    $("#resultSummary").textContent = total
      ? `${prefix}${filtered ? "筛出" : "共收录"} ${total} 张卡`
      : `${prefix}没有卡`;
    $("#clearFiltersBtn").hidden = !(state.q || state.faction || state.prefix || state.rarity || state.folder !== "all");
  }

  function render() {
    computeFiltered();
    renderStats();
    renderFolderTabs();
    renderCards();
    renderSummary();
  }

  function openOverlay(id) {
    const overlay = document.getElementById(id);
    if (!overlay || !overlay.hidden) return;
    overlay.hidden = false;
    document.body.classList.add("modal-open");
    setTimeout(() => overlay.querySelector(".modal-close")?.focus({ preventScroll: true }), 40);
  }

  function closeOverlay(id) {
    const overlay = document.getElementById(id);
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    if (!document.querySelector(".modal-overlay:not([hidden])") && !state.viewerOpen) {
      document.body.classList.remove("modal-open");
    }
    if (id === "detailOverlay") state.detailId = null;
    if (id === "editOverlay") state.editId = null;
    if (id === "attachmentOverlay") {
      state.attachmentId = null;
      state.attachmentBack = false;
    }
  }

  function detailIndex(id) {
    return state.filtered.findIndex((card) => card.id === id);
  }

  function showDetail(id) {
    const card = state.cards.find((item) => item.id === id);
    if (!card) return;
    state.detailId = id;
    const faction = card.faction || "其他";
    const skills = card.skills || [];
    $("#detailImage").src = card.image;
    $("#detailImage").alt = `${card.name}的完整卡面`;
    $("#detailId").textContent = `NO. ${card.id}`;
    const prefix = String(card.prefix || "").trim();
    $("#detailName").textContent = card.name;
    $("#detailPrefixMark").hidden = !prefix;
    $("#detailPrefixMark").textContent = prefix;
    $("#detailPrefix").hidden = !prefix;
    $("#detailPrefix").textContent = prefix ? `前缀 ${prefix}` : "";
    const rarity = normalizeRarity(card.rarity);
    $("#detailRarity").className = `detail-rarity-mark rarity-${rarity}`;
    $("#detailRarity").innerHTML = `<span>稀有度</span><strong>${rarity}</strong>`;
    $("#detailRarity").title = `稀有度 ${rarity}`;
    $("#detailTitle").textContent = card.title;
    $("#detailDeleteBtn").hidden = READ_ONLY;
    $("#detailFaction").textContent = faction;
    $("#detailFaction").style.setProperty("--faction-color", factionColor(faction));
    $("#detailHp").textContent = hpLabel(card);
    $("#detailSeries").textContent = seriesLabel(card.series);
    $("#detailSkills").innerHTML = skills.length
      ? skills.map((skill, index) => `
          <section class="skill${skill.derived ? " derived" : ""}">
            <span class="skill-name">${escapeHtml(skill.name || `技能 ${index + 1}`)}${skill.derived ? `<span class="derived-tag">衍生</span>` : ""}</span>
            <p class="skill-text">${skillHtml(skill)}</p>
            ${skillRefsHtml(skill, card)}
          </section>`).join("")
      : `<p class="skill-text" style="color:var(--dim)">卡面上没有识别到技能文字。</p>`;
    $("#detailQuote").hidden = !card.quote;
    const quoteText = card.quote || "";
    const sourceAt = quoteText.lastIndexOf("——");
    const quoteBody = (sourceAt > 0 && quoteText.length - sourceAt > 2)
      ? quoteText.slice(0, sourceAt).trim()
      : quoteText.trim();
    const quoteSource = (sourceAt > 0 && quoteText.length - sourceAt > 2)
      ? quoteText.slice(sourceAt).trim()
      : "";
    const quoteDisplay = quoteBody
      ? (/^[“「]/.test(quoteBody) ? quoteBody : `“${quoteBody}”`)
      : "";
    $("#detailQuote").innerHTML = quoteDisplay
      ? `<span class="quote-text">${escapeHtml(quoteDisplay)}</span>${quoteSource ? `<span class="quote-source">${escapeHtml(quoteSource)}</span>` : ""}`
      : "";
    renderDetailReferences(card);
    renderDetailAttachments(card);
    $("#detailMetaLeft").textContent = `${card.id} · ${skills.length} 个技能`;
    $("#detailMetaRight").textContent = `${faction} · ${seriesLabel(card.series)}`;
    const index = detailIndex(id);
    $("#detailPrevBtn").disabled = index <= 0;
    $("#detailNextBtn").disabled = index < 0 || index >= state.filtered.length - 1;
    openOverlay("detailOverlay");
    const hash = `#card=${encodeURIComponent(id)}`;
    if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
  }

  function moveDetail(delta) {
    if (!state.detailId) return;
    const index = detailIndex(state.detailId);
    if (index < 0) return;
    const next = state.filtered[index + delta];
    if (next) showDetail(next.id);
  }

  function closeDetail() {
    closeOverlay("detailOverlay");
    if (/^#card=/.test(window.location.hash)) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }

  function addEditSkillRow(skill = {}) {
    const row = document.createElement("div");
    row.className = "edit-skill";
    row.innerHTML = `
      <input class="edit-skill-name" maxlength="30" placeholder="技能名" autocomplete="off">
      <textarea class="edit-skill-text" rows="3" maxlength="1200" placeholder="技能描述"></textarea>
      <label class="edit-skill-derived"><input type="checkbox" class="edit-skill-derived-input"> 衍生技</label>
      <button type="button" class="edit-skill-remove" aria-label="删除这个技能">×</button>`;
    row.querySelector(".edit-skill-name").value = skill.name || "";
    row.querySelector(".edit-skill-text").value = skill.text || "";
    row.querySelector(".edit-skill-derived-input").checked = Boolean(skill.derived);
    row.querySelector(".edit-skill-remove").addEventListener("click", () => {
      const rows = $$(".edit-skill", $("#editSkills"));
      if (rows.length <= 1) {
        row.querySelector(".edit-skill-name").value = "";
        row.querySelector(".edit-skill-text").value = "";
        return;
      }
      row.remove();
    });
    $("#editSkills").appendChild(row);
    return row;
  }

  function fillSeriesSelect(selected) {
    const defs = folderDefs().filter((folder) => folder.key !== "all");
    const keys = defs.map((folder) => folder.key);
    if (selected && !keys.includes(selected)) keys.push(selected);
    $("#editSeries").innerHTML = keys.map((key) =>
      `<option value="${escapeHtml(key)}">${escapeHtml(folderPath(key))}</option>`).join("");
    $("#editSeries").value = selected || keys[0] || "2304";
  }

  function setEditImage(dataUrl) {
    state.editImageData = dataUrl || "";
    const preview = $("#editImagePreview");
    preview.hidden = !dataUrl;
    if (dataUrl) $("#editImagePreviewImg").src = dataUrl;
    else $("#editImagePreviewImg").removeAttribute("src");
  }

  function openEdit(id = null) {
    if (READ_ONLY) return;
    const card = id ? state.cards.find((item) => item.id === id) : null;
    if (id && !card) return;
    state.editId = id;
    state.editMode = card ? "edit" : "create";
    $("#editHeading").textContent = card ? `编辑「${card.name}」` : "新增卡牌";
    $("#editSub").textContent = card
      ? `${card.id} · 修改会写回本地卡表，下一次打开还在。`
      : "给一张新卡取称号、名字和分册；上传卡面后保存。";
    $("#editTitle").value = card?.title || "";
    $("#editName").value = card?.name || "";
    $("#editFaction").value = card?.faction || "群";
    $("#editPrefix").value = card?.prefix || "";
    $("#editRarity").value = normalizeRarity(card?.rarity || "C");
    $("#editHp").value = card?.hp == null ? "" : String(card.hp);
    $("#editHpMax").value = card?.hp_max == null ? "" : String(card.hp_max);
    $("#editArmor").value = card?.armor ? String(card.armor) : "";
    $("#editQuote").value = card?.quote || "";
    $("#editError").hidden = true;
    $("#editError").textContent = "";
    $("#editSkills").innerHTML = "";
    const skills = card?.skills?.length ? card.skills : [{}];
    skills.forEach((skill) => addEditSkillRow(skill));
    const factions = [...new Set(state.cards.map((item) => item.faction).filter(Boolean))];
    $("#factionList").innerHTML = factions.map((faction) =>
      `<option value="${escapeHtml(faction)}"></option>`).join("");
    const series = Object.keys(state.folders);
    $("#seriesList").innerHTML = series.map((value) =>
      `<option value="${escapeHtml(value)}"></option>`).join("");
    fillSeriesSelect(card?.series || (state.folder !== "all" ? state.folder : "2304"));
    $("#editImageField").hidden = Boolean(card);
    $("#editImageInput").value = "";
    state.editImageName = "";
    setEditImage("");
    $("#recognizeBtn").hidden = true;
    $("#recognizeStatus").textContent = "";
    $("#editSaveBtn").textContent = card ? "保存修改" : "添加卡牌";
    openOverlay("editOverlay");
    setTimeout(() => (card ? $("#editName") : $("#editImageInput")).focus({ preventScroll: true }), 70);
  }

  function collectEditSkills() {
    return $$(".edit-skill", $("#editSkills"))
      .map((row) => ({
        name: row.querySelector(".edit-skill-name").value.trim(),
        text: row.querySelector(".edit-skill-text").value.trim(),
        derived: row.querySelector(".edit-skill-derived-input").checked,
      }))
      .filter((skill) => skill.name || skill.text);
  }

  function showEditError(message) {
    const box = $("#editError");
    box.textContent = message;
    box.hidden = !message;
  }

  function setButtonLoading(button, busy, label = "处理中…") {
    if (!button) return;
    if (busy) {
      if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.classList.add("is-loading");
      button.textContent = label;
    } else {
      button.disabled = false;
      button.classList.remove("is-loading");
      if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
      }
    }
  }

  async function recognizeCurrentImage() {
    if (READ_ONLY) return;
    if (!state.editImageData) {
      showEditError("先上传一张卡面图片。");
      return;
    }
    const button = $("#recognizeBtn");
    const status = $("#recognizeStatus");
    showEditError("");
    status.textContent = "正在读卡面…";
    setButtonLoading(button, true, "识别中…");
    try {
      const response = await fetch("api/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_data: state.editImageData,
          filename: state.editImageName,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `识别失败（HTTP ${response.status}）`);
      if (data.name) $("#editName").value = data.name;
      if (data.title) $("#editTitle").value = data.title;
      if (data.prefix && !$("#editPrefix").value.trim()) $("#editPrefix").value = data.prefix;
      if (data.quote) $("#editQuote").value = data.quote;
      const rows = $$(".edit-skill", $("#editSkills"));
      const hasSkillContent = rows.some((row) =>
        row.querySelector(".edit-skill-name").value.trim() ||
        row.querySelector(".edit-skill-text").value.trim());
      const foundSkills = Array.isArray(data.skills) ? data.skills : [];
      if (!hasSkillContent) {
        $("#editSkills").innerHTML = "";
        if (foundSkills.length) {
          foundSkills.forEach((skill) => addEditSkillRow(skill));
        } else {
          addEditSkillRow();
        }
      } else if (foundSkills.length) {
        const emptyRow = rows.find((row) =>
          !row.querySelector(".edit-skill-text").value.trim());
        if (emptyRow) emptyRow.querySelector(".edit-skill-text").value = foundSkills[0].text || "";
      }
      status.textContent = data.ocr_available
        ? "识别完成：名字/称号来自文件名，引言和技能正文已尽量填入，请核对。"
        : "系统 OCR 不可用，已按文件名填入名字和称号。";
      toast(
        data.ocr_available ? "卡面文字已识别，请核对技能名。" : "只能按文件名识别。",
        data.ocr_available ? "success" : "warning",
        "识别卡面"
      );
    } catch (error) {
      status.textContent = "";
      showEditError(error.message);
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (READ_ONLY) return;
    const creating = state.editMode === "create";
    if (!creating && !state.editId) return;
    const name = $("#editName").value.trim();
    const title = $("#editTitle").value.trim();
    if (!name || !title) {
      showEditError("称号和名字不能为空。");
      (!name ? $("#editName") : $("#editTitle")).focus();
      return;
    }
    if (creating && !state.editImageData) {
      showEditError("新卡需要先上传一张卡面图片。");
      $("#editImageInput").focus();
      return;
    }
    const hpText = $("#editHp").value.trim();
    const hpMaxText = $("#editHpMax").value.trim();
    const armorText = $("#editArmor").value.trim();
    const hp = hpText === "" ? null : Number(hpText);
    const hpMax = hpMaxText === "" ? hp : Number(hpMaxText);
    const armor = armorText === "" ? 0 : Number(armorText);
    if (hp !== null && (!Number.isFinite(hp) || hp < 0 || hp > 30)) {
      showEditError("当前体力需要是 0 到 30 的整数。");
      $("#editHp").focus();
      return;
    }
    if (hpMax !== null && (!Number.isFinite(hpMax) || hpMax < 0 || hpMax > 30)) {
      showEditError("体力上限需要是 0 到 30 的整数。");
      $("#editHpMax").focus();
      return;
    }
    if (hp !== null && hpMax !== null && hp > hpMax) {
      showEditError("当前体力不能大于体力上限。");
      $("#editHp").focus();
      return;
    }
    if (!Number.isFinite(armor) || armor < 0 || armor > 30) {
      showEditError("护甲需要是 0 到 30 的整数。");
      $("#editArmor").focus();
      return;
    }
    const series = $("#editSeries").value.trim() || "2304";
    const payload = {
      name,
      title,
      faction: $("#editFaction").value.trim() || "其他",
      prefix: $("#editPrefix").value.trim(),
      rarity: normalizeRarity($("#editRarity").value),
      hp: hp === null ? null : Math.round(hp),
      hp_max: hpMax === null ? null : Math.round(hpMax),
      armor: Math.round(armor),
      series,
      quote: $("#editQuote").value.trim(),
      skills: collectEditSkills(),
    };
    if (creating) payload.image_data = state.editImageData;
    const button = $("#editSaveBtn");
    showEditError("");
    button.disabled = true;
    button.textContent = creating ? "上传并保存…" : "保存中…";
    try {
      const url = creating ? "api/cards" : `api/cards/${encodeURIComponent(state.editId)}`;
      const response = await fetch(url, {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `保存失败（HTTP ${response.status}）`);
      if (!data.card) throw new Error("保存成功但没有返回卡牌数据。");
      if (creating) {
        state.cards.push(data.card);
        state.folder = data.card.series;
        state.faction = "";
        state.prefix = "";
        state.rarity = "";
        state.q = "";
        $("#searchInput").value = "";
        $("#factionFilter").value = "";
        $("#prefixFilter").value = "";
        $("#rarityFilter").value = "";
      } else {
        const index = state.cards.findIndex((item) => item.id === state.editId);
        if (index >= 0) state.cards[index] = data.card;
      }
      if (data.folders) state.folders = normalizeFolders(data.folders);
      if (!state.folders[data.card.series]) {
        state.folders[data.card.series] = { name: data.card.series, parent: null };
      }
      const factions = [...new Set(state.cards.map((item) => item.faction).filter(Boolean))];
      if (state.faction && !factions.includes(state.faction)) state.faction = "";
      if (state.prefix && !state.cards.some((item) => item.prefix === state.prefix)) state.prefix = "";
      if (state.rarity && !state.cards.some((item) => normalizeRarity(item.rarity) === state.rarity)) state.rarity = "";
      renderFactionOptions();
      renderPrefixOptions();
      renderRarityOptions();
      render();
      closeOverlay("editOverlay");
      showDetail(data.card.id);
      toast(
        creating ? `「${data.card.name}」已加入「${folderLabel(data.card.series)}」。` : `「${data.card.name}」已保存。`,
        "success",
        creating ? "新卡入册" : "卡牌已修改"
      );
    } catch (error) {
      showEditError(error.message);
    } finally {
      button.disabled = false;
      button.textContent = creating ? "添加卡牌" : "保存修改";
    }
  }

  function renderFolderManager() {
    const defs = folderDefs().filter((folder) => folder.key !== "all");
    $("#folderManageList").innerHTML = defs.map((folder) => {
      const key = folder.key;
      const subtree = folderDescendantKeys(key);
      const count = state.cards.filter((card) => subtree.has(card.series)).length;
      const blocked = folderDescendantKeys(key);
      const parentOptions = [
        `<option value="">顶级分册</option>`,
        ...defs.filter((candidate) => !blocked.has(candidate.key)).map((candidate) =>
          `<option value="${escapeHtml(candidate.key)}" ${folderParent(key) === candidate.key ? "selected" : ""}>${escapeHtml(folderPath(candidate.key))}</option>`),
      ].join("");
      return `
        <div class="folder-manage-row" data-folder-key="${escapeHtml(key)}" style="--folder-depth:${folder.depth}">
          <div class="folder-row-main">
            ${folder.depth ? `<span class="folder-branch">↳</span>` : ""}
            <input class="folder-name-input" maxlength="30" value="${escapeHtml(folderName(key))}"
              aria-label="分册名">
          </div>
          <select class="folder-parent-select" aria-label="上级分册">${parentOptions}</select>
          <small>${count} 张</small>
          <button type="button" data-save-folder>保存</button>
          <button type="button" class="folder-delete" data-delete-folder title="只能删除空分册">删除</button>
        </div>`;
    }).join("");
    const parentSelect = $("#newFolderParent");
    if (parentSelect) {
      parentSelect.innerHTML = `<option value="">顶级分册</option>${defs.map((folder) =>
        `<option value="${escapeHtml(folder.key)}">${escapeHtml(folderPath(folder.key))}</option>`).join("")}`;
    }
  }

  function showFolderError(message) {
    const box = $("#folderError");
    box.textContent = message;
    box.hidden = !message;
  }

  function openFolderManager() {
    if (READ_ONLY) return;
    renderFolderManager();
    showFolderError("");
    $("#newFolderName").value = "";
    openOverlay("folderOverlay");
  }

  async function renameFolder(key, input, parentSelect) {
    if (READ_ONLY) return;
    const name = input.value.trim();
    if (!name) {
      showFolderError("分册名不能为空。");
      input.focus();
      return;
    }
    try {
      const response = await fetch(`api/folders/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parent: parentSelect.value || null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `保存失败（HTTP ${response.status}）`);
      if (data.folders) state.folders = normalizeFolders(data.folders);
      if (!state.folders[key]) state.folders[key] = { name, parent: null };
      render();
      renderFolderManager();
      showFolderError("");
      toast(`分册「${name}」已保存。`, "success", "分册已更新");
    } catch (error) {
      showFolderError(error.message);
    }
  }

  async function deleteFolder(key) {
    if (READ_ONLY) return;
    const name = folderName(key);
    if (!window.confirm(`确定删除分册「${name}」？\n只有空分册能删除，卡不会自动删除。`)) return;
    try {
      const response = await fetch(`api/folders/${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `删除失败（HTTP ${response.status}）`);
      if (data.folders) state.folders = normalizeFolders(data.folders);
      if (state.folder === key) state.folder = "all";
      render();
      renderFolderManager();
      showFolderError("");
      toast(`分册「${name}」已删除。`, "success", "分册已删除");
    } catch (error) {
      showFolderError(error.message);
    }
  }

  async function addFolder() {
    if (READ_ONLY) return;
    const name = $("#newFolderName").value.trim();
    if (!name) {
      showFolderError("先写一个分册名。");
      $("#newFolderName").focus();
      return;
    }
    try {
      const response = await fetch("api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parent: $("#newFolderParent").value || null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `新增失败（HTTP ${response.status}）`);
      if (data.folders) state.folders = normalizeFolders(data.folders);
      state.folder = data.key;
      $("#newFolderName").value = "";
      render();
      renderFolderManager();
      showFolderError("");
      toast(`分册「${name}」已建立，现在可以把卡移进去。`, "success", "新分册");
    } catch (error) {
      showFolderError(error.message);
    }
  }

  function attachmentOwnerName(attachment) {
    const owner = state.cards.find((card) => card.id === attachment.owner_id);
    return owner ? `${owner.name} · ${owner.title}` : "未关联角色";
  }

  function classicRefs(card) {
    const seen = new Map();
    Object.values(card.skill_refs || {}).flat().forEach((ref) => {
      if (ref.source_type !== "classic") return;
      const key = `${ref.name}|${ref.source_title || ""}`;
      if (!seen.has(key)) seen.set(key, ref);
    });
    return [...seen.values()];
  }

  function renderDetailReferences(card) {
    const box = $("#detailReferences");
    const refs = classicRefs(card);
    if (!refs.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const skillCards = state.attachments.filter(
      (item) => item.owner_id === card.id && item.kind === "技能牌"
    );
    if (skillCards.length) {
      box.hidden = false;
      box.innerHTML = `<div class="references-title">经典技能</div>
        <p class="references-note">已写在技能牌：${skillCards.map((item) => escapeHtml(item.name)).join("、")}。</p>`;
      return;
    }
    box.hidden = false;
    box.innerHTML = `<div class="references-title">经典技能引用</div>${refs.map((ref) => `
      <div class="classic-reference">
        <div class="classic-reference-head">
          <strong>${escapeHtml(ref.name)}</strong>
          <span>${escapeHtml(ref.source_title || "经典三国杀")}</span>
          ${ref.source_url ? `<a href="${escapeHtml(ref.source_url)}" target="_blank" rel="noopener">来源</a>` : ""}
        </div>
        <p>${escapeHtml(ref.source_text || "")}</p>
      </div>`).join("")}`;
  }

  function renderDetailAttachments(card) {
    const items = state.attachments.filter((item) => item.owner_id === card.id);
    const block = $("#detailAttachments");
    if (!items.length) {
      block.hidden = true;
      $("#detailAttachmentGrid").innerHTML = "";
      return;
    }
    block.hidden = false;
    $("#detailAttachmentGrid").innerHTML = items.map((item) => `
      <button type="button" class="attachment-card" data-attachment-id="${escapeHtml(item.id)}"
        aria-label="查看附属牌：${escapeHtml(item.name)}">
        <span class="attachment-frame"><img src="${escapeHtml(item.thumb)}" alt=""></span>
        <span class="attachment-caption">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.kind || "附属牌")}</span>
        </span>
      </button>`).join("");
  }

  function openAttachment(id) {
    const item = state.attachments.find((attachment) => attachment.id === id);
    if (!item) return;
    state.attachmentId = id;
    state.attachmentBack = false;
    $("#attachmentImage").src = item.image;
    $("#attachmentImage").alt = `${item.name}附属牌`;
    $("#attachmentName").textContent = item.name;
    $("#attachmentTitle").hidden = !item.title;
    $("#attachmentTitle").textContent = item.title || "";
    $("#attachmentKind").textContent = item.kind || "附属牌";
    $("#attachmentOwner").textContent = `所属：${attachmentOwnerName(item)}`;
    const attachmentSkills = item.skills || [];
    $("#attachmentSkills").innerHTML = attachmentSkills.length
      ? attachmentSkills.map((skill) => `
          <section class="skill${skill.derived ? " derived" : ""}">
            <span class="skill-name">${escapeHtml(skill.name || "技能")}${skill.derived ? `<span class="derived-tag">衍生</span>` : ""}</span>
            <p class="skill-text">${skillHtml(skill)}</p>
          </section>`).join("")
      : "";
    const attachmentQuote = String(item.quote || "").trim();
    $("#attachmentQuote").hidden = !attachmentQuote;
    $("#attachmentQuote").textContent = attachmentQuote
      ? (/^[“「]/.test(attachmentQuote) ? attachmentQuote : `“${attachmentQuote}”`)
      : "";
    $("#attachmentNote").textContent = item.note || "";
    $("#attachmentFlipBtn").hidden = !item.back;
    $("#attachmentFlipBtn").textContent = "翻到背面";
    openOverlay("attachmentOverlay");
  }

  function flipAttachment() {
    const item = state.attachments.find((attachment) => attachment.id === state.attachmentId);
    if (!item || !item.back) return;
    state.attachmentBack = !state.attachmentBack;
    $("#attachmentImage").src = state.attachmentBack ? item.back : item.image;
    $("#attachmentFlipBtn").textContent = state.attachmentBack ? "翻回正面" : "翻到背面";
  }

  function openViewer(index = 0) {
    if (!state.filtered.length) return;
    closeOverlay("detailOverlay");
    state.viewerOpen = true;
    state.viewerIndex = Math.max(0, Math.min(state.filtered.length - 1, index));
    const viewer = $("#viewer");
    viewer.hidden = false;
    document.body.classList.add("modal-open");
    renderViewer();
    const card = state.filtered[state.viewerIndex];
    if (card) window.history.replaceState(null, "", `#view=${encodeURIComponent(card.id)}`);
    viewer.querySelector(".viewer-close")?.focus({ preventScroll: true });
  }

  function closeViewer() {
    state.viewerOpen = false;
    $("#viewer").hidden = true;
    if (/^#view=/.test(window.location.hash)) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    if (!document.querySelector(".modal-overlay:not([hidden])")) {
      document.body.classList.remove("modal-open");
    }
  }

  function renderViewer() {
    const card = state.filtered[state.viewerIndex];
    if (!card) return;
    $("#viewerImage").src = card.image;
    $("#viewerImage").alt = `${card.name}的完整卡面`;
    $("#viewerCounter").textContent =
      `${String(state.viewerIndex + 1).padStart(2, "0")} / ${String(state.filtered.length).padStart(2, "0")}`;
    $("#viewerName").textContent = `${card.name} · ${card.title}`;
    $("#viewerPrev").disabled = state.viewerIndex <= 0;
    $("#viewerNext").disabled = state.viewerIndex >= state.filtered.length - 1;
    if (state.viewerOpen) {
      window.history.replaceState(null, "", `#view=${encodeURIComponent(card.id)}`);
    }
  }

  function moveViewer(delta) {
    const next = state.viewerIndex + delta;
    if (next < 0 || next >= state.filtered.length) return;
    state.viewerIndex = next;
    renderViewer();
  }

  function currentThemeChoice() {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return THEME_CHOICES.includes(stored) ? stored : "auto";
    } catch (error) {
      return "auto";
    }
  }

  function resolvedTheme(choice) {
    if (choice === "light" || choice === "dark") return choice;
    return THEME_MEDIA.matches ? "dark" : "light";
  }

  function applyTheme(choice, persist = true) {
    const safeChoice = THEME_CHOICES.includes(choice) ? choice : "auto";
    const resolved = resolvedTheme(safeChoice);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeChoice = safeChoice;
    if (persist) {
      try { localStorage.setItem(THEME_KEY, safeChoice); } catch (error) { /* private mode */ }
    }
    const labels = { auto: "跟随系统", light: "浅色", dark: "深色" };
    const icons = { auto: "auto", light: "sun", dark: "moon" };
    const label = $("#themeLabel");
    const iconUse = $("#themeIcon");
    if (label) label.textContent = labels[safeChoice];
    if (iconUse) iconUse.setAttribute("href", `#icon-${icons[safeChoice]}`);
    const button = $("#themeToggle");
    if (button) {
      button.title = `外观：${labels[safeChoice]}`;
      button.setAttribute("aria-label", `切换外观，当前为${labels[safeChoice]}`);
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", resolved === "light" ? "#f2ede3" : "#080a0f");
  }

  function initTheme() {
    applyTheme(currentThemeChoice(), false);
    THEME_MEDIA.addEventListener("change", () => {
      if (currentThemeChoice() === "auto") applyTheme("auto", false);
    });
  }

  function toast(message, type = "info", title = "") {
    const stack = $("#toastStack");
    const element = document.createElement("div");
    element.className = `toast ${type}`;
    element.innerHTML = `
      <div class="toast-copy">${title ? `<strong>${escapeHtml(title)}</strong>` : ""}<p>${escapeHtml(message)}</p></div>
      <button type="button" class="toast-close" aria-label="关闭提示">×</button>`;
    stack.appendChild(element);
    const remove = () => element.remove();
    element.querySelector(".toast-close").addEventListener("click", remove);
    setTimeout(remove, 4800);
  }

  function clearFilters() {
    state.folder = "all";
    state.faction = "";
    state.prefix = "";
    state.rarity = "";
    state.q = "";
    state.sort = "id";
    $("#searchInput").value = "";
    $("#factionFilter").value = "";
    $("#prefixFilter").value = "";
    $("#rarityFilter").value = "";
    $("#sortSelect").value = "id";
    render();
  }

  async function loadCards() {
    try {
      let data;
      if (window.SANGUOSHA_DATA) {
        data = window.SANGUOSHA_DATA;
        const assets = window.SANGUOSHA_ASSETS || {};
        data = {
          ...data,
          cards: (data.cards || []).map((card) => ({
            ...card,
            image: assets[card.image] || card.image,
            thumb: assets[card.thumb] || assets[card.image] || card.thumb,
          })),
          attachments: (data.attachments || []).map((item) => ({
            ...item,
            image: assets[item.image] || item.image,
            thumb: assets[item.thumb] || assets[item.image] || item.thumb,
            back: item.back ? (assets[item.back] || item.back) : item.back,
            back_thumb: item.back_thumb ? (assets[item.back_thumb] || item.back_thumb) : item.back_thumb,
          })),
        };
      } else {
        const response = await fetch("data/cards.json", { cache: "no-store" });
        if (!response.ok) throw new Error(`卡册数据读取失败（HTTP ${response.status}）`);
        data = await response.json();
      }
      state.cards = Array.isArray(data) ? data : data.cards || [];
      if (!Array.isArray(state.cards)) throw new Error("卡册数据格式不正确。");
      state.attachments = (!Array.isArray(data) && Array.isArray(data.attachments)) ? data.attachments : [];
      state.folders = normalizeFolders(!Array.isArray(data) ? data.folders : {});
      state.cards.forEach((card) => {
        if (card.series && !state.folders[card.series]) {
          state.folders[card.series] = { name: card.series, parent: null };
        }
      });
      renderFactionOptions();
      renderPrefixOptions();
      renderRarityOptions();
      render();
      const hash = /^#card=(.+)$/.exec(window.location.hash);
      if (hash) {
        const id = decodeURIComponent(hash[1]);
        if (state.cards.some((card) => card.id === id)) showDetail(id);
      }
      const viewHash = /^#view=(.+)$/.exec(window.location.hash);
      if (viewHash) {
        const index = state.filtered.findIndex((card) => card.id === decodeURIComponent(viewHash[1]));
        if (index >= 0) openViewer(index);
      }
    } catch (error) {
      state.loadError = error.message;
      $("#resultSummary").textContent = "卡册未能读取";
      renderCards();
    }
  }

  function bindEvents() {
    $("#searchInput").addEventListener("input", (event) => {
      state.q = event.target.value.trim();
      render();
    });
    $("#factionFilter").addEventListener("change", (event) => {
      state.faction = event.target.value;
      render();
    });
    $("#prefixFilter").addEventListener("change", (event) => {
      state.prefix = event.target.value;
      render();
    });
    $("#rarityFilter").addEventListener("change", (event) => {
      state.rarity = event.target.value;
      render();
    });
    $("#sortSelect").addEventListener("change", (event) => {
      state.sort = event.target.value;
      render();
    });
    $("#folderTabs").addEventListener("click", (event) => {
      const tab = event.target.closest("[data-folder]");
      if (!tab) return;
      state.folder = tab.dataset.folder;
      state.q = "";
      $("#searchInput").value = "";
      render();
    });
    $("#clearFiltersBtn").addEventListener("click", clearFilters);
    $("#emptyClearBtn").addEventListener("click", clearFilters);
    $("#browseBtn").addEventListener("click", () => {
      $("#collection").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("#themeToggle").addEventListener("click", () => {
      const choice = currentThemeChoice();
      const next = THEME_CHOICES[(THEME_CHOICES.indexOf(choice) + 1) % THEME_CHOICES.length];
      applyTheme(next);
      toast(
        next === "auto" ? "已跟随系统外观。" : next === "light" ? "已切到浅色。" : "已切到深色。",
        "info",
        "外观"
      );
    });
    $("#viewerBtn").addEventListener("click", () => openViewer(0));
    $("#headerViewerBtn").addEventListener("click", () => openViewer(0));
    $("#heroViewerBtn").addEventListener("click", () => openViewer(0));
    $("#addCardBtn").addEventListener("click", () => openEdit(null));
    $("#manageFoldersBtn").addEventListener("click", openFolderManager);
    $("#addFolderBtn").addEventListener("click", addFolder);
    $("#folderManageList").addEventListener("click", (event) => {
      const deleteButton = event.target.closest("[data-delete-folder]");
      if (deleteButton) {
        const deleteRow = deleteButton.closest("[data-folder-key]");
        deleteFolder(deleteRow.dataset.folderKey);
        return;
      }
      const button = event.target.closest("[data-save-folder]");
      if (!button) return;
      const row = button.closest("[data-folder-key]");
      renameFolder(
        row.dataset.folderKey,
        row.querySelector(".folder-name-input"),
        row.querySelector(".folder-parent-select")
      );
    });
    $("#editImageInput").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!file) {
        setEditImage("");
        return;
      }
      if (!file.type.startsWith("image/")) {
        showEditError("请选择图片文件。");
        event.target.value = "";
        return;
      }
      if (file.size > 12 * 1024 * 1024) {
        showEditError("图片过大了，请控制在 12MB 以内。");
        event.target.value = "";
        return;
      }
      state.editImageName = file.name || "";
      $("#recognizeBtn").hidden = false;
      $("#recognizeStatus").textContent = "";
      const reader = new FileReader();
      reader.onload = () => {
        setEditImage(String(reader.result || ""));
        showEditError("");
      };
      reader.onerror = () => showEditError("图片读取失败。");
      reader.readAsDataURL(file);
    });
    $("#recognizeBtn").addEventListener("click", recognizeCurrentImage);
    $("#editImageClear").addEventListener("click", () => {
      $("#editImageInput").value = "";
      state.editImageName = "";
      setEditImage("");
      $("#recognizeBtn").hidden = true;
      $("#recognizeStatus").textContent = "";
    });
    $("#cardGrid").addEventListener("click", (event) => {
      const button = event.target.closest("[data-card-id]");
      if (button) showDetail(button.dataset.cardId);
    });
    $("#detailPrevBtn").addEventListener("click", () => moveDetail(-1));
    $("#detailNextBtn").addEventListener("click", () => moveDetail(1));
    $("#detailEditBtn").addEventListener("click", () => {
      if (state.detailId) openEdit(state.detailId);
    });
    $("#detailDeleteBtn").addEventListener("click", () => {
      if (state.detailId) deleteCard(state.detailId);
    });
    $("#detailSkills").addEventListener("click", (event) => {
      const button = event.target.closest(".skill-ref");
      if (!button || !button.dataset.sourceId) return;
      const sourceId = button.dataset.sourceId;
      if (state.cards.some((card) => card.id === sourceId)) {
        showDetail(sourceId);
      } else if (state.attachments.some((item) => item.id === sourceId)) {
        openAttachment(sourceId);
      }
    });
    $("#detailAttachmentGrid").addEventListener("click", (event) => {
      const button = event.target.closest("[data-attachment-id]");
      if (button) openAttachment(button.dataset.attachmentId);
    });
    $("#attachmentFlipBtn").addEventListener("click", flipAttachment);
    $("#addSkillBtn").addEventListener("click", () => {
      const row = addEditSkillRow();
      row.querySelector(".edit-skill-name").focus();
      row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    $("#editForm").addEventListener("submit", saveEdit);
    $("#detailViewerBtn").addEventListener("click", () => {
      const index = detailIndex(state.detailId);
      openViewer(index < 0 ? 0 : index);
    });
    $("#viewerPrev").addEventListener("click", () => moveViewer(-1));
    $("#viewerNext").addEventListener("click", () => moveViewer(1));
    $$("[data-close]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.close;
        if (id === "detailOverlay") closeDetail();
        else if (id === "viewer") closeViewer();
        else closeOverlay(id);
      });
    });
    $$(".modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (event) => {
        if (event.target !== overlay) return;
        if (["editOverlay", "folderOverlay", "attachmentOverlay"].includes(overlay.id)) closeOverlay(overlay.id);
        else closeDetail();
      });
    });

    let touchStart = null;
    const viewerStage = $(".viewer-stage");
    viewerStage.addEventListener("touchstart", (event) => {
      const touch = event.touches[0];
      if (!touch) return;
      touchStart = { x: touch.clientX, y: touch.clientY };
    }, { passive: true });
    viewerStage.addEventListener("touchend", (event) => {
      if (!touchStart) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - touchStart.x;
      const dy = touch.clientY - touchStart.y;
      touchStart = null;
      if (Math.abs(dx) > 54 && Math.abs(dx) > Math.abs(dy) * 1.35) {
        moveViewer(dx < 0 ? 1 : -1);
      }
    }, { passive: true });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (state.viewerOpen) { closeViewer(); return; }
        if (!$("#attachmentOverlay").hidden) { closeOverlay("attachmentOverlay"); return; }
        if (state.editId || !$("#editOverlay").hidden) { closeOverlay("editOverlay"); return; }
        if (!$("#folderOverlay").hidden) { closeOverlay("folderOverlay"); return; }
        if (state.detailId) { closeDetail(); return; }
        return;
      }
      if (state.viewerOpen) {
        if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); moveViewer(-1); return; }
        if (event.key === "ArrowRight" || event.key === "PageDown") { event.preventDefault(); moveViewer(1); return; }
        return;
      }
      if (state.detailId) {
        if (event.key === "ArrowLeft") { event.preventDefault(); moveDetail(-1); return; }
        if (event.key === "ArrowRight") { event.preventDefault(); moveDetail(1); return; }
      }
      const tag = document.activeElement?.tagName;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(tag);
      if (event.key === "/" && !typing && !state.detailId) {
        event.preventDefault();
        $("#searchInput").focus();
      }
    });
    window.addEventListener("popstate", () => {
      const hash = /^#card=(.+)$/.exec(window.location.hash);
      if (!hash && state.detailId) closeDetail();
    });
  }

  initTheme();
  bindEvents();
  loadCards();
})();
