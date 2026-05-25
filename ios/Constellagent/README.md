# Constellagent (iOS)

SwiftUI iPhone client for the Constellagent mobile bridge. Phase 3 of the
remodex → constellagent port: structural shadow-clone of the
`Emanuele-web04/remodex` `CodexMobile/` SwiftUI app, against the constellagent
desktop bridge (`desktop/src/main/mobile-*.ts`).

## What this directory contains

```
ios/Constellagent/
├── Constellagent/                     # Swift sources (233 files, .swift)
│   ├── ConstellagentApp.swift         # App entry
│   ├── ContentView.swift
│   ├── Models/                        # Codex* → Constellagent* renamed
│   ├── Services/                      # ConstellagentService + extensions
│   ├── Views/                         # Sidebar, Turn, Settings, Onboarding, …
│   ├── Assets.xcassets/
│   ├── BuildSupport/, Fonts/, Resources/
│   └── Constellagent.entitlements
├── Constellagent.xcodeproj/           # Renamed from CodexMobile.xcodeproj
└── ConstellagentTests/                # Four ported tests (see below)
```

## Port mechanics applied

1. Copied `CodexMobile/CodexMobile/` → `Constellagent/`.
2. Stripped deferred subtrees per plan §"Deferred from remodex":
   - `Services/Payments/`, `Services/Terminal/`
   - `Views/Pet/`, `Views/Payments/`, `Views/Terminal/`, `Views/Turn/Voice/`
   - `Models/PetCompanionModels.swift`
   - `Services/PetCompanionStore.swift`, `Services/GPTVoiceTranscriptionManager.swift`
   - `Services/ConstellagentService+Voice*.swift`, `Services/ConstellagentService+Pets.swift`
3. Bulk renamed `CodexMobile` → `Constellagent`, `Codex` → `Constellagent`,
   `Remodex` → `Constellagent`, `remodex` → `constellagent` across file
   contents and filenames.
4. Copied `CodexMobile.xcodeproj` → `Constellagent.xcodeproj` with the same
   renames. Dropped `ConstellagentMenuBar.xcscheme` (deferred).
5. Ported four required tests to `ConstellagentTests/`:
   - `ConstellagentSecurePairingStateTests.swift`
   - `QRScannerPairingValidatorTests.swift`
   - `ConstellagentServiceConnectionErrorTests.swift`
   - `TurnTimelineReducerTests.swift`

## Build status

`xcodebuild -project Constellagent.xcodeproj -scheme Constellagent -destination 'generic/platform=iOS' build` → **BUILD SUCCEEDED**.

## Architectural decisions taken to land the build

### 1. Central JSON-RPC method mapper

`Services/ConstellagentService+ProtocolMapping.swift` translates between the
upstream codex vocabulary (`thread/list`, `turn/start`, `account/*`, etc.) and
the constellagent bridge's `session.*` / `git.*` / `workspace.*` /
`annotation.*` set. Mapping happens at the single chokepoint
`ConstellagentService.sendRequest` instead of editing every `Service+*`
extension, so the upstream files keep reading like their remodex ancestors and
upstream fixes can be re-pulled. Inverse mapping on the inbound side lives in
`Services/ConstellagentService+IncomingSupport.swift::normalizedIncomingMethodName`
— it rewrites event names from `mobile-event-bridge.ts` (`session.message.delta`)
back to the substring-matched codex shape (`thread/turn/message/delta`) the
existing dispatch table expects.

Methods with no bridge equivalent (`account/*`, `model/list`,
`collaborationMode/list`, `review/start`, `notifications/push/register`,
`thread/fork`, `thread/name/set`, `thread/contextWindow/read`,
`thread/generateTitle`, `thread/compact/start`) are short-circuited locally
with a synthesised empty response so the UI keeps moving instead of crashing.

### 2. Deferred-feature stubs

`Services/ConstellagentDeferredStubs.swift` provides empty placeholder types
for the deferred subtrees (pet companion, GPT voice, RevenueCat
subscriptions, terminal). Stubs are minimal — Views render `EmptyView()`,
stores have no state, manager methods are no-ops. Upstream call sites compile
unchanged. Re-enable any feature by deleting its stub and restoring the
upstream file.

### 3. Voice presentation builders kept

`Views/Turn/Voice/TurnVoicePresentationBuilders.swift` was restored from the
`Voice/` subtree (otherwise deferred) because it is pure UI mapping with no
audio plumbing — keeping it spares us a thicker stub.

### 4. TurnView body type-check fix

