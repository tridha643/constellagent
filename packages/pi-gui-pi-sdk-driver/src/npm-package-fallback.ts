import {
  DefaultResourceLoader,
  SettingsManager,
  createAgentSession,
  getAgentDir,
  type CreateAgentSessionOptions,
} from "@mariozechner/pi-coding-agent";
import { createPiGuiEventBus } from "./pi-event-bus.js";

async function ensurePiGuiResourceLoader(
  options: CreateAgentSessionOptions | undefined,
): Promise<CreateAgentSessionOptions> {
  const opts: CreateAgentSessionOptions = options ? { ...options } : {};
  if (opts.resourceLoader) {
    return opts;
  }
  const cwd = opts.cwd ?? process.cwd();
  const agentDir = opts.agentDir ?? getAgentDir();
  const settingsManager = opts.settingsManager ?? SettingsManager.create(cwd, agentDir);
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    eventBus: createPiGuiEventBus(),
  });
  await resourceLoader.reload();
  return { ...opts, cwd, agentDir, settingsManager, resourceLoader };
}

export function isGlobalNpmLookupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("npm root -g");
}

export function createSettingsManagerWithoutNpmPackages(current: SettingsManager): SettingsManager | null {
  const globalSettings = current.getGlobalSettings() as Record<string, unknown>;
  const projectSettings = current.getProjectSettings() as Record<string, unknown>;
  const nextGlobalPackages = filterOutNpmPackageSources(globalSettings.packages);
  const nextProjectPackages = filterOutNpmPackageSources(projectSettings.packages);

  const globalChanged = nextGlobalPackages !== globalSettings.packages;
  const projectChanged = nextProjectPackages !== projectSettings.packages;
  if (!globalChanged && !projectChanged) {
    return null;
  }

  const nextGlobalSettings = globalChanged ? { ...globalSettings, packages: nextGlobalPackages } : globalSettings;
  const nextProjectSettings = projectChanged ? { ...projectSettings, packages: nextProjectPackages } : projectSettings;
  return SettingsManager.fromStorage({
    withLock(scope, fn) {
      const currentJson =
        scope === "global"
          ? JSON.stringify(nextGlobalSettings)
          : JSON.stringify(nextProjectSettings);
      fn(currentJson);
    },
  });
}

export async function createAgentSessionWithNpmFallback(options?: CreateAgentSessionOptions) {
  const prepared = await ensurePiGuiResourceLoader(options);
  try {
    return await createAgentSession(prepared);
  } catch (error) {
    if (!isGlobalNpmLookupError(error)) {
      throw error;
    }

    const cwd = prepared.cwd ?? process.cwd();
    const agentDir = prepared.agentDir ?? getAgentDir();
    const currentSettingsManager = prepared.settingsManager ?? SettingsManager.create(cwd, agentDir);
    const fallbackSettingsManager = createSettingsManagerWithoutNpmPackages(currentSettingsManager);
    if (!fallbackSettingsManager) {
      throw error;
    }

    console.warn(
      `[pi-gui] Falling back to session resource loading without npm package sources for ${cwd}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: fallbackSettingsManager,
      eventBus: createPiGuiEventBus(),
    });
    await resourceLoader.reload();

    return createAgentSession({
      ...prepared,
      agentDir,
      settingsManager: fallbackSettingsManager,
      resourceLoader,
    });
  }
}

function filterOutNpmPackageSources(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  const filtered = value.filter((entry) => !isNpmPackageSource(entry));
  return filtered.length === value.length ? value : filtered;
}

function isNpmPackageSource(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().startsWith("npm:");
  }

  if (typeof value !== "object" || value === null || !("source" in value)) {
    return false;
  }

  return typeof value.source === "string" && value.source.trim().startsWith("npm:");
}
