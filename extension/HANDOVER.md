# Rise 360 Bulk Export — Project Handover

**Date:** 2026-06-22
**Prepared by:** Claude (Cowork session)
**Continuing in:** New project / conversation

---

## Project Overview

A tool for bulk-exporting Articulate Rise 360 courses as Web (HTML) and/or LMS (SCORM) packages across multiple subfolders. The workflow automates navigating into each subfolder, triggering the Publish flow for every course, configuring LMS settings (SCORM 1.2), and downloading the resulting zip files.

The project exists in two forms:
- **Tampermonkey userscript** (`rise-bulk-export.user.js`) — original form, v3.4
- **Browser extension** — converted from the userscript this session; files moved to a separate project folder by the user

---

## Repository

**GitHub:** `sp00kman1337/Rise-Exporter`
**Branch:** `main`
**Remote:** `https://github.com/sp00kman1337/Rise-Exporter`
**Raw userscript URL:** `https://raw.githubusercontent.com/sp00kman1337/Rise-Exporter/main/rise-bulk-export.user.js`

---

## Files in This Folder (Non-Extension)

| File | Status | Description |
|---|---|---|
| `rise-bulk-export.user.js` | **Active — v3.4** | Main Tampermonkey userscript |
| `rise-bulk-export.userORIGINAL.js` | Archive | Original version kept for reference |
| `README.md` | Current | Installation, usage, version history |
| `HANDOVER.md` | This file | Session handover document |
| `rise-bulk-export-summary.md` | Outdated | Summary from a previous session (v2 era) — can be deleted |

> The `extension/` folder may still appear locally due to OneDrive sync delay, but the extension project has been moved to a separate folder and is being continued there.

> The `assets/` and `dist/` folders (old BootStream theme CSS/fonts) were previously in this folder but are no longer referenced by the script. If they still appear, delete them manually — bash deletion is blocked by OneDrive permissions.

---

## Userscript — Current State (v3.4)

### Version History

| Version | Change |
|---|---|
| 3.0 | LMS/SCORM export support added |
| 3.1 | Removed prefix feature; added instructions panel |
| 3.2 | Security hardening: `esc()` XSS helper, `safeNavigate()` with allowed-origins whitelist |
| 3.3 | OLIVE/BootStream panel UI; GitHub auto-update headers (`@updateURL`, `@downloadURL`) |
| 3.4 | Inline CSS via `GM_addStyle` to fix Rise 360 CSP blocking external stylesheets; footer added |

### Script Header (key lines)

```js
// @version      3.4
// @match        https://rise.articulate.com/*
// @match        https://app.rise.com/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @homepageURL  https://github.com/sp00kman1337/Rise-Exporter#readme
// @supportURL   https://github.com/sp00kman1337/Rise-Exporter#readme
// @updateURL    https://raw.githubusercontent.com/sp00kman1337/Rise-Exporter/main/rise-bulk-export.user.js
// @downloadURL  https://raw.githubusercontent.com/sp00kman1337/Rise-Exporter/main/rise-bulk-export.user.js
```

---

## Key Technical Concepts

### State Machine

Persists across page navigations using `GM_setValue`/`GM_getValue`. The state object is stored as JSON under the key `rbe_state`.

Phases:

| Phase | Meaning |
|---|---|
| `IDLE` | Nothing running |
| `ENTERING_SUBFOLDER` | About to navigate into a subfolder |
| `IN_SUBFOLDER` | Inside a subfolder, processing courses |
| `ON_PUBLISH_PAGE` | On the publish page waiting for download |
| `BACK_TO_FOLDER` | Navigating back after a publish |

State API:
- `st()` — read current state
- `st(patch)` — merge patch and persist
- `st(null)` — reset to IDLE

### Storage

Userscript uses `GM_setValue` / `GM_getValue` synchronously.

The browser extension version (moved to separate project) replaced these with `chrome.storage.local` backed by an in-memory cache — loaded async at init, then all reads/writes are synchronous from cache.

### Security

- `esc(str)` — escapes HTML special characters before any `innerHTML` insertion
- `safeNavigate(url)` — only navigates to `rise.articulate.com` or `app.rise.com`; logs a warning and blocks anything else

### CSS / Styling

All styles are written inline via `GM_addStyle` — no external stylesheets. This was necessary because Rise 360's Content Security Policy blocks externally loaded CSS (including raw GitHub URLs and private server URLs).

Design system: **BootStream / OneStream brand tokens**

