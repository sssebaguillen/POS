import 'server-only'

const GITHUB_API = 'https://api.github.com'

export type GithubIssueInput = {
  type: 'bug' | 'sugerencia' | 'otro'
  message: string
  route: string | null
  contactEmail: string | null
  attachmentSignedUrl: string | null
  businessId: string
  operatorName: string | null
  userAgent: string | null
}

const TYPE_EMOJI: Record<GithubIssueInput['type'], string> = {
  bug: '🐛',
  sugerencia: '💡',
  otro: '💬',
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function buildTitle(type: GithubIssueInput['type'], message: string): string {
  const firstLine = message.split('\n')[0]?.trim() ?? ''
  return `${TYPE_EMOJI[type]} [${type}] ${truncate(firstLine || message, 70)}`
}

function buildBody(input: GithubIssueInput): string {
  const lines: string[] = []
  lines.push(`**Tipo:** ${input.type}`)
  if (input.route) lines.push(`**Ruta:** \`${input.route}\``)
  lines.push(`**Business:** \`${input.businessId.slice(0, 8)}…\``)
  lines.push(`**Reportado por:** ${input.operatorName ?? 'Dueño'}`)
  if (input.contactEmail) lines.push(`**Contacto:** ${input.contactEmail}`)
  if (input.userAgent) lines.push(`**User agent:** \`${truncate(input.userAgent, 120)}\``)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push(input.message)
  if (input.attachmentSignedUrl) {
    lines.push('')
    lines.push(`**Captura:** [ver imagen](${input.attachmentSignedUrl})`)
    lines.push('')
    lines.push(`![screenshot](${input.attachmentSignedUrl})`)
  }
  return lines.join('\n')
}

export async function createGithubIssue(input: GithubIssueInput): Promise<string | null> {
  const token = process.env.GITHUB_FEEDBACK_TOKEN
  const repo = process.env.GITHUB_FEEDBACK_REPO

  if (!token || !repo) {
    console.warn('[feedback/github] GITHUB_FEEDBACK_TOKEN or GITHUB_FEEDBACK_REPO not set; skipping')
    return null
  }

  try {
    const res = await fetch(`${GITHUB_API}/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: buildTitle(input.type, input.message),
        body: buildBody(input),
        labels: ['feedback', input.type],
      }),
      cache: 'no-store',
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[feedback/github] GitHub returned ${res.status}: ${text.slice(0, 200)}`)
      return null
    }

    const data = (await res.json()) as { html_url?: string }
    return typeof data.html_url === 'string' ? data.html_url : null
  } catch (err) {
    console.error('[feedback/github] request failed:', err)
    return null
  }
}
