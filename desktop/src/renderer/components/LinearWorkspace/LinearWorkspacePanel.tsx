import {
  CheckCircle,
  Circle,
  CircleDashed,
  ListBullets,
  PaperPlaneTilt,
  Pulse,
  RocketLaunch,
  Ticket,
  Tray,
  XCircle,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAppStore } from "../../store/app-store";
import type {
  LinearIssuesPriorityPreset,
  LinearProjectUpdateBarEntry,
  LinearWorkspaceToolbarTool,
  LinearWorkspaceView,
  Workspace,
} from "../../store/types";
import {
  normalizeLinearWorkspaceTabOrder,
  normalizeLinearWorkspaceToolbarTool,
} from "../../store/types";
import { SegmentedPill } from "../ui/segmented-pill";
import { Tooltip } from "../Tooltip/Tooltip";
import {
  linearCreateIssue,
  linearCreateProjectUpdate,
  linearFetchAssignedIssues,
  linearFetchCreatedIssues,
  linearFetchOrgUsers,
  linearFetchProjects,
  linearFetchIssuesForProjectIds,
  linearFetchProjectUpdates,
  linearFetchTeams,
  linearFetchViewer,
  linearOpenExternal,
  linearUserPickerWithViewer,
  workspaceBranchMatchesLinearIssue,
  type LinearIssueNode,
  type LinearProjectNode,
  type LinearProjectUpdateNode,
  type LinearTeamNode,
  type LinearUserNode,
} from "../../linear/linear-api";
import {
  buildLinearJumpIndex,
  linearJumpPayloadId,
  type LinearJumpRow,
} from "../../linear/linear-jump-index";
import { ChevronLeft } from "lucide-react";
import { FloatingPanel } from "../FloatingPanel/FloatingPanel";
import { LinearQuickOpen } from "./LinearQuickOpen";
import { LinearSearchComposer } from "./LinearSearchComposer";
import { LinearTicketsComposer } from "./LinearTicketsComposer";
import styles from "./LinearWorkspacePanel.module.css";

const linearIconSrc = new URL(
  "../../assets/linear/linear-icon.svg",
  import.meta.url,
).href;

const LINEAR_HEADER_TOOLS: {
  id: LinearWorkspaceToolbarTool;
  label: string;
  title: string;
}[] = [
  {
    id: "search",
    label: "Search",
    title: "Open workspace search (⌘F when Linear Issues tab is open)",
  },
  { id: "refresh", label: "Refresh", title: "Reload from Linear" },
  { id: "settings", label: "Settings", title: "Open Settings" },
];

function priorityLabel(p?: number): string {
  if (p == null) return "—";
  const map: Record<number, string> = {
    0: "None",
    1: "Urgent",
    2: "High",
    3: "Medium",
    4: "Low",
  };
  return map[p] ?? String(p);
}

function filterIssuesByPriorityPreset(
  list: LinearIssueNode[],
  preset: LinearIssuesPriorityPreset,
): LinearIssueNode[] {
  if (preset === "all") return list;
  const n = Number(preset);
  return list.filter((i) => i.priority === n);
}

/** Prefer a workspace opened from this Linear issue (agent session); else title prefix; else branch pattern. */
function findWorkspaceForLinearIssue(
  issue: LinearIssueNode,
  list: Workspace[],
): Workspace | undefined {
  const linked = list.find((w) => w.linearIssueId === issue.id);
  if (linked) return linked;
  const idPrefix = `${issue.identifier}:`;
  const byName = list.find((w) =>
    w.name.toLowerCase().startsWith(idPrefix.toLowerCase()),
  );
  if (byName) return byName;
  return list.find((w) => workspaceBranchMatchesLinearIssue(issue, w.branch));
}

function LinearIssueStateCell({ issue }: { issue: LinearIssueNode }) {
  const st = issue.state;
  const label = st?.name ?? "—";
  const type = st?.type?.toLowerCase() ?? "";
  const name = st?.name?.toLowerCase() ?? "";
  const iconProps = {
    size: 16,
    weight: "duotone" as const,
    "aria-hidden": true as const,
    className: styles.issueStateIcon,
  };
  let node: ReactNode;
  if (type === "completed" || name.includes("complete") || name.includes("done")) {
    node = <CheckCircle {...iconProps} />;
  } else if (
    type === "canceled" ||
    type === "cancelled" ||
    name.includes("cancel")
  ) {
    node = <XCircle {...iconProps} />;
  } else if (type === "started") {
    node = <Pulse {...iconProps} />;
  } else if (type === "unstarted") {
    node = <CircleDashed {...iconProps} />;
  } else if (type === "backlog") {
    node = <Tray {...iconProps} />;
  } else if (type === "triage" || name.includes("triage")) {
    node = <CircleDashed {...iconProps} />;
  } else if (st) {
    node = <Circle {...iconProps} />;
  } else {
    node = null;
  }
  return (
    <span className={styles.issueStateCell}>
      {node}
      <span className={styles.issueStateLabel}>{label}</span>
    </span>
  );
}

