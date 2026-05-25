import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type {
  MobileDeployIosAppInput,
  MobileDeployIosAppResult,
  MobileUsbIosDevice,
} from '../shared/mobile-settings-types'

const execFileAsync = promisify(execFile)

const IOS_SCHEME = 'Constellagent'
const IOS_BUNDLE_ID = 'com.tridhatri.constellagent.devlocal'
const DERIVED_DATA_PATH = '/tmp/ConstellagentDerivedData'

function resolveIosProjectRoot(): string {
  // desktop/out/main → repo root is three levels up in dev builds.
  return join(__dirname, '..', '..', '..', 'ios', 'Constellagent')
}

function tailLines(text: string, maxLines = 12): string {
  const lines = text.trim().split('\n').filter(Boolean)
  if (lines.length <= maxLines) return lines.join('\n')
  return lines.slice(-maxLines).join('\n')
}

function parseXctracePhysicalDevices(stdout: string): MobileUsbIosDevice[] {
  const devices: MobileUsbIosDevice[] = []
  let inDevicesSection = false

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '== Devices ==') {
      inDevicesSection = true
      continue
    }
    if (trimmed.startsWith('== ') && trimmed.endsWith(' ==') && trimmed !== '== Devices ==') {
      inDevicesSection = false
      continue
    }
    if (!inDevicesSection || !trimmed) continue
    if (trimmed.includes('MacBook') || trimmed.includes('Mac mini') || trimmed.includes('Mac Studio')) {
      continue
    }

    const match = trimmed.match(/^(.+?) \(([^)]+)\) \(([0-9A-Fa-f-]{25,})\)$/)
    if (!match) continue

    devices.push({
      name: match[1]!.trim(),
      osVersion: match[2]!.trim(),
      udid: match[3]!.trim(),
    })
  }

  return devices
}

export async function listUsbConnectedIosDevices(): Promise<MobileUsbIosDevice[]> {
  try {
    const { stdout } = await execFileAsync('xcrun', ['xctrace', 'list', 'devices'], {
      maxBuffer: 4 * 1024 * 1024,
    })
    return parseXctracePhysicalDevices(stdout)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not list USB-connected iOS devices: ${message}`)
  }
}

async function buildIosApp(deviceUdid: string, projectRoot: string): Promise<string> {
  const appPath = join(DERIVED_DATA_PATH, 'Build', 'Products', 'Debug-iphoneos', 'Constellagent.app')
  await execFileAsync(
    'xcodebuild',
    [
      '-project',
      join(projectRoot, 'Constellagent.xcodeproj'),
      '-scheme',
      IOS_SCHEME,
      '-destination',
      `platform=iOS,id=${deviceUdid}`,
      '-allowProvisioningUpdates',
      '-derivedDataPath',
      DERIVED_DATA_PATH,
      'build',
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  )
  if (!existsSync(appPath)) {
    throw new Error(`Build finished but app bundle was not found at ${appPath}`)
  }
  return appPath
}

async function installIosApp(deviceUdid: string, appPath: string): Promise<void> {
  await execFileAsync(
    'xcrun',
    ['devicectl', 'device', 'install', 'app', '--device', deviceUdid, appPath],
    { maxBuffer: 8 * 1024 * 1024 },
  )
}

async function launchIosApp(deviceUdid: string): Promise<void> {
  await execFileAsync(
    'xcrun',
    ['devicectl', 'device', 'process', 'launch', '--device', deviceUdid, IOS_BUNDLE_ID],
    { maxBuffer: 4 * 1024 * 1024 },
  )
}

export async function deployIosAppToDevice(
  input: MobileDeployIosAppInput,
): Promise<MobileDeployIosAppResult> {
  const deviceUdid = input.deviceUdid.trim()
  if (!deviceUdid) {
    throw new Error('Select a USB-connected iPhone first.')
  }

  const usbDevices = await listUsbConnectedIosDevices()
  const device = usbDevices.find((entry) => entry.udid === deviceUdid)
  if (!device) {
    return {
      ok: false,
      mode: input.mode,
      deviceUdid,
      message: 'No USB-connected iPhone matched that device id. Plug in your phone and trust this Mac.',
    }
  }

  const projectRoot = resolveIosProjectRoot()
  if (!existsSync(join(projectRoot, 'Constellagent.xcodeproj'))) {
    return {
      ok: false,
      mode: input.mode,
      deviceUdid,
      deviceName: device.name,
      message: `iOS project not found at ${projectRoot}. Run Constellagent from the repo checkout.`,
    }
  }

  let log = ''
  try {
    let appPath = join(DERIVED_DATA_PATH, 'Build', 'Products', 'Debug-iphoneos', 'Constellagent.app')

    if (input.mode === 'update') {
      appPath = await buildIosApp(deviceUdid, projectRoot)
      log += 'Built Debug iPhone app.\n'
      await installIosApp(deviceUdid, appPath)
      log += 'Installed app on device.\n'
    } else if (!existsSync(appPath)) {
      appPath = await buildIosApp(deviceUdid, projectRoot)
      await installIosApp(deviceUdid, appPath)
      log += 'Built and installed app because no prior build was found.\n'
    }

    await launchIosApp(deviceUdid)
    log += 'Launched Constellagent on device.\n'

    const actionLabel = input.mode === 'update' ? 'Updated and launched' : 'Launched'
    return {
      ok: true,
      mode: input.mode,
      deviceUdid,
      deviceName: device.name,
      message: `${actionLabel} Constellagent on ${device.name}. Approve Local Network on the phone if prompted, then pair with the code below.`,
      logTail: tailLines(log),
    }
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error
      ? String((error as { stderr?: unknown }).stderr ?? '')
      : ''
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      mode: input.mode,
      deviceUdid,
      deviceName: device.name,
      message,
      logTail: tailLines([message, stderr].filter(Boolean).join('\n')),
    }
  }
}
