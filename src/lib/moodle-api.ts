import type { CompletionStatus, CalendarRangeHint, EventType } from './types'

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

function detectCalendarEventType(attrType: string, name: string): EventType {
  if (attrType === 'open') return 'open'
  if (attrType === 'due') return 'due'
  if (attrType === 'close') return 'close'

  const n = name
  if (n.includes('開始') || n.includes('open')) return 'open'
  if (n.includes('終了') || n.includes('close') || n.includes('期間の終了') || n.includes('受験可能期間の終了')) return 'close'
  if (n.includes('期限') || n.includes('due')) return 'due'
  return 'unknown'
}

function mergeHint(map: Map<string, CalendarRangeHint>, cmid: string, type: EventType, timestamp: number): void {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return
  const current = map.get(cmid) ?? {}
  if (type === 'open') {
    current.openTs = current.openTs ? Math.min(current.openTs, timestamp) : timestamp
  }
  if (type === 'due') {
    current.dueTs = current.dueTs ? Math.max(current.dueTs, timestamp) : timestamp
  }
  if (type === 'close') {
    current.closeTs = current.closeTs ? Math.max(current.closeTs, timestamp) : timestamp
  }
  map.set(cmid, current)
}

function collectRangeHintsDeep(value: unknown, knownCmids: Set<string>, out: Map<string, CalendarRangeHint>): void {
  if (!value) return
  if (Array.isArray(value)) {
    value.forEach(v => collectRangeHintsDeep(v, knownCmids, out))
    return
  }
  if (typeof value !== 'object') return

  const rec = value as Record<string, unknown>
  const hrefCandidates = [rec.url, rec.actionurl, rec.viewurl, rec.link]
    .filter(v => typeof v === 'string') as string[]
  const cmid = hrefCandidates.map(extractCmid).find((v): v is string => !!v)

  if (cmid && knownCmids.has(cmid)) {
    const timestamp = [rec.timestart, rec.timesort, rec.timestamp, rec.time]
      .map(v => typeof v === 'number' ? v : Number(v))
      .find(v => Number.isFinite(v) && v > 0)

    const attrType = String(rec.eventtype ?? rec.type ?? '')
    const name = String(rec.name ?? rec.eventname ?? rec.label ?? '')
    const eventType = detectCalendarEventType(attrType, name)

    if (timestamp && eventType !== 'unknown') {
      mergeHint(out, cmid, eventType, timestamp)
    }
  }

  for (const v of Object.values(rec)) {
    collectRangeHintsDeep(v, knownCmids, out)
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

export async function fetchCalendarRangeHints(
  knownCmids: Set<string>,
): Promise<Map<string, CalendarRangeHint>> {
  if (!knownCmids.size) return new Map()

  const auth = getServiceUrlAndSesskey()
  if (!auth) return new Map()

  const range = getVisibleCalendarTimeRange()
  const from = (range?.from ?? Math.floor(Date.now() / 1000)) - (86400 * 120)
  const to = (range?.to ?? Math.floor(Date.now() / 1000)) + (86400 * 120)

  const req = [{
    index: 0,
    methodname: 'core_calendar_get_action_events_by_timesort',
    args: {
      limitnum: 500,
      limittononsuspendedevents: true,
      timesortfrom: from,
      timesortto: to,
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
  if (!payload || typeof payload !== 'object') return new Map()

  const p = payload as { error?: boolean; exception?: { message?: string }; data?: unknown }
  if (p.error) {
    const msg = p.exception?.message ?? 'Moodle ajax service error'
    throw new Error(msg)
  }

  const map = new Map<string, CalendarRangeHint>()
  collectRangeHintsDeep(p.data, knownCmids, map)
  return map
}
