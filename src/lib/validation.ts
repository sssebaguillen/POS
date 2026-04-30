export const BUSINESS_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/

export function validateImageUrl(url: string): string {
  if (!url) return ''
  if (
    url.startsWith('data:') ||
    url.startsWith('javascript:') ||
    url.startsWith('file:') ||
    url.startsWith('blob:')
  ) {
    return 'URL no permitida'
  }
  if (!url.startsWith('https://')) {
    return 'La URL debe comenzar con https://'
  }
  return ''
}
