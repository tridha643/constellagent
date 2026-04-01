import * as http from 'http'
import type { Settings } from '../renderer/store/types'
import type { SendBlueStatus } from '../shared/orchestrator-types'

const SENDBLUE_API_URL = 'https://api.sendblue.co/api/send-message'

export class SendBlueService {
  private server: http.Server | null = null
  private apiKey: string = ''
  private phoneNumber: string = ''
  private webhookUrl: string = ''
  private webhookPort: number = 3847

  /** Called by the orchestrator when an inbound SMS/iMessage arrives via webhook. */
  onMessage: ((from: string, content: string) => void) | null = null

  async start(settings: Settings): Promise<void> {
    this.apiKey = settings.sendblueApiKey
    this.phoneNumber = settings.sendbluePhoneNumber
    this.webhookUrl = settings.sendblueWebhookUrl
    this.webhookPort = settings.sendblueWebhookPort

    if (this.server) {
      await this.stop()
    }

    this.server = http.createServer((req, res) => {
      if (req.method === 'POST') {
        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', () => {
          try {
            const payload = JSON.parse(body)
            const from = payload.from_number || payload.from || ''
            const content = payload.content || payload.body || ''
            if (from && content && this.onMessage) {
              this.onMessage(from, content)
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'invalid JSON' }))
          }
        })
      } else {
        // Health check
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', service: 'constellagent-sendblue-webhook' }))
      }
    })

    return new Promise<void>((resolve, reject) => {
      this.server!.listen(this.webhookPort, () => {
        console.log(`[sendblue] Webhook server listening on port ${this.webhookPort}`)
        resolve()
      })
      this.server!.on('error', (err) => {
        console.error('[sendblue] Webhook server error:', err)
        reject(err)
      })
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return
    return new Promise<void>((resolve) => {
      this.server!.close(() => {
        console.log('[sendblue] Webhook server stopped')
        this.server = null
        resolve()
      })
    })
  }

  async send(to: string, message: string): Promise<void> {
    if (!this.apiKey) throw new Error('SendBlue API key not configured')

    const resp = await fetch(SENDBLUE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'sb-api-key-id': this.apiKey,
        'sb-api-secret-key': this.apiKey,
      },
      body: JSON.stringify({
        number: to,
        content: message,
      }),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`SendBlue API error ${resp.status}: ${text}`)
    }
  }

  status(): SendBlueStatus {
    return {
      connected: this.server !== null,
      webhookUrl: this.webhookUrl || null,
      phoneNumber: this.phoneNumber || null,
    }
  }

  destroy(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }
}