| Token | Value | Use |
|---|---|---|
| Primary | `#5564FF` | Buttons, links, checkboxes |
| Dark | `#000000` | Panel header background |
| Danger | `#CC3340` | Stop button |
| Success | `#00985B` | Log success messages |
| Warning | `#F67D02` | Log warning messages |

Buttons are uppercase, flat (no shadow), square corners (`border-radius: 0`).

### LMS Settings Auto-Applied

When exporting as LMS, the script configures the following on the publish page:

| Setting | Value |
|---|---|
| LMS Format | SCORM 1.2 |
| Reporting | Complete / Incomplete |
| Exit microlearning link | OFF |
| Hide cover page | ON |
| Reset progress after updates | OFF |
| Only load in LMS | ON |

### Timing Config

```js
const DELAYS = {
  beforeMenuClick: 800,
  afterMenuClick: 600,
  afterPublishHover: 500,
  publishTimeout: 120000,
  afterBack: 3000,
  afterFolderClick: 2000,
  afterSettingChange: 300,
  afterExpandSettings: 500,
  afterDownloadClick: 500,
  betweenCourses: 2000,
  betweenFolders: 2000,
};
```

---

## Panel UI

- Fixed position: top-right of the viewport
- Draggable header (black bar)
- Collapsible via − / + toggle
- Footer: GitHub link | Jay Pelupessy (`jpelupessy@onestreamsoftware.com`)

---

## Browser Extension (Moved to Separate Project Folder)

Built this session as a Manifest V3 Chrome/Edge extension to replace Tampermonkey. Files have been moved to a separate project folder by the user and are being continued there.

### File Structure

```
extension/
├── manifest.json       — Manifest V3 config
├── content.js          — Ported script logic (no GM_ references)
├── styles.css          — Panel CSS (extracted from GM_addStyle)
├── update.xml          — Auto-update manifest for CRX distribution
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Key Differences from the Userscript

| Userscript | Extension |
|---|---|
| `GM_addStyle(css)` | `styles.css` declared in manifest `content_scripts.css` array |
| `GM_setValue(key, val)` | `chrome.storage.local.set(...)` |
| `GM_getValue(key, default)` | `chrome.storage.local.get(...)` |
| `@updateURL` / `@downloadURL` | `update_url` in `manifest.json` pointing to `update.xml` on GitHub |

### Storage Pattern

`chrome.storage.local` is async, but the rest of the script expects synchronous reads. The extension solves this with an in-memory cache:

1. On init, `loadCaches()` fetches `rbe_state` and `rbe_log` from storage into `_stateCache` and `_logCache`
2. All subsequent `st()` reads come from `_stateCache` (synchronous)
3. All writes update `_stateCache` immediately and fire a background `chrome.storage.local.set()` to persist

### manifest.json (summary)

```json
{
  "manifest_version": 3,
  "name": "Rise 360 Bulk Export",
  "version": "3.4",
  "content_scripts": [{
    "matches": ["https://rise.articulate.com/*", "https://app.rise.com/*"],
    "js": ["content.js"],
    "css": ["styles.css"],
    "run_at": "document_idle"
  }],
  "permissions": ["storage"],
  "update_url": "https://raw.githubusercontent.com/sp00kman1337/Rise-Exporter/main/extension/update.xml"
}
```

### How to Load (Unpacked)

1. Go to `edge://extensions` or `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` folder
4. Navigate to Rise 360 — the panel appears automatically

### Auto-Update

The `update_url` in `manifest.json` only activates when the extension is packaged as a signed `.crx` file — it does **not** work for unpacked extensions. Until then, to update:

1. Pull latest code from GitHub
2. Open the extensions page
3. Click the reload icon on the Rise 360 Bulk Export card

When ready to enable true auto-update:
1. Open `edge://extensions` → Developer mode → **Pack extension** → point at the `extension/` folder
2. Save the generated `.crx` to the repo
3. Note the extension ID shown on the extensions page
4. Replace `REPLACE_WITH_YOUR_EXTENSION_ID` in `update.xml` with that ID
5. Update the `version` in `update.xml` to match `manifest.json`
6. Commit and push both the `.crx` and `update.xml` to GitHub

---

## Pending Items

- [ ] Delete `assets/` and `dist/` folders if they still appear (manual delete in VS Code — OneDrive blocks bash)
- [ ] Delete outdated `rise-bulk-export-summary.md`
- [ ] Commit and push footer changes to GitHub (footer HTML + CSS were added to userscript but not yet committed)
- [ ] Commit message for last change: `feat: add footer with GitHub link and contact email (v3.4)`
- [ ] Extension: replace `REPLACE_WITH_YOUR_EXTENSION_ID` in `update.xml` once the extension is installed and its ID is known
