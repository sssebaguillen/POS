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
