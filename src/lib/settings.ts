import { webext } from '$lib/webext'

export type ColorMode = 'by-assignment' | 'by-status'
export type CalendarEventDisplayMode = 'native' | 'moodline'

export interface StatusColors {
  completed: string   // hex
  incomplete: string
  unknown: string
}

export interface MoodlineSettings {
  colorMode: ColorMode
  statusColors: StatusColors
  barOpacity: number
  calendarEventDisplayMode: CalendarEventDisplayMode
  hiddenTimelineKeys: string[]
}

export const DEFAULT_SETTINGS: MoodlineSettings = {
  colorMode: 'by-assignment',
  barOpacity: 0.45,
  calendarEventDisplayMode: 'moodline',
  hiddenTimelineKeys: [],
  statusColors: {
    completed: '#22c55e',
    incomplete: '#f59e0b',
    unknown: '#94a3b8',
  },
}

function normalizeOpacity(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.barOpacity
  return Math.min(1, Math.max(0, n))
}

function normalizeCalendarEventDisplayMode(v: unknown): CalendarEventDisplayMode {
  return v === 'native' ? 'native' : 'moodline'
}

function normalizeHiddenTimelineKeys(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .slice(0, 2000)
}

export async function loadSettings(): Promise<MoodlineSettings> {
  const stored = await webext.storage.sync.get('moodlineSettings')
  if (!stored.moodlineSettings) return DEFAULT_SETTINGS

  const merged = { ...DEFAULT_SETTINGS, ...stored.moodlineSettings }
  return {
    ...merged,
    barOpacity: normalizeOpacity(merged.barOpacity),
    calendarEventDisplayMode: normalizeCalendarEventDisplayMode(merged.calendarEventDisplayMode),
    hiddenTimelineKeys: normalizeHiddenTimelineKeys(merged.hiddenTimelineKeys),
    statusColors: { ...DEFAULT_SETTINGS.statusColors, ...merged.statusColors },
  }
}

export async function saveSettings(s: MoodlineSettings): Promise<void> {
  await webext.storage.sync.set({
    moodlineSettings: {
      ...s,
      barOpacity: normalizeOpacity(s.barOpacity),
      calendarEventDisplayMode: normalizeCalendarEventDisplayMode(s.calendarEventDisplayMode),
      hiddenTimelineKeys: normalizeHiddenTimelineKeys(s.hiddenTimelineKeys),
    },
  })
}
