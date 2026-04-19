/** Linear GraphQL API — Personal API key auth only (v1). Requests run in the main process (see IPC). */

export interface LinearGraphQLError {
  message: string
}

function linearGraphqlBridge():
  | ((apiKey: string, query: string, variables?: Record<string, unknown>) => Promise<unknown>)
  | null {
  const w = window.api
  if (typeof w.linearGraphql === 'function') return w.linearGraphql.bind(w)
  if (typeof w.app?.linearGraphql === 'function') return w.app.linearGraphql.bind(w.app)
  return null
}

const STALE_PRELOAD_HINT =
  'Linear API bridge is missing. Fully quit Constellagent (⌘Q) and reopen, or Settings → Relaunch, so the latest preload loads.'

export async function linearGraphQL<T>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ data?: T; errors?: LinearGraphQLError[] }> {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    return { errors: [{ message: 'Missing Linear API key. Add one in Settings.' }] }
  }

  const invoke = linearGraphqlBridge()
  if (!invoke) {
    return { errors: [{ message: STALE_PRELOAD_HINT }] }
  }

  // Always via main: renderer `fetch` to api.linear.app fails with CORS ("Failed to fetch").
  const json = (await invoke(trimmed, query, variables)) as {
    data?: T
    errors?: LinearGraphQLError[]
  }
  return json
}

export const Q_VIEWER = `query LinearViewer {
  viewer { id name email }
}`

export const Q_ASSIGNED_ISSUES = `query LinearAssignedIssues {
  viewer {
    assignedIssues(first: 80, orderBy: updatedAt) {
      nodes {
        id
        identifier
        title
        url
        priority
        createdAt
        updatedAt
        state { name type }
        team { key name }
        project { id name }
        assignee { id name }
        creator { id name }
      }
    }
  }
}`

export const Q_CREATED_ISSUES = `query LinearCreatedIssues {
  issues(filter: { creator: { isMe: { eq: true } } }, first: 80, orderBy: updatedAt) {
    nodes {
      id
      identifier
      title
      url
      priority
      createdAt
      updatedAt
      state { name type }
      team { key name }
      project { id name }
      assignee { id name }
      creator { id name }
    }
  }
}`

/** All projects visible to the API key in the workspace (not limited to member/lead). */
export const Q_PROJECTS_ACCESSIBLE = `query LinearProjectsAccessible {
  projects(first: 250) {
    nodes {
      id
      name
      slugId
      url
      teams(first: 24) {
        nodes {
          key
          name
        }
      }
    }
  }
}`

export const Q_ORGANIZATION_NAME = `query LinearOrganizationName {
  organization {
    name
  }
}`

/** Workspace search (Quick Open): issues whose title matches substring. */
export const Q_SEARCH_ISSUES = `query LinearSearchIssues($q: String!) {
  issues(filter: { title: { containsIgnoreCase: $q } }, first: 40) {
    nodes {
      id
      identifier
      title
      url
      priority
      createdAt
      updatedAt
      state { name type }
      team { key name }
      project { id name }
      assignee { id name }
      creator { id name }
    }
  }
}`

/** Quick Open: title match among issues assigned to the API key user. */
export const Q_SEARCH_ISSUES_ASSIGNED_ME = `query LinearSearchIssuesAssignedMe($q: String!) {
  issues(
    filter: { title: { containsIgnoreCase: $q }, assignee: { isMe: { eq: true } } },
    first: 40
  ) {
    nodes {
      id
      identifier
      title
      url
      priority
      createdAt
      updatedAt
      state { name type }
      team { key name }
      project { id name }
      assignee { id name }
      creator { id name }
    }
  }
}`

/** Quick Open: title match among issues created by the API key user. */
export const Q_SEARCH_ISSUES_CREATED_ME = `query LinearSearchIssuesCreatedMe($q: String!) {
  issues(
    filter: { title: { containsIgnoreCase: $q }, creator: { isMe: { eq: true } } },
    first: 40
  ) {
    nodes {
      id
      identifier
      title
      url
      priority
      createdAt
      updatedAt
      state { name type }
      team { key name }
      project { id name }
      assignee { id name }
      creator { id name }
    }
  }
}`

/** Workspace search (Quick Open): projects whose name matches substring. */
export const Q_SEARCH_PROJECTS = `query LinearSearchProjects($q: String!) {
  projects(filter: { name: { containsIgnoreCase: $q } }, first: 40) {
    nodes {
      id
      name
      slugId
      url
      teams(first: 24) {
        nodes {
          key
          name
        }
      }
    }
  }
}`

