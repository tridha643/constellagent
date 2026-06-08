import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { useAppStore } from "../../store/app-store";
import {
  DEFAULT_SIDEBAR_ACTION_ORDER,
  type AgentType,
  type Folder,
  type Project,
  type ProjectIcon,
  type PrLinkProvider,
  type SidebarActionId,
  type StartupCommand,
  type Workspace,
} from "../../store/types";
import { getRenderableFolderGroups } from "../../store/sidebar-navigation";
import type { CreateWorktreeProgressEvent } from "../../../shared/workspace-creation";
import type { GithubLookupError, LinkedPullRequest, OpenPrInfo, PrInfo, ResolvedPrInfo } from "../../../shared/github-types";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { FolderDialog } from "./FolderDialog";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import { GraphiteStack } from "./GraphiteStack";
import { BranchAndPrLauncher } from "./BranchAndPrLauncher";
import { AddProjectDialog } from "./AddProjectDialog";

import {
  AlertCircle,
  ChevronDown,
  Folder as FolderIcon,
  FolderOpen,
  GitBranch,
  Loader2,
  Timer,
} from "lucide-react";
import { getProjectIconComponent } from "./project-icon-glyphs";
import type { WorkspaceSyncInfo } from "@shared/worktree-sync-types";
import { Tooltip } from "../Tooltip/Tooltip";
import {
  CONSTELLAGENT_WORKSPACE_MIME,
  CONSTELLAGENT_ACTION_MIME,
  CONSTELLAGENT_PROJECT_MIME,
  CONSTELLAGENT_FOLDER_MIME,
} from "../../utils/add-to-chat";
import { ContextWindowIndicator } from "./ContextWindowIndicator";
import { SpotlightStatusDot } from "../Spotlight/SpotlightStatusDot";
import { SpotlightIcon } from "../Icons/SpotlightIcon";
import styles from "./Sidebar.module.css";
import { maybeShowStaleMainToast } from "../../utils/ipc-stale-main";
import {
  buildGithubHttpsCloneUrl,
  getGithubUserAvatarUrl,
  getOwnerAvatarUrl,
} from "../../../shared/github-url";
import type { SpotlightState, SpotlightStatus } from "../../../shared/spotlight-types";
import { PROJECT_ICON_COLORS } from "../../../shared/project-icon-templates";

const PR_ICON_SIZE = 10;
const START_TERMINAL_MESSAGE = "Starting terminal...";
const PR_PROVIDER_DOMAINS: Record<PrLinkProvider, string> = {
  github: "github.com",
  graphite: "graphite.dev",
  devinreview: "devinreview.com",
};

const VALID_SIDEBAR_ACTION_IDS = new Set<SidebarActionId>(DEFAULT_SIDEBAR_ACTION_ORDER);

const LINEAR_ICON_SRC = new URL("../../assets/linear/linear-icon.svg", import.meta.url).href;

const WORKTREE_GLYPH_SIZE = 14;
const WORKTREE_GLYPH_STROKE = 1.75;

function SidebarWorkspaceGlyph({
  sync,
  automationId,
}: {
  sync: WorkspaceSyncInfo | undefined;
  automationId: string | null | undefined;
}) {
  const busy = sync?.status === "syncing" || sync?.status === "queued";
  const warn = sync?.status === "error" || sync?.status === "conflict";
  const base = `${styles.workspaceGlyph} ${styles.workspaceGlyphSlot}`;

  if (busy) {
    return (
      <Loader2
        className={`${base} ${styles.workspaceGlyphSpin}`}
        size={WORKTREE_GLYPH_SIZE}
        strokeWidth={WORKTREE_GLYPH_STROKE}
        aria-hidden
      />
    );
  }
  if (warn) {
    return (
      <AlertCircle
        className={`${base} ${styles.workspaceGlyphWarn}`}
        size={WORKTREE_GLYPH_SIZE}
        strokeWidth={WORKTREE_GLYPH_STROKE}
        aria-hidden
      />
    );
  }
  if (automationId) {
    return (
      <Timer
        className={base}
        size={WORKTREE_GLYPH_SIZE}
        strokeWidth={WORKTREE_GLYPH_STROKE}
        aria-hidden
      />
    );
  }
  return (
    <GitBranch
      className={base}
      size={WORKTREE_GLYPH_SIZE}
      strokeWidth={WORKTREE_GLYPH_STROKE}
      aria-hidden
    />
  );
}

function providerUrl(url: string, provider: PrLinkProvider): string {
  return url.replace("github.com", PR_PROVIDER_DOMAINS[provider]);
}

function sanitizeBranchName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/[\x00-\x1f\x7f~^:?*[\]\\]/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/\/\./g, "/-")
    .replace(/@\{/g, "-")
    .replace(/\.lock(\/|$)/g, "-lock$1")
    .replace(/^[.\-/]+/, "")
    .replace(/[.\-/]+$/, "");
}

function slugifyWorkspaceName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function buildPrWorkspaceName(pr: OpenPrInfo): string {
  const slug = slugifyWorkspaceName(pr.title);
  return slug || `pr-${pr.number}`;
}

function buildPrLocalBranch(pr: OpenPrInfo): string {
  if (!pr.isCrossRepository) {
    const head = sanitizeBranchName(pr.headRefName);
    if (head) return head;
  }
  const head = sanitizeBranchName(pr.headRefName) || `pr-${pr.number}`;
  const branch = sanitizeBranchName(`pr/${pr.number}-${head}`);
  return branch || `pr/${pr.number}`;
}

function buildResolvedPrLocalBranch(pr: ResolvedPrInfo): string {
  if (!pr.isCrossRepository) {
    const head = sanitizeBranchName(pr.headRefName);
    if (head) return head;
  }
  const head = sanitizeBranchName(pr.headRefName) || `pr-${pr.number}`;
  const branch = sanitizeBranchName(`pr/${pr.number}-${head}`);
  return branch || `pr/${pr.number}`;
}

function prHeadRemoteName(prNumber: number): string {
  return `pr-${prNumber}-head`;
}

function linkedPullRequestFromOpenPr(
  pr: OpenPrInfo,
  pushRemote: string,
  pushRef: string,
): LinkedPullRequest {
  return {
    number: pr.number,
    url: pr.url,
    title: pr.title,
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    headRepository: pr.headRepository,
    pushRemote,
    pushRef,
  };
}

function linkedPullRequestFromResolvedPr(
  pr: ResolvedPrInfo,
  pushRemote: string,
  pushRef: string,
): LinkedPullRequest {
  return {
    number: pr.number,
    url: pr.url,
    title: pr.title,
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    headRepository: pr.headRepository,
    pushRemote,
    pushRef,
  };
}

