import 'server-only'

export type TelegramInput = {
  type: 'bug' | 'sugerencia' | 'otro'
  message: string
  route: string | null
  contactEmail: string | null
  operatorName: string | null
  githubIssueUrl: string | null
}

const TYPE_EMOJI: Record<TelegramInput['type'], string> = {
  bug: '🐛',
  sugerencia: '💡',
  otro: '💬',
}

// Telegram MarkdownV2 reserves a long list of characters; we use legacy Markdown
// instead and just escape backticks/asterisks/underscores/brackets in user input.
function escapeMd(value: string): string {
  return value.replace(/([_*`[\]])/g, '\\$1')
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function buildText(input: TelegramInput): string {
  const lines: string[] = []
  lines.push(`${TYPE_EMOJI[input.type]} *Nuevo feedback* — _${input.type}_`)
  lines.push('')
  lines.push(escapeMd(truncate(input.message, 900)))
  lines.push('')
  if (input.route) lines.push(`📍 \`${escapeMd(input.route)}\``)
  lines.push(`👤 ${escapeMd(input.operatorName ?? 'Dueño')}`)
  if (input.contactEmail) lines.push(`✉️ ${escapeMd(input.contactEmail)}`)
  if (input.githubIssueUrl) {
    lines.push('')
    lines.push(`[Ver issue en GitHub](${input.githubIssueUrl})`)
  }
  return lines.join('\n')
}

export async function notifyTelegram(input: TelegramInput): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!token || !chatId) {
    console.warn('[feedback/telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set; skipping')
    return false
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: buildText(input),
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
      cache: 'no-store',
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[feedback/telegram] Telegram returned ${res.status}: ${text.slice(0, 200)}`)
      return false
    }

    return true
  } catch (err) {
    console.error('[feedback/telegram] request failed:', err)
    return false
  }
}
