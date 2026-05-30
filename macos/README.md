# IslandNotch

A lightweight macOS menu-bar / notch app that captures a screenshot with a
hotkey, parks it in a floating "Dynamic Island"-style shelf under the notch, and
makes the screenshot trivially pasteable into whatever **local CLI coding agent**
you're running (Claude Code, Codex, …).

> **The file path is the entire integration.** There is no server, no upload, no
> MCP, no tunnel, no API key. The app captures a PNG to a folder and puts a
> pasteable payload (the path, or the image bytes) on the clipboard. Your agent
> reads the local file natively.

```
double-⌘ (or your shortcut)
   → screencapture -i → ~/Desktop/island-shots/<timestamp>.png  (+ index.json)
   → thumbnail appears in the floating notch shelf
       • left-click  → copy payload to clipboard
       • right-click → Quick Look the full-res PNG (offline)
   → paste into Claude Code / Codex
```

## Features

- **Notch shelf** — a floating, non-activating panel under the notch (via
  [DynamicNotchKit](https://github.com/MrKai77/DynamicNotchKit)); a top-center
  floating pill is used automatically on Macs without a notch. Expands on hover.
- **Two capture hotkeys** — a configurable global chord
  ([KeyboardShortcuts](https://github.com/sindresorhus/KeyboardShortcuts),
  default ⌘⇧7) and an optional **double-tap ⌘** gesture (global `CGEventTap`).
- **Drag / throw images in** — drop image files onto the shelf; they're copied
  into the shots folder and indexed like a capture.
- **Auto-copy, your way** — choose which capture sources auto-copy to the
  clipboard (default: double-⌘ and the chord; drag-drops are manual).
- **Per-agent clipboard payload** — path, `look at <path>`, or raw image bytes,
  selectable per agent.
- **Quick Look** — right-click a thumbnail for a full-res, offline preview.
- **Housekeeping** — optional "delete shots older than N days" sweep.

## Architecture

```
macos/
├── IslandNotch.xcodeproj            # Hand-written, folder-synchronized (objectVersion 77)
├── project.yml                      # Optional XcodeGen spec (regenerates the project)
├── BuildSupport/                    # Base.xcconfig, Info.plist, entitlements, signing template
└── IslandNotch/
    ├── IslandNotchApp.swift         # @main; Settings scene only (LSUIElement agent app)
    ├── AppDelegate.swift            # status item, notch, hotkeys, capture wiring
    ├── Models/                      # ScreenshotEntry/Index, CaptureSource, PayloadMode, …
    ├── Services/                    # ScreenshotStore (+Index/+Capture/+Import/+Retention),
    │                                #   CaptureService, Hotkey/DoubleCommandTap, Pasteboard,
    │                                #   QuickLook, Permissions, AppPreferences
    ├── Windows/                     # NotchController (DynamicNotchKit wrapper), NotchGeometry
    └── Views/                       # NotchShelfView, ThumbnailView, DropZoneView, Settings/*
```

The **shots folder is the whole database.** `index.json` is a versioned cache/log
of `{ file, prompt, ts, source }`. On launch and after each change the store
reconciles the index against the PNGs actually on disk.

> **DynamicNotchKit note:** the package's public API can change between major
> versions. All usage is isolated to `Windows/NotchController.swift` — if your
> resolved version differs, that's the only file to adjust.

## Build & run

Requires macOS 14+ and Xcode 16+.

**Xcode (recommended):**
1. `cp BuildSupport/PrivateOverrides.xcconfig.example BuildSupport/PrivateOverrides.xcconfig`
   and set your `DEVELOPMENT_TEAM` (Xcode → Settings → Accounts).
2. Open `IslandNotch.xcodeproj`. Xcode resolves the Swift packages on first open.
3. Select the **IslandNotch** scheme and Run.

**Command line:**
```bash
cd macos
# Optional: regenerate the project from project.yml instead of the committed one
#   brew install xcodegen && xcodegen generate
xcodebuild -project IslandNotch.xcodeproj -scheme IslandNotch \
           -configuration Debug -destination 'platform=macOS' build
open ~/Library/Developer/Xcode/DerivedData/IslandNotch-*/Build/Products/Debug/IslandNotch.app
```

The app launches into the menu bar (no Dock icon). Open **Settings** from the
menu-bar icon.

## Permissions

Two one-time system prompts, both handled gracefully (and deep-linked from
**Settings → Permissions**):

- **Screen Recording** — required to capture. Takes effect after relaunch.
- **Accessibility** — required **only** for the double-⌘ gesture. Without it, the
  keyboard chord still works.

> TCC permission grants are tied to the app's signed identity. Sign with a stable
> Developer-ID (or a consistent local cert) so you don't have to re-grant after
> every rebuild.

## Distribution

Distribute as a Developer-ID **notarized**, **non-sandboxed** app. The App
Sandbox is impractical here (global event tap, launching `/usr/sbin/screencapture`,
writing to `~/Desktop`). Hardened Runtime is enabled (`ENABLE_HARDENED_RUNTIME`),
which is required for notarization; no hardened-runtime exceptions are needed.

## Settings reference

| Tab | Controls |
|-----|----------|
| General | Shots folder (Desktop vs Application Support), retention sweep, per-source auto-copy |
| Agents | Active agent, per-agent clipboard payload mode, custom agent name |
| Hotkey | Capture chord recorder, double-⌘ toggle |
| Permissions | Live Screen Recording / Accessibility status + prompts & deep links |
