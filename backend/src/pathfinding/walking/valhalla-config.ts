export function getValhallaBaseUrl(configuredBaseUrl: string | undefined): string {
  const baseUrl = configuredBaseUrl?.trim()
  if (!baseUrl) throw new Error('VALHALLA_BASE_URL is required')
  return baseUrl.replace(/\/+$/, '')
}
