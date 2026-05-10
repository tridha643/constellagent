import { describe, expect, test } from 'bun:test'
import { webhookSubscriptionCompareKey } from './composio-webhook-subscriptions'

describe('webhookSubscriptionCompareKey', () => {
  test('matches URLs that differ only by query param order', () => {
    const a = 'https://ex.ngrok.app/webhooks/composio?secret=abc&x=1'
    const b = 'https://ex.ngrok.app/webhooks/composio?x=1&secret=abc'
    expect(webhookSubscriptionCompareKey(a)).toBe(webhookSubscriptionCompareKey(b))
  })

  test('normalizes trailing slashes on path', () => {
    const a = 'https://ex.ngrok.app/webhooks/composio/'
    const b = 'https://ex.ngrok.app/webhooks/composio'
    expect(webhookSubscriptionCompareKey(a)).toBe(webhookSubscriptionCompareKey(b))
  })

  test('treats distinct secrets as different URLs', () => {
    const a = 'https://ex.ngrok.app/hooks?secret=a'
    const b = 'https://ex.ngrok.app/hooks?secret=b'
    expect(webhookSubscriptionCompareKey(a)).not.toBe(webhookSubscriptionCompareKey(b))
  })
})
