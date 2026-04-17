export type ColorMode = 'by-assignment' | 'by-status'

export interface StatusColors {
  completed: string   // hex
  incomplete: string
  unknown: string
}

export interface MoodlineSettings {
  colorMode: ColorMode
  statusColors: StatusColors
  barOpacity: number
}

export const DEFAULT_SETTINGS: MoodlineSettings = {
  colorMode: 'by-assignment',
  barOpacity: 0.45,
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

export async function loadSettings(): Promise<MoodlineSettings> {
  const stored = await chrome.storage.sync.get('moodlineSettings')
  if (!stored.moodlineSettings) return DEFAULT_SETTINGS

  const merged = { ...DEFAULT_SETTINGS, ...stored.moodlineSettings }
  return {
    ...merged,
    barOpacity: normalizeOpacity(merged.barOpacity),
    statusColors: { ...DEFAULT_SETTINGS.statusColors, ...merged.statusColors },
  }
}

export async function saveSettings(s: MoodlineSettings): Promise<void> {
  await chrome.storage.sync.set({
    moodlineSettings: {
      ...s,
      barOpacity: normalizeOpacity(s.barOpacity),
    },
  })
}
