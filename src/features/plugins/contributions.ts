/**
 * Turns a validated manifest's `contributes` into live Maibuk surfaces without
 * running the Worker: the shared Command registry (`registerPluginCommands`),
 * the Settings rows registry, the toolbar button registry, and the page,
 * sidebar-entry, and Item Menu registries in `contributions-registry.ts`.
 * Registering is metadata only, so the Command Palette, Settings search, the
 * toolbar arrangement, and the sidebar all discover an installed Plugin before
 * it is ready (ADR 0022).
 *
 * Contributions are filtered by platform and localized: the manifest's literal
 * strings are its `defaultLanguage`, and `locales/<lang>.json` overrides them
 * per field path. Command labels keep every language, so the palette and Voice
 * Commands resolve the current one; the other surfaces use the current UI
 * language and re-register in place when it changes.
 *
 * This is the write side, and the only module that parses a manifest. It is
 * reached from `lifecycle.ts`, which `main.tsx` dynamic-imports in idle time;
 * the read side lives in the zod-free `contributions-registry.ts` so the entry
 * chunk never ships the manifest validator (#437).
 */

import i18n from "@/i18n";
import { PLUGIN_PREFIX } from "@/features/plugins/ids";
import { pluginsRunOn } from "@/features/plugins/host-platform";
import { MANIFEST_LANGUAGES } from "@/features/plugins/manifest-constants";
import { applyPluginLocale, parsePluginLocale } from "@/features/plugins/manifest-validate";
import {
  currentUILanguage,
  deleteRegisteredContributions,
  getRegisteredContributions,
  notifyContributionsChange,
  pluginPageRoute,
  setRegisteredContributions,
  type PluginCommandDef,
  type PluginItemMenuEntryDef,
  type PluginPageDef,
  type PluginSidebarEntryDef,
  type PluginTarget,
} from "@/features/plugins/contributions-registry";
import type {
  PluginContributionId,
  PluginFolder,
  PluginLocale,
  PluginManifest,
} from "@/features/plugins/types";
import {
  currentSettingsPlatform,
  registerPluginSettingsRows,
  type PluginSettingsRowDeclaration,
  type SettingsPlatform,
} from "@/features/settings/rows";
import {
  registerToolbarButtons,
  type PluginToolbarButtonDeclaration,
} from "@/features/settings/toolbar-config";
import type { Language } from "@/features/settings/types";
import {
  PLUGIN_COMMAND_PREFIX,
  isCoreContextName,
  registerPluginCommands,
  type PluginCommandDeclaration,
  type PluginCommandId,
} from "@/lib/shortcut-registry";

// The read side of the registry, re-exported so existing callers keep one
// import path. New UI code imports `contributions-registry.ts` directly.
export {
  currentUILanguage,
  getPluginCommand,
  getPluginCommands,
  getPluginItemMenuEntries,
  getPluginPage,
  getPluginPages,
  getPluginSidebarEntries,
  onPluginContributionsChange,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions-registry";
export { pluginPageRoute };
export type {
  PluginCommandDef,
  PluginItemMenuEntryDef,
  PluginPageDef,
  PluginSidebarEntryDef,
  PluginTarget,
};

/**
 * The Shortcut Contexts of one declared Command, as the shared registry derives
 * them: a core name passes through, one of this Plugin's page ids becomes the
 * page's `plugin.<pluginId>.<pageId>` Context. The manifest validator already
 * refused any other name, so an unknown one keeps its literal (and can only
 * have arrived from an invalid bypass of the validator).
 */
function deriveCommandContexts(
  pluginId: string,
  contexts: readonly string[],
  pageLocalIds: ReadonlySet<string>
): readonly string[] {
  return contexts.map((context) => {
    if (isCoreContextName(context)) return context;
    if (pageLocalIds.has(context)) return `${PLUGIN_COMMAND_PREFIX}${pluginId}.${context}`;
    return context;
  });
}

const LOCALE_FILE_PATTERN = /^locales\/([a-z]+)\.json$/;

/**
 * Reads every `locales/<lang>.json` in the folder. A file that fails
 * validation is ignored with a warning, so one bad locale cannot refuse an
 * otherwise valid Plugin.
 */
export function readPluginLocales(
  folder: PluginFolder,
  manifest: PluginManifest
): Partial<Record<Language, PluginLocale>> {
  const locales: Partial<Record<Language, PluginLocale>> = {};
  for (const file of folder.files) {
    const match = LOCALE_FILE_PATTERN.exec(file.path);
    if (!match) continue;
    const language = match[1];
    if (!(MANIFEST_LANGUAGES as readonly string[]).includes(language)) continue;
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
    } catch {
      continue;
    }
    const result = parsePluginLocale(text, language, manifest);
    if (result.ok) locales[language as Language] = result.locale;
    else console.warn(`Plugin ${manifest.id} locale "${language}" was refused`, result.problems);
  }
  return locales;
}

