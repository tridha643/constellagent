/**
 * Re-export from shared so renderer code can import from either location.
 * Shared module is the single source of truth.
 */
export {
  AGENT_PLAN_DIRS_LABEL,
  AGENT_PLAN_RELATIVE_DIRS,
  isAgentPlanPath,
  agentForPlanPath,
  relativePathInWorktree,
} from '../../shared/agent-plan-path'