/** Bulk issues for member/lead projects (Cmd+F synthetic index coverage). */
export const Q_ISSUES_FOR_PROJECT_IDS = `query LinearIssuesForProjectIds($ids: [ID!]!) {
  issues(filter: { project: { id: { in: $ids } } }, first: 250, orderBy: updatedAt) {
    nodes {
      id
      identifier
      title
      url
      priority
      createdAt
      updatedAt
      state { name type }
      team { key name }
      project { id name }
      assignee { id name }
      creator { id name }
    }
  }
}`

export const Q_ORG_USERS = `query LinearOrgUsers {
  organization {
    users(first: 100) {
      nodes {
        id
        name
        displayName
      }
    }
  }
}`

export const Q_PROJECT_UPDATES = `query LinearProjectUpdates($id: String!) {
  project(id: $id) {
    id
    name
    projectUpdates(first: 30) {
      nodes {
        id
        createdAt
        updatedAt
        health
        body
        url
        user { id name displayName }
      }
    }
  }
}`

/** On-demand project doc for Pi drafts (not included in bulk project lists). */
export const Q_PROJECT_DRAFT_CONTEXT = `query LinearProjectDraftContext($id: String!) {
  project(id: $id) {
    id
    description
    content
  }
}`

/** Truncate long project document markdown before IPC / prompts. */
const MAX_PROJECT_DRAFT_CONTENT_CHARS = 16_000

export type LinearProjectDraftContext = {
  description: string | null
  contentMarkdown: string | null
}

/**
 * Fetches Linear project description and markdown document for Pi grounding.
 * Returns null fields on GraphQL errors, missing project, or empty values.
 */
export async function linearFetchProjectDraftContext(
  apiKey: string,
  projectId: string,
): Promise<LinearProjectDraftContext> {
  const id = projectId.trim()
  if (!id) return { description: null, contentMarkdown: null }

  const res = await linearGraphQL<{
    project: { id: string; description?: string | null; content?: string | null } | null
  }>(apiKey, Q_PROJECT_DRAFT_CONTEXT, { id })

  if (res.errors?.length) {
    return { description: null, contentMarkdown: null }
  }

  const p = res.data?.project
  if (!p) return { description: null, contentMarkdown: null }

  const description = (p.description ?? '').trim() || null
  let rawContent = (p.content ?? '').trim()
  if (rawContent.length > MAX_PROJECT_DRAFT_CONTENT_CHARS) {
    rawContent = `${rawContent.slice(0, MAX_PROJECT_DRAFT_CONTENT_CHARS)}\n\n…(truncated)`
  }
  const contentMarkdown = rawContent.length > 0 ? rawContent : null

  return { description, contentMarkdown }
}

export const M_PROJECT_UPDATE_CREATE = `mutation LinearProjectUpdateCreate($input: ProjectUpdateCreateInput!) {
  projectUpdateCreate(input: $input) {
    success
    projectUpdate {
      id
      createdAt
      updatedAt
      health
      body
      url
      user { id name displayName }
    }
  }
}`

export const Q_TEAMS = `query LinearTeams {
  teams(first: 100) {
    nodes {
      id
      key
      name
    }
  }
}`

export const M_ISSUE_CREATE = `mutation LinearIssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      title
      url
      priority
      state { name type }
      team { key name }
      project { id name }
      assignee { id name }
      creator { id name }
    }
  }
}`

export type ProjectUpdateHealthApi = 'onTrack' | 'atRisk' | 'offTrack'

export type LinearIssueNode = {
  id: string
  identifier: string
  title: string
  url: string
  priority?: number
  /** ISO-8601; used for Cmd+F ordering (newest of created/updated wins). */
  createdAt?: string
  updatedAt?: string
  state: { name: string; type?: string } | null
  team: { key: string; name: string } | null
  project?: { id: string; name: string } | null
  assignee?: { id: string; name: string } | null
  creator?: { id: string; name: string } | null
}

export type LinearProjectTeamSummary = {
  key: string
  name: string
}

export type LinearProjectNode = {
  id: string
  name: string
  slugId: string
  url: string
  /** Teams linked to the project (Linear API). */
  teamSummaries?: LinearProjectTeamSummary[]
  /** Workspace organization name when available (same for all projects in a typical API-key workspace). */
  organizationName?: string
}

