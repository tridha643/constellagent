import type { MobileAccessStatus, PairingQrPayload } from '@constellagent/mobile-protocol'

export interface MobileUsbIosDevice {
  readonly name: string
  readonly udid: string
  readonly osVersion?: string
}

export interface MobileConnectionSnapshot extends MobileAccessStatus {
  readonly pairingCode?: string
  readonly pairingCodeExpiresAt?: number
  readonly websocketConnections: number
  readonly connectedSecureChannels: number
}

export interface MobilePairingPayloadResult extends PairingQrPayload {
  readonly shortCode: string
  readonly qrDataUrl: string
  readonly qrPayloadJson: string
}

export interface MobileTrustedPhoneSummary {
  readonly phoneDeviceId: string
  readonly phoneIdentityPublicKey: string
}

export interface MobileDeployIosAppInput {
  readonly deviceUdid: string
  readonly mode: 'connect' | 'update'
}

export interface MobileDeployIosAppResult {
  readonly ok: boolean
  readonly mode: MobileDeployIosAppInput['mode']
  readonly deviceUdid: string
  readonly deviceName?: string
  readonly message: string
  readonly logTail?: string
}
