import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const ASK_QUESTION_PATCH_MARKER = '/* constellagent-ask-question-hook */'
const MODEL_VALIDATION_PATCH_MARKER = '/* constellagent-model-validation-hook */'

const QUERY_HANDLER_ORIGINAL =
  'query:(e,t)=>local_executor_awaiter(this,void 0,void 0,(function*(){return buildDefaultLocalInteractionResponse(t)}))'

const QUERY_HANDLER_PATCHED =
  'query:(e,t)=>local_executor_awaiter(this,void 0,void 0,(function*(){if(t.query.case==="askQuestionInteractionQuery"&&globalThis.__constellagentCursorAskQuestionHandler){return yield globalThis.__constellagentCursorAskQuestionHandler(t,Responses,ask_question_tool_pb)}return buildDefaultLocalInteractionResponse(t)}))'

const MODEL_VALIDATION_ESM_ORIGINAL =
  'resolveLocalModelSelection(e,{listModels:void 0!==n&&n.length>0?()=>this.listModelsForLocalValidation(n):void 0})'

const MODEL_VALIDATION_ESM_PATCHED =
  'resolveLocalModelSelection(e,{listModels:globalThis.__constellagentCursorBypassModelValidation?void 0:void 0!==n&&n.length>0?()=>this.listModelsForLocalValidation(n):void 0})'

const MODEL_VALIDATION_CJS_ORIGINAL =
  '{listModels:void 0!==r&&r.length>0?()=>this.listModelsForLocalValidation(r):void 0}'

const MODEL_VALIDATION_CJS_PATCHED =
  '{listModels:globalThis.__constellagentCursorBypassModelValidation?void 0:void 0!==r&&r.length>0?()=>this.listModelsForLocalValidation(r):void 0}'

export type CursorAskQuestionHandler = (
  query: unknown,
  Responses: unknown,
  askQuestionToolPb: unknown,
) => Promise<unknown> | unknown

declare global {
  // eslint-disable-next-line no-var
  var __constellagentCursorAskQuestionHandler: CursorAskQuestionHandler | undefined
  // eslint-disable-next-line no-var
  var __constellagentCursorBypassModelValidation: boolean | undefined
  // eslint-disable-next-line no-var
  var __constellagentCursorSdkHookInstalled: boolean | undefined
}

function resolveSdkBundlePaths(): string[] {
  const require = createRequire(import.meta.url)
  const resolved = require.resolve('@cursor/sdk')
  const distDir = join(dirname(resolved), '..')
  return [join(distDir, 'esm', 'index.js'), join(distDir, 'cjs', 'index.js')]
}

function patchSdkFile(sdkPath: string): { askQuestion: boolean; modelValidation: boolean } {
  let src: string
  try {
    src = readFileSync(sdkPath, 'utf8')
  } catch {
    return { askQuestion: false, modelValidation: false }
  }

  let next = src
  const askQuestionAlreadyPatched = next.includes(ASK_QUESTION_PATCH_MARKER)
  const modelValidationAlreadyPatched = next.includes(MODEL_VALIDATION_PATCH_MARKER)

  let askQuestion = askQuestionAlreadyPatched
  if (!askQuestionAlreadyPatched && next.includes(QUERY_HANDLER_ORIGINAL)) {
    next = `${ASK_QUESTION_PATCH_MARKER}${next.replace(QUERY_HANDLER_ORIGINAL, QUERY_HANDLER_PATCHED)}`
    askQuestion = true
  }

  let modelValidation = modelValidationAlreadyPatched
  if (!modelValidationAlreadyPatched) {
    if (next.includes(MODEL_VALIDATION_ESM_ORIGINAL)) {
      next = `${MODEL_VALIDATION_PATCH_MARKER}${next.replace(
        MODEL_VALIDATION_ESM_ORIGINAL,
        MODEL_VALIDATION_ESM_PATCHED,
      )}`
      modelValidation = true
    } else if (next.includes(MODEL_VALIDATION_CJS_ORIGINAL)) {
      next = `${MODEL_VALIDATION_PATCH_MARKER}${next.replace(
        MODEL_VALIDATION_CJS_ORIGINAL,
        MODEL_VALIDATION_CJS_PATCHED,
      )}`
      modelValidation = true
    }
  }

  if (next !== src) {
    writeFileSync(sdkPath, next)
  }
  return { askQuestion, modelValidation }
}

/**
 * Patches @cursor/sdk local executor hooks used by Constellagent.
 *
 * The model-validation hook lets Constellagent skip cloud catalog validation for
 * CLI-only local model ids while still passing the API key to the local executor.
 */
export function installCursorSdkAskQuestionHook(): void {
  if (globalThis.__constellagentCursorSdkHookInstalled) return

  const results = resolveSdkBundlePaths().map((sdkPath) => patchSdkFile(sdkPath))
  if (!results.some((result) => result.askQuestion)) {
    throw new Error('Cursor SDK askQuestion hook patch target not found — update cursor-sdk-interaction-patch.ts')
  }
  if (!results.some((result) => result.modelValidation)) {
    throw new Error('Cursor SDK model validation hook patch target not found — update cursor-sdk-interaction-patch.ts')
  }

  globalThis.__constellagentCursorSdkHookInstalled = true
}

export function setCursorAskQuestionHandler(handler: CursorAskQuestionHandler | null): void {
  globalThis.__constellagentCursorAskQuestionHandler = handler ?? undefined
}