function uniqueWorkspaceName(
  baseName: string,
  projectId: string,
  workspaces: Array<{ projectId: string; name: string }>,
): string {
  const normalized = baseName.trim() || "workspace";
  const used = new Set(
    workspaces
      .filter((ws) => ws.projectId === projectId)
      .map((ws) => ws.name.toLowerCase()),
  );
  if (!used.has(normalized.toLowerCase())) return normalized;

  let suffix = 2;
  while (used.has(`${normalized}-${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${normalized}-${suffix}`;
}

function githubErrorMessage(error?: GithubLookupError): string {
  if (error === "gh_not_installed") return "GitHub CLI is not installed.";
  if (error === "not_authenticated") return "GitHub CLI is not authenticated.";
  if (error === "not_github_repo") return "Origin remote is not a GitHub repo.";
  return "Failed to load open pull requests.";
}

interface WorkspaceCreationState {
  requestId: string;
  message: string;
}

interface ActionButtonConfig {
  id: SidebarActionId;
  icon: ReactNode;
  label: string;
  tooltipLabel: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}

function PrStateIcon({ state }: { state: "open" | "merged" | "closed" }) {
  if (state === "open") {
    // GitHub git-pull-request icon (simplified)
    return (
      <svg width={PR_ICON_SIZE} height={PR_ICON_SIZE} viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
      </svg>
    );
  }
  if (state === "merged") {
    // GitHub git-merge icon
    return (
      <svg width={PR_ICON_SIZE} height={PR_ICON_SIZE} viewBox="0 0 16 16" fill="currentColor">
        <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
      </svg>
    );
  }
  // closed — GitHub git-pull-request-closed icon
  return (
    <svg width={PR_ICON_SIZE} height={PR_ICON_SIZE} viewBox="0 0 16 16" fill="currentColor">
      <path d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.75.75 0 1 1 1.06 1.06l-.97.97.97.97a.75.75 0 0 1-1.06 1.06l-.97-.97-.97.97a.75.75 0 1 1-1.06-1.06l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM3.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
    </svg>
  );
}

function labelForSpotlightState(state: SpotlightState): string {
  switch (state) {
    case "preparing":
      return "Preparing";
    case "syncing":
      return "Syncing";
    case "watching":
      return "Spotlight";
    case "restoring":
      return "Restoring";
    case "blocked":
      return "Blocked";
    case "error":
      return "Error";
    default:
      return "Spotlight";
  }
}

function SidebarSpotlightStatusChip({ status }: { status: SpotlightStatus }) {
  if (status.state === "idle") return null;

  const label = labelForSpotlightState(status.state);

  return (
    <span
      className={styles.spotlightChip}
      data-spotlight-state={status.state}
      title={status.message ?? `Spotlight: ${label}`}
      aria-label={`Spotlight: ${label}`}
    >
      <SpotlightIcon className={styles.spotlightChipIcon} />
      <span className={styles.spotlightChipLabel}>{label}</span>
      <SpotlightStatusDot
        className={styles.spotlightChipDot}
        state={status.state}
        message={status.message}
      />
    </span>
  );
}

function WorkspaceSyncIndicator({ workspaceId }: { workspaceId: string }) {
  const info = useAppStore((s) => s.worktreeSyncStatus.get(workspaceId));
  const [hideSynced, setHideSynced] = useState(false);

  useEffect(() => {
    if (info?.status !== "synced") {
      setHideSynced(false);
      return;
    }
    setHideSynced(false);
    const t = window.setTimeout(() => setHideSynced(true), 5000);
    return () => window.clearTimeout(t);
  }, [info?.status, info?.lastSyncAt]);

  if (!info || info.status === "idle") return null;
  if (info.status === "synced" && hideSynced) return null;

  const tip =
    info.message ||
    (info.status === "queued"
      ? "Waiting for agent to finish"
      : info.status === "syncing"
        ? "Syncing worktree…"
        : info.status === "synced"
          ? "Synced"
          : info.status === "conflict"
            ? "Sync conflict"
            : "Sync error");

  if (info.status === "queued") {
    return (
      <Tooltip label={tip}>
        <span
          className={`${styles.syncIndicator} ${styles.syncIndicatorQueued}`}
          aria-hidden="true"
        >
          ⏳
        </span>
      </Tooltip>
    );
  }
  if (info.status === "syncing") {
    return (
      <Tooltip label={tip}>
        <span
          className={`${styles.syncIndicator} ${styles.syncIndicatorSyncing}`}
          aria-hidden="true"
        />
      </Tooltip>
    );
  }
  if (info.status === "synced") {
    return (
      <Tooltip label={tip}>
        <span
          className={`${styles.syncIndicator} ${styles.syncIndicatorOk}`}
          aria-hidden="true"
        >
          ✓
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip label={tip}>
      <span
        className={`${styles.syncIndicator} ${styles.syncIndicatorError}`}
        aria-hidden="true"
      />
    </Tooltip>
  );
}

/** GitHub git-pull-request icon (open PR) used on the workspace bar mainline. */
function PrBranchIcon({ local }: { local?: boolean }) {
  return (
    <svg
      className={`${styles.wsPrIcon} ${local ? styles.wsPrIconLocal : ""}`}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      {local ? (
        <path d="M3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0-6.628v5.256a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0Z" />
      ) : (
        <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v5.256a2.251 2.251 0 1 0 1.5 0V5.372ZM11 3a2.25 2.25 0 0 0-2.236 2.5H8.75a.75.75 0 0 0-.75.75v3.128a2.251 2.251 0 1 0 1.5 0V7h.014A2.25 2.25 0 1 0 11 3Z" />
      )}
    </svg>
  );
}

/** Small CI rollup chip for the PR-mode topline (mirrors mockup `.ci`). */
function CiChip({ status }: { status: PrInfo["checkStatus"] }) {
  if (status === "none") return null;
  if (status === "pending") {
    return (
      <svg
        className={`${styles.wsCi} ${styles.wsCiPending}`}
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-label="CI checks running"
      >
        <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM8.75 5a.75.75 0 0 0-1.5 0v3.25c0 .2.08.39.22.53l2 2a.75.75 0 1 0 1.06-1.06L8.75 7.94V5Z" />
      </svg>
    );
  }
  if (status === "failing") {
    return (
      <svg
        className={`${styles.wsCi} ${styles.wsCiFail}`}
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-label="CI checks failing"
      >
        <path d="M2.343 13.657A8 8 0 1 1 13.657 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.75.75 0 0 0-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 1 0 1.06 1.06L8 9.06l1.97 1.97a.75.75 0 1 0 1.06-1.06L9.06 8l1.97-1.97a.75.75 0 0 0-1.06-1.06L8 6.94 6.03 4.97Z" />
      </svg>
    );
  }
  return (
    <svg
      className={`${styles.wsCi} ${styles.wsCiPass}`}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-label="CI checks passing"
    >
      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 1 1 1.06-1.06l2.72 2.72 6.72-6.72a.75.75 0 0 1 1.06 0Z" />
    </svg>
  );
}

function WorkspaceStats({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span
      className={styles.wsStats}
      aria-label={`${additions} additions, ${deletions} deletions`}
    >
      <span className={styles.wsStatAdd}>+{additions}</span>{" "}
      <span className={styles.wsStatDel}>-{deletions}</span>
    </span>
  );
}

/**
 * The "rudu" workspace bar: a universal two-face layout whose data source flips
 * by whether an open PR exists. Both faces are always rendered into one grid
 * cell so the local⇄PR change is a pure opacity+blur crossfade (no reflow).
 * Local mode = name≡branch · latest commit subject · working-tree-inclusive
 * `+N -N`. PR mode = PR author (+avatar) · PR title · the PR's real `+N -N`.
 */
function WorkspaceBarFaces({
  ws,
  project,
  displayName,
  sync,
  isSpotlightWorkspace,
  spotlightStatus,
}: {
  ws: Workspace;
  project: Project;
  displayName: string;
  sync: WorkspaceSyncInfo | undefined;
  isSpotlightWorkspace: boolean;
  spotlightStatus: SpotlightStatus | undefined;
}) {
  const pr = useAppStore((s) => s.prStatusMap.get(`${ws.projectId}:${ws.branch}`));
  const barStats = useAppStore((s) => s.workspaceBarStatsMap.get(ws.id));
  const modeOverride = useAppStore((s) => s.workspaceBarModeOverride.get(ws.id));
  const toggleWorkspaceBarMode = useAppStore((s) => s.toggleWorkspaceBarMode);
  const prLinkProvider = project.prLinkProvider ?? "github";

  // Auto mode follows PR state; a manual flip override wins until it lands back
  // on auto (the store clears the override at that point).
  const autoMode = pr?.state === "open" ? "pr" : "local";
  const mode = modeOverride ?? autoMode;

  const localAdditions = barStats?.additions ?? 0;
  const localDeletions = barStats?.deletions ?? 0;
  const localSubject = barStats?.subject || displayName;

  const prAdditions = pr?.additions ?? 0;
  const prDeletions = pr?.deletions ?? 0;
  const prAuthor = pr?.authorLogin;

  return (
    <>
      <div className={styles.wsFaces} data-mode={mode}>
      {/* PR face */}
      <div className={`${styles.wsFace} ${styles.wsFacePr}`} aria-hidden={mode !== "pr"}>
        <div className={styles.wsTopline}>
          <span className={styles.wsAuthor}>
            {prAuthor && (
              <img
                className={styles.wsAuthorAvatar}
                src={getGithubUserAvatarUrl(prAuthor, 24)}
                alt=""
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            <span className={styles.wsAuthorLogin}>{prAuthor ?? "PR"}</span>
          </span>
          {pr && (
            <span className={styles.wsChips}>
              <CiChip status={pr.checkStatus} />
            </span>
          )}
        </div>
        <div className={styles.wsMainline}>
          <PrBranchIcon />
          <span
            className={styles.wsTitle}
            title={pr ? `PR #${pr.number}: ${pr.title}` : undefined}
            onClick={(e) => {
              if (!pr) return;
              e.stopPropagation();
              window.open(providerUrl(pr.url, prLinkProvider));
            }}
          >
            {pr?.title ?? "(no open PR)"}
          </span>
          <WorkspaceStats additions={prAdditions} deletions={prDeletions} />
        </div>
      </div>

      {/* Local face */}
      <div className={`${styles.wsFace} ${styles.wsFaceLocal}`} aria-hidden={mode !== "local"}>
        <div className={styles.wsTopline}>
          <span className={styles.wsIdent}>{displayName}</span>
          <span className={styles.wsChips}>
            <SidebarWorkspaceGlyph sync={sync} automationId={ws.automationId} />
            <WorkspaceSyncIndicator workspaceId={ws.id} />
            {isSpotlightWorkspace && spotlightStatus && (
              <SidebarSpotlightStatusChip status={spotlightStatus} />
            )}
          </span>
        </div>
        <div className={styles.wsMainline}>
          <PrBranchIcon local />
          <span className={styles.wsTitle} title={localSubject}>
            {localSubject}
          </span>
          <WorkspaceStats additions={localAdditions} deletions={localDeletions} />
        </div>
        <GraphiteStack
          workspaceId={ws.id}
          worktreePath={ws.worktreePath}
          repoPath={project.repoPath}
          graphitePreferredTrunk={project.graphitePreferredTrunk}
        />
      </div>
      </div>
      {/* Local⇄PR flip (rudu .flip): hover-revealed beside delete; pure override. */}
      <button
        className={styles.wsFlip}
        title="Switch view · local ⇄ PR"
        aria-label="Switch between local and PR view"
        onClick={(e) => {
          e.stopPropagation();
          toggleWorkspaceBarMode(ws.id);
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2" y="6" width="20" height="12" rx="6" />
          <circle cx="16" cy="12" r="2.7" fill="currentColor" stroke="none" />
        </svg>
      </button>
    </>
  );
}

/**
 * Project header glyph. Resolution priority: custom PNG → template glyph →
 * GitHub owner avatar → fallback branch glyph. Whatever resolves crossfades to
 * the expand/collapse chevron on hover (merging the old standalone ▶).
 */
function ProjectHeaderGlyph({
  owner,
  isExpanded,
  icon,
  projectId,
}: {
  owner: string | null;
  isExpanded: boolean;
  icon?: ProjectIcon;
  projectId: string;
}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [customUrl, setCustomUrl] = useState<string | null>(null);
  const [customFailed, setCustomFailed] = useState(false);

  const isCustom = icon?.type === "custom";
  const customVersion = isCustom ? icon.version : 0;

  // Fetch the custom icon data URL; re-fetch when the version bumps (replace).
  useEffect(() => {
    if (!isCustom) {
      setCustomUrl(null);
      setCustomFailed(false);
      return;
    }
    let cancelled = false;
    setCustomFailed(false);
    window.api.projectIcon
      .get(projectId)
      .then((url) => {
        if (!cancelled) setCustomUrl(url);
      })
      .catch(() => {
        if (!cancelled) setCustomFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isCustom, customVersion, projectId]);

  const TemplateIcon =
    icon?.type === "template" ? getProjectIconComponent(icon.glyph) : null;
  const templateColor = icon?.type === "template" ? icon.color : undefined;

  const showCustom = isCustom && !!customUrl && !customFailed;
  const showTemplate = !showCustom && !!TemplateIcon;
  const showAvatar = !showCustom && !showTemplate && !!owner && !avatarFailed;

  return (
    <span className={styles.glyphSlot}>
      {showCustom ? (
        <img
          className={styles.glyphAvatar}
          src={customUrl ?? undefined}
          alt=""
          onError={() => setCustomFailed(true)}
        />
      ) : showTemplate && TemplateIcon ? (
        <span className={styles.glyphTemplate} style={{ color: templateColor }} aria-hidden="true">
          <TemplateIcon size={15} strokeWidth={2} />
        </span>
      ) : showAvatar && owner ? (
        <img
          className={styles.glyphAvatar}
          src={getOwnerAvatarUrl(owner, 40)}
          alt=""
          onError={() => setAvatarFailed(true)}
        />
      ) : (
        <span className={styles.glyphFallback} aria-hidden="true">
          <GitBranch size={12} strokeWidth={2} />
        </span>
      )}
      <svg
        className={`${styles.glyphChevron} ${isExpanded ? styles.glyphChevronOpen : ""}`}
        viewBox="0 0 12 12"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M4.22 2.47a.75.75 0 0 1 1.06 0L8.53 5.72a.75.75 0 0 1 0 1.06L5.28 10.03a.75.75 0 0 1-1.06-1.06L6.97 6.25 4.22 3.53a.75.75 0 0 1 0-1.06Z" />
      </svg>
    </span>
  );
}

function FolderActionsMenu({
  folder,
  projectFolderCount,
  isPriority,
  isDefault,
  onRename,
  onSetPriority,
  onSetDefault,
  onSetColor,
  onDelete,
  onClose,
}: {
  folder: Folder;
  projectFolderCount: number;
  isPriority: boolean;
  isDefault: boolean;
  onRename: () => void;
  onSetPriority: () => void;
  onSetDefault: () => void;
  onSetColor: (color: string | undefined) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDoc, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDoc, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const canDelete = projectFolderCount > 1;
  return (
    <div ref={rootRef} className={styles.folderMenu} role="menu" aria-label={`${folder.name} actions`}>
      <div className={styles.folderColorRow} role="group" aria-label="Folder color">
        <button
          type="button"
          className={`${styles.folderColorSwatch} ${styles.folderColorSwatchNone} ${!folder.color ? styles.folderColorSwatchActive : ""}`}
          aria-label="Default color"
          aria-pressed={!folder.color}
          onClick={() => onSetColor(undefined)}
        />
        {PROJECT_ICON_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`${styles.folderColorSwatch} ${folder.color === c.var ? styles.folderColorSwatchActive : ""}`}
            style={{ "--swatch": c.var } as React.CSSProperties}
            aria-label={c.label}
            aria-pressed={folder.color === c.var}
            onClick={() => onSetColor(c.var)}
          />
        ))}
      </div>
      <button className={styles.folderMenuItem} role="menuitem" onClick={onRename}>
        Rename
      </button>
      <button
        className={styles.folderMenuItem}
        role="menuitem"
        disabled={isPriority}
        onClick={onSetPriority}
      >
        Set as priority target
      </button>
      <button
        className={styles.folderMenuItem}
        role="menuitem"
        disabled={isDefault}
        onClick={onSetDefault}
      >
        Set as default
      </button>
      <button
        className={`${styles.folderMenuItem} ${styles.folderMenuItemDanger}`}
        role="menuitem"
        disabled={!canDelete}
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}

export function Sidebar({ embedded = false, showTitleArea = true }: { embedded?: boolean; showTitleArea?: boolean }) {
  const projects = useAppStore((s) => s.projects);
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const addWorkspace = useAppStore((s) => s.addWorkspace);
  const addTab = useAppStore((s) => s.addTab);
  const addToast = useAppStore((s) => s.addToast);
  const workspaceDialogProjectId = useAppStore((s) => s.workspaceDialogProjectId);
  const openWorkspaceDialog = useAppStore((s) => s.openWorkspaceDialog);
  const deleteWorkspace = useAppStore((s) => s.deleteWorkspace);
  const updateProject = useAppStore((s) => s.updateProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const showConfirmDialog = useAppStore((s) => s.showConfirmDialog);
  const dismissConfirmDialog = useAppStore((s) => s.dismissConfirmDialog);
  const toggleSettings = useAppStore((s) => s.toggleSettings);
  const toggleAutomations = useAppStore((s) => s.toggleAutomations);
  const toggleLinear = useAppStore((s) => s.toggleLinear);
  const createConductorTabForActiveWorkspace = useAppStore((s) => s.createConductorTabForActiveWorkspace);
  const toggleHunkReview = useAppStore((s) => s.toggleHunkReview);
  const openLatestAgentPlan = useAppStore((s) => s.openLatestAgentPlan);
  const sidebarActionOrder = useAppStore((s) => s.sidebarActionOrder);
  const reorderSidebarAction = useAppStore((s) => s.reorderSidebarAction);
  const unreadWorkspaceIds = useAppStore((s) => s.unreadWorkspaceIds);
  const activeClaudeWorkspaceIds = useAppStore((s) => s.activeClaudeWorkspaceIds);
  const renameWorkspace = useAppStore((s) => s.renameWorkspace);
  const reorderProject = useAppStore((s) => s.reorderProject);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setPrStatuses = useAppStore((s) => s.setPrStatuses);
  const settings = useAppStore((s) => s.settings);
  const setGhAvailability = useAppStore((s) => s.setGhAvailability);
  const worktreeSyncMap = useAppStore((s) => s.worktreeSyncStatus);
  const spotlightStatusByProject = useAppStore((s) => s.spotlightStatusByProject);
  const graphiteStacks = useAppStore((s) => s.graphiteStacks);
  const repoInfoByProjectId = useAppStore((s) => s.repoInfoByProjectId);
  const collapsedProjectIds = useAppStore((s) => s.collapsedProjectIds);
  const toggleProjectCollapsed = useAppStore((s) => s.toggleProjectCollapsed);
  const lastActiveWorkspaceByProjectId = useAppStore((s) => s.lastActiveWorkspaceByProjectId);
  const folders = useAppStore((s) => s.folders);
  const addFolder = useAppStore((s) => s.addFolder);
  const renameFolder = useAppStore((s) => s.renameFolder);
  const setFolderColor = useAppStore((s) => s.setFolderColor);
  const removeFolder = useAppStore((s) => s.removeFolder);
  const reorderFolder = useAppStore((s) => s.reorderFolder);
  const toggleFolderCollapsed = useAppStore((s) => s.toggleFolderCollapsed);
  const moveWorkspaceToFolder = useAppStore((s) => s.moveWorkspaceToFolder);
  const moveWorkspaceToFolderBefore = useAppStore((s) => s.moveWorkspaceToFolderBefore);
  const setProjectPriorityFolder = useAppStore((s) => s.setProjectPriorityFolder);
  const setProjectDefaultFolder = useAppStore((s) => s.setProjectDefaultFolder);

  const [contextMenu, setContextMenu] = useState<{ wsId: string; x: number; y: number } | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(
    null,
  );
  const [draggedWsId, setDraggedWsId] = useState<string | null>(null);
  const [dropTargetWsId, setDropTargetWsId] = useState<string | null>(null);
  const [workspaceCreation, setWorkspaceCreation] =
    useState<WorkspaceCreationState | null>(null);
  const [showSlowCreateMessage, setShowSlowCreateMessage] = useState(false);
  const [addProjectDialogOpen, setAddProjectDialogOpen] = useState(false);
  const [openProjectPrPopoverId, setOpenProjectPrPopoverId] = useState<
    string | null
  >(null);
  const [projectOpenPrs, setProjectOpenPrs] = useState<
    Record<string, OpenPrInfo[]>
  >({});
  const [projectPrLoading, setProjectPrLoading] = useState<
    Record<string, boolean>
  >({});
  const [projectPrError, setProjectPrError] = useState<
    Record<string, string | null>
  >({});
  const [pullingPrKey, setPullingPrKey] = useState<string | null>(null);
  const [projectPrSearch, setProjectPrSearch] = useState("");
  const draggingWorkspaceIdRef = useRef<string | null>(null);
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [dropTargetProjectId, setDropTargetProjectId] = useState<string | null>(null);
  const draggingProjectIdRef = useRef<string | null>(null);
  const [draggedActionId, setDraggedActionId] = useState<SidebarActionId | null>(null);
  const [dropTargetActionId, setDropTargetActionId] = useState<SidebarActionId | null>(null);
  const draggingActionIdRef = useRef<SidebarActionId | null>(null);
  const editRef = useRef<string>("");
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [dropTargetFolderReorderId, setDropTargetFolderReorderId] = useState<string | null>(null);
  const draggingFolderIdRef = useRef<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderDialogProjectId, setFolderDialogProjectId] = useState<string | null>(null);
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const folderAutoExpandTimerRef = useRef<{ id: string; timer: number } | null>(null);
  const dialogProject = workspaceDialogProjectId
    ? (projects.find((p) => p.id === workspaceDialogProjectId) ?? null)
    : null;
  const folderDialogProject = folderDialogProjectId
    ? (projects.find((p) => p.id === folderDialogProjectId) ?? null)
    : null;
  const isCreatingWorkspace = workspaceCreation !== null;

  useEffect(() => {
    const unsub = window.api.git.onCreateWorktreeProgress(
      (progress: CreateWorktreeProgressEvent) => {
        if (!progress.requestId) return;
        setWorkspaceCreation((prev) => {
          if (!prev || prev.requestId !== progress.requestId) return prev;
          return { ...prev, message: progress.message };
        });
      },
    );
    return unsub;
  }, []);

  useEffect(() => {
    if (!workspaceCreation) {
      setShowSlowCreateMessage(false);
      return;
    }

    setShowSlowCreateMessage(false);
    const timer = setTimeout(() => setShowSlowCreateMessage(true), 5000);
    return () => clearTimeout(timer);
  }, [workspaceCreation?.requestId]);

  useEffect(() => {
    if (!openProjectPrPopoverId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenProjectPrPopoverId(null);
        setProjectPrSearch("");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openProjectPrPopoverId]);

  useEffect(() => {
    if (!openProjectPrPopoverId) return;
    if (!projects.some((p) => p.id === openProjectPrPopoverId)) {
      setOpenProjectPrPopoverId(null);
      setProjectPrSearch("");
    }
  }, [openProjectPrPopoverId, projects]);

  // ⌘⇧N from useShortcuts opens the new-folder modal for the active project.
  useEffect(() => {
    const onNewFolder = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      const projectId = detail?.projectId;
      if (!projectId) return;
      setFolderDialogProjectId(projectId);
    };
    window.addEventListener("constellagent:new-sidebar-folder", onNewFolder);
    return () => window.removeEventListener("constellagent:new-sidebar-folder", onNewFolder);
  }, []);

  const closeProjectPrModal = useCallback(() => {
    setOpenProjectPrPopoverId(null);
    setProjectPrSearch("");
  }, []);

  const isProjectExpanded = useCallback(
    (id: string) => {
      return !collapsedProjectIds.has(id);
    },
    [collapsedProjectIds],
  );

  const toggleProject = useCallback((id: string) => {
    toggleProjectCollapsed(id);
    if (openProjectPrPopoverId === id) closeProjectPrModal();
  }, [closeProjectPrModal, openProjectPrPopoverId, toggleProjectCollapsed]);

  const handleAddProject = useCallback(() => {
    setAddProjectDialogOpen(true);
  }, []);

  const finishCreateWorkspace = useCallback(
    async (
      project: Project,
      name: string,
      branch: string,
      worktreePath: string,
      linkedPullRequest?: LinkedPullRequest,
    ) => {
      const wsId = crypto.randomUUID();
      addWorkspace({
        id: wsId,
        name,
        branch,
        worktreePath,
        projectId: project.id,
        ...(linkedPullRequest ? { linkedPullRequest } : {}),
      });

      let startupSettings =
        project.startupCommands ?? [];
      try {
        startupSettings =
          (await window.api.projectStartupSettings.get(project.repoPath)) ??
          project.startupCommands ??
          [];
      } catch (err) {
        maybeShowStaleMainToast(err, addToast);
      }

      const commands: StartupCommand[] = startupSettings
        .filter((cmd) => typeof cmd.command === 'string' && cmd.command.trim())
        .map((cmd) => ({
          name: typeof cmd.name === 'string' ? cmd.name : '',
          command: cmd.command,
          waitFor: cmd.waitFor,
          waitCondition: cmd.waitCondition,
        }))

      // Pre-trust worktree in Claude Code if any command uses claude
      if (commands.some((c) => c.command.trim().startsWith("claude"))) {
        await window.api.claude.trustPath(worktreePath).catch(() => {});
      }

      if (commands.length === 0) {
        // Default: one blank terminal
        const ptyId = await window.api.pty.create(worktreePath, undefined, {
          AGENT_ORCH_WS_ID: wsId,
          AGENT_ORCH_AGENT_TYPE: "unknown",
        });
        addTab({
          id: crypto.randomUUID(),
          workspaceId: wsId,
          type: "terminal",
          title: "Terminal",
          ptyId,
        });
      } else {
        // Create all PTYs upfront
        let firstTabId: string | null = null;
        const ptyMap = new Map<string, string>(); // command name -> ptyId

        for (const cmd of commands) {
          const agentType = cmd.command.startsWith("codex")
            ? "codex"
            : cmd.command.startsWith("gemini")
              ? "gemini"
              : cmd.command.startsWith("opencode")
                ? "opencode"
              : cmd.command.startsWith("claude")
                ? "claude-code"
                : "unknown";
          const ptyId = await window.api.pty.create(worktreePath, undefined, {
            AGENT_ORCH_WS_ID: wsId,
            AGENT_ORCH_AGENT_TYPE: agentType,
          });
          if (cmd.name) ptyMap.set(cmd.name, ptyId);
          const tabId = crypto.randomUUID();
          if (!firstTabId) firstTabId = tabId;
          addTab({
            id: tabId,
            workspaceId: wsId,
            type: "terminal",
            title: cmd.name || cmd.command,
            ptyId,
            ...(agentType !== "unknown"
              ? { agentType: agentType as AgentType }
              : {}),
          });
        }

        // Helper to resolve final command with session resume
        const resolveFinalCmd = async (cmd: { command: string }) => {
          let finalCmd = cmd.command;
          if (settings.sessionResumeEnabled) {
            if (finalCmd.startsWith('claude')) {
              const sessionId = await window.api.session.getLast(wsId, 'claude-code');
              if (sessionId) {
                finalCmd = finalCmd.replace(/^claude\b/, `claude --resume ${sessionId}`);
              }
            } else if (finalCmd.startsWith('codex')) {
              finalCmd = finalCmd.replace(/^codex\b/, 'codex resume --last');
            } else if (finalCmd.startsWith('gemini')) {
              finalCmd = finalCmd.replace(/^gemini\b/, 'gemini --resume');
            } else if (finalCmd.startsWith('opencode')) {
              finalCmd = finalCmd.replace(/^opencode\b/, 'opencode resume --last');
            }
          }
          return finalCmd;
        };

        // Launch commands with dependency awareness
        const launched = new Set<string>();
        const launchPromises = new Map<string, Promise<void>>();

        const launchCmd = (cmd: typeof commands[0]): Promise<void> => {
          const name = cmd.name;
          if (name && launchPromises.has(name)) return launchPromises.get(name)!;

          const promise = (async () => {
            const ptyId = name ? ptyMap.get(name) : undefined;
            if (!ptyId) return;

            // Wait for dependency if any
            if (cmd.waitFor && cmd.waitCondition) {
              const depPtyId = ptyMap.get(cmd.waitFor);
              const depCmd = commands.find((c) => c.name === cmd.waitFor);

              // Ensure dependency launches first
              if (depCmd) {
                await launchCmd(depCmd);
              }

              if (depPtyId && cmd.waitCondition.type === 'delay') {
                await new Promise<void>((resolve) =>
                  setTimeout(resolve, cmd.waitCondition!.type === 'delay'
                    ? (cmd.waitCondition as { type: 'delay'; seconds: number }).seconds * 1000
                    : 0)
                );
              } else if (depPtyId && cmd.waitCondition.type === 'output') {
                const pattern = (cmd.waitCondition as { type: 'output'; pattern: string }).pattern;
                await new Promise<void>((resolve) => {
                  const timeout = setTimeout(resolve, 60000); // 60s safety timeout
                  const cleanup = window.api.pty.onData(depPtyId, (data: string) => {
                    if (data.includes(pattern)) {
                      clearTimeout(timeout);
                      cleanup();
                      resolve();
                    }
                  });
                });
              }
            } else {
              // No dependency — just wait for shell init
              await new Promise<void>((resolve) => setTimeout(resolve, 500));
            }

            if (!launched.has(name)) {
              launched.add(name);
              const finalCmd = await resolveFinalCmd(cmd);
              window.api.pty.write(ptyId, finalCmd + "\n");
            }
          })();

          if (name) launchPromises.set(name, promise);
          return promise;
        };

        // Launch all commands (dependency resolution happens internally)
        for (const cmd of commands) {
          launchCmd(cmd);
        }

        // Activate the first terminal tab
        if (firstTabId) setActiveTab(firstTabId);
      }
    },
    [addWorkspace, addTab, setActiveTab],
  );

  const handleCreateWorkspace = useCallback(
    async (
      project: Project,
      name: string,
      branch: string,
      newBranch: boolean,
      force = false,
      baseBranch?: string,
    ) => {
      if (workspaceCreation) return;
      const requestId = crypto.randomUUID();
      setWorkspaceCreation({
        requestId,
        message: "Syncing remote...",
      });

      try {
        const worktreePath = await window.api.git.createWorktree(
          project.repoPath,
          name,
          branch,
          newBranch,
          baseBranch,
          force,
          requestId,
          settings.worktreeCredentialRules,
        );
        const createdBranch = await window.api.git.getCurrentBranch(worktreePath).catch(() => branch);
        setWorkspaceCreation((prev) => {
          if (!prev || prev.requestId !== requestId) return prev;
          return { ...prev, message: START_TERMINAL_MESSAGE };
        });
        await finishCreateWorkspace(project, name, createdBranch, worktreePath);
        openWorkspaceDialog(null);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to create workspace";
        const confirmMessages = [
          {
            key: "WORKTREE_PATH_EXISTS",
            title: "Worktree already exists",
            message: `A leftover directory for workspace "${name}" already exists on disk. Replace it?`,
          },
          {
            key: "BRANCH_CHECKED_OUT",
            title: "Branch in use",
            message: `Branch "${branch}" is checked out in another worktree. Remove the old worktree and continue?`,
          },
        ];
        const confirm = confirmMessages.find((c) => msg.includes(c.key));
        if (confirm) {
          showConfirmDialog({
            ...confirm,
            confirmLabel: "Replace",
            destructive: true,
            onConfirm: () => {
              dismissConfirmDialog();
              handleCreateWorkspace(project, name, branch, newBranch, true, baseBranch);
            },
          });
          return;
        }
        addToast({ id: crypto.randomUUID(), message: msg, type: "error" });
      } finally {
        setWorkspaceCreation((prev) => {
          if (!prev || prev.requestId !== requestId) return prev;
          return null;
        });
      }
    },
    [
      workspaceCreation,
      finishCreateWorkspace,
      addToast,
      showConfirmDialog,
      dismissConfirmDialog,
      openWorkspaceDialog,
      settings.worktreeCredentialRules,
    ],
  );

  const loadProjectOpenPrs = useCallback(
    async (project: Project) => {
      setProjectPrLoading((prev) => ({ ...prev, [project.id]: true }));
      setProjectPrError((prev) => ({ ...prev, [project.id]: null }));

      try {
        const result = await window.api.github.listOpenPrs(project.repoPath);
        setGhAvailability(project.id, result.available);
        if (!result.available) {
          setProjectOpenPrs((prev) => ({ ...prev, [project.id]: [] }));
          setProjectPrError((prev) => ({
            ...prev,
            [project.id]: githubErrorMessage(result.error),
          }));
          return;
        }

        setProjectOpenPrs((prev) => ({ ...prev, [project.id]: result.data }));
        const branchStatuses: Record<string, OpenPrInfo | null> = {};
        for (const pr of result.data) {
          if (!pr.headRefName) continue;
          branchStatuses[pr.headRefName] = pr;
        }
        if (Object.keys(branchStatuses).length > 0) {
          setPrStatuses(project.id, branchStatuses);
        }
      } catch {
        setProjectPrError((prev) => ({
          ...prev,
          [project.id]: "Failed to load open pull requests.",
        }));
      } finally {
        setProjectPrLoading((prev) => ({ ...prev, [project.id]: false }));
      }
    },
    [setGhAvailability, setPrStatuses],
  );

  const handleToggleProjectPrPopover = useCallback(
    (project: Project) => {
      setOpenProjectPrPopoverId((prev) => {
        const next = prev === project.id ? null : project.id;
        if (next === project.id) {
          setProjectPrSearch("");
          void loadProjectOpenPrs(project);
        } else {
          setProjectPrSearch("");
        }
        return next;
      });
    },
    [loadProjectOpenPrs],
  );

  const handlePullPrLocally = useCallback(
    async (project: Project, pr: OpenPrInfo, force = false) => {
      const localBranch = buildPrLocalBranch(pr);
      const existing = workspaces.find(
        (ws) => ws.projectId === project.id && (
          ws.linkedPullRequest?.number === pr.number || ws.branch === localBranch
        ),
      );
      if (existing) {
        setActiveWorkspace(existing.id);
        closeProjectPrModal();
        return;
      }
      if (workspaceCreation) return;

      const workspaceName = uniqueWorkspaceName(
        buildPrWorkspaceName(pr),
        project.id,
        workspaces,
      );
      const requestId = crypto.randomUUID();
      const prKey = `${project.id}:${pr.number}`;
      setPullingPrKey(prKey);
      setWorkspaceCreation({
        requestId,
        message: `Fetching PR #${pr.number}...`,
      });

      try {
        const headRemoteUrl = pr.isCrossRepository && pr.headRepository
          ? buildGithubHttpsCloneUrl(pr.headRepository.owner, pr.headRepository.name)
          : undefined;
        const { worktreePath, branch, pushRemote, pushRef } =
          await window.api.git.createWorktreeFromPr(
            project.repoPath,
            workspaceName,
            pr.number,
            localBranch,
            force,
            requestId,
            settings.worktreeCredentialRules,
            {
              headRefName: pr.headRefName,
              headRemoteName: pr.isCrossRepository ? prHeadRemoteName(pr.number) : 'origin',
              headRemoteUrl,
            },
          );
        setWorkspaceCreation((prev) => {
          if (!prev || prev.requestId !== requestId) return prev;
          return { ...prev, message: START_TERMINAL_MESSAGE };
        });
        await finishCreateWorkspace(
          project,
          workspaceName,
          branch,
          worktreePath,
          linkedPullRequestFromOpenPr(pr, pushRemote, pushRef),
        );
        setPrStatuses(project.id, { [branch]: pr });
        closeProjectPrModal();
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : `Failed to pull PR #${pr.number} locally`;
        if (msg.includes("WORKTREE_PATH_EXISTS") && !force) {
          showConfirmDialog({
            title: "Workspace path exists",
            message: `A workspace directory for "${workspaceName}" already exists. Replace it?`,
            confirmLabel: "Replace",
            destructive: true,
            onConfirm: () => {
              dismissConfirmDialog();
              void handlePullPrLocally(project, pr, true);
            },
          });
          return;
        }
        addToast({ id: crypto.randomUUID(), message: msg, type: "error" });
      } finally {
        setPullingPrKey((prev) => (prev === prKey ? null : prev));
        setWorkspaceCreation((prev) => {
          if (!prev || prev.requestId !== requestId) return prev;
          return null;
        });
      }
    },
    [
      workspaceCreation,
      workspaces,
      setActiveWorkspace,
      closeProjectPrModal,
      finishCreateWorkspace,
      showConfirmDialog,
      dismissConfirmDialog,
      addToast,
      settings.worktreeCredentialRules,
      setPrStatuses,
    ],
  );

  const handleCreateResolvedPrWorkspace = useCallback(
    async (project: Project, name: string, pr: ResolvedPrInfo, force = false) => {
      const localBranch = buildResolvedPrLocalBranch(pr);
      const existing = workspaces.find(
        (ws) => ws.projectId === project.id && (
          ws.linkedPullRequest?.number === pr.number || ws.branch === localBranch
        ),
      );
      if (existing) {
        setActiveWorkspace(existing.id);
        openWorkspaceDialog(null);
        return;
      }
      if (workspaceCreation) return;

      const workspaceName = uniqueWorkspaceName(
        name || `pr-${pr.number}`,
        project.id,
        workspaces,
      );
      const requestId = crypto.randomUUID();
      setWorkspaceCreation({
        requestId,
        message: `Fetching PR #${pr.number}...`,
      });

      try {
        const headRemoteUrl = pr.isCrossRepository && pr.headRepository
          ? buildGithubHttpsCloneUrl(pr.headRepository.owner, pr.headRepository.name)
          : undefined;
        const { worktreePath, branch, pushRemote, pushRef } =
          await window.api.git.createWorktreeFromPr(
            project.repoPath,
            workspaceName,
            pr.number,
            localBranch,
            force,
            requestId,
            settings.worktreeCredentialRules,
            {
              headRefName: pr.headRefName,
              headRemoteName: pr.isCrossRepository ? prHeadRemoteName(pr.number) : 'origin',
              headRemoteUrl,
            },
          );
        setWorkspaceCreation((prev) => {
          if (!prev || prev.requestId !== requestId) return prev;
          return { ...prev, message: START_TERMINAL_MESSAGE };
        });
        await finishCreateWorkspace(
          project,
          workspaceName,
          branch,
          worktreePath,
          linkedPullRequestFromResolvedPr(pr, pushRemote, pushRef),
        );
        openWorkspaceDialog(null);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : `Failed to pull PR #${pr.number} locally`;
        if (msg.includes("WORKTREE_PATH_EXISTS") && !force) {
          showConfirmDialog({
            title: "Workspace path exists",
            message: `A workspace directory for "${workspaceName}" already exists. Replace it?`,
            confirmLabel: "Replace",
            destructive: true,
            onConfirm: () => {
              dismissConfirmDialog();
              void handleCreateResolvedPrWorkspace(project, name, pr, true);
            },
          });
          return;
        }
        addToast({ id: crypto.randomUUID(), message: msg, type: "error" });
      } finally {
        setWorkspaceCreation((prev) => {
          if (!prev || prev.requestId !== requestId) return prev;
          return null;
        });
      }
    },
    [
      addToast,
      dismissConfirmDialog,
      finishCreateWorkspace,
      openWorkspaceDialog,
      setActiveWorkspace,
      settings.worktreeCredentialRules,
      showConfirmDialog,
      workspaceCreation,
      workspaces,
    ],
  );

  const handleResumeAgent = useCallback(
    async (wsId: string, agent: 'claude' | 'codex' | 'gemini' | 'opencode') => {
      setContextMenu(null);
      // Find an active terminal tab for this workspace
      const tabs = useAppStore.getState().tabs;
      const termTab = tabs.find(
        (t) => t.workspaceId === wsId && t.type === 'terminal',
      );
      if (!termTab || termTab.type !== 'terminal') {
        addToast({ id: crypto.randomUUID(), message: 'No terminal tab in workspace', type: 'error' });
        return;
      }

      if (agent === 'claude') {
        const sessionId = await window.api.session.getLast(wsId, 'claude-code');
        if (!sessionId) {
          addToast({ id: crypto.randomUUID(), message: 'No previous Claude session found', type: 'info' });
          return;
        }
        window.api.pty.write(termTab.ptyId, `claude --resume ${sessionId}\n`);
      } else if (agent === 'codex') {
        window.api.pty.write(termTab.ptyId, 'codex resume --last\n');
      } else if (agent === 'opencode') {
        window.api.pty.write(termTab.ptyId, 'opencode resume --last\n');
      } else {
        window.api.pty.write(termTab.ptyId, 'gemini --resume\n');
      }
    },
    [addToast],
  );

  const handleSelectWorkspace = useCallback(
    (wsId: string) => {
      setActiveWorkspace(wsId);
    },
    [setActiveWorkspace],
  );

  const handleDeleteWorkspace = useCallback(
    (e: React.MouseEvent, ws: { id: string; name: string }) => {
      e.stopPropagation();
      if (e.shiftKey) {
        deleteWorkspace(ws.id);
        return;
      }
      showConfirmDialog({
        title: "Delete Workspace",
        message: `Delete workspace "${ws.name}"? This will remove the git worktree from disk.`,
        confirmLabel: "Delete",
        destructive: true,
        tip: "Tip: Hold \u21e7 Shift while deleting to skip this dialog",
        onConfirm: () => {
          void deleteWorkspace(ws.id);
        },
      });
    },
    [showConfirmDialog, deleteWorkspace],
  );

  const handleDeleteProject = useCallback(
    (e: React.MouseEvent, project: Project) => {
      e.stopPropagation();
      const wsCount = workspaces.filter(
        (w) => w.projectId === project.id,
      ).length;
      showConfirmDialog({
        title: "Delete Project",
        message: `Delete project "${project.name}"${wsCount > 0 ? ` and its ${wsCount} workspace${wsCount > 1 ? "s" : ""}` : ""}? This will remove all git worktrees from disk.`,
        confirmLabel: "Delete",
        destructive: true,
        tip: "Tip: Hold \u21e7 Shift while deleting to skip this dialog",
        onConfirm: () => {
          deleteProject(project.id);
          dismissConfirmDialog();
        },
      });
    },
    [workspaces, showConfirmDialog, deleteProject, dismissConfirmDialog],
  );

  const openPrUrl = useCallback(
    (projectId: string, url: string) => {
      const provider =
        projects.find((project) => project.id === projectId)?.prLinkProvider ??
        "github";
      window.open(providerUrl(url, provider));
    },
    [projects],
  );

  const projectPrModalProject = openProjectPrPopoverId
    ? (projects.find((p) => p.id === openProjectPrPopoverId) ?? null)
    : null;
  const modalOpenPrs = projectPrModalProject
    ? (projectOpenPrs[projectPrModalProject.id] ?? [])
    : [];
  const modalPrLoading = projectPrModalProject
    ? !!projectPrLoading[projectPrModalProject.id]
    : false;
  const modalPrError = projectPrModalProject
    ? projectPrError[projectPrModalProject.id] ?? null
    : null;
  const searchNeedle = projectPrSearch.trim().toLowerCase();
  const filteredModalPrs =
    searchNeedle.length === 0
      ? modalOpenPrs
      : modalOpenPrs.filter((pr) => {
          const haystack = [
            pr.title,
            pr.authorLogin ?? "",
            pr.headRefName,
            `#${pr.number}`,
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(searchNeedle);
        });

  const actionButtonConfigs = useMemo<Record<SidebarActionId, ActionButtonConfig>>(() => ({
    'add-project': {
      id: 'add-project',
      icon: '+',
      label: 'Add project',
      tooltipLabel: 'Add project',
      onClick: handleAddProject,
    },
    conductor: {
      id: 'conductor',
      icon: '◎',
      label: 'Conductor',
      tooltipLabel: 'Conductor chat (Codex + Cursor)',
      shortcut: '⇧⌘C',
      onClick: createConductorTabForActiveWorkspace,
    },
    automations: {
      id: 'automations',
      icon: '⏱',
      label: 'Automations',
      tooltipLabel: 'Automations',
      onClick: toggleAutomations,
    },
    linear: {
      id: 'linear',
      icon: (
        <img
          src={LINEAR_ICON_SRC}
          alt=""
          width={16}
          height={16}
          style={{ display: "block" }}
        />
      ),
      label: 'Linear',
      tooltipLabel: 'Linear workspace',
      onClick: toggleLinear,
    },
    plans: {
      id: 'plans',
      icon: '≡',
      label: 'Plans',
      tooltipLabel: 'Open newest agent plan across all agents',
      onClick: () => { void openLatestAgentPlan(); },
    },
    review: {
      id: 'review',
      icon: '±',
      label: 'Review',
      tooltipLabel: 'Toggle hunk review',
      shortcut: '⇧⌘R',
      onClick: () => { void toggleHunkReview(); },
    },
    settings: {
      id: 'settings',
      icon: '⚙',
      label: 'Settings',
      tooltipLabel: 'Settings',
      shortcut: '⌘,',
      onClick: toggleSettings,
    },
  }), [handleAddProject, createConductorTabForActiveWorkspace, toggleAutomations, toggleLinear, openLatestAgentPlan, toggleSettings, toggleHunkReview]);

  const orderedActions = useMemo(
    () => sidebarActionOrder.map((id) => actionButtonConfigs[id]),
    [sidebarActionOrder, actionButtonConfigs],
  );

  return (
    <div className={`${styles.sidebar} ${embedded ? styles.sidebarEmbedded : ''}`}>
      {showTitleArea && <div className={styles.titleRow} aria-hidden="true" />}

      <div className={styles.projectList}>
        {projects.length === 0 && (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>✦</span>
            <span className={styles.emptyTitle}>No projects yet</span>
            <span className={styles.emptyCopy}>
              Add a directory or git repository to start building parallel workspaces.
            </span>
            <button
              type="button"
              className={styles.emptyBtn}
              onClick={() => setAddProjectDialogOpen(true)}
            >
              + Add a project
            </button>
          </div>
        )}

        {projects.map((project) => {
          const isExpanded = isProjectExpanded(project.id);
          const repoInfo = repoInfoByProjectId.get(project.id) ?? null;
          const folderGroups = getRenderableFolderGroups(
            project.id,
            folders,
            workspaces,
            project.defaultFolderId ?? null,
          );

          return (
            <div
              key={project.id}
              className={`${styles.projectSection} ${draggedProjectId === project.id ? styles.projectSectionDragging : ""} ${dropTargetProjectId === project.id && draggedProjectId !== project.id ? styles.projectSectionDropTarget : ""}`}
              onDragOver={(e) => {
                if (!draggingProjectIdRef.current) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropTargetProjectId(project.id);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setDropTargetProjectId((prev) => prev === project.id ? null : prev);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const fromId =
                  e.dataTransfer.getData(CONSTELLAGENT_PROJECT_MIME)
                  || e.dataTransfer.getData("text/plain");
                if (fromId) reorderProject(fromId, project.id);
                draggingProjectIdRef.current = null;
                setDraggedProjectId(null);
                setDropTargetProjectId(null);
              }}
            >
              <div
                className={styles.projectHeader}
                draggable
                onDragStart={(e) => {
                  draggingProjectIdRef.current = project.id;
                  setDraggedProjectId(project.id);
                  e.dataTransfer.setData(CONSTELLAGENT_PROJECT_MIME, project.id);
                  e.dataTransfer.setData("text/plain", project.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  draggingProjectIdRef.current = null;
                  setDraggedProjectId(null);
                  setDropTargetProjectId(null);
                }}
                onClick={() => toggleProject(project.id)}
              >
                <ProjectHeaderGlyph
                  owner={repoInfo?.owner ?? null}
                  isExpanded={isExpanded}
                  icon={project.icon}
                  projectId={project.id}
                />
                <span className={styles.repoName} title={repoInfo ? `${repoInfo.owner}/${repoInfo.name}` : project.name}>
                  {repoInfo ? (
                    <>
                      <span className={styles.repoOwner}>{repoInfo.owner}/</span>
                      {repoInfo.name}
                    </>
                  ) : (
                    project.name
                  )}
                </span>
                <span
                  className={styles.hdrActions}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Tooltip label="Project settings">
                    <button
                      className={styles.settingsBtn}
                      aria-label="Project settings"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingProject(project);
                      }}
                    >
                      ⚙
                    </button>
                  </Tooltip>
                  <Tooltip label="Open pull requests">
                    <button
                      className={styles.prListBtn}
                      aria-expanded={openProjectPrPopoverId === project.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleProjectPrPopover(project);
                      }}
                    >
                      PR
                    </button>
                  </Tooltip>
                  <Tooltip label="Sync all worktrees">
                    <button
                      type="button"
                      className={styles.syncBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        void window.api.git.syncAllWorktrees(project.id).then(() => {
                          useAppStore.getState().refreshGitWorktrees();
                        });
                      }}
                    >
                      ↻
                    </button>
                  </Tooltip>
                  <Tooltip label="Delete project">
                    <button
                      className={styles.deleteBtn}
                      onClick={(e) => handleDeleteProject(e, project)}
                    >
                      ✕
                    </button>
                  </Tooltip>
                </span>
              </div>

              {isExpanded && (
                <div className={styles.workspaceList}>
                  {folderGroups.map(({ folder, workspaces: folderWorkspaces }) => {
                    const isFolderCollapsed = !!folder.collapsed;
                    const isPriorityFolder = project.priorityFolderId === folder.id;
                    const isDefaultFolder = project.defaultFolderId === folder.id;
                    const isFolderEditing = editingFolderId === folder.id;
                    const isFolderDropTarget = dropTargetFolderId === folder.id;
                    const isFolderReorderDropTarget = dropTargetFolderReorderId === folder.id;
                    const projectFolderCount = folderGroups.length;
                    return (
                      <div
                        key={folder.id}
                        className={`${styles.folderSection} ${draggedFolderId === folder.id ? styles.folderSectionDragging : ""}`}
                        style={folder.color ? ({ "--fc": folder.color } as React.CSSProperties) : undefined}
                      >
                        <div
                          className={`${styles.folderHeader} ${isFolderDropTarget ? styles.folderHeaderDropTarget : ""} ${isFolderReorderDropTarget && draggedFolderId !== folder.id ? styles.folderHeaderReorderTarget : ""}`}
                          data-folder-id={folder.id}
                          role="button"
                          tabIndex={isFolderEditing ? -1 : 0}
                          draggable={!isFolderEditing}
                          aria-expanded={!isFolderCollapsed}
                          aria-label={`${folder.name} folder, ${isFolderCollapsed ? "collapsed" : "expanded"}`}
                          onKeyDown={(e) => {
                            if (isFolderEditing) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleFolderCollapsed(folder.id);
                            }
                          }}
                          onClick={() => {
                            if (isFolderEditing) return;
                            toggleFolderCollapsed(folder.id);
                          }}
                          onDragStart={(e) => {
                            if (isFolderEditing) return;
                            draggingFolderIdRef.current = folder.id;
                            setDraggedFolderId(folder.id);
                            e.dataTransfer.setData(CONSTELLAGENT_FOLDER_MIME, folder.id);
                            e.dataTransfer.setData("text/plain", folder.id);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => {
                            draggingFolderIdRef.current = null;
                            setDraggedFolderId(null);
                            setDropTargetFolderReorderId(null);
                          }}
                          onDragOver={(e) => {
                            if (draggingFolderIdRef.current) {
                              e.stopPropagation();
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              setDropTargetFolderReorderId(folder.id);
                              return;
                            }
                            if (!draggingWorkspaceIdRef.current) return;
                            e.stopPropagation();
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            setDropTargetFolderId(folder.id);
                            const existing = folderAutoExpandTimerRef.current;
                            if (folder.collapsed && existing?.id !== folder.id) {
                              if (existing) window.clearTimeout(existing.timer);
                              const timer = window.setTimeout(() => {
                                toggleFolderCollapsed(folder.id);
                                folderAutoExpandTimerRef.current = null;
                              }, 350);
                              folderAutoExpandTimerRef.current = { id: folder.id, timer };
                            }
                          }}
                          onDragLeave={(e) => {
                            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                            setDropTargetFolderReorderId((prev) => (prev === folder.id ? null : prev));
                            setDropTargetFolderId((prev) => (prev === folder.id ? null : prev));
                            const existing = folderAutoExpandTimerRef.current;
                            if (existing?.id === folder.id) {
                              window.clearTimeout(existing.timer);
                              folderAutoExpandTimerRef.current = null;
                            }
                          }}
                          onDrop={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const fromFolderId =
                              e.dataTransfer.getData(CONSTELLAGENT_FOLDER_MIME)
                              || (draggingFolderIdRef.current ?? "");
                            if (fromFolderId) {
                              reorderFolder(fromFolderId, folder.id);
                              draggingFolderIdRef.current = null;
                              setDraggedFolderId(null);
                              setDropTargetFolderReorderId(null);
                              setDropTargetFolderId(null);
                              return;
                            }
                            const wsId =
                              e.dataTransfer.getData(CONSTELLAGENT_WORKSPACE_MIME)
                              || e.dataTransfer.getData("text/plain");
                            if (wsId) moveWorkspaceToFolder(wsId, folder.id);
                            setDropTargetFolderId(null);
                            const existing = folderAutoExpandTimerRef.current;
                            if (existing) {
                              window.clearTimeout(existing.timer);
                              folderAutoExpandTimerRef.current = null;
                            }
                            draggingWorkspaceIdRef.current = null;
                            setDraggedWsId(null);
                            setDropTargetWsId(null);
                            setDropTargetFolderReorderId(null);
                          }}
                        >
                          {isFolderCollapsed ? (
                            <FolderIcon
                              size={15}
                              strokeWidth={1.65}
                              className={`${styles.folderIcon} ${styles.folderIconClosed}`}
                              aria-hidden
                            />
                          ) : (
                            <FolderOpen
                              size={15}
                              strokeWidth={1.65}
                              className={`${styles.folderIcon} ${styles.folderIconOpen}`}
                              aria-hidden
                            />
                          )}
                          {isFolderEditing ? (
                            <input
                              className={styles.folderNameInput}
                              defaultValue={folder.name}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                                else if (e.key === "Escape") setEditingFolderId(null);
                              }}
                              onBlur={(e) => {
                                const val = e.currentTarget.value.trim();
                                if (val && val !== folder.name) renameFolder(folder.id, val);
                                setEditingFolderId(null);
                              }}
                            />
                          ) : (
                            <span className={styles.folderName}>{folder.name}</span>
                          )}
                          <div className={styles.folderMenuWrap} onClick={(e) => e.stopPropagation()}>
                            <button
                              className={styles.folderMenuBtn}
                              aria-label="Folder actions"
                              aria-expanded={folderMenuId === folder.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setFolderMenuId((prev) => (prev === folder.id ? null : folder.id));
                              }}
                            >
                              …
                            </button>
                            {folderMenuId === folder.id && (
                              <FolderActionsMenu
                                folder={folder}
                                projectFolderCount={projectFolderCount}
                                isPriority={isPriorityFolder}
                                isDefault={isDefaultFolder}
                                onRename={() => {
                                  setEditingFolderId(folder.id);
                                  setFolderMenuId(null);
                                }}
                                onSetPriority={() => {
                                  setProjectPriorityFolder(folder.projectId, folder.id);
                                  setFolderMenuId(null);
                                }}
                                onSetDefault={() => {
                                  setProjectDefaultFolder(folder.projectId, folder.id);
                                  setFolderMenuId(null);
                                }}
                                onSetColor={(color) => {
                                  setFolderColor(folder.id, color);
                                }}
                                onDelete={() => {
                                  setFolderMenuId(null);
                                  if (projectFolderCount <= 1) return;
                                  if (folderWorkspaces.length === 0) {
                                    removeFolder(folder.id);
                                    return;
                                  }
                                  showConfirmDialog({
                                    title: "Delete folder",
                                    message: `Move ${folderWorkspaces.length} workspace${folderWorkspaces.length === 1 ? "" : "s"} out of "${folder.name}" and delete the folder?`,
                                    confirmLabel: "Delete",
                                    destructive: true,
                                    onConfirm: () => {
                                      removeFolder(folder.id);
                                      dismissConfirmDialog();
                                    },
                                  });
                                }}
                                onClose={() => setFolderMenuId(null)}
                              />
                            )}
                          </div>
                        </div>

                        {!isFolderCollapsed && (
                        <div className={styles.folderChildren}>
                        {folderWorkspaces.map((ws) => {
                          const isEditing = editingWorkspaceId === ws.id;
                          const isAutoName = /^ws-[a-z0-9]+$/.test(ws.name);
                          const displayName = isAutoName ? ws.branch : ws.name;
                          const spotlightStatus = spotlightStatusByProject.get(ws.projectId);
                          const isSpotlightWorkspace =
                            !!spotlightStatus &&
                            spotlightStatus.workspaceId === ws.id &&
                            spotlightStatus.state !== "idle";

                          return (
                            <div
                              key={ws.id}
                              className={`${styles.workspaceItem} ${
                                ws.id === activeWorkspaceId ? styles.active : ""
                              } ${unreadWorkspaceIds.has(ws.id) ? styles.unread : ""} ${activeClaudeWorkspaceIds.has(ws.id) ? styles.claudeActive : ""} ${draggedWsId === ws.id ? styles.workspaceItemDragging : ""} ${dropTargetWsId === ws.id && draggedWsId !== ws.id ? styles.workspaceItemDropTarget : ""} ${graphiteStacks.has(ws.id) && (graphiteStacks.get(ws.id)?.branches.length ?? 0) > 1 ? styles.graphiteWorkspace : ""} ${isSpotlightWorkspace ? styles.spotlightWorkspace : ""}`}
                              data-spotlight-state={isSpotlightWorkspace ? spotlightStatus!.state : undefined}
                              draggable={!isEditing}
                              onClick={() =>
                                !isEditing && handleSelectWorkspace(ws.id)
                              }
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setContextMenu({ wsId: ws.id, x: e.clientX, y: e.clientY });
                              }}
                              onDoubleClick={() => {
                                editRef.current = displayName;
                                setEditingWorkspaceId(ws.id);
                              }}
                              onDragStart={(e) => {
                                draggingWorkspaceIdRef.current = ws.id;
                                setDraggedWsId(ws.id);
                                e.dataTransfer.setData(CONSTELLAGENT_WORKSPACE_MIME, ws.id);
                                e.dataTransfer.setData("text/plain", ws.id);
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              onDragEnd={() => {
                                draggingWorkspaceIdRef.current = null;
                                setDraggedWsId(null);
                                setDropTargetWsId(null);
                                setDropTargetFolderId(null);
                                const existing = folderAutoExpandTimerRef.current;
                                if (existing) {
                                  window.clearTimeout(existing.timer);
                                  folderAutoExpandTimerRef.current = null;
                                }
                              }}
                              onDragOver={(e) => {
                                if (!draggingWorkspaceIdRef.current) return;
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                                setDropTargetWsId(ws.id);
                              }}
                              onDragLeave={(e) => {
                                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                                setDropTargetWsId((prev) => prev === ws.id ? null : prev);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                const fromId =
                                  e.dataTransfer.getData(CONSTELLAGENT_WORKSPACE_MIME)
                                  || e.dataTransfer.getData("text/plain");
                                if (fromId && fromId !== ws.id) {
                                  moveWorkspaceToFolderBefore(fromId, folder.id, ws.id);
                                }
                                draggingWorkspaceIdRef.current = null;
                                setDraggedWsId(null);
                                setDropTargetWsId(null);
                              }}
                            >
                              {isEditing ? (
                                <input
                                  className={styles.workspaceNameInput}
                                  defaultValue={displayName}
                                  autoFocus
                                  ref={(el) => {
                                    if (el) {
                                      el.select();
                                    }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.currentTarget.blur();
                                    } else if (e.key === "Escape") {
                                      editRef.current = "";
                                      setEditingWorkspaceId(null);
                                    }
                                  }}
                                  onBlur={(e) => {
                                    const val = e.currentTarget.value.trim();
                                    if (val && val !== ws.name) {
                                      renameWorkspace(ws.id, val);
                                    }
                                    setEditingWorkspaceId(null);
                                  }}
                                />
                              ) : (
                                <WorkspaceBarFaces
                                  ws={ws}
                                  project={project}
                                  displayName={displayName}
                                  sync={worktreeSyncMap.get(ws.id)}
                                  isSpotlightWorkspace={isSpotlightWorkspace}
                                  spotlightStatus={spotlightStatus}
                                />
                              )}
                              <BranchAndPrLauncher
                                projectId={project.id}
                                repoPath={project.repoPath}
                                workspaceId={ws.id}
                                worktreePath={ws.worktreePath}
                                workspaceBranch={ws.branch}
                              />
                              <Tooltip label="Delete workspace">
                                <button
                                  className={styles.deleteBtn}
                                  onClick={(e) => handleDeleteWorkspace(e, ws)}
                                >
                                  ✕
                                </button>
                              </Tooltip>
                            </div>
                          );
                        })}
                        </div>
                        )}
                      </div>
                    );
                  })}

                  <details className={styles.projectAddDetails}>
                    <summary className={styles.projectAddSummary}>
                      <ChevronDown className={styles.projectAddChevron} size={14} strokeWidth={2} aria-hidden />
                      <span>Add</span>
                    </summary>
                    <div className={styles.projectAddExpand}>
                      <div className={styles.projectAddMenu}>
                        <Tooltip label="New folder" shortcut="⇧⌘N">
                          <button
                            type="button"
                            className={styles.projectAddMenuItem}
                            onClick={(e) => {
                              (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
                              setFolderDialogProjectId(project.id);
                            }}
                          >
                            New folder
                          </button>
                        </Tooltip>
                        <Tooltip label="New workspace" shortcut="⌘N">
                          <button
                            type="button"
                            className={styles.projectAddMenuItem}
                            onClick={(e) => {
                              (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
                              openWorkspaceDialog(project.id);
                            }}
                          >
                            New workspace
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  </details>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.actions}>
        <ContextWindowIndicator />
        <div className={styles.actionsList}>
          {orderedActions.map((action) => (
            <div
              key={action.id}
              className={[
                styles.actionButtonWrapper,
                draggedActionId === action.id ? styles.actionButtonDragging : '',
                dropTargetActionId === action.id ? styles.actionButtonDropTarget : '',
              ].filter(Boolean).join(' ')}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(CONSTELLAGENT_ACTION_MIME, action.id);
                e.dataTransfer.setData("text/plain", action.id);
                e.dataTransfer.effectAllowed = 'move';
                draggingActionIdRef.current = action.id;
                requestAnimationFrame(() => setDraggedActionId(action.id));
              }}
              onDragEnd={() => {
                draggingActionIdRef.current = null;
                setDraggedActionId(null);
                setDropTargetActionId(null);
              }}
              onDragOver={(e) => {
                if (!draggingActionIdRef.current) return;
                if (draggingActionIdRef.current === action.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDropTargetActionId(action.id);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setDropTargetActionId((prev) => (prev === action.id ? null : prev));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const raw =
                  e.dataTransfer.getData(CONSTELLAGENT_ACTION_MIME)
                  || e.dataTransfer.getData("text/plain");
                const fromId = raw as SidebarActionId;
                if (
                  fromId
                  && VALID_SIDEBAR_ACTION_IDS.has(fromId)
                  && fromId !== action.id
                ) {
                  reorderSidebarAction(fromId, action.id);
                }
                setDropTargetActionId(null);
              }}
            >
              <Tooltip label={action.tooltipLabel} shortcut={action.shortcut}>
                <button
                  type="button"
                  draggable={false}
                  className={styles.actionButton}
                  onClick={action.onClick}
                  disabled={action.disabled}
                >
                  <span className={styles.actionIcon}>{action.icon}</span>
                  <span>{action.label}</span>
                </button>
              </Tooltip>
            </div>
          ))}
        </div>
      </div>

      {projectPrModalProject && (
        <div
          className={`${styles.projectPrModalOverlay} constellagent-dialog-overlay`}
          onClick={closeProjectPrModal}
        >
          <div
            className={`${styles.projectPrModal} constellagent-dialog-body`}
            data-project-pr-modal
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.projectPrModalHeader}>
              <div className={styles.projectPrModalHeaderText}>
                <span className={styles.projectPrModalTitle}>Open Pull Requests</span>
                <span className={styles.projectPrModalSubtitle}>
                  {projectPrModalProject.name}
                </span>
              </div>
              <div className={styles.projectPrModalHeaderActions}>
                <button
                  className={styles.projectPrModalGhostBtn}
                  onClick={() => {
                    void loadProjectOpenPrs(projectPrModalProject);
                  }}
                  disabled={modalPrLoading}
                >
                  Refresh
                </button>
                <button
                  className={styles.projectPrModalCloseBtn}
                  onClick={closeProjectPrModal}
                  aria-label="Close pull requests modal"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className={styles.projectPrModalToolbar}>
              <input
                className={styles.projectPrSearchInput}
                placeholder="Filter by title, author, branch, #"
                value={projectPrSearch}
                onChange={(e) => setProjectPrSearch(e.target.value)}
              />
              <span className={styles.projectPrModalSummary}>
                {filteredModalPrs.length}
                {filteredModalPrs.length !== modalOpenPrs.length
                  ? ` of ${modalOpenPrs.length}`
                  : ""}{" "}
                open
              </span>
            </div>

            {modalPrLoading && (
              <div
                className={styles.projectPrLoadingRow}
                role="status"
                aria-live="polite"
              >
                <span
                  className={styles.projectPrLoadingSpinner}
                  aria-hidden="true"
                  data-allow-motion=""
                />
                <span>Loading open pull requests...</span>
              </div>
            )}

            {!modalPrLoading && modalPrError && (
              <div className={`${styles.projectPrStatus} ${styles.projectPrStatusError}`}>
                {modalPrError}
              </div>
            )}
            {!modalPrLoading && !modalPrError && modalOpenPrs.length === 0 && (
              <div className={styles.projectPrStatus}>No open pull requests.</div>
            )}
            {!modalPrLoading &&
              !modalPrError &&
              modalOpenPrs.length > 0 &&
              filteredModalPrs.length === 0 && (
                <div className={styles.projectPrStatus}>
                  No pull requests match "{projectPrSearch}".
                </div>
              )}
            {!modalPrError && filteredModalPrs.length > 0 && (
              <div className={styles.projectPrModalList}>
                {filteredModalPrs.map((pr) => {
                  const prKey = `${projectPrModalProject.id}:${pr.number}`;
                  const openPr = pr.state === "open";
                  const pendingCommentCount = openPr
                    ? Math.max(0, pr.pendingCommentCount || 0)
                    : 0;
                  const hasPendingComments = pendingCommentCount > 0;
                  const isBlockedByCi = openPr && !!pr.isBlockedByCi;
                  const isApproved = openPr && !!pr.isApproved;
                  const isCiPassing =
                    openPr && pr.checkStatus === "passing" && !isBlockedByCi;
                  const ciChipLabel = openPr
                    ? isBlockedByCi
                      ? "CI blocked"
                      : pr.checkStatus === "failing"
                        ? "CI failing"
                        : pr.checkStatus === "pending"
                          ? "CI pending"
                          : isCiPassing
                            ? "CI passing"
                            : null
                    : null;
                  const commentChipLabel = hasPendingComments
                    ? `${pendingCommentCount} comment${pendingCommentCount === 1 ? "" : "s"}`
                    : null;
                  const localBranch = buildPrLocalBranch(pr);
                  const existingWorkspace = workspaces.find(
                    (ws) =>
                      ws.projectId === projectPrModalProject.id &&
                      ws.branch === localBranch,
                  );
                  const isPulling = pullingPrKey === prKey;
                  const disablePull = !!workspaceCreation || !!pullingPrKey;

                  return (
                    <div key={pr.number} className={styles.projectPrRow}>
                      <div className={styles.projectPrRowMain}>
                        <button
                          className={styles.projectPrLink}
                          onClick={() => openPrUrl(projectPrModalProject.id, pr.url)}
                          title={`PR #${pr.number}: ${pr.title}`}
                        >
                          <span className={`${styles.prInline} ${styles.pr_open}`}>
                            <PrStateIcon state={pr.state} />
                            <span className={styles.prNumber}>#{pr.number}</span>
                          </span>
                          <span className={styles.projectPrItemTitle}>{pr.title}</span>
                        </button>
                        <div className={styles.projectPrMetaRow}>
                          {pr.authorLogin && (
                            <span className={styles.projectPrAuthor}>@{pr.authorLogin}</span>
                          )}
                          <span className={styles.projectPrBranch}>{localBranch}</span>
                        </div>
                      </div>
                      <div className={styles.projectPrRowSide}>
                        <div className={styles.projectPrStatusGroup}>
                          {ciChipLabel && (
                            <span
                              className={`${styles.projectPrStatusChip} ${
                                isBlockedByCi || pr.checkStatus === "failing"
                                  ? styles.projectPrStatusChipDanger
                                  : pr.checkStatus === "pending"
                                    ? styles.projectPrStatusChipNeutral
                                    : styles.projectPrStatusChipSuccess
                              }`}
                              title={ciChipLabel}
                            >
                              {ciChipLabel}
                            </span>
                          )}
                          {isApproved && (
                            <span
                              className={`${styles.projectPrStatusChip} ${styles.projectPrStatusChipSuccess}`}
                              title="Approved"
                            >
                              Approved
                            </span>
                          )}
                          {commentChipLabel && (
                            <span
                              className={`${styles.projectPrStatusChip} ${styles.projectPrStatusChipWarning}`}
                              title={`${pendingCommentCount} unresolved review comment${pendingCommentCount === 1 ? "" : "s"}`}
                            >
                              {commentChipLabel}
                            </span>
                          )}
                        </div>
                        <button
                          className={styles.projectPrPullBtn}
                          onClick={() => {
                            void handlePullPrLocally(projectPrModalProject, pr);
                          }}
                          disabled={disablePull}
                        >
                          {existingWorkspace
                            ? "Focus workspace"
                            : isPulling
                              ? "Pulling..."
                              : "Pull locally"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {addProjectDialogOpen && (
        <AddProjectDialog onClose={() => setAddProjectDialogOpen(false)} />
      )}

      {folderDialogProject && (
        <FolderDialog
          project={folderDialogProject}
          onConfirm={(name) => {
            addFolder(folderDialogProject.id, name);
            setFolderDialogProjectId(null);
          }}
          onCancel={() => setFolderDialogProjectId(null)}
        />
      )}

      {dialogProject && (
        <WorkspaceDialog
          project={dialogProject}
          onConfirm={(name, branch, newBranch, baseBranch) => {
            handleCreateWorkspace(
              dialogProject,
              name,
              branch,
              newBranch,
              false,
              baseBranch,
            );
          }}
          onConfirmPr={(name, pr) => {
            void handleCreateResolvedPrWorkspace(dialogProject, name, pr);
          }}
          onCancel={() => {
            if (!isCreatingWorkspace) openWorkspaceDialog(null);
          }}
          isCreating={isCreatingWorkspace}
          createProgressMessage={workspaceCreation?.message}
          showSlowCreateMessage={showSlowCreateMessage}
        />
      )}

      {editingProject && (
        <ProjectSettingsDialog
          project={editingProject}
          onSave={({ startupCommands, prLinkProvider, icon }) => {
            updateProject(editingProject.id, {
              startupCommands,
              prLinkProvider,
              icon: icon ?? undefined,
            });
            setEditingProject(null);
          }}
          onCancel={() => setEditingProject(null)}
        />
      )}

      {contextMenu && (
        <div
          className={styles.projectPrModalOverlay}
          onClick={() => setContextMenu(null)}
          style={{ background: 'transparent' }}
        >
          <div
            style={{
              position: 'fixed',
              left: contextMenu.x,
              top: contextMenu.y,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 0',
              zIndex: 9999,
              minWidth: 180,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '4px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 600 }}>
              Resume last session
            </div>
            <button
              className={styles.actionButton}
              style={{ width: '100%', textAlign: 'left', borderRadius: 0 }}
              onClick={() => handleResumeAgent(contextMenu.wsId, 'claude')}
            >
              Claude Code
            </button>
            <button
              className={styles.actionButton}
              style={{ width: '100%', textAlign: 'left', borderRadius: 0 }}
              onClick={() => handleResumeAgent(contextMenu.wsId, 'codex')}
            >
              Codex
            </button>
            <button
              className={styles.actionButton}
              style={{ width: '100%', textAlign: 'left', borderRadius: 0 }}
              onClick={() => handleResumeAgent(contextMenu.wsId, 'gemini')}
            >
              Gemini
            </button>
            <button
              className={styles.actionButton}
              style={{ width: '100%', textAlign: 'left', borderRadius: 0 }}
              onClick={() => handleResumeAgent(contextMenu.wsId, 'opencode')}
            >
              OpenCode
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
