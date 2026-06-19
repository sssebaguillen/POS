'use client'

import { UploadSimple } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { validateImageUrl } from '@/lib/validation'
import { FieldErrorMessage, ShakeOnError } from '@/components/shared/ShakeError'
import type { ImageUploadController } from '@/hooks/useImageUpload'

interface Props {
  controller: ImageUploadController
}

export default function ImageUploadField({ controller }: Props) {
  const {
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
  } = controller

  if (url && source === 'upload') {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-edge bg-surface px-3 py-3">
        <img
          src={url}
          alt="Vista previa"
          className="h-20 w-20 rounded-lg object-cover border border-edge shrink-0"
        />
        <div className="flex flex-col gap-1.5 pt-1 min-w-0">
          <p className="text-xs text-hint">Imagen subida</p>
          <button
            type="button"
            onClick={clearUrl}
            className="text-xs text-destructive hover:text-destructive/80 text-left"
          >
            Quitar imagen
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-edge overflow-hidden">
      <div className="flex border-b border-edge">
        <button
          type="button"
          onClick={() => setTab('upload')}
          className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
            tab === 'upload'
              ? 'bg-surface text-body border-b-2 border-primary'
              : 'bg-surface-alt text-hint hover:text-subtle'
          }`}
        >
          Subir archivo
        </button>
        <button
          type="button"
          onClick={() => setTab('url')}
          className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
            tab === 'url'
              ? 'bg-surface text-body border-b-2 border-primary'
              : 'bg-surface-alt text-hint hover:text-subtle'
          }`}
        >
          URL externa
        </button>
      </div>
      <div className="p-3">
        {tab === 'upload' && (
          <>
            <label className="flex flex-col items-center gap-2 cursor-pointer rounded-lg border border-dashed border-edge bg-surface px-4 py-5 hover:border-primary/40 transition-colors">
              <UploadSimple className="h-5 w-5 text-hint" />
              <span className="text-xs text-hint">
                {uploading ? 'Subiendo...' : 'Arrastra o haz clic para seleccionar'}
              </span>
              <span className="text-[10px] text-hint">PNG, JPG, WebP · máx. 2 MB</span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={uploading}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) void uploadFile(file)
                }}
              />
            </label>
            {uploadError && (
              <p className="text-caption text-destructive mt-1">{uploadError}</p>
            )}
          </>
        )}
        {tab === 'url' && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <ShakeOnError error={urlError} className="flex-1 min-w-0">
                <Input
                  value={externalUrlInput}
                  onChange={e => {
                    setExternalUrlInput(e.target.value)
                    setUrlError('')
                    if (source === 'url') clearUrl()
                  }}
                  placeholder="https://..."
                  aria-invalid={!!urlError}
                />
              </ShakeOnError>
              <Button
                type="button"
                onClick={() => confirmExternalUrl(validateImageUrl)}
                className="shrink-0"
              >
                Confirmar
              </Button>
            </div>
            <FieldErrorMessage error={urlError} className="text-caption" />
            {url && source === 'url' && (
              <div className="flex items-start gap-3">
                {imgError ? (
                  <div className="h-20 w-20 rounded-lg border border-destructive/40 bg-destructive/10 shrink-0 flex items-center justify-center p-1">
                    <p className="text-caption text-destructive text-center leading-tight">
                      No se pudo cargar. Verifica que la URL sea pública y directa.
                    </p>
                  </div>
                ) : (
                  <img
                    src={url}
                    alt="Vista previa"
                    className="h-20 w-20 rounded-lg object-cover border border-edge shrink-0"
                    onLoad={() => setImgError(false)}
                    onError={() => setImgError(true)}
                  />
                )}
                <button
                  type="button"
                  onClick={clear}
                  className="text-xs text-destructive hover:text-destructive/80 mt-1"
                >
                  Quitar imagen
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
