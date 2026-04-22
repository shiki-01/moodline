import { parseDayCells, parseCalendarEvents, buildTimelines, setCompletionMap } from '$lib/parser'
import { injectStyles, renderTimelines, enhanceUpcomingEvents, redrawOverlay } from '$lib/overlay'
import { loadSettings, DEFAULT_SETTINGS } from '$lib/settings'
import { fetchCompletionMap, fetchCalendarRangeHints } from '$lib/moodle-api'
import { webext } from '$lib/webext'
import type { MoodlineSettings } from '$lib/settings'
import type { SerializableTimeline, AssignmentTimeline, CalendarRangeHint } from '$lib/types'

let cachedTimelines: SerializableTimeline[] = []
let lastCellKey = ''
let currentSettings: MoodlineSettings = DEFAULT_SETTINGS
let suppressObserverUntil = 0
let cachedRangeHints = new Map<string, CalendarRangeHint>()
let isFetching = false

function suppressObserver(ms = 700): void {
  suppressObserverUntil = Date.now() + ms
}

function cellKey(cells: ReturnType<typeof parseDayCells>): string {
  return cells.map(c => c.timestamp).join(',')
}

function toSerializable(tl: AssignmentTimeline): SerializableTimeline {
  return {
    id: tl.id,
    timelineKey: tl.timelineKey,
    name: tl.name,
    component: tl.component,
    color: tl.color,
    completion: tl.completion,
    hidden: false,
    openTs: tl.openEvent?.timestamp,
    closeTs: tl.closeEvent?.timestamp,
    dueTs: tl.dueEvent?.timestamp,
  }
}

function getEffectiveRange(
  tl: AssignmentTimeline,
  minVisibleTs: number,
  maxVisibleTs: number,
): { startTs?: number; endTs?: number } {
  const isDueOnly = !!tl.isDueOnly
  const startTs = isDueOnly
    ? tl.dueEvent?.timestamp
    : (tl.openEvent?.timestamp ?? (tl.extendsBeforeView ? minVisibleTs : tl.dueEvent?.timestamp))
  const endTs = isDueOnly
    ? tl.dueEvent?.timestamp
    : (tl.closeEvent?.timestamp ?? tl.dueEvent?.timestamp ?? (tl.extendsAfterView ? maxVisibleTs : tl.openEvent?.timestamp))
  return { startTs, endTs }
}

function isTimelineHidden(tl: AssignmentTimeline): boolean {
  return currentSettings.hiddenTimelineKeys.includes(tl.timelineKey)
}

function toSerializableForPopup(
  tl: AssignmentTimeline,
  minVisibleTs: number,
  maxVisibleTs: number,
): SerializableTimeline {
  const base = toSerializable(tl)
  const { startTs, endTs } = getEffectiveRange(tl, minVisibleTs, maxVisibleTs)
  return {
    ...base,
    hidden: isTimelineHidden(tl),
    displayStartTs: startTs,
    displayEndTs: endTs,
  }
}

function render(): void {
  const cells = parseDayCells()
  if (!cells.length) return

  const key = cellKey(cells)
  if (key === lastCellKey) return
  lastCellKey = key

  injectStyles()

  const events = parseCalendarEvents()
  if (!events.length) return

  const minVisibleTs = Math.min(...cells.map(c => c.timestamp))
  const maxVisibleTs = Math.max(...cells.map(c => c.timestamp))

  const allTimelines = buildTimelines(events, cachedRangeHints)
  const visibleTimelines = allTimelines.filter(tl => !isTimelineHidden(tl))
  cachedTimelines = allTimelines.map(tl => toSerializableForPopup(tl, minVisibleTs, maxVisibleTs))

  // Moodline 自身の DOM 更新で observer が再描画ループしないよう短時間抑止
  suppressObserver()
  renderTimelines(visibleTimelines, cells, currentSettings)
  enhanceUpcomingEvents(visibleTimelines)
}

