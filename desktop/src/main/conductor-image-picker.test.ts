import { afterEach, describe, expect, mock, test } from 'bun:test'

const readFileMock = mock(async () => Buffer.from('png-bytes'))
const showOpenDialogMock = mock(async () => ({
  canceled: false,
  filePaths: ['/tmp/screenshot.png'],
}))

mock.module('node:fs/promises', () => ({
  readFile: readFileMock,
}))

mock.module('electron', () => ({
  dialog: {
    showOpenDialog: showOpenDialogMock,
  },
}))

const { pickConductorImageAttachments } = await import('./conductor-image-picker')

describe('pickConductorImageAttachments', () => {
  afterEach(() => {
    readFileMock.mockClear()
    showOpenDialogMock.mockClear()
  })

  test('returns attachments read in main process', async () => {
    const result = await pickConductorImageAttachments()

    expect(showOpenDialogMock).toHaveBeenCalledTimes(1)
    expect(readFileMock).toHaveBeenCalledWith('/tmp/screenshot.png')
    expect(result.attachments).toHaveLength(1)
    expect(result.attachments[0]?.name).toBe('screenshot.png')
    expect(result.attachments[0]?.mimeType).toBe('image/png')
    expect(result.attachments[0]?.data).toBe(Buffer.from('png-bytes').toString('base64'))
  })

  test('returns empty result when dialog is canceled', async () => {
    showOpenDialogMock.mockResolvedValueOnce({ canceled: true, filePaths: [] })

    const result = await pickConductorImageAttachments()

    expect(result.attachments).toEqual([])
    expect(result.error).toBeUndefined()
  })

  test('surfaces oversize rejection', async () => {
    readFileMock.mockResolvedValueOnce(Buffer.alloc(21 * 1024 * 1024))

    const result = await pickConductorImageAttachments()

    expect(result.attachments).toEqual([])
    expect(result.error).toContain('20 MB')
  })
})
