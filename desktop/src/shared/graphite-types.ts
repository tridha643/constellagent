export interface GraphiteBranchInfo {
  name: string
  parent: string | null
  prNumber?: number
}

export interface GraphiteStackInfo {
  branches: GraphiteBranchInfo[]  // ordered trunk → tip
  currentBranch: string
}

export interface GraphiteCreateBranchOption {
  name: string
  parent: string | null
  trunk: string
  depth: number
}

export interface GraphiteCreateOptions {
  trunks: string[]
  branches: GraphiteCreateBranchOption[]
}

export type GraphiteStackAction = 'start-stack' | 'add-to-stack' | 'submit-stack'

export interface GraphiteStackActionResult {
  branch: string
}

export const GRAPHITE_DEFAULT_BRANCH_ONLY_ERROR = 'Graphite actions are only available on the default branch.'
export const GRAPHITE_SINGLE_ACTION_ERROR = 'Graphite only supports starting a stack from the default branch.'
