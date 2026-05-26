'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { translateDbError } from '@/lib/errors'

type ImageSource = 'upload' | 'url' | null

interface UseImageUploadOptions {
  businessId: string | null
  initialUrl?: string | null
  initialSource?: ImageSource
}

export interface ImageUploadController {
  url: string | null
  source: ImageSource
  tab: 'upload' | 'url'
  externalUrlInput: string
  urlError: string
  uploading: boolean
  imgError: boolean
  uploadError: string
  setTab: (tab: 'upload' | 'url') => void
  setExternalUrlInput: (value: string) => void
  setUrlError: (error: string) => void
  setImgError: (value: boolean) => void
  clear: () => void
  clearUrl: () => void
  confirmExternalUrl: (validate: (value: string) => string) => void
  uploadFile: (file: File) => Promise<void>
  reset: (next?: { url?: string | null; source?: ImageSource }) => void
}

function tabForSource(source: ImageSource): 'upload' | 'url' {
  return source === 'url' ? 'url' : 'upload'
}

export function useImageUpload({
  businessId,
  initialUrl = null,
  initialSource = null,
}: UseImageUploadOptions): ImageUploadController {
  const supabase = useMemo(() => createClient(), [])
  const [url, setUrl] = useState<string | null>(initialUrl)
  const [source, setSource] = useState<ImageSource>(initialSource)
  const [tab, setTab] = useState<'upload' | 'url'>(tabForSource(initialSource))
  const [externalUrlInput, setExternalUrlInput] = useState(
    initialSource === 'url' ? (initialUrl ?? '') : ''
  )
  const [urlError, setUrlError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [imgError, setImgError] = useState(false)
  const [uploadError, setUploadError] = useState('')

  function clear() {
    setUrl(null)
    setSource(null)
    setExternalUrlInput('')
    setUrlError('')
    setImgError(false)
  }

  function clearUrl() {
    setUrl(null)
    setSource(null)
  }

  function confirmExternalUrl(validate: (value: string) => string) {
    const error = validate(externalUrlInput)
    setUrlError(error)
    if (!error && externalUrlInput) {
      setImgError(false)
      setUrl(externalUrlInput)
      setSource('url')
    }
  }

  async function uploadFile(file: File) {
    if (!businessId) return
    setUploading(true)
    setUploadError('')
    const ext = file.name.split('.').pop() ?? 'jpg'
    const filename = `${businessId}/${crypto.randomUUID()}.${ext}`
    const { error: storageError } = await supabase.storage
      .from('product-images')
      .upload(filename, file, { upsert: true })
    if (storageError) {
      setUploadError(translateDbError(storageError.message, 'No se pudo subir la imagen. Intenta con otra foto.'))
      setUploading(false)
      return
    }
    const { data: urlData } = supabase.storage
      .from('product-images')
      .getPublicUrl(filename)
    setUrl(urlData.publicUrl)
    setSource('upload')
    setUploading(false)
  }

  function reset(next?: { url?: string | null; source?: ImageSource }) {
    const nextUrl = next?.url ?? null
    const nextSource = next?.source ?? null
    setUrl(nextUrl)
    setSource(nextSource)
    setTab(tabForSource(nextSource))
    setExternalUrlInput(nextSource === 'url' ? (nextUrl ?? '') : '')
    setUrlError('')
    setUploading(false)
    setImgError(false)
    setUploadError('')
  }

  return {
    url,
    source,
    tab,
    externalUrlInput,
    urlError,
    uploading,
    imgError,
    uploadError,
    setTab,
    setExternalUrlInput,
    setUrlError,
    setImgError,
    clear,
    clearUrl,
    confirmExternalUrl,
    uploadFile,
    reset,
  }
}