function usersFromLoadedIssues(
  assigned: LinearIssueNode[],
  created: LinearIssueNode[],
): LinearUserNode[] {
  const m = new Map<string, LinearUserNode>();
  for (const i of assigned) {
    if (i.assignee)
      m.set(i.assignee.id, { id: i.assignee.id, name: i.assignee.name });
    if (i.creator)
      m.set(i.creator.id, { id: i.creator.id, name: i.creator.name });
  }
  for (const i of created) {
    if (i.assignee)
      m.set(i.assignee.id, { id: i.assignee.id, name: i.assignee.name });
    if (i.creator)
      m.set(i.creator.id, { id: i.creator.id, name: i.creator.name });
  }
  return [...m.values()];
}

type LinearE2eBootstrap = {
  viewer?: { id: string; name: string; email?: string } | null;
  projects?: LinearProjectNode[];
  teams?: LinearTeamNode[];
  ticketIssues?: LinearIssueNode[];
  issueCreateResponse?: LinearIssueNode | null;
};

export function LinearWorkspacePanel() {
  const settings = useAppStore((s) => s.settings);
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const toggleLinear = useAppStore((s) => s.toggleLinear);
  const openLinearQuickOpen = useAppStore((s) => s.openLinearQuickOpen);
  const linearQuickOpenVisible = useAppStore((s) => s.linearQuickOpenVisible);
  const addToast = useAppStore((s) => s.addToast);
  const startLinearIssueAgentSession = useAppStore(
    (s) => s.startLinearIssueAgentSession,
  );
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);

  const apiKey = settings.linearApiKey;

  const [loading, setLoading] = useState(false);
  const [viewer, setViewer] = useState<{
    id: string;
    name: string;
    email?: string;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<LinearIssueNode[]>([]);
  const [created, setCreated] = useState<LinearIssueNode[]>([]);
  const [projects, setProjects] = useState<LinearProjectNode[]>([]);
  const [workspaceUsers, setWorkspaceUsers] = useState<LinearUserNode[]>([]);
  const [orgUsersUnavailable, setOrgUsersUnavailable] = useState(false);
  const [scopeProjectId, setScopeProjectId] = useState("");
  const [scopeUserId, setScopeUserId] = useState("");
  const [projectUpdates, setProjectUpdates] = useState<
    LinearProjectUpdateNode[]
  >([]);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [updatesError, setUpdatesError] = useState<string | null>(null);
  const [updatesProjectName, setUpdatesProjectName] = useState<
    string | undefined
  >(undefined);
  const [linearToolsMenuOpen, setLinearToolsMenuOpen] = useState(false);
  /** Playwright: dispatch `constellagent-e2e-linear-issues` with LinearIssueNode[] detail */
  const [e2eLinearIssues, setE2eLinearIssues] = useState<
    LinearIssueNode[] | null
  >(null);
  const e2eIssueCreateResponse = useRef<LinearIssueNode | null>(null);
  const linearToolsMenuRef = useRef<HTMLDivElement>(null);
  const [composerSubmitError, setComposerSubmitError] = useState<string | null>(
    null,
  );
  const [supplementalIssues, setSupplementalIssues] = useState<LinearIssueNode[]>(
    [],
  );
  const [linearTeams, setLinearTeams] = useState<LinearTeamNode[]>([]);
  const [ticketTeamId, setTicketTeamId] = useState("");
  const [ticketPriority, setTicketPriority] = useState(0);
  const [ticketIssues, setTicketIssues] = useState<LinearIssueNode[]>([]);
  const [ticketIssuesLoading, setTicketIssuesLoading] = useState(false);
  const [ticketIssuesError, setTicketIssuesError] = useState<string | null>(null);
  /** Default Updates composer “From” to the API key user once per viewer id. */
  const defaultUpdatesPersonForViewer = useRef<string | null>(null);

  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) {
      m.set(p.id, p.name);
    }
    return m;
  }, [projects]);

  const barEntries = settings.linearProjectUpdateBar;
  const favoriteIds = new Set(settings.linearFavoriteProjectIds);

  const loadAll = useCallback(async () => {
    const key = settings.linearApiKey.trim();
    if (!key) {
      setViewer(null);
      setLoadError("Add your Personal API key in Settings.");
      setAssigned([]);
      setCreated([]);
      setProjects([]);
      setWorkspaceUsers([]);
      setOrgUsersUnavailable(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    try {
      const v = await linearFetchViewer(key);
      if (v.errors?.length) {
        setLoadError(v.errors.map((e) => e.message).join("; "));
        setViewer(null);
      } else {
        const node = v.data?.viewer;
        if (node?.id) {
          setViewer({
            id: node.id,
            name: node.name?.trim() || "Connected",
            email: node.email?.trim() || undefined,
          });
        } else {
          setViewer(null);
        }
      }

      const [a, c, pr, ou, tm] = await Promise.all([
        linearFetchAssignedIssues(key),
        linearFetchCreatedIssues(key),
        linearFetchProjects(key),
        linearFetchOrgUsers(key),
        linearFetchTeams(key),
      ]);

      if (a.errors?.length) {
        setLoadError((prev) =>
          [prev, ...a.errors!.map((e) => e.message)].filter(Boolean).join("; "),
        );
        setAssigned([]);
      } else {
        setAssigned(a.data?.viewer?.assignedIssues?.nodes ?? []);
      }

      if (c.errors?.length) {
        setCreated([]);
      } else {
        setCreated(c.data?.issues?.nodes ?? []);
      }

      setProjects(pr.projects);
      if (pr.errors?.length) {
        setLoadError((prev) =>
          [prev, ...pr.errors!.map((e) => e.message)]
            .filter(Boolean)
            .join("; "),
        );
      }

      if (ou.errors?.length) {
        setOrgUsersUnavailable(true);
        setWorkspaceUsers([]);
      } else {
        setOrgUsersUnavailable(false);
        setWorkspaceUsers(ou.users);
      }

      if (tm.errors?.length) {
        setLinearTeams([]);
      } else {
        setLinearTeams(tm.teams);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load Linear");
    } finally {
      setLoading(false);
    }
  }, [settings.linearApiKey]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<LinearIssueNode[]>;
      if (Array.isArray(ce.detail)) setE2eLinearIssues(ce.detail);
    };
    window.addEventListener("constellagent-e2e-linear-issues", handler);
    return () =>
      window.removeEventListener("constellagent-e2e-linear-issues", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<LinearE2eBootstrap>;
      const detail = ce.detail;
      if (!detail || typeof detail !== "object") return;
      setLoadError(null);
      if ("viewer" in detail) setViewer(detail.viewer ?? null);
      if (Array.isArray(detail.projects)) setProjects(detail.projects);
      if (Array.isArray(detail.teams)) setLinearTeams(detail.teams);
      if (Array.isArray(detail.ticketIssues)) setTicketIssues(detail.ticketIssues);
      if ("issueCreateResponse" in detail) {
        e2eIssueCreateResponse.current = detail.issueCreateResponse ?? null;
      }
    };
    window.addEventListener("constellagent-e2e-linear-bootstrap", handler);
    return () =>
      window.removeEventListener("constellagent-e2e-linear-bootstrap", handler);
  }, []);

  useEffect(() => {
    if (!apiKey.trim()) {
      defaultUpdatesPersonForViewer.current = null;
    }
  }, [apiKey]);

  useEffect(() => {
    if (!viewer?.id) return;
    if (defaultUpdatesPersonForViewer.current === viewer.id) return;
    setScopeUserId(viewer.id);
    defaultUpdatesPersonForViewer.current = viewer.id;
  }, [viewer?.id]);

  useEffect(() => {
    const key = apiKey.trim();
    if (!scopeProjectId || !key) {
      setProjectUpdates([]);
      setUpdatesError(null);
      setUpdatesLoading(false);
      setUpdatesProjectName(undefined);
      return;
    }
    let cancelled = false;
    setUpdatesLoading(true);
    setUpdatesError(null);
    void linearFetchProjectUpdates(key, scopeProjectId).then((res) => {
      if (cancelled) return;
      setUpdatesLoading(false);
      if (res.errors?.length) {
        setUpdatesError(res.errors.map((e) => e.message).join("; "));
        setProjectUpdates([]);
        setUpdatesProjectName(undefined);
        return;
      }
      setProjectUpdates(res.updates);
      setUpdatesProjectName(res.projectName);
    });
    return () => {
      cancelled = true;
    };
  }, [scopeProjectId, apiKey]);

  useEffect(() => {
    const key = apiKey.trim();
    if (!scopeProjectId || !key) {
      setTicketIssues([]);
      setTicketIssuesError(null);
      setTicketIssuesLoading(false);
      return;
    }
    let cancelled = false;
    setTicketIssuesLoading(true);
    setTicketIssuesError(null);
    void linearFetchIssuesForProjectIds(key, [scopeProjectId]).then((res) => {
      if (cancelled) return;
      setTicketIssuesLoading(false);
      if (res.errors?.length) {
        setTicketIssuesError(res.errors.map((e) => e.message).join("; "));
        setTicketIssues([]);
        return;
      }
      setTicketIssues(res.issues ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [scopeProjectId, apiKey]);

  useEffect(() => {
    setTicketTeamId("");
  }, [scopeProjectId]);

  useEffect(() => {
    if (ticketTeamId) return;
    const issue = ticketIssues.find(
      (i) => i.project?.id === scopeProjectId && i.team?.key,
    );
    if (!issue?.team?.key) return;
    const t = linearTeams.find((x) => x.key === issue.team!.key);
    if (t?.id) setTicketTeamId(t.id);
  }, [ticketTeamId, ticketIssues, scopeProjectId, linearTeams]);

  useEffect(() => {
    if (!linearToolsMenuOpen) return;
    const close = () => setLinearToolsMenuOpen(false);
    const onDocMouseDown = (e: MouseEvent) => {
      if (linearToolsMenuRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [linearToolsMenuOpen]);

  const rawIssuesByScope = useMemo(() => {
    if (e2eLinearIssues?.length) return e2eLinearIssues;
    return settings.linearIssueScope === "assigned" ? assigned : created;
  }, [
    e2eLinearIssues,
    settings.linearIssueScope,
    assigned,
    created,
  ]);

  const issues = useMemo(
    () =>
      filterIssuesByPriorityPreset(
        rawIssuesByScope,
        settings.linearIssuesPriorityPreset,
      ),
    [rawIssuesByScope, settings.linearIssuesPriorityPreset],
  );

  const workspaceView = settings.linearWorkspaceView;

  const setBar = (next: LinearProjectUpdateBarEntry[]) => {
    updateSettings({ linearProjectUpdateBar: next });
  };

  const addBarProject = (projectId: string) => {
    if (!projectId || barEntries.some((e) => e.linearProjectId === projectId))
      return;
    setBar([...barEntries, { linearProjectId: projectId, note: "" }]);
  };

  const removeBarEntry = (projectId: string) => {
    setBar(barEntries.filter((e) => e.linearProjectId !== projectId));
  };

  const moveBar = (projectId: string, dir: -1 | 1) => {
    const i = barEntries.findIndex((e) => e.linearProjectId === projectId);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= barEntries.length) return;
    const next = [...barEntries];
    const t = next[i]!;
    next[i] = next[j]!;
    next[j] = t;
    setBar(next);
  };

  const updateBarNote = (projectId: string, note: string) => {
    setBar(
      barEntries.map((e) =>
        e.linearProjectId === projectId ? { ...e, note } : e,
      ),
    );
  };

  const toggleFavorite = (projectId: string) => {
    const set = new Set(settings.linearFavoriteProjectIds);
    if (set.has(projectId)) set.delete(projectId);
    else set.add(projectId);
    updateSettings({ linearFavoriteProjectIds: [...set] });
  };

  const barProjectOptions = useMemo(() => {
    const inBar = new Set(barEntries.map((e) => e.linearProjectId));
    return projects.filter((p) => !inBar.has(p.id));
  }, [projects, barEntries]);

  const issueById = useMemo(() => {
    const m = new Map<string, LinearIssueNode>();
    for (const x of assigned) m.set(x.id, x);
    for (const x of created) m.set(x.id, x);
    return m;
  }, [assigned, created]);

  useEffect(() => {
    if (!linearQuickOpenVisible || !apiKey.trim()) return;
    const ids = projects.map((p) => p.id).slice(0, 40);
    if (ids.length === 0) {
      setSupplementalIssues([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const r = await linearFetchIssuesForProjectIds(apiKey.trim(), ids);
      if (cancelled) return;
      if (r.errors?.length) return;
      setSupplementalIssues(r.issues ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [linearQuickOpenVisible, apiKey, projects]);

  const jumpRows = useMemo(
    () =>
      buildLinearJumpIndex({
        barEntries,
        projectNameById,
        assigned,
        created,
        projects,
        supplementalIssues,
      }),
    [barEntries, projectNameById, assigned, created, projects, supplementalIssues],
  );
  const pickerUsers = useMemo(() => {
    if (!orgUsersUnavailable && workspaceUsers.length > 0)
      return workspaceUsers;
    return usersFromLoadedIssues(assigned, created);
  }, [orgUsersUnavailable, workspaceUsers, assigned, created]);

  const pickerUsersWithViewer = useMemo(
    () => linearUserPickerWithViewer(viewer, pickerUsers),
    [viewer, pickerUsers],
  );

  const scopedProjectLabel =
    (scopeProjectId &&
      (projectNameById.get(scopeProjectId) ?? updatesProjectName)) ||
    undefined;

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );
  const worktreePathForPi = activeWorkspace?.worktreePath ?? null;

  const activateIssueWorkspaceOrOpenUrl = useCallback(
    (issue: LinearIssueNode) => {
      const ws = findWorkspaceForLinearIssue(issue, workspaces);
      if (ws) {
        setActiveWorkspace(ws.id);
        toggleLinear();
        return;
      }
      if (issue.url) void linearOpenExternal(issue.url);
    },
    [workspaces, setActiveWorkspace, toggleLinear],
  );

  const openProject = (p: LinearProjectNode) => {
    if (p.url) void linearOpenExternal(p.url);
    else void linearOpenExternal(`https://linear.app/project/${p.slugId}`);
  };

  const onJumpActivate = (row: LinearJumpRow) => {
    if (row.kind === "issue") {
      const id = linearJumpPayloadId(row);
      const i = issueById.get(id);
      if (i) {
        activateIssueWorkspaceOrOpenUrl(i);
        return;
      }
      if (row.navigateUrl) {
        void linearOpenExternal(row.navigateUrl);
      }
      return;
    }
    if (row.kind === "project") {
      if (row.navigateUrl) {
        void linearOpenExternal(row.navigateUrl);
        return;
      }
      const id = linearJumpPayloadId(row);
      const p = projects.find((x) => x.id === id);
      if (p) openProject(p);
      return;
    }
    if (row.kind === "bar") {
      const pid = linearJumpPayloadId(row);
      const p = projects.find((x) => x.id === pid);
      if (p) openProject(p);
      else {
        void linearOpenExternal("https://linear.app");
        addToast({
          id: crypto.randomUUID(),
          type: "info",
          message:
            "Open the project from Linear, or refresh after loading projects.",
        });
      }
    }
  };

  const userLine =
    viewer?.email?.trim() ||
    viewer?.name?.trim() ||
    (viewer ? "Connected" : null);

  const toolbarTool = normalizeLinearWorkspaceToolbarTool(
    settings.linearWorkspaceToolbarTool,
  );
  const toolbarSavedLabel =
    LINEAR_HEADER_TOOLS.find((x) => x.id === toolbarTool)?.label ?? "Search";

  const activateLinearTool = (t: LinearWorkspaceToolbarTool) => {
    updateSettings({ linearWorkspaceToolbarTool: t });
    switch (t) {
      case "search":
        openLinearQuickOpen();
        break;
      case "refresh":
        if (loading) return;
        void loadAll();
        break;
      case "settings":
        toggleLinear();
        useAppStore.getState().toggleSettings();
        break;
    }
    setLinearToolsMenuOpen(false);
  };

  const handleSubmitProjectUpdate = useCallback(
    async (body: string) => {
      const key = apiKey.trim();
      if (!key) {
        setComposerSubmitError("Add your Personal API key in Settings.");
        return false;
      }
      if (!scopeProjectId) {
        setComposerSubmitError("Select a project.");
        return false;
      }
      setComposerSubmitError(null);
      const res = await linearCreateProjectUpdate(key, {
        projectId: scopeProjectId,
        body,
      });
      if (res.errors?.length) {
        setComposerSubmitError(res.errors.map((e) => e.message).join("; "));
        return false;
      }
      if (res.projectUpdate) {
        setProjectUpdates((prev) => [res.projectUpdate!, ...prev]);
        addToast({
          id: crypto.randomUUID(),
          type: "info",
          message: "Project update posted",
        });
        return true;
      }
      return false;
    },
    [addToast, apiKey, scopeProjectId],
  );

  const handleSubmitTicket = useCallback(
    async (input: {
      title: string;
      description: string;
      teamId: string;
      priority: number;
    }) => {
      const key = apiKey.trim();
      const e2eCreatedIssue = e2eIssueCreateResponse.current;
      if (!key && !e2eCreatedIssue) {
        setComposerSubmitError("Add your Personal API key in Settings.");
        return false;
      }
      if (!input.teamId) {
        setComposerSubmitError("Select a team.");
        return false;
      }
      setComposerSubmitError(null);
      const projectId = scopeProjectId.trim();
      const res = e2eCreatedIssue
        ? { issue: e2eCreatedIssue }
        : await linearCreateIssue(key, {
            teamId: input.teamId,
            title: input.title,
            description: input.description || undefined,
            ...(projectId ? { projectId } : {}),
            priority: input.priority,
          });
      if (res.errors?.length) {
        setComposerSubmitError(res.errors.map((e) => e.message).join("; "));
        return false;
      }
      if (res.issue) {
        const created = res.issue;
        let copiedToClipboard = false;
        let clipboardError: string | null = null;
        if (
          settings.linearCopyCreatedIssueToClipboard &&
          created.url.trim()
        ) {
          try {
            await navigator.clipboard.writeText(created.url);
            copiedToClipboard = true;
          } catch (err) {
            clipboardError =
              err instanceof Error && err.message.trim()
                ? err.message.trim()
                : "Clipboard write failed";
          }
        }
        setTicketIssues((prev) => [created, ...prev]);
        addToast({
          id: crypto.randomUUID(),
          type: "info",
          message: copiedToClipboard
            ? `Created ${created.identifier} and copied link`
            : `Created ${created.identifier}`,
          action: {
            label: "Open agent",
            onClick: () => {
              void startLinearIssueAgentSession(created);
            },
          },
        });
        if (clipboardError) {
          addToast({
            id: crypto.randomUUID(),
            type: "warning",
            message: `Created ${created.identifier}, but couldn’t copy link: ${clipboardError}`,
          });
        }
        return true;
      }
      return false;
    },
    [
      addToast,
      apiKey,
      scopeProjectId,
      settings.linearCopyCreatedIssueToClipboard,
      startLinearIssueAgentSession,
    ],
  );

  const linearTabOrder = normalizeLinearWorkspaceTabOrder(
    settings.linearWorkspaceTabOrder,
  );

  const workspacePillTabs = useMemo(
    () =>
      linearTabOrder.map((id) => {
        if (id === "issues") {
          return {
            id,
            label: "Issues",
            icon: <ListBullets weight="duotone" aria-hidden />,
          };
        }
        if (id === "tickets") {
          return {
            id,
            label: "Tickets",
            icon: <Ticket weight="duotone" aria-hidden />,
          };
        }
        return {
          id,
          label: "Updates",
          icon: <PaperPlaneTilt weight="duotone" aria-hidden />,
        };
      }),
    [linearTabOrder],
  );

  return (
    <FloatingPanel
      variant="fullscreen"
      testId="linear-workspace-panel"
    >
      <FloatingPanel.Titlebar trafficLightPad>
        <div className={styles.headerBrand}>
          <Tooltip label="Back">
            <button
              type="button"
              className={styles.backBtn}
              onClick={toggleLinear}
              aria-label="Close Linear"
            >
              <ChevronLeft size={16} strokeWidth={2} aria-hidden />
            </button>
          </Tooltip>
          <img
            src={linearIconSrc}
            alt=""
            className={styles.brandIcon}
            width={20}
            height={20}
          />
          <span className={styles.brandTitle}>Linear</span>
        </div>
          <div className={styles.headerUser}>
            {loadError ? (
              <span className={styles.headerUserChipError} title={loadError}>
                {loadError}
              </span>
            ) : loading && apiKey.trim() ? (
              <span className={styles.headerUserChipMuted}>Loading…</span>
            ) : userLine ? (
              <span className={styles.headerUserChip} title={userLine}>
                {userLine}
              </span>
            ) : null}
          </div>
          <div className={styles.headerActions}>
            <div
              className={styles.headerToolMenu}
              ref={linearToolsMenuRef}
              data-testid="linear-header-tool-menu"
            >
              <Tooltip
                label={`Saved default: ${toolbarSavedLabel}`}
                position="bottom"
                multiline
              >
                <button
                  type="button"
                  className={styles.headerToolMenuTrigger}
                  aria-expanded={linearToolsMenuOpen}
                  aria-haspopup="listbox"
                  title="Search, refresh, or open settings"
                  onClick={() => setLinearToolsMenuOpen((o) => !o)}
                >
                  <span className={styles.headerToolMenuTriggerLabel}>
                    Actions
                  </span>
                  <span className={styles.headerToolMenuChevron} aria-hidden>
                    ▾
                  </span>
                </button>
              </Tooltip>
              {linearToolsMenuOpen ? (
                <div
                  className={styles.headerToolMenuList}
                  role="listbox"
                  aria-label="Linear actions"
                >
                  {LINEAR_HEADER_TOOLS.map(({ id, label, title }) => {
                    const refreshBusy = id === "refresh" && loading;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="option"
                        title={title}
                        aria-selected={toolbarTool === id}
                        disabled={refreshBusy}
                        className={`${styles.headerToolMenuItem} ${toolbarTool === id ? styles.headerToolMenuItemActive : ""}`}
                        onClick={() => activateLinearTool(id)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={`${styles.headerToolBtn} ${styles.headerToolBtnAccent}`}
              onClick={() => void linearOpenExternal("https://linear.app")}
            >
              Open Linear
            </button>
          </div>
      </FloatingPanel.Titlebar>

      <div className={styles.workspaceMain}>
        <LinearQuickOpen
          key={`linear-quick-open:${linearQuickOpenVisible ? "open" : "closed"}`}
          apiKey={apiKey}
          viewer={
            viewer?.id
              ? { id: viewer.id, name: viewer.name }
              : null
          }
          jumpRows={jumpRows}
          pickerUsers={pickerUsersWithViewer}
          orgUsersUnavailable={orgUsersUnavailable}
          onActivateRow={onJumpActivate}
        />
        <div className={styles.content}>
          <div
            className={styles.viewPillRow}
            title="Switch tab: ⌥⌘←/→, ⌘[/], or ⌘1–3 (order matches the pill)"
          >
            <SegmentedPill
              ariaLabel="Linear workspace view"
              tabs={workspacePillTabs}
              activeId={workspaceView}
              onChange={(id) =>
                updateSettings({
                  linearWorkspaceView: id as LinearWorkspaceView,
                })
              }
              onReorder={(nextIds) =>
                updateSettings({
                  linearWorkspaceTabOrder:
                    normalizeLinearWorkspaceTabOrder(nextIds),
                })
              }
              data-testid="linear-workspace-view-pill"
            />
          </div>
          {workspaceView === "updates" ? (
            <div className={styles.composerBand}>
              <LinearSearchComposer
                projects={projects}
                scopeProjectId={scopeProjectId}
                onScopeProjectIdChange={setScopeProjectId}
                pickerUsers={pickerUsersWithViewer}
                orgUsersUnavailable={orgUsersUnavailable}
                scopeUserId={scopeUserId}
                onScopeUserIdChange={setScopeUserId}
                projectUpdates={projectUpdates}
                updatesLoading={updatesLoading}
                updatesError={updatesError}
                selectedProjectName={scopedProjectLabel}
                worktreePathForPi={worktreePathForPi}
                submitError={composerSubmitError}
                onClearSubmitError={() => setComposerSubmitError(null)}
                onSubmitUpdate={handleSubmitProjectUpdate}
                linearApiKey={apiKey}
              />
            </div>
          ) : null}
          {workspaceView === "tickets" ? (
            <div className={styles.composerBand}>
              <LinearTicketsComposer
                projects={projects}
                scopeProjectId={scopeProjectId}
                onScopeProjectIdChange={setScopeProjectId}
                selectedProjectName={scopedProjectLabel}
                teams={linearTeams}
                scopeTeamId={ticketTeamId}
                onScopeTeamIdChange={setTicketTeamId}
                priority={ticketPriority}
                onPriorityChange={setTicketPriority}
                ticketIssues={ticketIssues}
                issuesLoading={ticketIssuesLoading}
                issuesError={ticketIssuesError}
                submitError={composerSubmitError}
                onClearSubmitError={() => setComposerSubmitError(null)}
                onSubmitTicket={handleSubmitTicket}
                projectNameForDraft={scopedProjectLabel?.trim() || "Project"}
                worktreePathForPi={worktreePathForPi}
                linearApiKey={apiKey}
              />
            </div>
          ) : null}
          {workspaceView === "issues" ? (
          <div className={styles.inner}>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>My issues</div>
              <div className={styles.filterRow}>
                <div className={styles.segment}>
                  <button
                    type="button"
                    className={`${styles.segBtn} ${settings.linearIssueScope === "assigned" ? styles.segBtnOn : ""}`}
                    onClick={() =>
                      updateSettings({ linearIssueScope: "assigned" })
                    }
                  >
                    Assigned to me
                  </button>
                  <button
                    type="button"
                    className={`${styles.segBtn} ${settings.linearIssueScope === "created" ? styles.segBtnOn : ""}`}
                    onClick={() =>
                      updateSettings({ linearIssueScope: "created" })
                    }
                  >
                    Created by me
                  </button>
                </div>
              </div>
              {issues.length === 0 ? (
                <div className={styles.empty}>
                  {apiKey.trim()
                    ? "No issues in this view."
                    : "Connect Linear in Settings."}
                </div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Title</th>
                        <th>State</th>
                        <th>Team</th>
                        <th>P</th>
                        <th
                          className={styles.tableThAgent}
                          aria-label="Coding agent"
                          title="New worktree + agent"
                        >
                          <RocketLaunch
                            size={16}
                            weight="duotone"
                            aria-hidden
                            className={styles.tableAgentHeaderIcon}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {issues.map((issue) => {
                        const linkedWorkspace = findWorkspaceForLinearIssue(
                          issue,
                          workspaces,
                        );
                        const issueIdClass = [
                          styles.issueId,
                          linkedWorkspace ? styles.issueIdLinked : "",
                          linkedWorkspace?.id === activeWorkspaceId
                            ? styles.issueIdLinkedActive
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ");
                        return (
                        <tr key={issue.id}>
                          <td>
                            <button
                              type="button"
                              className={issueIdClass}
                              data-testid={`linear-issue-id-${issue.identifier.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
                              data-workspace-linked={linkedWorkspace ? "true" : "false"}
                              onClick={() => activateIssueWorkspaceOrOpenUrl(issue)}
                              title={
                                linkedWorkspace
                                  ? `Open linked workspace: ${linkedWorkspace.name}`
                                  : `Open ${issue.identifier} in Linear`
                              }
                            >
                              {issue.identifier}
                            </button>
                          </td>
                          <td>{issue.title}</td>
                          <td>
                            <LinearIssueStateCell issue={issue} />
                          </td>
                          <td>
                            {issue.team
                              ? `${issue.team.key} · ${issue.team.name}`
                              : "—"}
                          </td>
                          <td>{priorityLabel(issue.priority)}</td>
                          <td className={styles.agentLaunchCell}>
                            <Tooltip label="New worktree and coding agent for this issue">
                              <button
                                type="button"
                                className={styles.agentLaunchBtn}
                                onClick={() =>
                                  void startLinearIssueAgentSession(issue)
                                }
                                aria-label={`Open ${issue.identifier} in coding agent`}
                              >
                                <RocketLaunch size={18} aria-hidden weight="duotone" />
                              </button>
                            </Tooltip>
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>Projects</div>
              <div className={styles.sectionHint}>
                Projects visible to your Linear API key in this workspace.
              </div>
              {projects.length === 0 ? (
                <div className={styles.empty}>No projects loaded.</div>
              ) : (
                <div className={styles.tableWrap}>
                  {projects.map((p) => (
                    <div key={p.id} className={styles.projectRow}>
                      <button
                        type="button"
                        className={styles.linkBtn}
                        style={{ textAlign: "left", flex: 1 }}
                        onClick={() => openProject(p)}
                      >
                        {p.name}
                      </button>
                      <button
                        type="button"
                        className={`${styles.star} ${favoriteIds.has(p.id) ? styles.on : ""}`}
                        title={
                          favoriteIds.has(p.id) ? "Remove favorite" : "Favorite"
                        }
                        onClick={() => toggleFavorite(p.id)}
                      >
                        {favoriteIds.has(p.id) ? "★" : "☆"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          ) : null}
        </div>
      </div>
    </FloatingPanel>
  );
}
