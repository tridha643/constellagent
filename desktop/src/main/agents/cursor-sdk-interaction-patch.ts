import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const PATCH_MARKER = '/* constellagent-ask-question-hook */'

const QUERY_HANDLER_ORIGINAL =
  'query:(e,t)=>local_executor_awaiter(this,void 0,void 0,(function*(){return buildDefaultLocalInteractionResponse(t)}))'

const QUERY_HANDLER_PATCHED =
  'query:(e,t)=>local_executor_awaiter(this,void 0,void 0,(function*(){if(t.query.case==="askQuestionInteractionQuery"&&globalThis.__constellagentCursorAskQuestionHandler){return yield globalThis.__constellagentCursorAskQuestionHandler(t,Responses,ask_question_tool_pb)}return buildDefaultLocalInteractionResponse(t)}))'

export type CursorAskQuestionHandler = (
  query: unknown,
  Responses: unknown,
  askQuestionToolPb: unknown,
) => Promise<unknown> | unknown

declare global {
  // eslint-disable-next-line no-var
  var __constellagentCursorAskQuestionHandler: CursorAskQuestionHandler | undefined
  // eslint-disable-next-line no-var
  var __constellagentCursorSdkHookInstalled: boolean | undefined
}

function resolveSdkBundlePaths(): string[] {
  const require = createRequire(import.meta.url)
  const resolved = require.resolve('@cursor/sdk')
  const distDir = join(dirname(resolved), '..')
  return [join(distDir, 'esm', 'index.js'), join(distDir, 'cjs', 'index.js')]
}

function patchSdkFile(sdkPath: string): boolean {
  let src: string
  try {
    src = readFileSync(sdkPath, 'utf8')
  } catch {
    return false
  }
  if (src.includes(PATCH_MARKER)) return true
  if (!src.includes(QUERY_HANDLER_ORIGINAL)) return false
  writeFileSync(sdkPath, `${PATCH_MARKER}${src.replace(QUERY_HANDLER_ORIGINAL, QUERY_HANDLER_PATCHED)}`)
  return true
}

/** Patches @cursor/sdk local executor to delegate askQuestionInteractionQuery to a custom handler. */
export function installCursorSdkAskQuestionHook(): void {
  if (globalThis.__constellagentCursorSdkHookInstalled) return

  const patched = resolveSdkBundlePaths().some((sdkPath) => patchSdkFile(sdkPath))
  if (!patched) {
    throw new Error('Cursor SDK askQuestion hook patch target not found — update cursor-sdk-interaction-patch.ts')
  }

  globalThis.__constellagentCursorSdkHookInstalled = true
}

export function setCursorAskQuestionHandler(handler: CursorAskQuestionHandler | null): void {
  globalThis.__constellagentCursorAskQuestionHandler = handler ?? undefined
}