function localizedLabelPerLanguage(
  manifest: PluginManifest,
  locales: Partial<Record<Language, PluginLocale>>,
  localId: string
): Partial<Record<Language, string>> {
  const labels: Partial<Record<Language, string>> = {};
  for (const language of Object.keys(locales) as Language[]) {
    const locale = locales[language];
    if (locale === undefined) continue;
    const command = applyPluginLocale(manifest, locale).contributes?.commands?.find(
      (item) => item.id === localId
    );
    if (command !== undefined) labels[language] = command.label;
  }
  return labels;
}

export interface PluginContributionsSource {
  manifest: PluginManifest;
  folder: PluginFolder;
}

/**
 * Admits a manifest's contributions and returns the unregister for all of
 * them. Re-registers in place when the UI language changes, so the localized
 * page titles, sidebar labels, and Settings rows follow the author's language
 * without reloading. A Plugin that does not run on this platform registers
 * nothing.
 */
export function registerPluginContributions(source: PluginContributionsSource): () => void {
  const { manifest, folder } = source;
  const locales = readPluginLocales(folder, manifest);
  let unregisters: Array<() => void> = [];

  const apply = (): void => {
    // A failed apply must not leave a partial registration behind. Undo
    // newest-first: what this apply stored so far, then what the previous
    // registration still owns (its closures sit in `unregisters` until the
    // new ones replace them on success, and they are token-checked, so the
    // two passes neither double-run nor miss an interleaved replacement).
    const rollback = (): void => {
      for (const unregister of next.slice().reverse()) unregister();
      for (const unregister of unregisters.slice().reverse()) unregister();
      unregisters = [];
      notifyContributionsChange();
    };
    const next: Array<() => void> = [];
    try {
      const platform = currentSettingsPlatform();
      // The host runs no Plugin on a platform it does not support (Android in
      // v1, #447): such a Plugin contributes no Command, page, Settings row,
      // toolbar button, or Item Menu entry, whatever its manifest declares.
      if (
        !pluginsRunOn(platform) ||
        !(manifest.platforms as readonly SettingsPlatform[]).includes(platform)
      ) {
        unregisters = [];
        return;
      }
      const localized = applyPluginLocale(manifest, locales[currentUILanguage()] ?? {});
      const contributes = localized.contributes ?? {};
      const onPlatform = <T extends { platforms?: readonly SettingsPlatform[] }>(
        item: T
      ): boolean => item.platforms === undefined || item.platforms.includes(platform);

      // Two views of the same declarations: the localized manifest's labels are
      // the on-screen strings for the current UI language (item menus, page
      // titles), the raw manifest's are the default-language literals that stay
      // stable across languages because the shared Command registry keeps them
      // plus every locale's label.
      const localizedCommands = (contributes.commands ?? []).filter(onPlatform);
      const defaultLanguageCommands = (manifest.contributes?.commands ?? []).filter(onPlatform);
      const commandById = new Map(localizedCommands.map((command) => [command.id, command]));
      // A page or toolbar button is registered only while the Command it
      // points at survived the same platform filter. Otherwise the surface
      // would reach the shell naming a Command the shared registry never got,
      // and reading its label or Shortcut would throw (#482).
      const pages = (contributes.pages ?? []).filter(
        (page) => onPlatform(page) && commandById.has(page.command)
      );
      const sidebarEntries = (contributes.sidebarEntries ?? []).filter(onPlatform);
      const settingsRows = (contributes.settingsRows ?? []).filter(onPlatform);
      const toolbarButtons = (contributes.toolbarButtons ?? []).filter(
        (button) => onPlatform(button) && commandById.has(button.command)
      );
      const itemMenuEntries = (contributes.itemMenuEntries ?? []).filter(onPlatform);

      // Every registry below replaces its entries by Plugin id on re-register,
      // so a re-apply (a language change) updates in place instead of stacking
      // copies, and the unregister from this apply covers all of them.
      if (defaultLanguageCommands.length > 0) {
        const declarations: PluginCommandDeclaration[] = defaultLanguageCommands.map((command) => ({
          id: command.id,
          label: command.label,
          labels: localizedLabelPerLanguage(manifest, locales, command.id),
          ...(command.keywords !== undefined ? { keywords: command.keywords } : {}),
          contexts: command.contexts,
          ...(command.defaults !== undefined ? { defaults: command.defaults } : {}),
          ...(command.web !== undefined ? { web: command.web } : {}),
          ...(command.voice !== undefined
            ? { voice: command.voice as unknown as PluginCommandDeclaration["voice"] }
            : {}),
          ...(command.navigates !== undefined ? { navigates: command.navigates } : {}),
          ...(command.opensDialog !== undefined ? { opensDialog: command.opensDialog } : {}),
        }));
        next.push(
          registerPluginCommands(manifest.id, {
            commands: declarations,
            defaultLanguage: manifest.defaultLanguage,
            ...(pages.length > 0 ? { pages: pages.map((page) => page.id) } : {}),
            ...(manifest.commandRenames !== undefined
              ? { commandRenames: manifest.commandRenames }
              : {}),
          })
        );
      }

      if (settingsRows.length > 0) {
        const declarations: PluginSettingsRowDeclaration[] = settingsRows.map((row) => ({
          id: row.id,
          label: row.label,
          ...(row.description !== undefined ? { description: row.description } : {}),
          ...(row.keywords !== undefined ? { keywords: row.keywords } : {}),
          ...(row.platforms !== undefined ? { platforms: row.platforms } : {}),
        }));
        next.push(
          registerPluginSettingsRows(manifest.id, {
            displayName: localized.name,
            rows: declarations,
            ...(manifest.rowRenames !== undefined ? { rowRenames: manifest.rowRenames } : {}),
          })
        );
      }

      if (toolbarButtons.length > 0) {
        const declarations: PluginToolbarButtonDeclaration[] = toolbarButtons.map((button) => ({
          id: button.id,
          command: button.command,
          icon: button.icon,
        }));
        next.push(
          registerToolbarButtons(manifest.id, {
            buttons: declarations,
            ...(manifest.buttonRenames !== undefined
              ? { buttonRenames: manifest.buttonRenames }
              : {}),
          })
        );
      }

      const pageDefs: PluginPageDef[] = pages.map((page) => ({
        pluginId: manifest.id,
        displayName: localized.name,
        localId: page.id,
        id: `${PLUGIN_PREFIX}${manifest.id}.${page.id}` as PluginContributionId,
        title: page.title,
        // A page that declares `frame` is a whole-page Frame (D2).
        ...(page.frame !== undefined ? { frame: page.frame } : {}),
        commandId: `${PLUGIN_COMMAND_PREFIX}${manifest.id}.${page.command}` as PluginCommandId,
      }));
      const sidebarDefs: PluginSidebarEntryDef[] = [];
      for (const entry of sidebarEntries) {
        const page = pageDefs.find((candidate) => candidate.localId === entry.page);
        if (page === undefined) continue;
        sidebarDefs.push({
          ...page,
          pageId: page.localId,
          pageRoute: pluginPageRoute(manifest.id, page.localId),
          icon: entry.icon,
        });
      }
      const itemMenuDefs: PluginItemMenuEntryDef[] = [];
      for (const entry of itemMenuEntries) {
        const command = commandById.get(entry.command);
        if (command === undefined || command.targets === undefined) continue;
        itemMenuDefs.push({
          pluginId: manifest.id,
          displayName: localized.name,
          commandId: `${PLUGIN_COMMAND_PREFIX}${manifest.id}.${command.id}` as PluginCommandId,
          localId: command.id,
          label: command.label,
          targets: command.targets,
        });
      }
      // The stored Contexts are the derived names the shared registry keeps, so
      // `getPluginCommands` and `getCommand` agree on one Command's Contexts:
      // the page's own Commands bind on that page and nowhere else.
      const pageLocalIds = new Set(pageDefs.map((page) => page.localId));
      const commandDefs: PluginCommandDef[] = defaultLanguageCommands.map((command) => {
        const fullId = `${PLUGIN_COMMAND_PREFIX}${manifest.id}.${command.id}` as PluginCommandId;
        const page = pageDefs.find((candidate) => candidate.commandId === fullId);
        return {
          id: fullId,
          pluginId: manifest.id,
          localId: command.id,
          contexts: deriveCommandContexts(manifest.id, command.contexts, pageLocalIds),
          ...(command.targets !== undefined ? { targets: command.targets } : {}),
          ...(page !== undefined ? { pageId: page.localId } : {}),
        };
      });

      const previous = getRegisteredContributions(manifest.id);
      const token = Symbol(manifest.id);
      if (
        commandDefs.length > 0 ||
        pageDefs.length > 0 ||
        sidebarDefs.length > 0 ||
        itemMenuDefs.length > 0
      ) {
        setRegisteredContributions(manifest.id, {
          pluginId: manifest.id,
          displayName: localized.name,
          commands: commandDefs,
          pages: pageDefs,
          sidebarEntries: sidebarDefs,
          itemMenuEntries: itemMenuDefs,
          token,
        });
      } else if (previous !== undefined) {
        deleteRegisteredContributions(manifest.id);
      }
      next.push(() => {
        const current = getRegisteredContributions(manifest.id);
        if (current?.token !== token) return;
        deleteRegisteredContributions(manifest.id);
        notifyContributionsChange();
      });

      unregisters = next;
      notifyContributionsChange();
    } catch (error) {
      rollback();
      throw error;
    }
  };

  apply();
  const onLanguageChanged = () => {
    try {
      apply();
    } catch (error) {
      // The re-apply rolled its partial work back already; a throw must not
      // reach i18next, so the Plugin is logged out of every registry instead.
      console.error(
        `Plugin ${manifest.id} contributions failed to re-register after a language change and were removed`,
        error
      );
    }
  };
  i18n.on("languageChanged", onLanguageChanged);
  return () => {
    i18n.off("languageChanged", onLanguageChanged);
    for (const unregister of unregisters.slice().reverse()) unregister();
    unregisters = [];
  };
}
