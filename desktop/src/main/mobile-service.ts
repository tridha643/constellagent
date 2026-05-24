import { MobileLocalServer } from './mobile-local-server'

let mobileLocalServer: MobileLocalServer | null = null

export function getMobileLocalServer(): MobileLocalServer {
  if (!mobileLocalServer) mobileLocalServer = new MobileLocalServer()
  return mobileLocalServer
}

export async function startMobileLocalServer(): Promise<void> {
  await getMobileLocalServer().start()
}

export async function stopMobileLocalServer(): Promise<void> {
  await mobileLocalServer?.stop()
  mobileLocalServer = null
}
