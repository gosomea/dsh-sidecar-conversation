import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { assertJsonRequest, assertTrustedSidecarRequest } from '../src/host/request-trust.js'

function request(headers: Record<string, string> = {}, remoteAddress: string | null = '127.0.0.1'): IncomingMessage {
  return { headers, socket: { remoteAddress: remoteAddress ?? undefined } } as unknown as IncomingMessage
}

describe('Sidecar HTTP trust boundary', () => {
  it('accepts same-origin and markerless loopback requests', () => {
    expect(() => { assertTrustedSidecarRequest(request({ host: 'localhost:3080', origin: 'http://localhost:3080' })) }).not.toThrow()
    expect(() => { assertTrustedSidecarRequest(request({ host: '127.8.9.10:3080' })) }).not.toThrow()
  })

  it('rejects DNS-rebound, cross-site, non-loopback and missing-address requests', () => {
    expect(() => { assertTrustedSidecarRequest(request({ host: 'evil.example:3080', origin: 'http://evil.example:3080' })) }).toThrow(/Host/)
    expect(() => { assertTrustedSidecarRequest(request({ host: 'localhost:3080', 'sec-fetch-site': 'cross-site' })) }).toThrow(/cross-site/)
    expect(() => { assertTrustedSidecarRequest(request({ host: 'localhost:3080' }, '192.168.1.5')) }).toThrow(/loopback/)
    expect(() => { assertTrustedSidecarRequest(request({ host: 'localhost:3080' }, null)) }).toThrow(/loopback/)
  })

  it('requires JSON media type for write routes', () => {
    expect(() => { assertJsonRequest(request({ 'content-type': 'application/json; charset=utf-8' })) }).not.toThrow()
    expect(() => { assertJsonRequest(request({ 'content-type': 'text/plain' })) }).toThrow(/application\/json/)
  })
})
