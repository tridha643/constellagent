import { describe, expect, it } from 'bun:test'
import { parseGithubUrl } from './github-url'

describe('parseGithubUrl', () => {
  it('parses https URLs with and without .git suffix', () => {
    const a = parseGithubUrl('https://github.com/anthropics/anthropic-sdk-python')
    expect(a).not.toBeNull()
    expect(a?.owner).toBe('anthropics')
    expect(a?.name).toBe('anthropic-sdk-python')
    expect(a?.cloneUrl).toBe('https://github.com/anthropics/anthropic-sdk-python.git')

    const b = parseGithubUrl('https://github.com/anthropics/anthropic-sdk-python.git')
    expect(b?.cloneUrl).toBe('https://github.com/anthropics/anthropic-sdk-python.git')
  })

  it('parses http URLs', () => {
    const res = parseGithubUrl('http://github.com/a/b.git')
    expect(res?.owner).toBe('a')
    expect(res?.name).toBe('b')
    expect(res?.cloneUrl).toBe('https://github.com/a/b.git')
  })

  it('preserves SSH URLs verbatim and appends .git when missing', () => {
    const a = parseGithubUrl('git@github.com:anthropics/anthropic-sdk-python.git')
    expect(a?.owner).toBe('anthropics')
    expect(a?.cloneUrl).toBe('git@github.com:anthropics/anthropic-sdk-python.git')

    const b = parseGithubUrl('git@github.com:anthropics/anthropic-sdk-python')
    expect(b?.cloneUrl).toBe('git@github.com:anthropics/anthropic-sdk-python.git')
  })

  it('parses ssh:// URLs', () => {
    const res = parseGithubUrl('ssh://git@github.com/anthropics/repo.git')
    expect(res?.owner).toBe('anthropics')
    expect(res?.name).toBe('repo')
    // ssh:// URLs get normalized to HTTPS since we prefer the credential helper path.
    expect(res?.cloneUrl).toBe('https://github.com/anthropics/repo.git')
  })

  it('parses owner/repo shorthand', () => {
    const res = parseGithubUrl('anthropics/anthropic-sdk-python')
    expect(res?.owner).toBe('anthropics')
    expect(res?.name).toBe('anthropic-sdk-python')
    expect(res?.cloneUrl).toBe('https://github.com/anthropics/anthropic-sdk-python.git')
  })

  it('parses github.com/owner/repo without a scheme', () => {
    const res = parseGithubUrl('github.com/anthropics/repo')
    expect(res?.owner).toBe('anthropics')
    expect(res?.name).toBe('repo')
  })

  it('handles mixed-case hostname', () => {
    const res = parseGithubUrl('https://GitHub.com/Anthropics/anthropic-sdk-python.git')
    expect(res?.owner).toBe('Anthropics')
    expect(res?.name).toBe('anthropic-sdk-python')
  })

  it('handles trailing slashes and extra path segments', () => {
    const res = parseGithubUrl('https://github.com/anthropics/anthropic-sdk-python/')
    expect(res?.owner).toBe('anthropics')
    expect(res?.name).toBe('anthropic-sdk-python')
  })

  it('rejects non-github hosts', () => {
    expect(parseGithubUrl('https://gitlab.com/a/b')).toBeNull()
    expect(parseGithubUrl('https://bitbucket.org/a/b')).toBeNull()
    expect(parseGithubUrl('ssh://git@gitlab.com/a/b.git')).toBeNull()
    expect(parseGithubUrl('git@gitlab.com:a/b.git')).toBeNull()
  })

  it('rejects malformed input', () => {
    expect(parseGithubUrl('')).toBeNull()
    expect(parseGithubUrl('   ')).toBeNull()
    expect(parseGithubUrl('not a url')).toBeNull()
    expect(parseGithubUrl('https://github.com/onlyowner')).toBeNull()
    expect(parseGithubUrl('https://github.com/')).toBeNull()
  })

  it('sanitizes suggestedName to lowercase kebab', () => {
    const res = parseGithubUrl('anthropics/My_Fancy.Repo')
    expect(res?.name).toBe('My_Fancy.Repo')
    expect(res?.suggestedName).toBe('my_fancy-repo')
  })

  it('trims whitespace', () => {
    const res = parseGithubUrl('  anthropics/repo  ')
    expect(res?.owner).toBe('anthropics')
    expect(res?.name).toBe('repo')
  })
})
