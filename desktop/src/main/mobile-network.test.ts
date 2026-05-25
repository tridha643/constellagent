import { describe, expect, test } from 'bun:test'
import {
  isMobileAccessEnabled,
  isPrivateIpv4,
  isTailscaleIpv4,
  resolveMobileAdvertisedHost,
  resolveMobileListenHost,
} from './mobile-network'

describe('mobile network helpers', () => {
  test('detects RFC1918 private IPv4 ranges', () => {
    expect(isPrivateIpv4('192.168.2.66')).toBe(true)
    expect(isPrivateIpv4('10.0.0.5')).toBe(true)
    expect(isPrivateIpv4('172.16.4.1')).toBe(true)
    expect(isPrivateIpv4('8.8.8.8')).toBe(false)
    expect(isPrivateIpv4('100.64.0.1')).toBe(false)
  })

  test('detects Tailscale CGNAT IPv4 range', () => {
    expect(isTailscaleIpv4('100.64.0.1')).toBe(true)
    expect(isTailscaleIpv4('100.127.255.255')).toBe(true)
    expect(isTailscaleIpv4('100.63.0.1')).toBe(false)
  })

  test('defaults mobile access on in electron dev unless explicitly disabled', () => {
    const previousRendererUrl = process.env.ELECTRON_RENDERER_URL
    const previousMobileAccess = process.env.CONSTELLAGENT_MOBILE_ACCESS
    try {
      process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
      delete process.env.CONSTELLAGENT_MOBILE_ACCESS
      expect(isMobileAccessEnabled()).toBe(true)

      process.env.CONSTELLAGENT_MOBILE_ACCESS = '0'
      expect(isMobileAccessEnabled()).toBe(false)
    } finally {
      if (previousRendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
      else process.env.ELECTRON_RENDERER_URL = previousRendererUrl
      if (previousMobileAccess === undefined) delete process.env.CONSTELLAGENT_MOBILE_ACCESS
      else process.env.CONSTELLAGENT_MOBILE_ACCESS = previousMobileAccess
    }
  })

  test('binds to all interfaces in dev when host is not configured', () => {
    const previousRendererUrl = process.env.ELECTRON_RENDERER_URL
    try {
      process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
      expect(resolveMobileListenHost()).toBe('0.0.0.0')
      expect(resolveMobileListenHost('192.168.2.66')).toBe('192.168.2.66')
    } finally {
      if (previousRendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
      else process.env.ELECTRON_RENDERER_URL = previousRendererUrl
    }
  })

  test('never advertises 0.0.0.0 in pairing URLs', () => {
    expect(resolveMobileAdvertisedHost(undefined, '0.0.0.0')).not.toBe('0.0.0.0')
    expect(resolveMobileAdvertisedHost('192.168.2.66', '0.0.0.0')).toBe('192.168.2.66')
  })
})