/** Secondary line for project pickers: team keys/names and optional org. */
export function formatLinearProjectRowSubtitle(project: LinearProjectNode): string {
  const parts: string[] = []
  for (const t of project.teamSummaries ?? []) {
    const key = (t.key ?? '').trim()
    const name = (t.name ?? '').trim()
    if (key && name) parts.push(`${key} · ${name}`)
    else if (name) parts.push(name)
    else if (key) parts.push(key)
  }
  const org = project.organizationName?.trim()
  if (org) parts.push(org)
  return parts.join(' · ')
}

type LinearProjectGraphqlNode = {
  id: string
  name: string
  slugId: string
  url: string
  teams?: { nodes?: { key: string; name: string }[] | null } | null
}

function mapGraphqlProjectNode(
  raw: LinearProjectGraphqlNode,
  organizationName?: string | null,
): LinearProjectNode {
  const nodes = raw.teams?.nodes?.filter(Boolean) ?? []
  const teamSummaries: LinearProjectTeamSummary[] = nodes.map((t) => ({
    key: t.key ?? '',
    name: t.name ?? '',
  }))
  const out: LinearProjectNode = {
    id: raw.id,
    name: raw.name,
    slugId: raw.slugId,
    url: raw.url,
  }
  if (teamSummaries.length > 0) out.teamSummaries = teamSummaries
  const o = organizationName?.trim()
  if (o) out.organizationName = o
  return out
}

export type LinearUserNode = {
  id: string
  name: string
  displayName?: string
}

/** Ensure the authenticated viewer appears in person pickers when org directory omitted them. */
export function linearUserPickerWithViewer(
  viewer: { id: string; name: string; email?: string } | null,
  users: LinearUserNode[],
): LinearUserNode[] {
  if (!viewer?.id) return users
  if (users.some((u) => u.id === viewer.id)) return users
  return [{ id: viewer.id, name: viewer.name, displayName: viewer.name.trim() || viewer.name }, ...users]
}

export type LinearProjectUpdateNode = {
  id: string
  createdAt: string
  updatedAt: string
  health?: string | null
  body?: string | null
  url: string
  user: { id: string; name: string; displayName?: string } | null
}

export type LinearTeamNode = {
  id: string
  key: string
  name: string
}

export async function linearFetchViewer(apiKey: string) {
  return linearGraphQL<{ viewer: { id: string; name: string; email?: string } }>(apiKey, Q_VIEWER)
}

export async function linearFetchAssignedIssues(apiKey: string) {
  return linearGraphQL<{ viewer: { assignedIssues: { nodes: LinearIssueNode[] } } }>(
    apiKey,
    Q_ASSIGNED_ISSUES,
  )
}

export async function linearFetchCreatedIssues(apiKey: string) {
  return linearGraphQL<{ issues: { nodes: LinearIssueNode[] } }>(apiKey, Q_CREATED_ISSUES)
}

/**
 * Projects the authenticated API key can access in the workspace (org-scoped per Linear).
 */
export async function linearFetchProjects(apiKey: string): Promise<{
  projects: LinearProjectNode[]
  errors?: LinearGraphQLError[]
}> {
  const [projRes, orgRes] = await Promise.all([
    linearGraphQL<{ projects: { nodes: LinearProjectGraphqlNode[] } }>(apiKey, Q_PROJECTS_ACCESSIBLE),
    linearGraphQL<{ organization: { name: string } | null }>(apiKey, Q_ORGANIZATION_NAME),
  ])

  const errors: LinearGraphQLError[] = [...(projRes.errors ?? []), ...(orgRes.errors ?? [])]
  const orgName = orgRes.data?.organization?.name ?? null
  const rawNodes = projRes.data?.projects?.nodes ?? []
  const projects = rawNodes.map((n) => mapGraphqlProjectNode(n, orgName))

  if (projects.length > 0) {
    return errors.length ? { projects, errors } : { projects }
  }

  if (errors.length) {
    return { projects: [], errors }
  }
  return { projects: [] }
}

const SEARCH_QUERY_MIN_LEN = 2

function mergeIssueNodesDedupe(a: LinearIssueNode[], b: LinearIssueNode[]): LinearIssueNode[] {
  const m = new Map<string, LinearIssueNode>()
  for (const x of a) m.set(x.id, x)
  for (const x of b) {
    if (!m.has(x.id)) m.set(x.id, x)
  }
  return [...m.values()].slice(0, 40)
}