async function init(): Promise<void> {
  const settings = await loadSettings()

  currentSettings = settings

  // DOM 準備後に描画 → API で完了状態を補完して再描画
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fetchAndRender)
  } else {
    fetchAndRender()
  }
}

async function fetchAndRender(): Promise<void> {
  if (isFetching) return
  isFetching = true

  try {
    render() // まず即描画（完了状態なし）

    // カレンダーイベントから cmid を収集
    const events = parseCalendarEvents()
    const knownCmids = new Set(
      events
        .map(e => e.normalizedName) // normalizedName = cmid (extractCmid の結果)
        .filter(v => /^\d+$/.test(v)) // 数字のみ = cmid
    )

    if (!knownCmids.size) return

    const [completionMap, rangeHints] = await Promise.all([
      fetchCompletionMap(knownCmids).catch(e => {
        const message = e instanceof Error ? e.message : String(e)
        const isDisabledWebservice = /ウェブサービスを利用できません|存在しないか、無効にされています/i.test(message)
        if (isDisabledWebservice) {
          console.info('[Moodline] completion web service unavailable, fallback used')
        } else {
          console.warn('[Moodline] completion API failed:', e)
        }
        return new Map<string, import('$lib/types').CompletionStatus>()
      }),
      fetchCalendarRangeHints(knownCmids).catch(e => {
        console.info('[Moodline] calendar range hints unavailable, fallback to visible events:', e)
        return new Map<string, CalendarRangeHint>()
      }),
    ])

    if (completionMap.size) setCompletionMap(completionMap)
    if (rangeHints.size) cachedRangeHints = rangeHints

    if (!completionMap.size && !rangeHints.size) return

    // 完了状態を反映して再描画（セルキーをリセットして強制）
    lastCellKey = ''
    render()
  } finally {
    isFetching = false
  }
}

init()

webext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_TIMELINES') sendResponse({ timelines: cachedTimelines })
  return true
})

// 設定変更 → 即再描画
webext.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.moodlineSettings) return
  loadSettings().then(s => {
    currentSettings = s
    suppressObserver()
    lastCellKey = ''
    render()
  })
})

// カレンダー月移動などの DOM 変化に追随
let debounceTimer: ReturnType<typeof setTimeout>
function isCalendarRelatedMutation(m: MutationRecord): boolean {
  const roots = [
    m.target,
    ...Array.from(m.addedNodes),
    ...Array.from(m.removedNodes),
  ]

  return roots.some(n => {
    if (!(n instanceof Element)) return false
    return !!n.closest(
      '.calendarwrapper, table.calendarmonth, td[data-day-timestamp], [data-region="event-item"], [data-region="event-list-item"]'
    )
  })
}

const observer = new MutationObserver(mutations => {
  if (Date.now() < suppressObserverUntil) return

  const isOwnChange = mutations.every(m => {
    const t = m.target as Element
    return (
      t.id === 'moodline-overlay' ||
      t.id === 'moodline-tooltip' ||
      !!t.closest?.('#moodline-overlay') ||
      !!t.closest?.('#moodline-tooltip')
    )
  })
  if (isOwnChange) return

  const hasCalendarChange = mutations.some(isCalendarRelatedMutation)
  if (!hasCalendarChange) return

  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    suppressObserver()
    document.querySelectorAll('[data-moodline-enhanced]').forEach(el => {
      el.removeAttribute('data-moodline-enhanced')
      el.classList.remove('moodline-enhanced')
      el.querySelector('.moodline-upcoming-badge')?.remove()
    })

    const newKey = cellKey(parseDayCells())
    if (newKey && newKey !== lastCellKey) {
      // 月が切り替わった → キャッシュをリセットして API 再取得
      cachedRangeHints = new Map()
      setCompletionMap(new Map())
      lastCellKey = ''
      fetchAndRender()
    } else {
      lastCellKey = ''
      render()
    }
  }, 300)
})

observer.observe(document.body, { childList: true, subtree: true })

let resizeTimer: ReturnType<typeof setTimeout>
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    suppressObserver()
    redrawOverlay()
  }, 150)
}, { passive: true })
