export type EventType = 'open' | 'due' | 'close' | 'unknown'
export type CompletionStatus = 'completed' | 'incomplete' | 'unknown'

export interface CalendarEvent {
  id: string
  name: string
  normalizedName: string
  type: EventType
  component: string // mod_quiz, mod_assign, etc.
  timestamp: number // day-level Unix timestamp
  element: HTMLElement
}

export interface AssignmentTimeline {
  id: string
  name: string
  component: string
  color: string
  openEvent?: CalendarEvent
  dueEvent?: CalendarEvent
  closeEvent?: CalendarEvent
  completion: CompletionStatus
}

export interface DayCell {
  timestamp: number
  day: number
  element: HTMLTableCellElement
}

/** DOM要素を持たないシリアライズ可能な版（popup通信用） */
export interface SerializableTimeline {
  id: string
  name: string
  component: string
  color: string
  completion: CompletionStatus
  openTs?: number
  closeTs?: number
  dueTs?: number
}
