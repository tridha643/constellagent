import { describe, expect, test } from 'bun:test'
import type { SessionDriverEvent, SessionRef } from '@pi-gui/session-driver'
import type { TranscriptMessage } from '../shared/pi/pi-desktop-state'
import { applyTimelineEvent, type TimelineRuntimeState } from './pi-timeline'

const sessionRef: SessionRef = { workspaceId: 'workspace-1', sessionId: 'session-1' }

function runtimeState(): TimelineRuntimeState {
  return {
    runMetricsBySession: new Map(),
    runningSinceBySession: new Map(),
    activeAssistantMessageBySession: new Map(),
    activeWorkingActivityBySession: new Map(),
  }
}

function apply(events: readonly SessionDriverEvent[]): TranscriptMessage[] {
  const cache = new Map<string, TranscriptMessage[]>()
  const state = runtimeState()
  for (const event of events) {
    applyTimelineEvent(cache, event, state)
  }
  return cache.get('workspace-1:session-1') ?? []
}

describe('applyTimelineEvent generated images', () => {
  test('labels image generation tools and stores normalized image output', () => {
    const transcript = apply([
      {
        type: 'toolStarted',
        sessionRef,
        timestamp: '2026-05-23T12:00:00.000Z',
        callId: 'tool-1',
        toolName: 'generateImage',
        input: { description: 'a cabin under aurora' },
      },
      {
        type: 'toolFinished',
        sessionRef,
        timestamp: '2026-05-23T12:00:01.000Z',
        callId: 'tool-1',
        success: true,
        output: {
          status: 'success',
          value: { filePath: '/tmp/aurora.png', imageData: 'iVBORw0KGgo=' },
        },
      },
    ])

    const tool = transcript.find((item) => item.kind === 'tool')
    expect(tool).toMatchObject({
      kind: 'tool',
      toolName: 'generateImage',
      status: 'success',
      label: 'Generated image',
      detail: 'a cabin under aurora',
    })
    expect(tool?.output).toMatchObject({
      kind: 'generatedImages',
      images: [
        {
          kind: 'generatedImage',
          mimeType: 'image/png',
          data: 'iVBORw0KGgo=',
          filePath: '/tmp/aurora.png',
          name: 'aurora.png',
          prompt: 'a cabin under aurora',
        },
      ],
    })
  })

  test('keeps original output when no supported image can be extracted', () => {
    const transcript = apply([
      {
        type: 'toolStarted',
        sessionRef,
        timestamp: '2026-05-23T12:00:00.000Z',
        callId: 'tool-1',
        toolName: 'generateImage',
        input: { description: 'unsupported image' },
      },
      {
        type: 'toolFinished',
        sessionRef,
        timestamp: '2026-05-23T12:00:01.000Z',
        callId: 'tool-1',
        success: true,
        output: { content: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/heic' }] },
      },
    ])

    const tool = transcript.find((item) => item.kind === 'tool')
    expect(tool?.label).toBe('Generating image: unsupported image')
    expect(tool?.output).toEqual({
      content: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/heic' }],
    })
  })
})
