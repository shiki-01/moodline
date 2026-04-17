import { parseDayCells, parseCalendarEvents, buildTimelines, setCompletionMap } from '$lib/parser'
import { injectStyles, renderTimelines, enhanceUpcomingEvents, redrawOverlay } from '$lib/overlay'
import { loadSettings, DEFAULT_SETTINGS } from '$lib/settings'
import { fetchCompletionMap } from '$lib/moodle-api'
import type { MoodlineSettings } from '$lib/settings'
import type { SerializableTimeline, AssignmentTimeline } from '$lib/types'

let cachedTimelines: SerializableTimeline[] = []
let lastCellKey = ''
let currentSettings: MoodlineSettings = DEFAULT_SETTINGS
let suppressObserverUntil = 0

function suppressObserver(ms = 700): void {
  suppressObserverUntil = Date.now() + ms
}

function cellKey(cells: ReturnType<typeof parseDayCells>): string {
  return cells.map(c => c.timestamp).join(',')
}

function toSerializable(tl: AssignmentTimeline): SerializableTimeline {
  return {
    id: tl.id,
    name: tl.name,
    component: tl.component,
    color: tl.color,
    completion: tl.completion,
    openTs: tl.openEvent?.timestamp,
    closeTs: tl.closeEvent?.timestamp,
    dueTs: tl.dueEvent?.timestamp,
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

  const timelines = buildTimelines(events)
  cachedTimelines = timelines.map(toSerializable)

  // Moodline 自身の DOM 更新で observer が再描画ループしないよう短時間抑止
  suppressObserver()
  renderTimelines(timelines, cells, currentSettings)
  enhanceUpcomingEvents(timelines)
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
  render() // まず即描画（完了状態なし）

  // カレンダーイベントから cmid を収集
  const events = parseCalendarEvents()
  const knownCmids = new Set(
    events
      .map(e => e.normalizedName) // normalizedName = cmid (extractCmid の結果)
      .filter(v => /^\d+$/.test(v)) // 数字のみ = cmid
  )

  if (!knownCmids.size) return

  const completionMap = await fetchCompletionMap(knownCmids).catch(e => {
    const message = e instanceof Error ? e.message : String(e)
    const isDisabledWebservice = /ウェブサービスを利用できません|存在しないか、無効にされています/i.test(message)
    if (isDisabledWebservice) {
      console.info('[Moodline] completion web service unavailable, fallback used')
    } else {
      console.warn('[Moodline] completion API failed:', e)
    }
    return new Map<string, import('$lib/types').CompletionStatus>()
  })

  if (!completionMap.size) return

  setCompletionMap(completionMap)
  // 完了状態を反映して再描画（セルキーをリセットして強制）
  lastCellKey = ''
  render()
}

init()

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_TIMELINES') sendResponse({ timelines: cachedTimelines })
  return true
})

// 設定変更 → 即再描画
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.moodlineSettings) return
  loadSettings().then(s => {
    currentSettings = s
    suppressObserver()
    redrawOverlay(s)
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
    // セルキーをリセットして強制再描画
    lastCellKey = ''
    render()
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
