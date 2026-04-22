import type { CompletionStatus, CalendarRangeHint, EventType } from './types'

function extractCmid(href: string): string | null {
  try { return new URL(href).searchParams.get('id') } catch { return null }
}

interface MoodleConfigLike {
  wwwroot?: string
  sesskey?: string
  userid?: number | string
  userId?: number | string
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

function getCurrentUserId(): number | undefined {
  const cfg = getMoodleConfig()
  const raw = cfg.userid ?? cfg.userId ?? document.querySelector<HTMLElement>('[data-userid]')?.getAttribute('data-userid')
  const n = Number(raw)
  if (Number.isFinite(n) && n > 0) return n
  return undefined
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

function detectFutureOpenCmids(knownCmids: Set<string>): Set<string> {
  const now = Math.floor(Date.now() / 1000)
  const out = new Set<string>()

  document.querySelectorAll<HTMLElement>('td[data-day-timestamp] li[data-region="event-item"]').forEach(li => {
    const a = li.querySelector<HTMLAnchorElement>('a[data-action="view-event"]')
    if (!a) return

    const cmid = extractCmid(a.href)
    if (!cmid || !knownCmids.has(cmid)) return

    const attrType = String(li.dataset.eventEventtype ?? '')
    const name = String(
      li.querySelector('.eventname, .event-name')?.textContent?.trim()
      ?? a.title?.trim()
      ?? a.textContent?.trim()
      ?? ''
    )
    const type = detectCalendarEventType(attrType, name)
    if (type !== 'open') return

    const td = li.closest<HTMLTableCellElement>('td[data-day-timestamp]')
    const ts = Number.parseInt(td?.dataset.dayTimestamp ?? '', 10)
    if (!Number.isFinite(ts) || ts <= 0) return

    if (ts > now) out.add(cmid)
  })

  return out
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function detectStatusFromLabel(label: string): CompletionStatus | null {
  if (!label) return null
  if (/解答済|解答済み|提出済|完了|completed|submitted|done/i.test(label)) return 'completed'
  if (/未解答|未提出|未完了|未受験|incomplete|not\s+submitted|not\s+attempted/i.test(label)) return 'incomplete'
  return null
}

function detectFromCalendarStatusDom(knownCmids: Set<string>): Map<string, CompletionStatus> {
  const map = new Map<string, CompletionStatus>()
  if (!knownCmids.size) return map

  document.querySelectorAll<HTMLElement>('td[data-day-timestamp]').forEach(td => {
    const dayContent = td.querySelector<HTMLElement>('[data-region="day-content"]')
    if (!dayContent) return

    const byName = new Map<string, string[]>()
    dayContent.querySelectorAll<HTMLElement>('li[data-region="event-item"]').forEach(li => {
      const a = li.querySelector<HTMLAnchorElement>('a[data-action="view-event"]')
      if (!a) return
      const cmid = extractCmid(a.href)
      if (!cmid || !knownCmids.has(cmid)) return

      const name = normalizeText(
        li.querySelector('.eventname, .event-name')?.textContent?.trim()
        ?? a.title?.trim()
        ?? a.textContent?.trim()
        ?? ''
      )
      if (!name) return

      const arr = byName.get(name) ?? []
      arr.push(cmid)
      byName.set(name, arr)
    })

    if (!byName.size) return

    dayContent.querySelectorAll<HTMLElement>('div[data-popover-eventtype-course]').forEach(row => {
      const label = normalizeText(
        row.querySelector('img')?.getAttribute('alt')
        ?? row.querySelector('img')?.getAttribute('title')
        ?? ''
      )
      const status = detectStatusFromLabel(label)
      if (!status) return

      const text = normalizeText(row.textContent ?? '')
      if (!text) return

      for (const [name, cmids] of byName) {
        if (!text.includes(name) && !name.includes(text)) continue
        cmids.forEach(cmid => map.set(cmid, status))
      }
    })
  })

  return map
}

function collectCompletionStateDeep(
  value: unknown,
  knownCmids: Set<string>,
  out: Map<string, CompletionStatus>,
): void {
  if (!value) return
  if (Array.isArray(value)) {
    value.forEach(v => collectCompletionStateDeep(v, knownCmids, out))
    return
  }
  if (typeof value !== 'object') return

  const rec = value as Record<string, unknown>
  const cmidRaw = rec.cmid ?? rec.id
  const cmid = typeof cmidRaw === 'number' ? String(cmidRaw) : String(cmidRaw ?? '')

  if (cmid && knownCmids.has(cmid)) {
    const stateRaw = rec.completionstate ?? rec.state ?? rec.complete
    if (typeof stateRaw === 'boolean') {
      out.set(cmid, stateRaw ? 'completed' : 'incomplete')
    } else {
      const stateNum = Number(stateRaw)
      if (Number.isFinite(stateNum)) {
        out.set(cmid, stateNum > 0 ? 'completed' : 'incomplete')
      }
    }
  }

  for (const v of Object.values(rec)) {
    collectCompletionStateDeep(v, knownCmids, out)
  }
}

async function detectFromCompletionApi(knownCmids: Set<string>): Promise<Map<string, CompletionStatus> | null> {
  const auth = getServiceUrlAndSesskey()
  if (!auth) return null
  const userId = getCurrentUserId()

  const cmidList = [...knownCmids].filter(v => /^\d+$/.test(v))
  if (!cmidList.length) return null

  // 1) cmid -> courseid を引く
  const cmReq = cmidList.map((cmid, idx) => ({
    index: idx,
    methodname: 'core_course_get_course_module',
    args: { cmid: Number(cmid) },
  }))

  const url = new URL(auth.serviceUrl)
  url.searchParams.set('sesskey', auth.sesskey)

  const cmRes = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmReq),
  })
  if (!cmRes.ok) throw new Error(`HTTP ${cmRes.status}`)

