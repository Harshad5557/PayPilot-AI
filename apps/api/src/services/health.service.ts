export function getHealth() {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
  } as const
}
