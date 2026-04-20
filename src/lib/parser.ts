import type { CalendarEvent, AssignmentTimeline, DayCell, EventType, CompletionStatus, CalendarRangeHint } from './types'
import { getColor } from './colors'

// cmid → completion status (API から取得したもの)
let _completionMap = new Map<string, CompletionStatus>()
export function setCompletionMap(map: Map<string, CompletionStatus>): void {
  _completionMap = map
}

function extractCmid(href: string): string | null {
  try {
    return new URL(href).searchParams.get('id')
  } catch {
    return null
  }
}

function detectEventType(attrType: string, name: string): EventType {
  if (attrType === 'open') return 'open'
  if (attrType === 'due') return 'due'
  if (attrType === 'close') return 'close'
  // 日本語サフィックスからも判定
  const n = name
  if (n.includes('開始') || n.includes('open')) return 'open'
  if (n.includes('終了') || n.includes('close') || n.includes('期間の終了') || n.includes('受験可能期間の終了')) return 'close'
  if (n.includes('期限') || n.includes('due')) return 'due'
  return 'unknown'
}

function resolveCompletion(cmid: string | null): CompletionStatus {
  if (!cmid) return 'unknown'
  return _completionMap.get(cmid) ?? 'unknown'
}

function normalizeTimelineName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

function buildTimelineKey(cmid: string | null, component: string, name: string): string {
  if (cmid && /^\d+$/.test(cmid)) return `cmid:${cmid}`
  return `name:${component}:${normalizeTimelineName(name)}`
}

export function parseDayCells(): DayCell[] {
  const cells: DayCell[] = []
  document.querySelectorAll<HTMLTableCellElement>('td[data-day][data-day-timestamp]').forEach(td => {
    const ts = parseInt(td.dataset.dayTimestamp ?? '0', 10)
    const day = parseInt(td.dataset.day ?? '0', 10)
    if (ts && day) cells.push({ timestamp: ts, day, element: td })
  })
  return cells
}

export function parseCalendarEvents(): CalendarEvent[] {
  const events: CalendarEvent[] = []

  document.querySelectorAll<HTMLElement>('li[data-region="event-item"]').forEach(li => {
    const anchor = li.querySelector<HTMLAnchorElement>('a[data-action="view-event"]')
    if (!anchor) return

    const id = anchor.dataset.eventId ?? ''
    const rawName = li.querySelector('.eventname')?.textContent?.trim()
      ?? anchor.title?.trim()
      ?? ''
    const component = li.dataset.eventComponent ?? ''
    const attrType = li.dataset.eventEventtype ?? ''
    const type = detectEventType(attrType, rawName)

    // href の ?id= が課題ごとに一致 → これをグルーピングキーに使う
    const cmid = extractCmid(anchor.href ?? '') ?? null

    const td = li.closest<HTMLTableCellElement>('td[data-day-timestamp]')
    const timestamp = parseInt(td?.dataset.dayTimestamp ?? '0', 10)
    if (!timestamp || !id) return

    events.push({
      id,
      name: rawName,
      normalizedName: cmid ?? rawName, // cmid があればそれを正規化名として使う
      type,
      component,
      timestamp,
      element: li,
    })
  })

  return events
}

function buildSyntheticEvent(
  cmid: string,
  base: CalendarEvent,
  type: EventType,
  timestamp: number,
): CalendarEvent {
  return {
    id: `api-${cmid}-${type}-${timestamp}`,
    name: base.name,
    normalizedName: cmid,
    type,
    component: base.component,
    timestamp,
  }
}

export function buildTimelines(
  events: CalendarEvent[],
  rangeHints?: Map<string, CalendarRangeHint>,
): AssignmentTimeline[] {
  // cmid（normalizedName に格納済み）でグループ化
  const groups = new Map<string, CalendarEvent[]>()
  for (const ev of events) {
    const key = ev.normalizedName // cmid or raw name
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(ev)
  }

  const timelines: AssignmentTimeline[] = []
  let colorIndex = 0

  for (const [, group] of groups) {
    const cmid = group[0]?.normalizedName ?? ''
    const hint = cmid ? rangeHints?.get(cmid) : undefined

    const openEvDom = group.find(e => e.type === 'open')
    const dueEvDom = group.find(e => e.type === 'due')
    const closeEvDom = group.find(e => e.type === 'close')

    const representative = openEvDom ?? closeEvDom ?? dueEvDom
    if (!representative) continue

    const openEv = openEvDom ?? (hint?.openTs ? buildSyntheticEvent(cmid, representative, 'open', hint.openTs) : undefined)
    const dueEv = dueEvDom ?? (hint?.dueTs ? buildSyntheticEvent(cmid, representative, 'due', hint.dueTs) : undefined)
    const closeEv = closeEvDom ?? (hint?.closeTs ? buildSyntheticEvent(cmid, representative, 'close', hint.closeTs) : undefined)

    const hasRange = !!openEv && !!(closeEv || dueEv)
    const isDueOnly = !openEv && dueEv
    const extendsAfterView = !!openEv && !closeEv && !dueEv
    const extendsBeforeView = !openEv && !!closeEv

    if (!hasRange && !isDueOnly && !extendsAfterView && !extendsBeforeView) continue

    const completion = resolveCompletion(cmid)

    timelines.push({
      id: `tl-${colorIndex}`,
      timelineKey: buildTimelineKey(cmid || null, representative.component, representative.name),
      name: representative.name
        // 「〇〇 の受験可能期間の終了」→「〇〇」のようにサフィックスを除去して表示名を整える
        .replace(/\s*(の受験可能期間の終了|の受験可能期間の開始|が開始されます|が終了します|の期限|opens?|closes?|is due)\s*$/i, '')
        .trim(),
      component: representative.component,
      color: getColor(colorIndex).bar,
      openEvent: openEv,
      dueEvent: dueEv,
      closeEvent: closeEv,
      extendsBeforeView,
      extendsAfterView,
      isDueOnly: !!isDueOnly,
      completion,
    })
    colorIndex++
  }

  return timelines
}
