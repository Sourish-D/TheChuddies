const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')

export function apiUrl(path) {
  if (apiBaseUrl) return `${apiBaseUrl}${path}`
  if (import.meta.env.PROD) {
    throw new Error(
      'Farm data is unavailable because this deployment has no API configured. Set VITE_API_BASE_URL to the deployed API origin.',
    )
  }
  return path
}
