import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/app-store'
import type {
  MobileConnectionSnapshot,
  MobilePairingPayloadResult,
  MobileTrustedPhoneSummary,
  MobileUsbIosDevice,
} from '../../../shared/mobile-settings-types'
import styles from './SettingsPanel.module.css'

function formatExpiry(expiresAtMs?: number): string {
  if (!expiresAtMs) return 'No active code'
  const remainingMs = expiresAtMs - Date.now()
  if (remainingMs <= 0) return 'Expired'
  const minutes = Math.floor(remainingMs / 60_000)
  const seconds = Math.floor((remainingMs % 60_000) / 1000)
  return `${minutes}m ${seconds}s remaining`
}

export function MobileSettingsSection() {
  const addToast = useAppStore((s) => s.addToast)
  const [status, setStatus] = useState<MobileConnectionSnapshot | null>(null)
  const [usbDevices, setUsbDevices] = useState<MobileUsbIosDevice[]>([])
  const [trustedDevices, setTrustedDevices] = useState<MobileTrustedPhoneSummary[]>([])
  const [selectedUdid, setSelectedUdid] = useState('')
  const [pairing, setPairing] = useState<MobilePairingPayloadResult | null>(null)
  const [busy, setBusy] = useState<'qr' | 'code' | 'connect' | 'update' | null>(null)
  const [lastDeployMessage, setLastDeployMessage] = useState<string | null>(null)
  const [, setTick] = useState(0)

  const refreshStatus = useCallback(async () => {
    const [statusResult, trustedResult, usbResult] = await Promise.allSettled([
      window.api.mobile.getStatus(),
      window.api.mobile.listTrustedDevices(),
      window.api.mobile.listUsbDevices(),
    ])

    if (statusResult.status === 'fulfilled') {
      setStatus(statusResult.value)
    }
    if (trustedResult.status === 'fulfilled') {
      setTrustedDevices(trustedResult.value)
    }
    if (usbResult.status === 'fulfilled') {
      const nextUsb = usbResult.value
      setUsbDevices(nextUsb)
      setSelectedUdid((current) => {
        if (current && nextUsb.some((device) => device.udid === current)) return current
        return nextUsb[0]?.udid ?? ''
      })
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
    const timer = window.setInterval(() => {
      void refreshStatus()
    }, 4000)
    return () => window.clearInterval(timer)
  }, [refreshStatus])

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const bridgeStatusLabel = useMemo(() => {
    if (!status?.enabled) return 'Disabled'
    if (!status.running) return 'Not running'
    if ((status.connectedSecureChannels ?? 0) > 0) return 'Phone connected'
    if ((status.websocketConnections ?? 0) > 0) return 'Handshaking'
    return 'Waiting for phone'
  }, [status])

  const bridgeStatusClass = useMemo(() => {
    if (!status?.enabled || !status.running) return styles.statusPill
    if ((status.connectedSecureChannels ?? 0) > 0) return styles.statusPillOk
    if ((status.websocketConnections ?? 0) > 0) return styles.statusPillWarn
    return styles.statusPill
  }, [status])

  const activePairingCode = pairing?.shortCode ?? status?.pairingCode
  const activePairingExpiresAt = pairing?.expiresAt ?? status?.pairingCodeExpiresAt

  const generatePairing = useCallback(async () => {
    setBusy('qr')
    try {
      const next = await window.api.mobile.createPairingPayload()
      setPairing(next)
      await refreshStatus()
      addToast({
        id: crypto.randomUUID(),
        message: `Pairing code ${next.shortCode} ready (expires in 5 minutes).`,
        type: 'info',
      })
      return next
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addToast({ id: crypto.randomUUID(), message, type: 'error' })
      return null
    } finally {
      setBusy(null)
    }
  }, [addToast, refreshStatus])

  const copyPairingCode = useCallback(async () => {
    setBusy('code')
    try {
      let code = pairing?.shortCode ?? status?.pairingCode
      if (!code) {
        const next = await window.api.mobile.createPairingPayload()
        setPairing(next)
        code = next.shortCode
        await refreshStatus()
      }
      if (!code) {
        addToast({
          id: crypto.randomUUID(),
          message: 'Generate a pairing code first.',
          type: 'error',
        })
        return
      }
      await navigator.clipboard.writeText(code)
      addToast({
        id: crypto.randomUUID(),
        message: `Copied pairing code ${code}.`,
        type: 'info',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addToast({ id: crypto.randomUUID(), message, type: 'error' })
    } finally {
      setBusy(null)
    }
  }, [addToast, pairing, refreshStatus, status?.pairingCode])

  const runDeploy = useCallback(
    async (mode: 'connect' | 'update') => {
      if (!selectedUdid) {
        addToast({
          id: crypto.randomUUID(),
          message: 'Connect an iPhone over USB first.',
          type: 'error',
        })
        return
      }

      setBusy(mode === 'connect' ? 'connect' : 'update')
      setLastDeployMessage(null)
      try {
        if (!pairing && !status?.pairingCode) {
          await generatePairing()
        }
        const result = await window.api.mobile.deployIosApp({ deviceUdid: selectedUdid, mode })
        setLastDeployMessage(result.logTail ?? result.message)
        addToast({
          id: crypto.randomUUID(),
          message: result.message,
          type: result.ok ? 'info' : 'error',
        })
        if (result.ok) {
          await refreshStatus()
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        addToast({ id: crypto.randomUUID(), message, type: 'error' })
      } finally {
        setBusy(null)
      }
    },
    [addToast, generatePairing, pairing, refreshStatus, selectedUdid, status?.pairingCode],
  )

  const revokeTrustedDevice = useCallback(
    async (phoneDeviceId: string) => {
      try {
        await window.api.mobile.revokeTrustedDevice(phoneDeviceId)
        await refreshStatus()
        addToast({
          id: crypto.randomUUID(),
          message: 'Removed trusted phone.',
          type: 'info',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        addToast({ id: crypto.randomUUID(), message, type: 'error' })
      }
    },
    [addToast, refreshStatus],
  )

  return (
    <>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Mobile Bridge</div>
        <p className={styles.sectionHint}>
          Pair the Constellagent iPhone app with this desktop over your local network. In dev, the bridge
          starts automatically and picks your current LAN IP for pairing URLs. Set{' '}
          <code className={styles.inlineCode}>CONSTELLAGENT_MOBILE_HOST</code> only when you need a fixed
          address, or <code className={styles.inlineCode}>CONSTELLAGENT_MOBILE_ACCESS=0</code> to disable it.
        </p>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>Bridge status</div>
            <div className={styles.rowDescription}>
              {status?.running && status.baseUrl
                ? `${status.baseUrl} · ${status.connectedSecureChannels ?? 0} secure channel(s)`
                : status?.enabled
                  ? 'Enabled but not listening yet.'
                  : 'Mobile access is disabled (CONSTELLAGENT_MOBILE_ACCESS=0).'}
            </div>
          </div>
          <span className={bridgeStatusClass}>{bridgeStatusLabel}</span>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>USB iPhone</div>
            <div className={styles.rowDescription}>
              {usbDevices.length > 0
                ? 'A physical device is connected over USB.'
                : 'Plug in your iPhone and trust this Mac to deploy or launch the app.'}
            </div>
          </div>
          <span className={usbDevices.length > 0 ? styles.statusPillOk : styles.statusPillWarn}>
            {usbDevices.length > 0 ? 'Connected' : 'Not detected'}
          </span>
        </div>

        {usbDevices.length > 1 ? (
          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>Target device</div>
              <div className={styles.rowDescription}>Choose which USB iPhone to launch or update.</div>
            </div>
            <select
              className={styles.selectInput}
              value={selectedUdid}
              onChange={(event) => setSelectedUdid(event.target.value)}
            >
              {usbDevices.map((device) => (
                <option key={device.udid} value={device.udid}>
                  {device.name}
                  {device.osVersion ? ` (${device.osVersion})` : ''}
                </option>
              ))}
            </select>
          </div>
        ) : usbDevices[0] ? (
          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>{usbDevices[0].name}</div>
              <div className={styles.rowDescription}>
                {usbDevices[0].osVersion ? `iOS ${usbDevices[0].osVersion}` : usbDevices[0].udid}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Pairing</div>
        <p className={styles.sectionHint}>
          Scan the QR code or enter the short pairing code on your iPhone. Codes expire after five minutes.
        </p>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>Active pairing code</div>
            <div className={styles.rowDescription}>{formatExpiry(activePairingExpiresAt)}</div>
          </div>
          <code className={styles.inlineCode}>{activePairingCode ?? '—'}</code>
        </div>

        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={busy !== null || !status?.running}
            onClick={() => void generatePairing()}
          >
            {busy === 'qr' ? 'Generating…' : 'Generate QR code'}
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={busy !== null || !status?.running}
            onClick={() => void copyPairingCode()}
          >
            {busy === 'code' ? 'Copying…' : 'Copy pairing code'}
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={busy !== null || !selectedUdid}
            onClick={() => void runDeploy('connect')}
          >
            {busy === 'connect' ? 'Launching…' : 'Connect (launch app)'}
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={busy !== null || !selectedUdid}
            onClick={() => void runDeploy('update')}
          >
            {busy === 'update' ? 'Updating…' : 'Update iPhone app'}
          </button>
        </div>

        {pairing?.qrDataUrl ? (
          <div className={styles.mobileQrBlock}>
            <img className={styles.mobileQrImage} src={pairing.qrDataUrl} alt="Constellagent pairing QR code" />
            <code className={styles.callbackUrl}>{pairing.qrPayloadJson}</code>
          </div>
        ) : null}

        {lastDeployMessage ? <p className={styles.errorHint}>{lastDeployMessage}</p> : null}
      </div>

      {trustedDevices.length > 0 ? (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Trusted phones</div>
          <p className={styles.sectionHint}>
            Phones that completed secure pairing with this desktop. Revoke access if you lose a device.
          </p>
          {trustedDevices.map((device) => (
            <div key={device.phoneDeviceId} className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowLabel}>{device.phoneDeviceId.slice(0, 8)}…</div>
                <div className={styles.rowDescription}>{device.phoneIdentityPublicKey.slice(0, 24)}…</div>
              </div>
              <button
                type="button"
                className={styles.actionBtnDanger}
                onClick={() => void revokeTrustedDevice(device.phoneDeviceId)}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}
