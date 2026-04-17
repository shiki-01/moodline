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

  document.getElementById(OVERLAY_ID)?.remove()
  const overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  overlay.style.setProperty('--ml-base-opacity', String(settings.barOpacity))
  wrapper.appendChild(overlay)

  setupHoverSync(overlay)

  const wRect = wrapper.getBoundingClientRect()

  timelines.forEach((tl, tlIdx) => {
    const startTs = tl.openEvent?.timestamp ?? tl.dueEvent?.timestamp
    const endTs = tl.closeEvent?.timestamp ?? tl.dueEvent?.timestamp
    if (!startTs || !endTs) return

    const color = resolveColor(tl, tlIdx, settings)
    const affected = getDaysBetween(startTs, endTs, cells)
    if (!affected.length) return

    const startDay = Math.floor(startTs / 86400)
    const endDay = Math.floor(endTs / 86400)

    const tipSuffix = tl.completion === 'completed' ? '（完了）'
      : tl.completion === 'incomplete' ? '（未完了）'
        : ''
    const tipText = tl.name + tipSuffix

    // 背景
    affected.forEach(cell => {
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

    // バー (1行 = 1セグメント)
    const yOffset = tlIdx * (BAR_H + BAR_GAP) + BAR_BOTTOM_PAD
    const rowGroups = groupByRow(affected)

    for (const [, rowCells] of rowGroups) {
      const sorted = [...rowCells].sort((a, b) => a.timestamp - b.timestamp)
      const first = sorted[0]
      const last = sorted[sorted.length - 1]

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
