export interface CursorModelCatalog {
  readonly cloudIds: ReadonlySet<string>
  readonly cloudAliases: ReadonlySet<string>
  readonly cliIds: ReadonlySet<string>
}

export interface CursorSdkModelContext {
  readonly apiKey?: string
  readonly hasCliLogin: boolean
  readonly catalog: CursorModelCatalog
}

export function isKnownCursorCloudModel(modelId: string, catalog: CursorModelCatalog): boolean {
  const normalized = modelId.trim().toLowerCase()
  if (!normalized) return false
  return catalog.cloudIds.has(normalized) || catalog.cloudAliases.has(normalized)
}

export function isKnownCursorCliModel(modelId: string, catalog: CursorModelCatalog): boolean {
  const normalized = modelId.trim().toLowerCase()
  if (!normalized) return false
  return catalog.cliIds.has(normalized)
}

/**
 * The Cursor SDK validates local model ids against Cursor.models.list() whenever an
 * API key is present (including CURSOR_API_KEY in the environment). CLI builds can
 * expose models like composer-2.5-fast before the cloud catalog catches up.
 */
export function shouldBypassCursorSdkModelValidation(
  modelId: string,
  context: CursorSdkModelContext,
): boolean {
  if (!context.hasCliLogin) return false
  if (!isKnownCursorCliModel(modelId, context.catalog)) return false
  return !isKnownCursorCloudModel(modelId, context.catalog)
}

export function isCursorSdkModelValidationError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('Cannot use this model:')
}