/**
 * Workspace issue title search for Cmd+F.
 * @param audience `mine` — assigned-to-me or created-by-me (default); `workspace` — any issue in the workspace.
 */
export async function linearSearchIssues(
  apiKey: string,
  q: string,
  options?: { audience?: 'mine' | 'workspace' },
): Promise<{
  issues: LinearIssueNode[]
  errors?: LinearGraphQLError[]
}> {
  const trimmed = q.trim()
  if (trimmed.length < SEARCH_QUERY_MIN_LEN) {
    return { issues: [] }
  }
  const audience = options?.audience ?? 'mine'

  if (audience === 'workspace') {
    const res = await linearGraphQL<{ issues: { nodes: LinearIssueNode[] } }>(apiKey, Q_SEARCH_ISSUES, {
      q: trimmed,
    })
    if (res.errors?.length) {
      return { issues: [], errors: res.errors }
    }
    return { issues: res.data?.issues?.nodes ?? [] }
  }

  const [assignedRes, createdRes] = await Promise.all([
    linearGraphQL<{ issues: { nodes: LinearIssueNode[] } }>(apiKey, Q_SEARCH_ISSUES_ASSIGNED_ME, {
      q: trimmed,
    }),
    linearGraphQL<{ issues: { nodes: LinearIssueNode[] } }>(apiKey, Q_SEARCH_ISSUES_CREATED_ME, {
      q: trimmed,
    }),
  ])
  const errList = [...(assignedRes.errors ?? []), ...(createdRes.errors ?? [])]
  const nodesA = assignedRes.data?.issues?.nodes ?? []
  const nodesB = createdRes.data?.issues?.nodes ?? []
  const issues = mergeIssueNodesDedupe(nodesA, nodesB)
  if (errList.length && nodesA.length === 0 && nodesB.length === 0) {
    return { issues: [], errors: errList }
  }
  return errList.length ? { issues, errors: errList } : { issues }
}

export async function linearSearchProjects(apiKey: string, q: string): Promise<{
  projects: LinearProjectNode[]
  errors?: LinearGraphQLError[]
}> {
  const trimmed = q.trim()
  if (trimmed.length < SEARCH_QUERY_MIN_LEN) {
    return { projects: [] }
  }
  const [res, orgRes] = await Promise.all([
    linearGraphQL<{ projects: { nodes: LinearProjectGraphqlNode[] } }>(apiKey, Q_SEARCH_PROJECTS, {
      q: trimmed,
    }),
    linearGraphQL<{ organization: { name: string } | null }>(apiKey, Q_ORGANIZATION_NAME),
  ])
  if (res.errors?.length) {
    return { projects: [], errors: res.errors }
  }
  const orgName = orgRes.data?.organization?.name ?? null
  const nodes = res.data?.projects?.nodes ?? []
  const projects = nodes.map((n) => mapGraphqlProjectNode(n, orgName))
  const orgErr = orgRes.errors?.length ? orgRes.errors : undefined
  return orgErr ? { projects, errors: orgErr } : { projects }
}

/** Issues belonging to any of the given projects (for expanding local Cmd+F index). */
export async function linearFetchIssuesForProjectIds(
  apiKey: string,
  projectIds: string[],
): Promise<{ issues: LinearIssueNode[]; errors?: LinearGraphQLError[] }> {
  const ids = projectIds.filter(Boolean).slice(0, 50)
  if (ids.length === 0) {
    return { issues: [] }
  }
  const res = await linearGraphQL<{ issues: { nodes: LinearIssueNode[] } }>(
    apiKey,
    Q_ISSUES_FOR_PROJECT_IDS,
    { ids },
  )
  if (res.errors?.length) {
    return { issues: [], errors: res.errors }
  }
  return { issues: res.data?.issues?.nodes ?? [] }
}

export async function linearFetchOrgUsers(apiKey: string): Promise<{
  users: LinearUserNode[]
  errors?: LinearGraphQLError[]
}> {
  const res = await linearGraphQL<{
    organization: { users: { nodes: LinearUserNode[] } } | null
  }>(apiKey, Q_ORG_USERS)

  if (res.errors?.length) {
    return { users: [], errors: res.errors }
  }
  const nodes = res.data?.organization?.users?.nodes ?? []
  return { users: nodes.filter(Boolean) }
}

