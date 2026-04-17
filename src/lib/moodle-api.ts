import type { CompletionStatus } from './types'

function extractCmid(href: string): string | null {
  try { return new URL(href).searchParams.get('id') } catch { return null }
}

interface MoodleConfigLike {
  wwwroot?: string
  sesskey?: string
}

function getMoodleConfig(): MoodleConfigLike {
  const w = window as Window & { M?: { cfg?: MoodleConfigLike } }
  return w.M?.cfg ?? {}
}

function getServiceUrlAndSesskey(): { serviceUrl: string; sesskey: string } | null {
  const cfg = getMoodleConfig()
  const sesskeyFromDom = document.querySelector<HTMLInputElement>('input[name="sesskey"]')?.value
  const sesskey = cfg.sesskey ?? sesskeyFromDom
  const wwwroot = cfg.wwwroot ?? location.origin
  if (!sesskey || !wwwroot) return null

  return {
    serviceUrl: `${wwwroot.replace(/\/$/, '')}/lib/ajax/service.php`,
    sesskey,
  }
}

function collectCmidsDeep(value: unknown, out: Set<string>): void {
  if (!value) return
  if (typeof value === 'string') {
    if (value.includes('view.php?id=')) {
      const cmid = extractCmid(value)
      if (cmid) out.add(cmid)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach(v => collectCmidsDeep(v, out))
    return
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectCmidsDeep(v, out)
    }
  }
}

function getVisibleCalendarTimeRange(): { from: number; to: number } | null {
  const stamps = [...document.querySelectorAll<HTMLTableCellElement>('td[data-day-timestamp]')]
    .map(td => Number.parseInt(td.dataset.dayTimestamp ?? '', 10))
    .filter(ts => Number.isFinite(ts) && ts > 0)
  if (!stamps.length) return null

  const min = Math.min(...stamps)
  const max = Math.max(...stamps)
  // API 側の取りこぼしを避けるために少しだけ前後に余白を持たせる
  return { from: min - 86400, to: max + 86400 }
}

async function detectFromActionEventsApi(knownCmids: Set<string>): Promise<Map<string, CompletionStatus> | null> {
  const auth = getServiceUrlAndSesskey()
  if (!auth) return null

  const range = getVisibleCalendarTimeRange()

  const req = [{
    index: 0,
    methodname: 'core_calendar_get_action_events_by_timesort',
    args: {
      limitnum: 50,
      limittononsuspendedevents: true,
      ...(range ? { timesortfrom: range.from, timesortto: range.to } : {}),
    },
  }]

  const url = new URL(auth.serviceUrl)
  url.searchParams.set('sesskey', auth.sesskey)

  const res = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const json = await res.json() as unknown
  const payload = Array.isArray(json) ? json[0] : json
  if (!payload || typeof payload !== 'object') return null

  const p = payload as { error?: boolean; exception?: { message?: string }; data?: unknown }
  if (p.error) {
    const msg = p.exception?.message ?? 'Moodle ajax service error'
    throw new Error(msg)
  }

  const actionEventCmids = new Set<string>()
  collectCmidsDeep(p.data, actionEventCmids)

  const matched = [...actionEventCmids].filter(cmid => knownCmids.has(cmid))
  if (!matched.length) return null

  const map = new Map<string, CompletionStatus>()
  for (const cmid of knownCmids) {
    map.set(cmid, actionEventCmids.has(cmid) ? 'incomplete' : 'completed')
  }
  return map
}

/**
 * Moodle の「タイムライン = 未完了のみ表示」という仕様を利用した完了判定
 *
 * タイムライン・upcoming events ブロックに出てくる課題 cmid を収集し、
 * knownCmids のうちそこにない cmid = 完了済みと推定する。
 */
function detectFromTimeline(knownCmids: Set<string>): Map<string, CompletionStatus> {
  const incompleteCmids = new Set<string>()
  let foundAnyCmid = false
  let foundKnownCmid = false

  // タイムラインブロック・upcoming events ブロック両方をスキャン
  const SELECTORS = [
    '[data-region="event-list-item"]',   // block_timeline
    '.event[data-region="event-item"]',  // block_calendar_upcoming
    '.timeline-event-list-item',         // 旧 Moodle
  ]

  for (const sel of SELECTORS) {
    document.querySelectorAll<HTMLElement>(sel).forEach(item => {
      item.querySelectorAll<HTMLAnchorElement>('a[href*="view.php?id="]').forEach(a => {
        const cmid = extractCmid(a.href)
        if (!cmid) return
        foundAnyCmid = true
        if (knownCmids.has(cmid)) {
          incompleteCmids.add(cmid)
          foundKnownCmid = true
        }
      })
    })
  }

  const map = new Map<string, CompletionStatus>()
  // タイムラインから判定根拠を得られない場合は completed と断定しない
  if (!foundAnyCmid || !foundKnownCmid) {
    for (const cmid of knownCmids) map.set(cmid, 'unknown')
    return map
  }

  for (const cmid of knownCmids) {
    map.set(cmid, incompleteCmids.has(cmid) ? 'incomplete' : 'completed')
  }
  return map
}

export async function fetchCompletionMap(
  knownCmids: Set<string>,
): Promise<Map<string, CompletionStatus>> {
  if (!knownCmids.size) return new Map()

  // 1) WebService 優先（DOM 依存を減らして安定化）
  const apiMap = await detectFromActionEventsApi(knownCmids).catch(e => {
    console.info('[Moodline] action-events API unavailable, fallback to DOM:', e)
    return null
  })
  if (apiMap) return apiMap

  // 2) 最終フォールバック: タイムライン DOM
  const map = detectFromTimeline(knownCmids)
  const hasSignal = [...map.values()].some(v => v === 'completed' || v === 'incomplete')
  if (!hasSignal) console.warn('[Moodline] completion signal unavailable from timeline DOM')
  return map
}
