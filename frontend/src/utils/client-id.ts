let fallbackCounter = 0

function fallbackUuid(): string {
  fallbackCounter += 1
  const seed = `${Date.now().toString(16)}-${fallbackCounter.toString(16)}-${Math.random().toString(16).slice(2)}`
  let index = 0
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const value = Number.parseInt(seed[index++ % seed.length] ?? '0', 16) || Math.floor(Math.random() * 16)
    const nibble = token === 'x' ? value : (value & 0x3) | 0x8
    return nibble.toString(16)
  })
}

export function createClientId(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return fallbackUuid()
}
