/** A GitHub repository row from `gh repo list` or `gh search repos` (for clone UI). */
export interface GithubCloneRepoSuggestion {
  fullName: string
  webUrl: string
}