  const cmJson = await cmRes.json() as unknown
  const cmPayloads = Array.isArray(cmJson) ? cmJson : [cmJson]
  const courseIds = new Set<number>()

  for (let i = 0; i < cmidList.length; i++) {
    const payload = cmPayloads[i]
    if (!payload || typeof payload !== 'object') continue
    const p = payload as { error?: boolean; data?: unknown }
    if (p.error || !p.data || typeof p.data !== 'object') continue
    const d = p.data as Record<string, unknown>
    const cm = (d.cm && typeof d.cm === 'object') ? d.cm as Record<string, unknown> : undefined
    const courseId = Number(cm?.course ?? d.courseid)
    if (Number.isFinite(courseId) && courseId > 0) courseIds.add(courseId)
  }

  if (!courseIds.size) return null

  // 2) 各 course の completion status を取得
  const completionReq = [...courseIds].map((courseid, idx) => ({
    index: idx,
    methodname: 'core_completion_get_activities_completion_status',
    args: { courseid, ...(userId ? { userid: userId } : {}) },
  }))

  const completionRes = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(completionReq),
  })
  if (!completionRes.ok) throw new Error(`HTTP ${completionRes.status}`)

  const completionJson = await completionRes.json() as unknown
  const completionPayloads = Array.isArray(completionJson) ? completionJson : [completionJson]

  const map = new Map<string, CompletionStatus>()
  for (const payload of completionPayloads) {
    if (!payload || typeof payload !== 'object') continue
    const p = payload as { error?: boolean; data?: unknown }
    if (p.error) continue
    collectCompletionStateDeep(p.data, knownCmids, map)
  }

  return map.size ? map : null
}

async function detectFromActionEventsApi(knownCmids: Set<string>): Promise<Map<string, CompletionStatus> | null> {
  const auth = getServiceUrlAndSesskey()
  if (!auth) return null

  const range = getVisibleCalendarTimeRange()
  const now = Math.floor(Date.now() / 1000)
  const from = (range?.from ?? now) - (86400 * 120)
  const to = (range?.to ?? now) + (86400 * 120)

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

  const futureOpenCmids = detectFutureOpenCmids(knownCmids)

  const map = new Map<string, CompletionStatus>()
  for (const cmid of knownCmids) {
    if (actionEventCmids.has(cmid)) {
      map.set(cmid, 'incomplete')
      continue
    }

    // 開始前(open が未来)の課題を completed と推定しない
    if (futureOpenCmids.has(cmid)) {
      map.set(cmid, 'unknown')
      continue
    }

    map.set(cmid, 'completed')
  }
  return map
}

/**
 * Moodle の「タイムライン = 未完了のみ表示」という仕様を利用した完了判定
 *
 * タイムライン・upcoming events ブロックに出てくる課題 cmid を収集し、
 * knownCmids のうちそこにない cmid = 完了済みと推定する。
 */
function detectFromTimeline(
  knownCmids: Set<string>,
): Map<string, CompletionStatus> {
  const incompleteCmids = new Set<string>()
  const futureOpenCmids = detectFutureOpenCmids(knownCmids)
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
    if (incompleteCmids.has(cmid)) {
      map.set(cmid, 'incomplete')
      continue
    }

    if (futureOpenCmids.has(cmid)) {
      map.set(cmid, 'unknown')
      continue
    }

    map.set(cmid, 'completed')
  }
  return map
}

export async function fetchCompletionMap(
  knownCmids: Set<string>,
): Promise<Map<string, CompletionStatus>> {
  if (!knownCmids.size) return new Map()

  // 0) completion API（最優先。日付情報とは独立して完了状態を取得）
  const completionApiMap = await detectFromCompletionApi(knownCmids).catch(e => {
    console.info('[Moodline] completion-status API unavailable:', e)
    return null
  })

  // 1) action-events API（未完了シグナル補助）
  const apiMap = await detectFromActionEventsApi(knownCmids).catch(e => {
    console.info('[Moodline] action-events API unavailable, fallback to DOM:', e)
    return null
  })

  // 2) タイムライン DOM（未完了シグナル補完）
  const timelineMap = detectFromTimeline(knownCmids)

  // 3) カレンダー DOM の状態アイコン（completed/incomplete 補完）
  const calendarStatusMap = detectFromCalendarStatusDom(knownCmids)

  const map = new Map<string, CompletionStatus>()
  for (const cmid of knownCmids) {
    const completionApiStatus = completionApiMap?.get(cmid)
    if (completionApiStatus === 'completed' || completionApiStatus === 'incomplete') {
      map.set(cmid, completionApiStatus)
      continue
    }

    const apiStatus = apiMap?.get(cmid)
    if (apiStatus === 'completed' || apiStatus === 'incomplete') {
      map.set(cmid, apiStatus)
      continue
    }

    const calendarStatus = calendarStatusMap.get(cmid)
    // カレンダーDOMの未解答ラベルはノイズが混ざるため、completed 補完のみ採用する
    if (calendarStatus === 'completed') {
      map.set(cmid, 'completed')
      continue
    }

    const timelineStatus = timelineMap.get(cmid) ?? 'unknown'

    map.set(cmid, timelineStatus)
  }

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
      limitnum: 50,
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
