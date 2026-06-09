// Re-export del provider global de toasts (la implementación vive en ToastProvider).
// Se mantiene este módulo para no romper los imports existentes `from '@/hooks/useToast'`.
export { useToast } from '@/components/shared/ToastProvider'
export type { ToastOptions } from '@/components/shared/ToastProvider'
