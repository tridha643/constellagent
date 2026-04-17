/**
 * Monaco’s in-browser TypeScript worker has no workspace node_modules/tsconfig.
 * Semantic validation is optional so imports like `aws-sdk` don’t flood the editor with false positives.
 *
 * Note: `monaco-editor` typings mark `languages.typescript` as a deprecated stub; the runtime API is used below.
 */
export function applyMonacoTypeScriptDiagnostics(
  monaco: typeof import('monaco-editor'),
  semanticValidationEnabled: boolean,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- monaco-editor types omit the live TS worker API
  const tsNs = monaco.languages.typescript as any
  const diagnosticsOptions = {
    noSemanticValidation: !semanticValidationEnabled,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
  }
  tsNs.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions)
  tsNs.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions)
}

export function applyMonacoTypeScriptCompilerDefaults(monaco: typeof import('monaco-editor')): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tsNs = monaco.languages.typescript as any
  const compilerOptions = {
    target: tsNs.ScriptTarget.ESNext,
    module: tsNs.ModuleKind.ESNext,
    moduleResolution: tsNs.ModuleResolutionKind.NodeJs,
    jsx: tsNs.JsxEmit.ReactJSX,
    allowJs: true,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    allowNonTsExtensions: true,
  }
  tsNs.typescriptDefaults.setCompilerOptions(compilerOptions)
  tsNs.javascriptDefaults.setCompilerOptions(compilerOptions)
}
