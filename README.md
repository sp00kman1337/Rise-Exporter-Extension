# Rise 360 Bulk Export

A browser extension that automates bulk-exporting Articulate Rise 360 courses
as Web (HTML) and/or LMS (SCORM) packages across multiple subfolders.

## Requirements

- Microsoft Edge or Chrome
- Access to [Articulate Rise 360](https://rise.articulate.com) or [app.rise.com](https://app.rise.com)
- Automatic downloads enabled for the Rise domain (see [Browser Setup](#browser-setup))

## Installation

1. Download `rise_file_exporter_v1.0.zip` from the repository and extract it
2. Open `edge://extensions` (or `chrome://extensions`)
3. Enable **Developer mode** (toggle, top-right)
4. Click **Load unpacked** → select the `extension/` folder from the extracted zip
5. The extension is now active — navigate to Rise 360 and the panel will appear automatically

## Updating

1. Download the latest zip from the repository and extract it, replacing your existing `extension/` folder
2. Open `edge://extensions` (or `chrome://extensions`)
3. Find **Rise 360 Bulk Export** and click the **reload** icon (↺)

The extension will reload with the latest version — no reinstall needed.

## Browser Setup

Edge and Chrome block multiple automatic downloads by default. Before running an export,
whitelist the Rise domain so all zip files download without prompts.

**Edge:**
1. Navigate to `edge://settings/content/automaticDownloads`
2. Add `https://rise.articulate.com` to the **Allow** list

**Chrome:**
1. Navigate to `chrome://settings/content/automaticDownloads`
2. Add `https://rise.articulate.com` to the **Allow** list

## Usage

1. Navigate to a **parent folder** in Rise 360 (the folder that contains subfolders as cards)
2. Click **Scan Folders** in the panel — checkboxes appear for each subfolder found
3. Deselect any folders you want to skip
4. Choose your export format: **Web (HTML)**, **LMS (SCORM)**, or **Both**
5. Click **Start Export**
6. The extension processes each folder and course automatically, logging progress in the panel
7. Click **Stop** at any time to abort and clear state

Downloaded ZIP files will appear in your browser's default downloads folder using
Rise's default file naming.

## Export Formats

| Format | Description |
|---|---|
| Web (HTML) | Publishes each course as a standalone HTML zip |
| LMS (SCORM) | Publishes each course as a SCORM 1.2 package with preconfigured settings |

### LMS Settings Applied Automatically

When exporting as LMS, the extension configures the following settings on the publish page:

| Setting | Value |
|---|---|
| LMS Format | SCORM 1.2 |
| Reporting | Complete / Incomplete |
| Exit microlearning link | OFF |
| Hide cover page | ON |
| Reset progress after updates | OFF |
| Only load in LMS | ON |

## Configuration

Timing values can be adjusted at the top of `extension/content.js` in the `DELAYS` object
if you experience issues on slower connections:

```js
const DELAYS = {
  beforeMenuClick: 800,      // ms before clicking the "..." menu
  afterMenuClick: 600,       // ms after clicking "..." for menu to appear
  afterPublishHover: 500,    // ms after hovering Publish for submenu
  publishTimeout: 120000,    // max ms to wait for publish (2 min)
  afterBack: 3000,           // ms after clicking Back for page to load
  afterFolderClick: 2000,    // ms after clicking a folder for content to load
  betweenCourses: 2000,      // ms pause between courses
  betweenFolders: 2000,      // ms pause between folders
};
```

After editing, reload the extension from the extensions page for changes to take effect.

## Known Limitations

- Downloads use Rise's default file naming — files are not renamed automatically
- Only handles one level of folder nesting (parent → subfolder → courses)
- If a publish fails mid-export, the extension skips that course and continues
- Requires the user to be inside a parent folder view before scanning

## Version History

| Version | Notes |
|---|---|
| 1.0 | Initial release as browser extension (converted from Tampermonkey userscript) |