export async function linearFetchProjectUpdates(
  apiKey: string,
  projectId: string,
): Promise<{
  updates: LinearProjectUpdateNode[]
  projectName?: string
  errors?: LinearGraphQLError[]
}> {
  const res = await linearGraphQL<{
    project: {
      id: string
      name: string
      projectUpdates: { nodes: LinearProjectUpdateNode[] }
    } | null
  }>(apiKey, Q_PROJECT_UPDATES, { id: projectId })

  if (res.errors?.length) {
    return { updates: [], errors: res.errors }
  }
  const proj = res.data?.project
  if (!proj) {
    return { updates: [], errors: [{ message: 'Project not found or not accessible.' }] }
  }
  return {
    updates: proj.projectUpdates?.nodes ?? [],
    projectName: proj.name,
  }
}

export async function linearCreateProjectUpdate(
  apiKey: string,
  input: {
    projectId: string
    body: string
    health?: ProjectUpdateHealthApi | null
  },
): Promise<{
  projectUpdate?: LinearProjectUpdateNode
  errors?: LinearGraphQLError[]
}> {
  const trimmedBody = input.body.trim()
  if (!trimmedBody) {
    return { errors: [{ message: 'Update body cannot be empty.' }] }
  }

  type CreatePayload = {
    projectUpdateCreate: {
      success: boolean
      projectUpdate: LinearProjectUpdateNode | null
    } | null
  }

  const variables: Record<string, unknown> = {
    input: {
      projectId: input.projectId,
      body: trimmedBody,
    },
  }
  if (input.health != null) {
    ;(variables.input as Record<string, unknown>).health = input.health
  }

  const res = await linearGraphQL<CreatePayload>(apiKey, M_PROJECT_UPDATE_CREATE, variables)

  if (res.errors?.length) {
    return { errors: res.errors }
  }
  const payload = res.data?.projectUpdateCreate
  if (!payload?.success || !payload.projectUpdate) {
    return {
      errors: [{ message: 'Linear did not return a project update. Check permissions or project access.' }],
    }
  }
  return { projectUpdate: payload.projectUpdate }
}

export async function linearFetchTeams(apiKey: string): Promise<{
  teams: LinearTeamNode[]
  errors?: LinearGraphQLError[]
}> {
  const res = await linearGraphQL<{ teams: { nodes: LinearTeamNode[] } }>(apiKey, Q_TEAMS)
  if (res.errors?.length) {
    return { teams: [], errors: res.errors }
  }
  return { teams: res.data?.teams?.nodes ?? [] }
}

/** Linear priority: 0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low */
export async function linearCreateIssue(
  apiKey: string,
  input: {
    teamId: string
    title: string
    description?: string | null
    projectId?: string | null
    /** 0–4; omit or undefined = default team behavior */
    priority?: number | null
  },
): Promise<{
  issue?: LinearIssueNode
  errors?: LinearGraphQLError[]
}> {
  const trimmedTitle = input.title.trim()
  if (!trimmedTitle) {
    return { errors: [{ message: 'Issue title cannot be empty.' }] }
  }
  const teamId = input.teamId.trim()
  if (!teamId) {
    return { errors: [{ message: 'Team is required to create an issue.' }] }
  }

  type CreatePayload = {
    issueCreate: {
      success: boolean
      issue: LinearIssueNode | null
    } | null
  }

  const issueInput: Record<string, unknown> = {
    teamId,
    title: trimmedTitle,
  }
  if (input.description != null && String(input.description).trim()) {
    issueInput.description = String(input.description).trim()
  }
  if (input.projectId?.trim()) {
    issueInput.projectId = input.projectId.trim()
  }
  if (input.priority != null && input.priority >= 0 && input.priority <= 4) {
    issueInput.priority = input.priority
  }

  const res = await linearGraphQL<CreatePayload>(apiKey, M_ISSUE_CREATE, {
    input: issueInput,
  })

  if (res.errors?.length) {
    return { errors: res.errors }
  }
  const payload = res.data?.issueCreate
  if (!payload?.success || !payload.issue) {
    return {
      errors: [{ message: 'Linear did not return an issue. Check permissions, team, or project access.' }],
    }
  }
  return { issue: payload.issue }
}

export async function linearOpenExternal(url: string): Promise<void> {
  await window.api.app.openExternal(url)
}
