(function () {
  'use strict';

  // ── CONFIG ───────────────────────────────────────────────────────────────────
  const DELAYS = {
    beforeMenuClick: 800, afterMenuClick: 600, afterPublishHover: 500,
    publishTimeout: 120000, afterBack: 3000, afterFolderClick: 2000,
    afterSettingChange: 300, afterExpandSettings: 500, afterDownloadClick: 500,
    betweenCourses: 2000, betweenFolders: 2000,
  };

  const LMS_SETTINGS = {
    lmsFormat: 'scorm12',
    reporting: 'completed-incomplete',
    toggles: {
      'enable-exit-course': false,
      'disable-course-cover-page': true,
      'enable-reset-learner-data': false,
      'load-only-in-lms': true,
    },
  };

  const PHASE = {
    IDLE: 'IDLE', IN_SUBFOLDER: 'IN_SUBFOLDER', ON_PUBLISH_PAGE: 'ON_PUBLISH_PAGE',
    BACK_TO_FOLDER: 'BACK_TO_FOLDER', ENTERING_SUBFOLDER: 'ENTERING_SUBFOLDER',
  };

  // ── STORAGE (in-memory cache backed by chrome.storage.local) ─────────────────
  // All reads are synchronous (from cache). Writes update cache + persist async.
  const STATE_INIT = { phase: PHASE.IDLE, totalExported: 0, totalFailed: 0 };
  let _stateCache = { ...STATE_INIT };
  let _logCache   = [];

  function _persistState() {
    chrome.storage.local.set({ rbe_state: JSON.stringify(_stateCache) });
  }
  function _persistLog() {
    chrome.storage.local.set({ rbe_log: JSON.stringify(_logCache) });
  }

  /** Load caches from storage before init runs */
  function loadCaches() {
    return new Promise(resolve => {
      chrome.storage.local.get(['rbe_state', 'rbe_log'], result => {
        try { _stateCache = JSON.parse(result.rbe_state || 'null') || { ...STATE_INIT }; }
        catch { _stateCache = { ...STATE_INIT }; }
        try { _logCache = JSON.parse(result.rbe_log || '[]'); }
        catch { _logCache = []; }
        resolve();
      });
    });
  }

  // st()        → read current state
  // st(patch)   → merge patch into state, return merged
  // st(null)    → reset to IDLE
  function st(patch) {
    if (patch === null) {
      _stateCache = { ...STATE_INIT };
      _persistState();
      return _stateCache;
    }
    if (patch === undefined) return _stateCache;
    _stateCache = { ..._stateCache, ...patch };
    _persistState();
    return _stateCache;
  }

  // ── LOG ───────────────────────────────────────────────────────────────────────
  function log(msg, type = 'info') {
    _logCache.push({ msg, type, time: new Date().toLocaleTimeString() });
    if (_logCache.length > 200) _logCache.splice(0, _logCache.length - 200);
    _persistLog();
    _renderLog(_logCache);
    console.log(`[Rise Bulk Export] ${msg}`);
  }

  function _renderLog(entries) {
    const el = document.getElementById('rbe-log');
    if (!el) return;
    el.innerHTML = entries.map(e =>
      `<div class="rbe-log-${esc(e.type)}">[${esc(e.time)}] ${esc(e.msg)}</div>`
    ).join('');
    el.scrollTop = el.scrollHeight;
  }

  const restoreLog = () => _renderLog(_logCache);
  const clearLog   = () => { _logCache = []; _persistLog(); };

  // ── UTILITIES ────────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const findByExactText = (sel, text, root = document) => {
    for (const el of root.querySelectorAll(sel))
      if (el.textContent.trim() === text) return el;
    return null;
  };

  function hoverElement(el) {
    const { left, top, width, height } = el.getBoundingClientRect();
    const cx = left + width / 2, cy = top + height / 2;
    const m = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
    const p = { ...m, pointerId: 1, pointerType: 'mouse', width: 1, height: 1, isPrimary: true };
    ['pointerover', 'pointermove'].forEach(t => el.dispatchEvent(new PointerEvent(t, p)));
    el.dispatchEvent(new PointerEvent('pointerenter', { ...p, bubbles: false }));
    ['mouseover', 'mousemove'].forEach(t => el.dispatchEvent(new MouseEvent(t, m)));
    el.dispatchEvent(new MouseEvent('mouseenter', { ...m, bubbles: false }));
  }

  async function pollFor(fn, timeout = 15000, interval = 1000) {
    for (const end = Date.now() + timeout; Date.now() < end;) {
      const r = fn(); if (r) return r;
      await sleep(interval);
    }
    return null;
  }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const ALLOWED_ORIGINS = ['https://rise.articulate.com', 'https://app.rise.com'];

  function safeNavigate(url) {
    try {
      const { origin } = new URL(url);
      if (ALLOWED_ORIGINS.includes(origin)) { window.location.href = url; return true; }
    } catch {}
    console.warn('[Rise Bulk Export] Blocked navigation to untrusted URL:', url);
    return false;
  }

  // ── DOM ───────────────────────────────────────────────────────────────────────
  const contentArea = () =>
    document.getElementById('current-content')
    || document.querySelector('[data-ba="dashboard_container"]')
    || document.querySelector('[role="region"][data-auto-scrollable="true"]')
    || document.body;

  // ── SCANNING ──────────────────────────────────────────────────────────────────
  function scanFolders() {
    const folders = [], ca = contentArea();
    const SKIP = '[data-ba="sidebar_container"], #rbe-panel, [data-ba="breadcrumbs_container"], [aria-label="Breadcrumbs"], [data-ba="create_courseCard"]';
    const badName = n => !n || n === 'New Folder' || n.startsWith('+') || /^Folders\s*\(/.test(n);

    const collect = root => root.querySelectorAll('a').forEach(a => {
      const name = a.textContent.trim();
      if (a.closest(SKIP) || badName(name) || folders.some(f => f.name === name)) return;
      folders.push({ name, href: a.href || '', el: a });
    });

    const walker = document.createTreeWalker(ca, NodeFilter.SHOW_TEXT, {
      acceptNode: n => /^Folders\s*\(\d+\)$/.test(n.textContent.trim())
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const textNode = walker.nextNode();
    if (textNode) {
      for (let s = textNode.parentElement, i = 0; i < 12 && s && s !== ca && s !== document.body; i++, s = s.parentElement) {
        collect(s);
        if (folders.length) return folders;
      }
    }
    collect(ca);
    return folders;
  }

  function scanCourseCards() {
    const ca = contentArea();
    const primary = [...ca.querySelectorAll('[data-ba="create_courseCard"]')].map((card, i) => ({
      title: card.getAttribute('data-ba-name') || `Course ${i + 1}`,
      courseId: card.getAttribute('data-ba-course-id') || '',
      el: card, index: i,
    }));
    if (primary.length) return primary;

    return [...ca.querySelectorAll('li[role="listitem"]')].reduce((acc, item, i) => {
      const titleEl = item.querySelector('[class*="title"], h3, h4, a[class*="heading"]');
      if (titleEl && (item.textContent.includes('Microlearning') || item.textContent.includes('Course')))
        acc.push({ title: titleEl.textContent.trim(), el: item, index: i });
      return acc;
    }, []);
  }

  // ── FORMAT HELPERS ───────────────────────────────────────────────────────────
  const getCurrentFormat = () => {
    const s = st();
    return (s.exportFormats || ['web'])[s.currentFormatIndex || 0] || 'web';
  };

  function advanceAfterExport(succeeded) {
    const s = st();
    const formats = s.exportFormats || ['web'];
    const fmtIdx = s.currentFormatIndex || 0;
    const updates = { phase: PHASE.BACK_TO_FOLDER };

    if (succeeded) updates.totalExported = s.totalExported + 1;
    else           updates.totalFailed   = s.totalFailed + 1;

    if (fmtIdx + 1 < formats.length) {
      updates.currentFormatIndex = fmtIdx + 1;
    } else {
      updates.currentFormatIndex = 0;
      updates.currentCourseIndex = s.currentCourseIndex + 1;
    }
    return updates;
  }

  // ── LMS SETTINGS ─────────────────────────────────────────────────────────────
  async function expandMoreSettings() {
    let link = null;
    for (const el of document.querySelectorAll('[class*="export-settings"] *, [class*="settings-label"] *')) {
      if (/^more settings$/i.test(el.textContent.trim()) && !el.children.length) { link = el; break; }
    }
    if (!link) link = findByExactText('div, span, a, button', 'More settings');
    if (link) { log(`    Expanding "More settings"...`, 'info'); link.click(); await sleep(DELAYS.afterSettingChange); }
  }

  function setSelectValue(selectEl, value) {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(selectEl, value);
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setToggle(inputEl, desired) {
    if (inputEl.checked === desired) return;
    const label = inputEl.closest('label') || document.querySelector(`label[for="${inputEl.id}"]`);
    (label || inputEl).click();
  }

  async function configureLmsSettings() {
    log(`  Waiting for LMS settings to load...`, 'info');
    const lmsFormatSelect = await pollFor(() => {
      const s = document.querySelectorAll('select[class*="dropdown"]');
      return s.length >= 1 ? s[0] : null;
    }, 30000, 1000);

    if (!lmsFormatSelect) { log(`  ⚠ LMS settings never loaded`, 'error'); return; }
    log(`  Configuring LMS settings...`, 'info');

    await expandMoreSettings();
    await sleep(DELAYS.afterExpandSettings);

    if (lmsFormatSelect.value !== LMS_SETTINGS.lmsFormat) {
      log(`    Setting LMS format → SCORM 1.2`, 'info');
      setSelectValue(lmsFormatSelect, LMS_SETTINGS.lmsFormat);
      await sleep(DELAYS.afterSettingChange);
    } else { log(`    LMS format already SCORM 1.2 ✓`, 'info'); }

    const selects = document.querySelectorAll('select[class*="dropdown"]');
    if (selects.length >= 2) {
      const rep = selects[1];
      if (rep.value !== LMS_SETTINGS.reporting) {
        log(`    Setting Reporting → Complete/Incomplete`, 'info');
        setSelectValue(rep, LMS_SETTINGS.reporting);
        await sleep(DELAYS.afterSettingChange);
      } else { log(`    Reporting already Complete/Incomplete ✓`, 'info'); }
    } else { log(`    ⚠ Could not find Reporting dropdown`, 'warn'); }

    for (const [id, desired] of Object.entries(LMS_SETTINGS.toggles)) {
      const input = await pollFor(() => document.getElementById(id), 5000, 500);
      if (input) {
        const label = id.replace(/-/g, ' ').replace(/^(enable|disable)\s/, '');
        if (input.checked !== desired) {
          log(`    Setting "${label}" → ${desired ? 'ON' : 'OFF'}`, 'info');
          setToggle(input, desired);
          await sleep(DELAYS.afterSettingChange);
        } else { log(`    "${label}" already ${desired ? 'ON' : 'OFF'} ✓`, 'info'); }
      } else { log(`    ⚠ Could not find toggle #${id}`, 'warn'); }
    }
    log(`  LMS settings configured`, 'success');
  }

  // ── EXPORT: CARD MENU ────────────────────────────────────────────────────────
  async function openCardMenu(cardEl) {
    const name = cardEl.getAttribute('data-ba-name') || 'unknown';
    log(`    Looking for "..." on: "${name}"`, 'info');

    let btn = cardEl.querySelector('button[data-ba="content.dropDownMenu.menuButton"]');
    if (!btn) {
      hoverElement(cardEl);
      await sleep(DELAYS.beforeMenuClick);
      btn = cardEl.querySelector('button[data-ba="content.dropDownMenu.menuButton"]')
         || cardEl.querySelector('button[aria-haspopup="true"]');
    }
    if (!btn) {
      cardEl.querySelectorAll('div').forEach(d => { d.style.opacity = '1'; d.style.visibility = 'visible'; });
      await sleep(500);
      btn = cardEl.querySelector('button[data-ba="content.dropDownMenu.menuButton"]')
         || cardEl.querySelector('button[aria-haspopup]');
    }
    if (!btn) {
      [...cardEl.querySelectorAll('button')].forEach((b, i) =>
        log(`      [${i}] data-ba="${b.getAttribute('data-ba')}" text="${b.textContent.trim().slice(0, 30)}"`, 'warn'));
      throw new Error('Could not find "..." menu button');
    }
    if (btn.closest('[class*="breadcrumb"], [data-ba="dropdownMenu_menuAnchor"]'))
      throw new Error('Found breadcrumb menu button, not card menu. Aborting.');

    log(`    Clicking "..."`, 'info');
    btn.click();
    await sleep(DELAYS.afterMenuClick);
  }

  async function clickPublishFormat(format = 'web') {
    const menuLabel = format === 'lms' ? 'LMS' : 'Web';

    const publishItem = await pollFor(() =>
      document.querySelector('li[data-ba="content.dropDownMenu.publish"]')
      || findByExactText('[role="menuitem"]', 'Publish'), 5000, 300);
    if (!publishItem) throw new Error('Could not find "Publish" menu item');

    log(`    Hovering "Publish"...`, 'info');
    hoverElement(publishItem);
    await sleep(DELAYS.afterPublishHover);

    const targetItem = await pollFor(() => {
      for (const menu of document.querySelectorAll('ul[role="menu"]'))
        for (const item of menu.querySelectorAll('[role="menuitem"]'))
          if (item.textContent.trim() === menuLabel) return item;
      return null;
    }, 5000, 300);
    if (!targetItem) throw new Error(`Could not find "${menuLabel}" submenu item`);

    log(`    Clicking "${menuLabel}" (will navigate to publish page)...`, 'info');
    st({ phase: PHASE.ON_PUBLISH_PAGE });
    targetItem.click();
  }

  // ── EXPORT: PUBLISH PAGE ─────────────────────────────────────────────────────
  async function handlePublishPage() {
    const fmt = getCurrentFormat();
    log(`  On publish page (${fmt.toUpperCase()}) — waiting for Download button...`, 'info');

    if (fmt === 'lms') await configureLmsSettings();

    const downloadBtn = await pollFor(() => findByExactText('button', 'Download'), 30000, 1000);
    if (!downloadBtn) { log(`  ✗ Could not find Download button`, 'error'); navigateBackToFolder(); return; }

    await sleep(DELAYS.afterDownloadClick);
    log(`  Clicking "Download"...`, 'info');
    downloadBtn.click();

    log(`  Publishing... (waiting up to ${DELAYS.publishTimeout / 1000}s)`, 'info');
    const success = await pollFor(() => {
      const t = document.body.innerText;
      return (
        t.includes('Publish Successful') ||
        t.includes('Published successfully') ||
        t.includes('Your course package is ready')
      ) || null;
    }, DELAYS.publishTimeout, 500);

    log(
      success
        ? `  ✓ Published (${fmt.toUpperCase()}) successfully — zip auto-downloaded`
        : `  ✗ Publish timed out`,
      success ? 'success' : 'error'
    );
    st(advanceAfterExport(!!success));

    log(`  Clicking "Back"...`, 'info');
    const backBtn = await pollFor(() => findByExactText('button, a, [role="button"]', 'Back'), 10000, 500);
    backBtn ? backBtn.click() : (log(`  ✗ No Back button, using history.back()`, 'warn'), window.history.back());
  }

  function navigateBackToFolder() {
    const s = st({ phase: PHASE.BACK_TO_FOLDER });
    s.currentFolderUrl ? (safeNavigate(s.currentFolderUrl) || window.history.back()) : window.history.back();
  }

  // ── EXPORT: FOLDER PROCESSING ────────────────────────────────────────────────
  async function processCourses() {
    await sleep(DELAYS.betweenCourses);
    const cards = scanCourseCards();
    let idx = st().currentCourseIndex || 0;
    log(`  Found ${cards.length} course(s), continuing from index ${idx}`, 'info');

    while (idx < cards.length) {
      const fmt = getCurrentFormat();
      const card = cards[idx];
      log(`  Exporting [${idx + 1}/${cards.length}] (${fmt.toUpperCase()}): "${card.title}"`, 'info');
      try {
        await openCardMenu(card.el);
        await clickPublishFormat(fmt);
        return;
      } catch (err) {
        log(`  ✗ Error: ${err.message}`, 'error');
        st({ currentCourseIndex: ++idx, currentFormatIndex: 0, totalFailed: st().totalFailed + 1 });
        await sleep(DELAYS.betweenFolders);
      }
    }

    log(`  ✓ Folder complete`, 'success');
    await moveToNextFolder();
  }

  async function handleEnteringSubfolder() {
    await sleep(DELAYS.afterFolderClick);
    const { selectedFolders = [], currentFolderIndex = 0 } = st();
    let idx = currentFolderIndex;

    while (idx < selectedFolders.length) {
      const target = selectedFolders[idx];
      log(`📂 Entering folder: "${target.name}"`, 'info');
      const folder = scanFolders().find(f => f.name === target.name);
      if (folder) {
        st({ phase: PHASE.IN_SUBFOLDER, currentFolderIndex: idx, currentFolderUrl: folder.href });
        folder.el.click();
        await sleep(DELAYS.afterFolderClick);
        await processCourses();
        return;
      }
      log(`  Could not find folder "${target.name}" — skipping`, 'error');
      st({ currentFolderIndex: ++idx, currentCourseIndex: 0, currentFormatIndex: 0 });
    }

    log('No more folders to process', 'warn');
    st(null);
    updateButtons();
  }

  async function moveToNextFolder() {
    const s = st();
    const nextIdx = (s.currentFolderIndex || 0) + 1;

    if (nextIdx >= (s.selectedFolders || []).length) {
      log(`\n═══ DONE ═══`, 'info');
      log(`Exported: ${s.totalExported} | Failed: ${s.totalFailed}`, s.totalFailed > 0 ? 'warn' : 'success');
      st(null);
      document.body.classList.remove('rbe-export-active');
      updateButtons();
      return;
    }

    log(`📂 Next folder: "${s.selectedFolders[nextIdx].name}"`, 'info');
    st({ currentFolderIndex: nextIdx, currentCourseIndex: 0, currentFormatIndex: 0, phase: PHASE.ENTERING_SUBFOLDER });
    if (s.parentFolderUrl) safeNavigate(s.parentFolderUrl);
  }

  // ── START / STOP ─────────────────────────────────────────────────────────────
  async function startExport() {
    const selectedNames = [...document.querySelectorAll('.rbe-folder-cb:checked')].map(cb => cb.value);
    if (!selectedNames.length) { log('No folders selected!', 'error'); return; }

    const formatChoice = document.querySelector('input[name="rbe-format"]:checked')?.value || 'web';
    const exportFormats = formatChoice === 'both' ? ['web', 'lms'] : [formatChoice];

    const selectedFolders = scanFolders()
      .filter(f => selectedNames.includes(f.name))
      .map(({ name, href }) => ({ name, href }));
    if (!selectedFolders.length) { log('Could not find selected folders in DOM', 'error'); return; }

    clearLog();
    log(`Starting export of ${selectedFolders.length} folder(s) as ${exportFormats.map(f => f.toUpperCase()).join(' + ')}`, 'info');
    st({
      phase: PHASE.ENTERING_SUBFOLDER, active: true, exportFormats,
      parentFolderUrl: window.location.href, selectedFolders,
      currentFolderIndex: 0, currentCourseIndex: 0, currentFormatIndex: 0,
      totalExported: 0, totalFailed: 0,
    });
    document.body.classList.add('rbe-export-active');
    updateButtons();
    await handleEnteringSubfolder();
  }

  function stopExport() {
    log('⏹ Export stopped by user', 'warn');
    st(null);
    document.body.classList.remove('rbe-export-active');
    updateButtons();
  }

  // ── PANEL ─────────────────────────────────────────────────────────────────────
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'rbe-panel';
    panel.innerHTML = `
      <div id="rbe-header">
        <span>Rise Bulk Export</span>
        <button id="rbe-toggle-btn" title="Collapse">−</button>
      </div>
      <div id="rbe-body">
        <div id="rbe-instructions">
          This exporter automatically exports Rise courses as HTML or SCORM. Navigate into a main folder, click <strong>Scan Folders</strong>, select which subfolders to export, then click <strong>Start Export</strong>. All files will be downloaded to your downloads folder.
        </div>
        <div class="rbe-section">
          <p class="rbe-label">Folders</p>
          <button class="rbe-btn rbe-btn-outline rbe-btn-full" id="rbe-scan-btn">Scan Folders</button>
          <div id="rbe-folder-list"></div>
          <div id="rbe-select-links" style="display:none">
            <a id="rbe-select-all">Select all</a><a id="rbe-select-none">Select none</a>
          </div>
        </div>
        <div class="rbe-section">
          <p class="rbe-label">Export Format</p>
          <div class="rbe-radio-group">
            <label class="rbe-check"><input type="radio" name="rbe-format" id="rbe-fmt-web" value="web" checked><span>Web (HTML)</span></label>
            <label class="rbe-check"><input type="radio" name="rbe-format" id="rbe-fmt-lms" value="lms"><span>LMS (SCORM)</span></label>
            <label class="rbe-check"><input type="radio" name="rbe-format" id="rbe-fmt-both" value="both"><span>Both</span></label>
          </div>
        </div>
        <div class="rbe-section rbe-action-row">
          <button class="rbe-btn rbe-btn-primary rbe-btn-grow" id="rbe-start-btn" disabled>Start Export</button>
          <button class="rbe-btn rbe-btn-danger" id="rbe-stop-btn">Stop</button>
        </div>
        <div id="rbe-log"></div>
        <div id="rbe-footer">
          <a href="https://github.com/sp00kman1337/Rise-Exporter" target="_blank">GitHub</a>
          <span>|</span>
          <a href="mailto:jpelupessy@onestreamsoftware.com">Jay Pelupessy</a>
        </div>
      </div>`;
    document.body.appendChild(panel);

    const $ = id => document.getElementById(id);

    $('rbe-toggle-btn').addEventListener('click', () => {
      panel.classList.toggle('rbe-collapsed');
      $('rbe-toggle-btn').textContent = panel.classList.contains('rbe-collapsed') ? '+' : '−';
    });

    $('rbe-scan-btn').addEventListener('click', () => {
      log('Scanning...', 'info');
      const folders = scanFolders();
      const list = $('rbe-folder-list'), links = $('rbe-select-links');

      if (!folders.length) {
        const ca = contentArea();
        const allLinks = ca.querySelectorAll('a');
        log(`DEBUG: content area=${ca.id || ca.tagName}, ${allLinks.length} links`, 'warn');
        log(`DEBUG: Folders header=${((ca.innerText || '').match(/Folders\s*\(\d+\)/) || ['NO'])[0]}`, 'warn');
        let n = 0;
        allLinks.forEach(a => {
          if (n >= 15 || a.closest('[data-ba="sidebar_container"], #rbe-panel')) return;
          log(`  Link: "${a.textContent.trim().slice(0, 50)}" bc=${!!a.closest('[data-ba="breadcrumbs_container"],[aria-label="Breadcrumbs"]')} href=${(a.href || '').slice(0, 70)}`, 'warn');
          n++;
        });
        list.innerHTML = '<p style="color:#999;font-size:12px;margin:4px 0 0">No folders found. Check log.</p>';
        links.style.display = 'none';
        $('rbe-start-btn').disabled = true;
        return;
      }

      list.innerHTML = folders.map((f, i) => `
        <label class="rbe-check">
          <input type="checkbox" class="rbe-folder-cb" id="rbe-f-${i}" value="${esc(f.name)}" checked>
          <span>${esc(f.name)}</span>
        </label>`).join('');
      links.style.display = 'block';
      $('rbe-start-btn').disabled = false;
      log(`Scanned ${folders.length} folder(s)`, 'success');
    });

    $('rbe-select-all')?.addEventListener('click', e => { e.preventDefault(); document.querySelectorAll('.rbe-folder-cb').forEach(c => c.checked = true); });
    $('rbe-select-none')?.addEventListener('click', e => { e.preventDefault(); document.querySelectorAll('.rbe-folder-cb').forEach(c => c.checked = false); });
    $('rbe-start-btn').addEventListener('click', startExport);
    $('rbe-stop-btn').addEventListener('click', stopExport);

    // Draggable header
    let ox, oy, drag = false;
    $('rbe-header').addEventListener('mousedown', e => {
      drag = true;
      const r = panel.getBoundingClientRect();
      ox = e.clientX - r.left; oy = e.clientY - r.top;
      panel.style.transition = 'none';
    });
    document.addEventListener('mousemove', e => {
      if (!drag) return;
      panel.style.left  = (e.clientX - ox) + 'px';
      panel.style.top   = (e.clientY - oy) + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => drag = false);
  }

  function updateButtons() {
    const active = st().phase !== PHASE.IDLE;
    ['rbe-start-btn', 'rbe-scan-btn'].forEach(id => {
      const el = document.getElementById(id); if (el) el.disabled = active;
    });
    const stop = document.getElementById('rbe-stop-btn');
    if (stop) stop.disabled = false;
  }

  // ── INIT / RESUME ─────────────────────────────────────────────────────────────
  async function init() {
    await loadCaches(); // populate state + log caches from storage before anything else
    createPanel();
    restoreLog();
    const s = st();
    console.log('[Rise Bulk Export] Init:', s);
    updateButtons();
    if (s.phase !== PHASE.IDLE)
      log(`Resuming: phase=${s.phase}, folder=${s.currentFolderIndex}, course=${s.currentCourseIndex}, format=${s.currentFormatIndex}`, 'info');

    if (s.phase !== PHASE.IDLE) document.body.classList.add('rbe-export-active');

    switch (s.phase) {
      case PHASE.ON_PUBLISH_PAGE:
        log('--- resuming: publish page ---', 'info');
        await handlePublishPage();
        break;
      case PHASE.BACK_TO_FOLDER:
        log('--- resuming: back to folder ---', 'info');
        await sleep(DELAYS.afterBack);
        st({ phase: PHASE.IN_SUBFOLDER });
        await processCourses();
        break;
      case PHASE.ENTERING_SUBFOLDER:
        log('--- resuming: entering subfolder ---', 'info');
        await handleEnteringSubfolder();
        break;
      case PHASE.IN_SUBFOLDER:
        log('--- resuming: in subfolder ---', 'info');
        await processCourses();
        break;
      default:
        log('Ready. Navigate to the parent folder, then click "Scan Folders".', 'info');
    }
  }

  init();
})();
