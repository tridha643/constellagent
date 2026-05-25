import { describe, expect, test } from 'bun:test'
import {
  createMobileCommandRequestSchema,
  mobileAccessStatusSchema,
  mobileCommandSchema,
  modelListParamsSchema,
  modelListResponseSchema,
} from './index'

describe('mobile protocol schemas', () => {
  test('accepts the local access status shape', () => {
    const parsed = mobileAccessStatusSchema.parse({
      enabled: true,
      running: true,
      host: '100.64.0.10',
      port: 3987,
      baseUrl: 'http://100.64.0.10:3987',
      tailscale: {
        available: true,
        hostName: 'macbook.tailnet.ts.net',
        addresses: ['100.64.0.10'],
      },
    })

    expect(parsed.tailscale.addresses).toEqual(['100.64.0.10'])
  })

  test('defaults empty command payloads', () => {
    const parsed = createMobileCommandRequestSchema.parse({
      type: 'session.cancel',
    })

    expect(parsed.payload).toEqual({})
  })

  test('rejects unsupported mobile command types', () => {
    expect(() =>
      mobileCommandSchema.parse({
        id: 'cmd_1',
        deviceId: 'device_1',
        type: 'git.push',
        payload: {},
        status: 'pending',
        policyResult: 'blocked',
        createdAt: '2026-05-24T12:00:00.000Z',
      }),
    ).toThrow()
  })

  test('accepts model.list params and response shapes', () => {
    const params = modelListParamsSchema.parse({ workspacePath: '/tmp/ws' })
    expect(params.workspacePath).toBe('/tmp/ws')

    const response = modelListResponseSchema.parse({
      items: [
        {
          id: 'claude-sonnet-4',
          model: 'claude-sonnet-4',
          displayName: 'Sonnet 4',
          isDefault: true,
        },
      ],
    })
    expect(response.items[0]?.displayName).toBe('Sonnet 4')
  })
})
