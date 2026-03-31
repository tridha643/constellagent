import type { PrInfo } from '../shared/github-types'
import { GithubService } from './github-service'
import { emitAutomationEvent } from './automation-event-bus'
import { listPersistedProjectsWithBranches } from './persisted-state'

const POLL_INTERVAL_MS = 60_000

function clonePrInfo(info: PrInfo): PrInfo {
  return { ...info }
}

export class GithubPollService {
  private timer: ReturnType<typeof setInterval> | null = null
  private previousStatuses = new Map<string, PrInfo>()
  private polling = false

  start(): void {
    if (this.timer) return
    void this.pollOnce()
    this.timer = setInterval(() => {
      void this.pollOnce()
    }, POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async pollOnce(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const projects = listPersistedProjectsWithBranches()
      const seenKeys = new Set<string>()

      for (const project of projects) {
        if (project.branches.length === 0) continue
        let result
        try {
          result = await GithubService.getPrStatuses(project.repoPath, project.branches)
        } catch (err) {
          console.error('[automations] GitHub poll failed:', err)
          continue
        }

        if (!result.available) continue

        for (const [branch, info] of Object.entries(result.data)) {
          const key = `${project.projectId}:${branch}`
          seenKeys.add(key)
          const previous = this.previousStatuses.get(key)
          if (!info) {
            this.previousStatuses.delete(key)
            continue
          }
          this.emitTransitions(project.projectId, branch, previous, info)
          this.previousStatuses.set(key, clonePrInfo(info))
        }
      }

      for (const key of Array.from(this.previousStatuses.keys())) {
        if (!seenKeys.has(key)) this.previousStatuses.delete(key)
      }
    } finally {
      this.polling = false
    }
  }

  private emitTransitions(projectId: string, branch: string, previous: PrInfo | undefined, next: PrInfo): void {
    if (!previous) {
      emitAutomationEvent({
        type: 'pr:created',
        timestamp: Date.now(),
        projectId,
        branch,
        prInfo: clonePrInfo(next),
      })
      return
    }

    const timestamp = Date.now()
    if (previous.state !== 'merged' && next.state === 'merged') {
      emitAutomationEvent({ type: 'pr:merged', timestamp, projectId, branch, prInfo: clonePrInfo(next) })
    }
    if (previous.checkStatus !== 'failing' && next.checkStatus === 'failing') {
      emitAutomationEvent({ type: 'pr:checks-failed', timestamp, projectId, branch, prInfo: clonePrInfo(next) })
    }
    if (previous.checkStatus !== 'passing' && next.checkStatus === 'passing') {
      emitAutomationEvent({ type: 'pr:checks-passed', timestamp, projectId, branch, prInfo: clonePrInfo(next) })
    }
    if (!previous.isApproved && next.isApproved) {
      emitAutomationEvent({ type: 'pr:approved', timestamp, projectId, branch, prInfo: clonePrInfo(next) })
    }
    if (!previous.isChangesRequested && next.isChangesRequested) {
      emitAutomationEvent({ type: 'pr:changes-requested', timestamp, projectId, branch, prInfo: clonePrInfo(next) })
    }
    if ((next.pendingCommentCount ?? 0) > (previous.pendingCommentCount ?? 0)) {
      emitAutomationEvent({ type: 'pr:comments-received', timestamp, projectId, branch, prInfo: clonePrInfo(next) })
    }
  }
}

