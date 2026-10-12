const ID_SEPARATOR = /[\s,，;；]+/u
const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i

export function parsePingTaskIds(value: unknown): number[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(ID_SEPARATOR) : []
  return [...new Set(values.filter(item => typeof item === 'number' || (typeof item === 'string' && item.trim())).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 3)
}

export function parseNodePingBindings(value: unknown): Record<string, number[]> {
  const result: Record<string, number[]> = Object.create(null)
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return result
    for (const [uuid, ids] of Object.entries(parsed)) {
      if (UUID_PATTERN.test(uuid))
        result[uuid] = parsePingTaskIds(ids)
    }
  }
  catch { /* Malformed optional configuration falls back to global bindings. */ }
  return result
}
