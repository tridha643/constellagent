import { describe, expect, test } from 'bun:test'
import { parseXctracePhysicalDevices } from './mobile-device-tools'

const SAMPLE_XCTRACE_OUTPUT = `
== Devices ==
Tri's iPhone (18.4) (00008140-001A2B3C4D5E6F78)
My MacBook Pro (Mac15,3) (MacBookPro18,3)

== Simulators ==
iPhone 16 (18.4) (SIMULATOR-UDID)
`

describe('parseXctracePhysicalDevices', () => {
  test('extracts physical iOS devices and skips Mac hosts', () => {
    const devices = parseXctracePhysicalDevices(SAMPLE_XCTRACE_OUTPUT)
    expect(devices).toEqual([
      {
        name: "Tri's iPhone",
        osVersion: '18.4',
        udid: '00008140-001A2B3C4D5E6F78',
      },
    ])
  })
})
