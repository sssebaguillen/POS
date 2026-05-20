'use client'

import type { ActivityLogRow, ActivityLookups } from '@/components/activity/types'
import { formatFullTimestamp } from '@/components/activity/utils'
import { renderActivityDetail } from '@/components/activity/detail/renderers'

interface ActivityDetailProps {
  row: ActivityLogRow
  lookups: ActivityLookups
}

export default function ActivityDetail({ row, lookups }: ActivityDetailProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 pb-2 border-b border-edge/40">
        <p className="text-xs text-hint">
          <span className="text-body font-medium">{row.actor_name}</span>
          <span className="mx-1.5">·</span>
          {formatFullTimestamp(row.created_at, false)}
        </p>
      </div>
      {renderActivityDetail({ row, lookups })}
    </div>
  )
}