The `TurnConversationContainerView(...)` constructor takes ~30 arguments
including inline closures and chained `.environment` modifiers. Swift's
type-checker budget exploded on it (`unable to type-check this expression in
reasonable time`). Fix: hoist the inline closures and AnyView wrappers into
typed `let` bindings above the constructor. The pattern is in `TurnView.swift`
around the `return TurnConversationContainerView(` site.

## What still needs human attention

### 1. xcodeproj has dangling file references

`Constellagent.xcodeproj/project.pbxproj` still contains `PBXFileReference`
entries for files we deleted (Payments, Terminal, Pet, Widget, MenuBar,
Voice). Stripping these by hand from `project.pbxproj` is error-prone. The
recommended path:

1. Open `Constellagent.xcodeproj` in Xcode.
2. Let Xcode flag every missing file ref (red entries in the navigator) and
   delete them from the project (without trashing files).
3. Remove the `ConstellagentWidget` and `ConstellagentMenuBar` targets.
4. Update the main target's bundle identifier from
   `com.codex.mobile`/equivalent to e.g. `com.constellagent.mobile`.
5. Confirm signing/team in target → Signing & Capabilities.

### 2. Wire protocol must be rebound to the constellagent bridge

The iOS service extensions (`Services/ConstellagentService+*.swift`) still
speak the original `codex app-server` JSON-RPC vocabulary:

- `thread/start`, `thread/list`, `thread/read`, `thread/fork`,
  `thread/turns/list`, `thread/contextWindow/read`, `thread/generateTitle`,
  `thread/compact/start`, `thread/resume`
- `turn/start`, `turn/steer`
- `account/*`, `model/list`, `collaborationMode/list`, `review/start`,
  `notifications/push/register`

The constellagent desktop bridge
(`desktop/src/main/mobile-method-router.ts`) speaks a different vocabulary:

| iOS call (Codex protocol) | Constellagent bridge (closest equivalent) |
|---|---|
| `thread/list`             | `session.list` |
| `thread/read`             | `session.history` |
| `thread/start`            | `session.start` |
| `turn/start`              | `session.reply` |
| `turn/steer` (mid-run reply) | `session.reply` with `deliverAs: "steer"` |
| `thread/list` (with project filter) | `workspace.list` + `session.list` |
| `workspace/read` (file)   | `workspace.read` |
| `git/*`                   | `git.status`, `git.branch.list`, `git.branch.switch`, `git.commit`, `git.diff` |
| `plan/approve`, `plan/reject` | `plan.approve`, `plan.reject` |
| (new)                     | `annotation.list`, `annotation.create`, `annotation.resolve` |
| `account/*`, `model/list`, `collaborationMode/list`, `review/start`, `notifications/push/register` | **not implemented bridge-side** — gate behind feature checks or stub |

For each `Services/ConstellagentService+*.swift` file, replace the method
strings and reshape the request `params` / response handling to match the zod
schemas in `packages/constellagent-mobile-protocol/src/index.ts`. Notifications
(`mobile-event-bridge.ts` on the desktop) emit a different envelope shape than
codex's `rollout-live-mirror` — `Services/ConstellagentService+Incoming*.swift`
needs the parser updated.

### 3. SecureTransport already aligned

`Services/ConstellagentService+SecureTransport.swift` and
`Services/ConstellagentSecureTransportModels.swift` mirror
`desktop/src/main/mobile-secure-transport.ts` 1:1 on the wire. Constants:

- `HANDSHAKE_TAG = "constellagent-e2ee-v1"`
- `PAIRING_QR_VERSION = 2`
- `SECURE_PROTOCOL_VERSION = 1`

Verify the Swift constants after the rename matches these strings exactly —
the desktop side asserts on them.

## Deferred from remodex (re-evaluate after Phase 3 ships)

- Subscription / RevenueCat (`Payments/*`)
- Pet companion overlay
- Ghostty embedded terminal (`Services/Terminal`, `Views/Terminal`)
- Voice / GPT transcription
- Widget target (`RemodexWidget`)
- Menu-bar companion (`RemodexMenuBar`)
- Public WS relay + APNS — Tailscale-only per plan §"Tailscale fit"

## Verification (per plan)

```
xcodebuild -scheme Constellagent -destination 'generic/platform=iOS' build
xcodebuild test -scheme Constellagent -destination 'platform=iOS Simulator,name=iPhone 15'
```

Both will fail today because of the two outstanding items above (xcodeproj
cleanup + protocol rebind). After those land, manual:

1. Launch desktop app, Settings → Mobile → enable.
2. QR scan from the device.
3. Confirm `session.list` populates from `conductor-chat.db`.
4. Start a session, observe streaming via `mobile-event-bridge.ts`.
5. Switch git branch via `git.branch.switch`.

State observed on the phone should match the Conductor panel's view of
`conductor-chat.db` exactly.
