export type EventType = 'open' | 'due' | 'close' | 'unknown'
export type CompletionStatus = 'completed' | 'incomplete' | 'unknown'

export interface CalendarEvent {
  id: string
  name: string
  normalizedName: string
  type: EventType
  component: string // mod_quiz, mod_assign, etc.
  timestamp: number // day-level Unix timestamp
  element?: HTMLElement
}

export interface CalendarRangeHint {
  openTs?: number
  dueTs?: number
  closeTs?: number
}

export interface AssignmentTimeline {
  id: string
  timelineKey: string
  name: string
  component: string
  color: string
  openEvent?: CalendarEvent
  dueEvent?: CalendarEvent
  closeEvent?: CalendarEvent
  extendsBeforeView?: boolean
  extendsAfterView?: boolean
  isDueOnly?: boolean
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
  timelineKey: string
  name: string
  component: string
  color: string
  completion: CompletionStatus
  hidden?: boolean
  openTs?: number
  closeTs?: number
  dueTs?: number
  displayStartTs?: number
  displayEndTs?: number
}
