import type { AssignmentTimeline, DayCell } from './types'
import type { MoodlineSettings } from './settings'
import { DEFAULT_SETTINGS } from './settings'
import { getColor } from './colors'

const STYLE_ID = 'moodline-styles'
const OVERLAY_ID = 'moodline-overlay'
const TOOLTIP_ID = 'moodline-tooltip'

let activeHoverTimelineId: string | null = null

const BAR_H = 10
const BAR_GAP = 3
const BAR_BOTTOM_PAD = 4
const START_INSET = 5
const END_INSET = 5
const CELL_EXTRA_CONTENT_PAD = 8
const CELL_OVERRIDE_ATTR = 'data-moodline-row-overridden'
const CUSTOM_LIST_CLASS = 'moodline-day-list'
const CUSTOM_ITEM_CLASS = 'moodline-day-item'

const MARK_NATIVE_UL_DISPLAY = 'data-moodline-native-ul-display'
const MARK_DAY_CONTENT_OVERFLOW = 'data-moodline-day-content-overflow'
const MARK_CELL_OVERFLOW = 'data-moodline-cell-overflow'
const MARK_WRAPPER_OVERFLOW = 'data-moodline-wrapper-overflow'
const MARK_TABLE_OVERFLOW = 'data-moodline-table-overflow'
const MARK_DAY_CONTENT_POSITION = 'data-moodline-day-content-position'
const MARK_DAY_CONTENT_ZINDEX = 'data-moodline-day-content-zindex'

// ─── Tooltip (position:fixed、body 直下に置くので再生成の影響ゼロ) ───────────
function getTooltip(): HTMLDivElement {
  let el = document.getElementById(TOOLTIP_ID) as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = TOOLTIP_ID
    el.style.cssText = [
      'position:fixed',
      'background:rgba(0,0,0,0.78)',
      'color:#fff',
      'font-size:11px',
      'line-height:1.4',
      'padding:3px 8px',
      'border-radius:5px',
      'white-space:nowrap',
      'pointer-events:none',
      'z-index:99999',
      'display:none',
      'transition:opacity 0.1s',
    ].join(';')
    document.body.appendChild(el)
  }
  return el
}

function showTooltip(text: string, x: number, y: number): void {
  const tip = getTooltip()
  tip.textContent = text
  tip.style.left = `${x + 12}px`
  tip.style.top = `${y - 28}px`
  tip.style.display = 'block'
}

function hideTooltip(): void {
  getTooltip().style.display = 'none'
}

