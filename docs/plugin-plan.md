# Plugin System Architecture for Maibuk

## Overview

Add a scalable plugin system to Maibuk focused on **editor extensions** with:

- Local plugin installation (from .zip files)
- Frontend-only plugins (JavaScript, no Rust)
- Sandboxed execution with permission-based security

## Architecture Summary

```
PluginManager → PluginSandbox (iframe) → Plugin Code
      ↓                                      ↓
PluginStore ← ─ ─ ─ ─ API Bridge ─ ─ ─ ─ → PluginAPI
      ↓
Editor.tsx (dynamic extension loading)
```

---

## Implementation Steps

### Phase 1: Core Types & Store

**Create `/src/features/plugins/` directory structure:**

```
src/features/plugins/
├── index.ts
├── types.ts              # PluginManifest, Permission, InstalledPlugin
├── store.ts              # Zustand store with persistence
└── core/
    ├── PluginManager.ts  # Singleton orchestrator
    ├── PluginLoader.ts   # ZIP extraction, validation
    └── PluginValidator.ts
```

**Key Types:**

- `PluginManifest`: id, name, version, permissions, main entry, type
- `Permission`: `editor:read`, `editor:write`, `storage:local`, `ui:toolbar`, `network:fetch`
- `InstalledPlugin`: manifest + enabled state + granted permissions

**Files to modify:**

- None in phase 1 (new files only)

---

### Phase 2: Permission System & Sandbox

**Create `/src/features/plugins/security/`:**

```
security/
├── PermissionManager.ts   # Check/grant/revoke permissions
├── PluginSandbox.ts       # iframe-based isolation
└── SecurityPolicy.ts      # CSP rules, dangerous pattern detection
```

**Sandbox approach:**

- Each plugin runs in a hidden `<iframe sandbox="allow-scripts">`
- Communication via `MessageChannel` (postMessage API)
- CSP restricts network unless `network:fetch` permission granted
- Code scanned for dangerous patterns (`eval`, `document.cookie`, etc.)

---

### Phase 3: Plugin API Bridge

**Create `/src/features/plugins/api/`:**

```
api/
├── PluginBridge.ts     # Main API orchestrator
├── EditorAPI.ts        # TipTap editor access (read/write content, commands)
├── StorageAPI.ts       # Namespaced localStorage (5MB quota per plugin)
└── UIAPI.ts            # Notifications, toolbar buttons, panels
```

**EditorAPI methods:**

- `getContent()`, `getText()`, `getSelection()`, `getWordCount()`
- `insertText()`, `replaceSelection()`, `executeCommand()`
- `onUpdate()`, `onSelectionUpdate()` (subscriptions)

---

### Phase 4: Editor Integration

**Modify `/src/components/editor/Editor.tsx`:**

1. Import `usePluginExtensions` hook
2. Add plugin extensions to the extensions array after core extensions
3. Provide editor instance to PluginManager

**Create:**

- `/src/features/plugins/hooks/usePluginExtensions.ts` - loads enabled plugin TipTap extensions
- `/src/components/editor/extensions/PluginExtensionLoader.ts` - wraps extensions with error boundaries

**Key change in Editor.tsx (line ~49-100):**

```typescript
const pluginExtensions = usePluginExtensions();

const editor = useEditor({
  extensions: [
    // ... existing extensions ...
    ...pluginExtensions, // Add at end
  ],
  // ...
});
```

---

### Phase 5: UI Components

**Create `/src/features/plugins/components/`:**

```
components/
├── PluginSettings.tsx        # Main plugin management section
├── PluginCard.tsx            # Individual plugin display
├── PluginInstallDialog.tsx   # File picker + validation
├── PluginPermissionDialog.tsx # Permission approval
└── PluginErrorBoundary.tsx   # Error isolation
```

**Modify `/src/pages/Settings.tsx`:**

- Add `<PluginSettings />` section between Export and About sections

**Add i18n keys to:**

- `/src/locales/en.json`
- `/src/locales/es.json`

---

### Phase 6: Storage & Database

**Modify `/src/lib/db/index.ts`:**

Add tables:

```sql
CREATE TABLE IF NOT EXISTS plugin_storage (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE(plugin_id, key)
);
```

**Plugin code storage:**

- Use IndexedDB for plugin JavaScript bundles (larger files)
- Manifest/settings in Zustand store (persisted to localStorage)

---

## Critical Files

| Purpose                  | File Path                                        |
| ------------------------ | ------------------------------------------------ |
| Editor extensions array  | `src/components/editor/Editor.tsx:49-100`        |
| Settings page            | `src/pages/Settings.tsx`                         |
| Store pattern            | `src/features/settings/store.ts`                 |
| TipTap extension example | `src/components/editor/extensions/SceneBreak.ts` |
| Database schema          | `src/lib/db/index.ts`                            |

---

## Plugin Manifest Format

```json
{
  "id": "com.example.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "Does something useful",
  "author": { "name": "Author Name" },
  "main": "dist/index.js",
  "type": "editor-extension",
  "permissions": ["editor:read", "editor:write", "storage:local"],
  "maibukVersion": ">=0.1.18",
  "editorExtension": {
    "extensionType": "extension",
    "name": "myPlugin"
  }
}
```

---

## Security Model

| Permission        | Access Granted                               |
| ----------------- | -------------------------------------------- |
| `editor:read`     | Read document content, word count, selection |
| `editor:write`    | Modify content, execute formatting commands  |
| `storage:local`   | 5MB namespaced localStorage per plugin       |
| `ui:toolbar`      | Add toolbar buttons                          |
| `ui:notification` | Show toast notifications                     |
| `network:fetch`   | HTTPS requests (user must approve)           |

**Blocked by default:**

- Direct DOM access
- eval/Function constructor
- Cookie/sessionStorage access
- Cross-plugin data access

---

## Verification Plan

1. **Unit tests:**

   - PluginValidator: manifest validation
   - PermissionManager: grant/revoke logic
   - PluginSandbox: message passing

2. **Integration tests:**

   - Install plugin from .zip
   - Enable/disable plugin
   - Plugin persists across app restart

3. **Manual testing:**

   - Create test plugin that adds word count goal feature
   - Verify sandbox isolation (plugin error doesn't crash app)
   - Test permission dialog flow

4. **Security testing:**
   - Verify blocked patterns are rejected
   - Test storage quota enforcement
   - Confirm CSP blocks unauthorized network requests

---

## Future Enhancements (not in initial scope)

- Plugin marketplace / remote installation
- Rust backend plugins via Tauri
- Plugin auto-updates
- Export format plugins
- Theme plugins