// ─── Styles ─────────────────────────────────────────────────────────────────
export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    #${OVERLAY_ID} {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: 50;
      overflow: visible;
    }
    .ml-bg {
      position: absolute;
      pointer-events: none;
    }
    .ml-bar {
      position: absolute;
      height: ${BAR_H}px;
      pointer-events: auto;
      cursor: default;
      opacity: var(--ml-base-opacity, 0.45);
      transition: opacity 0.15s ease;
    }
    /* JS が同じ timeline の全バーに付与 */
    .ml-bar.ml-hovered { opacity: 1; }

    .ml-bar.is-start {
      border-top-left-radius: 6px;
      border-bottom-left-radius: 6px;
    }
    .ml-bar.is-end {
      border-top-right-radius: 6px;
      border-bottom-right-radius: 6px;
    }
    .ml-bar.is-start.is-end { border-radius: 6px; }

    .ml-bar.status-completed {
      background-image: repeating-linear-gradient(
        -45deg,
        transparent, transparent 4px,
        rgba(255,255,255,0.35) 4px, rgba(255,255,255,0.35) 5px
      );
    }

    /* upcoming events */
    [data-region="event-item"].moodline-enhanced {
      border-left: 3px solid transparent !important;
      padding-left: 6px !important;
    }
    .moodline-upcoming-badge {
      display: inline-block;
      font-size: 10px; font-weight: 600;
      padding: 1px 5px; border-radius: 3px;
      margin-left: 5px; vertical-align: middle;
      color: #fff;
    }

    .${CUSTOM_LIST_CLASS} {
      list-style: none;
      margin: 4px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      position: relative;
      z-index: 80;
      pointer-events: auto;
    }
    .${CUSTOM_ITEM_CLASS} {
      margin: 0;
      padding: 2px 4px;
      border-left: 3px solid #64748b;
      border-radius: 4px;
      background: rgba(255,255,255,0.9);
      line-height: 1.25;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11px;
    }
    .${CUSTOM_ITEM_CLASS} a {
      color: inherit;
      text-decoration: none;
      display: inline-block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: middle;
    }
    .${CUSTOM_ITEM_CLASS} a:hover { text-decoration: underline; }
    .${CUSTOM_ITEM_CLASS} .moodline-day-badge {
      margin-left: 4px;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 600;
      color: #fff;
      vertical-align: middle;
    }
  `
  document.head.appendChild(style)
}

// ─── Hover sync across all segments of the same timeline ────────────────────
function setupHoverSync(overlay: HTMLElement): void {
  overlay.addEventListener('mouseover', e => {
    const bar = (e.target as HTMLElement).closest<HTMLElement>('.ml-bar')
    if (!bar) return
    const id = bar.dataset.tlId
    if (!id) return
    activeHoverTimelineId = id
    overlay.querySelectorAll<HTMLElement>(`[data-tl-id="${id}"]`).forEach(b => b.classList.add('ml-hovered'))
    showTooltip(bar.dataset.tip ?? '', e.clientX, e.clientY)
  })

  overlay.addEventListener('mouseout', e => {
    const bar = (e.target as HTMLElement).closest<HTMLElement>('.ml-bar')
    if (!bar) return
    // まだオーバーレイ内に留まっているなら何もしない
    const related = e.relatedTarget as HTMLElement | null
    const relatedBar = related?.closest('.ml-bar') as HTMLElement | null
    if (relatedBar?.dataset.tlId === bar.dataset.tlId) return
    const id = bar.dataset.tlId
    if (!id) return
    activeHoverTimelineId = null
    overlay.querySelectorAll<HTMLElement>(`[data-tl-id="${id}"]`).forEach(b => b.classList.remove('ml-hovered'))
    hideTooltip()
  })

  overlay.addEventListener('mouseleave', () => {
    activeHoverTimelineId = null
    overlay.querySelectorAll<HTMLElement>('.ml-bar.ml-hovered').forEach(b => b.classList.remove('ml-hovered'))
    hideTooltip()
  })

  overlay.addEventListener('mousemove', e => {
    const tip = getTooltip()
    if (tip.style.display !== 'none') {
      tip.style.left = `${e.clientX + 12}px`
      tip.style.top = `${e.clientY - 28}px`
    }
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function groupByRow(cells: DayCell[]): Map<HTMLTableRowElement, DayCell[]> {
  const map = new Map<HTMLTableRowElement, DayCell[]>()
  for (const cell of cells) {
    const tr = cell.element.parentElement as HTMLTableRowElement
    if (!map.has(tr)) map.set(tr, [])
    map.get(tr)!.push(cell)
  }
  return map
}

function resetRowOverrides(cells: DayCell[]): void {
  cells.forEach(cell => {
    if (!cell.element.hasAttribute(CELL_OVERRIDE_ATTR)) return
    cell.element.style.removeProperty('padding-bottom')
    cell.element.style.removeProperty('min-height')
    cell.element.style.removeProperty('height')
    cell.element.removeAttribute(CELL_OVERRIDE_ATTR)
  })
}

function setInlineOverride(el: HTMLElement, prop: string, value: string, marker: string): void {
  if (!el.hasAttribute(marker)) {
    el.setAttribute(marker, '1')
    el.setAttribute(`${marker}-prev`, el.style.getPropertyValue(prop))
  }
  el.style.setProperty(prop, value)
}

function restoreInlineOverride(el: HTMLElement, prop: string, marker: string): void {
  if (!el.hasAttribute(marker)) return
  const prev = el.getAttribute(`${marker}-prev`) ?? ''
  if (prev) el.style.setProperty(prop, prev)
  else el.style.removeProperty(prop)
  el.removeAttribute(marker)
  el.removeAttribute(`${marker}-prev`)
}

function resetCalendarContentOverrides(cells: DayCell[]): void {
  cells.forEach(cell => {
    cell.element.querySelectorAll<HTMLElement>(`.${CUSTOM_LIST_CLASS}`).forEach(el => el.remove())

    cell.element.querySelectorAll<HTMLElement>(`[${MARK_NATIVE_UL_DISPLAY}]`).forEach(el => {
      restoreInlineOverride(el, 'display', MARK_NATIVE_UL_DISPLAY)
    })
    cell.element.querySelectorAll<HTMLElement>(`[${MARK_DAY_CONTENT_OVERFLOW}]`).forEach(el => {
      restoreInlineOverride(el, 'overflow', MARK_DAY_CONTENT_OVERFLOW)
    })
    cell.element.querySelectorAll<HTMLElement>(`[${MARK_DAY_CONTENT_POSITION}]`).forEach(el => {
      restoreInlineOverride(el, 'position', MARK_DAY_CONTENT_POSITION)
    })
    cell.element.querySelectorAll<HTMLElement>(`[${MARK_DAY_CONTENT_ZINDEX}]`).forEach(el => {
      restoreInlineOverride(el, 'z-index', MARK_DAY_CONTENT_ZINDEX)
    })

    restoreInlineOverride(cell.element, 'overflow', MARK_CELL_OVERFLOW)
  })
}

function resetContainerOverflowOverrides(wrapper: HTMLElement): void {
  restoreInlineOverride(wrapper, 'overflow', MARK_WRAPPER_OVERFLOW)
  const table = wrapper.querySelector<HTMLElement>('table.calendarmonth')
  if (table) restoreInlineOverride(table, 'overflow', MARK_TABLE_OVERFLOW)
}

function extractCmid(href: string): string | null {
  try {
    return new URL(href).searchParams.get('id')
  } catch {
    return null
  }
}

function openLinkLikeOriginal(anchor: HTMLAnchorElement, event: MouseEvent): void {
  const href = anchor.href
  if (!href) return

  if (event.metaKey || event.ctrlKey || event.button === 1) {
    window.open(href, '_blank', 'noopener')
    return
  }

  if (event.shiftKey) {
    window.open(href, '_blank')
    return
  }

  window.location.href = href
}

function resolveEventListColor(tl: AssignmentTimeline | undefined, settings: MoodlineSettings): string {
  if (!tl) return '#64748b'
  if (settings.colorMode === 'by-status') {
    return tl.completion === 'completed'
      ? settings.statusColors.completed
      : tl.completion === 'incomplete'
        ? settings.statusColors.incomplete
        : settings.statusColors.unknown
  }
  return tl.color
}

function applyCustomCalendarEventList(
  timelines: AssignmentTimeline[],
  cells: DayCell[],
  settings: MoodlineSettings,
  wrapper: HTMLElement,
): void {
  const timelineByCmid = new Map<string, AssignmentTimeline>()
  for (const tl of timelines) {
    const cmid = tl.openEvent?.normalizedName ?? tl.closeEvent?.normalizedName ?? tl.dueEvent?.normalizedName
    if (cmid && /^\d+$/.test(cmid)) timelineByCmid.set(cmid, tl)
  }

  setInlineOverride(wrapper, 'overflow', 'visible', MARK_WRAPPER_OVERFLOW)
  const table = wrapper.querySelector<HTMLElement>('table.calendarmonth')
  if (table) setInlineOverride(table, 'overflow', 'visible', MARK_TABLE_OVERFLOW)

  for (const cell of cells) {
    const dayContent = cell.element.querySelector<HTMLElement>('[data-region="day-content"]')
    if (!dayContent) continue

    const sourceItems = dayContent.querySelectorAll<HTMLElement>('li[data-region="event-item"]')
    if (!sourceItems.length) continue

    const nativeList = dayContent.querySelector<HTMLElement>('ul')
    if (nativeList) setInlineOverride(nativeList, 'display', 'none', MARK_NATIVE_UL_DISPLAY)

    setInlineOverride(dayContent, 'overflow', 'visible', MARK_DAY_CONTENT_OVERFLOW)
    setInlineOverride(dayContent, 'position', 'relative', MARK_DAY_CONTENT_POSITION)
    setInlineOverride(dayContent, 'z-index', '80', MARK_DAY_CONTENT_ZINDEX)
    setInlineOverride(cell.element, 'overflow', 'visible', MARK_CELL_OVERFLOW)

    const list = document.createElement('ul')
    list.className = CUSTOM_LIST_CLASS

    sourceItems.forEach(item => {
      const anchor = item.querySelector<HTMLAnchorElement>('a[data-action="view-event"]')
      if (!anchor) return

      const name = item.querySelector('.eventname, .event-name')?.textContent?.trim()
        ?? anchor.title?.trim()
        ?? anchor.textContent?.trim()
        ?? ''
      if (!name) return

      const li = document.createElement('li')
      li.className = CUSTOM_ITEM_CLASS

      const cmid = extractCmid(anchor.href ?? '')
      const tl = cmid ? timelineByCmid.get(cmid) : undefined
      li.style.borderLeftColor = resolveEventListColor(tl, settings)

      const link = anchor.cloneNode(true) as HTMLAnchorElement
      link.textContent = name
      link.className = anchor.className
      link.dataset.action = anchor.dataset.action ?? 'view-event'

      link.addEventListener('click', e => {
        e.stopPropagation()
        e.preventDefault()
        openLinkLikeOriginal(link, e)
      })

      li.addEventListener('click', e => {
        e.stopPropagation()
        const target = e.target as HTMLElement
        if (target.closest('a')) return
        e.preventDefault()
        openLinkLikeOriginal(link, e)
      })

      list.appendChild(li)
      li.appendChild(link)

      if (tl?.completion && tl.completion !== 'unknown') {
        const badge = document.createElement('span')
        badge.className = 'moodline-day-badge'
        badge.textContent = tl.completion === 'completed' ? '完了' : '未完了'
        badge.style.backgroundColor = tl.completion === 'completed' ? '#22c55e' : '#f59e0b'
        li.appendChild(badge)
      }
    })

    if (list.childElementCount > 0) dayContent.appendChild(list)
  }
}

function getDaysBetween(startTs: number, endTs: number, cells: DayCell[]): DayCell[] {
  const s = Math.floor(startTs / 86400)
  const e = Math.floor(endTs / 86400)
  return cells.filter(c => {
    const d = Math.floor(c.timestamp / 86400)
    return d >= s && d <= e
  })
}

function getWrapper(): HTMLElement | null {
  const table = document.querySelector<HTMLElement>('table.calendarmonth')
  if (!table) return null
  const wrapper = table.closest<HTMLElement>('.calendarwrapper') ?? table.parentElement
  if (!wrapper) return null
  if (getComputedStyle(wrapper).position === 'static') wrapper.style.position = 'relative'
  return wrapper
}

// ─── Color resolver ──────────────────────────────────────────────────────────
function resolveColor(tl: AssignmentTimeline, tlIdx: number, settings: MoodlineSettings) {
  if (settings.colorMode === 'by-status') {
    const hex = tl.completion === 'completed' ? settings.statusColors.completed
              : tl.completion === 'incomplete' ? settings.statusColors.incomplete
              : settings.statusColors.unknown
    return { bar: hex, bg: hex + '44' }
  }
  return getColor(tlIdx)
}

// ─── Main render ─────────────────────────────────────────────────────────────
let _lastTimelines: AssignmentTimeline[] = []
let _lastCells: DayCell[] = []
let _lastSettings: MoodlineSettings = DEFAULT_SETTINGS

/** リサイズ・設定変更時に再描画 */
export function redrawOverlay(settings?: MoodlineSettings): void {
  if (!_lastTimelines.length || !_lastCells.length) return
  if (settings) _lastSettings = settings
  _renderOverlay(_lastTimelines, _lastCells, _lastSettings)
}

export function renderTimelines(timelines: AssignmentTimeline[], cells: DayCell[], settings: MoodlineSettings): void {
  _lastTimelines = timelines
  _lastCells = cells
  _lastSettings = settings
  _renderOverlay(timelines, cells, settings)
}

function _renderOverlay(timelines: AssignmentTimeline[], cells: DayCell[], settings: MoodlineSettings): void {
  if (!cells.length) return
  const wrapper = getWrapper()
  if (!wrapper) return

  const minVisibleTs = Math.min(...cells.map(c => c.timestamp))
  const maxVisibleTs = Math.max(...cells.map(c => c.timestamp))

  document.getElementById(OVERLAY_ID)?.remove()
  resetRowOverrides(cells)
  resetCalendarContentOverrides(cells)
  resetContainerOverflowOverrides(wrapper)

  if (settings.calendarEventDisplayMode === 'moodline') {
    applyCustomCalendarEventList(timelines, cells, settings, wrapper)
  }

  const overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  overlay.style.setProperty('--ml-base-opacity', String(settings.barOpacity))
  wrapper.appendChild(overlay)

  setupHoverSync(overlay)

  const wRect = wrapper.getBoundingClientRect()
  const allRowGroups = groupByRow(cells)

  const rowTimelineOrder = new Map<HTMLTableRowElement, string[]>()
  const rowTimelineSet = new Map<HTMLTableRowElement, Set<string>>()
  const timelineSegmentsByRow = new Map<string, Map<HTMLTableRowElement, DayCell[]>>()

  timelines.forEach(tl => {
    const isDueOnly = !!tl.isDueOnly
    const startTs = isDueOnly
      ? tl.dueEvent?.timestamp
      : (tl.openEvent?.timestamp ?? (tl.extendsBeforeView ? minVisibleTs : tl.dueEvent?.timestamp))
    const endTs = isDueOnly
      ? tl.dueEvent?.timestamp
      : (tl.closeEvent?.timestamp ?? tl.dueEvent?.timestamp ?? (tl.extendsAfterView ? maxVisibleTs : tl.openEvent?.timestamp))
    if (!startTs || !endTs) return

    const affected = getDaysBetween(startTs, endTs, cells)
    if (!affected.length) return

    const rowGroups = groupByRow(affected)
    timelineSegmentsByRow.set(tl.id, rowGroups)

    for (const [row] of rowGroups) {
      if (!rowTimelineSet.has(row)) rowTimelineSet.set(row, new Set())
      if (!rowTimelineOrder.has(row)) rowTimelineOrder.set(row, [])

      const set = rowTimelineSet.get(row)!
      if (!set.has(tl.id)) {
        set.add(tl.id)
        rowTimelineOrder.get(row)!.push(tl.id)
      }
    }
  })

  const rowLaneMap = new Map<HTMLTableRowElement, Map<string, number>>()
  const rowLaneCount = new Map<HTMLTableRowElement, number>()
  for (const [row, order] of rowTimelineOrder) {
    const laneMap = new Map<string, number>()
    order.forEach((id, idx) => laneMap.set(id, idx))
    rowLaneMap.set(row, laneMap)
    rowLaneCount.set(row, order.length)
  }

  for (const [row, rowCells] of allRowGroups) {
    const laneCount = rowLaneCount.get(row) ?? 0
    if (!laneCount) continue

    const reserveBottom = laneCount * (BAR_H + BAR_GAP) + BAR_BOTTOM_PAD + CELL_EXTRA_CONTENT_PAD
    for (const cell of rowCells) {
      const currentPadBottom = Number.parseFloat(getComputedStyle(cell.element).paddingBottom || '0') || 0
      if (reserveBottom > currentPadBottom) {
        cell.element.style.paddingBottom = `${reserveBottom}px`
      }
      const currentHeight = cell.element.getBoundingClientRect().height
      const minNeeded = Math.ceil(currentHeight + reserveBottom)
      cell.element.style.minHeight = `${minNeeded}px`
      cell.element.setAttribute(CELL_OVERRIDE_ATTR, '1')
    }
  }

  timelines.forEach((tl, tlIdx) => {
    const isDueOnly = !!tl.isDueOnly

    const startTs = isDueOnly
      ? tl.dueEvent?.timestamp
      : (tl.openEvent?.timestamp ?? (tl.extendsBeforeView ? minVisibleTs : tl.dueEvent?.timestamp))
    const endTs = isDueOnly
      ? tl.dueEvent?.timestamp
      : (tl.closeEvent?.timestamp ?? tl.dueEvent?.timestamp ?? (tl.extendsAfterView ? maxVisibleTs : tl.openEvent?.timestamp))
    if (!startTs || !endTs) return

    const color = resolveColor(tl, tlIdx, settings)
    const rowGroups = timelineSegmentsByRow.get(tl.id)
    if (!rowGroups || !rowGroups.size) return

    const startDay = Math.floor(startTs / 86400)
    const endDay = Math.floor(endTs / 86400)

    const tipSuffix = tl.completion === 'completed' ? '（完了）'
      : tl.completion === 'incomplete' ? '（未完了）'
        : ''
    const tipText = tl.name + tipSuffix

    // 背景
    for (const [, rowCells] of rowGroups) {
      rowCells.forEach(cell => {
        const r = cell.element.getBoundingClientRect()
        const bg = document.createElement('div')
        bg.className = 'ml-bg'
        bg.style.cssText = [
          `left:${r.left - wRect.left}px`,
          `top:${r.top - wRect.top}px`,
          `width:${r.width}px`,
          `height:${r.height}px`,
        ].join(';')
        overlay.appendChild(bg)
      })
    }

    // バー (1行 = 1セグメント)

    for (const [row, rowCells] of rowGroups) {
      const sorted = [...rowCells].sort((a, b) => a.timestamp - b.timestamp)
      const first = sorted[0]
      const last = sorted[sorted.length - 1]

      const lane = rowLaneMap.get(row)?.get(tl.id) ?? tlIdx
      const yOffset = lane * (BAR_H + BAR_GAP) + BAR_BOTTOM_PAD

      const isStart = Math.floor(first.timestamp / 86400) === startDay
      const isEnd = Math.floor(last.timestamp / 86400) === endDay

      const fRect = first.element.getBoundingClientRect()
      const lRect = last.element.getBoundingClientRect()

      const barLeft = fRect.left - wRect.left + (isStart ? START_INSET : -1)
      const barRight = lRect.right - wRect.left - (isEnd ? END_INSET : -1)
      const barTop = fRect.bottom - wRect.top - yOffset - BAR_H

      const bar = document.createElement('div')
      bar.className = 'ml-bar'
      bar.dataset.tlId = tl.id
      bar.dataset.tip = tipText
      if (isStart) bar.classList.add('is-start')
      if (isEnd) bar.classList.add('is-end')
      if (tl.completion === 'completed') bar.classList.add('status-completed')

      bar.style.cssText = [
        `left:${barLeft}px`,
        `top:${barTop}px`,
        `width:${barRight - barLeft}px`,
        `background-color:${color.bar}`,
      ].join(';')

      overlay.appendChild(bar)
    }
  })

  if (activeHoverTimelineId) {
    overlay.querySelectorAll<HTMLElement>(`[data-tl-id="${activeHoverTimelineId}"]`).forEach(b => b.classList.add('ml-hovered'))
  }
}

// ─── Upcoming events ─────────────────────────────────────────────────────────
export function enhanceUpcomingEvents(timelines: AssignmentTimeline[]): void {
  const nameMap = new Map(timelines.map(tl => [tl.name, tl]))

  document.querySelectorAll<HTMLElement>('[data-region="event-item"]').forEach(item => {
    if (item.hasAttribute('data-moodline-enhanced')) return
    const nameEl = item.querySelector('.eventname, .event-name')
    const rawName = nameEl?.textContent?.trim() ?? ''
    if (!rawName) return

    let matched: AssignmentTimeline | undefined
    for (const [name, tl] of nameMap) {
      if (rawName.includes(name) || name.includes(rawName)) { matched = tl; break }
    }
    if (!matched) return

    item.setAttribute('data-moodline-enhanced', '1')
    item.classList.add('moodline-enhanced')
      ; (item as HTMLElement).style.borderLeftColor = matched.color

    if (matched.completion !== 'unknown' && nameEl) {
      const badge = document.createElement('span')
      badge.className = 'moodline-upcoming-badge'
      badge.style.backgroundColor = matched.completion === 'completed' ? '#22c55e' : '#f59e0b'
      badge.textContent = matched.completion === 'completed' ? '完了' : '未完了'
      nameEl.appendChild(badge)
    }
  })
}
