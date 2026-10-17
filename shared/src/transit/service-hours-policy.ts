import type { ShuttleServiceWindow } from './service-hours.ts'
export type { ShuttleServiceWindow } from './service-hours.ts'
export type ShuttleServiceStatus = 'active' | 'before-start' | 'after-end' | 'unavailable'

export interface ShuttleServiceEvaluation {
  readonly status: ShuttleServiceStatus
  readonly nextStartLabel: string | null
}

export interface ShuttleServiceStart {
  readonly minutesUntil: number
  readonly label: string
}

export const SHUTTLE_SERVICE_START_GRACE_MINUTES = 30
export const SHUTTLE_SERVICE_HOURS_REFRESH_INTERVAL_MS = 5 * 60 * 1_000

interface LocalDateTime {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly weekday: number
  readonly minutes: number
}

const SINGAPORE_TIME_ZONE = 'Asia/Singapore'
const LOCAL_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: SINGAPORE_TIME_ZONE,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function partsOf(date: Date): Record<string, string> {
  return Object.fromEntries(
    LOCAL_DATE_FORMATTER.formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value]),
  )
}

function localDateTime(date: Date): LocalDateTime {
  const parts = partsOf(date)
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  return {
    year,
    month,
    day,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

function dateKey(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function dayTypeMatches(dayType: string, weekday: number): boolean {
  const normalized = dayType.trim().toLowerCase()
  if (normalized === 'sat') return weekday === 6
  if (normalized === 'sun') return weekday === 0
  if (normalized === 'mon-fri' || normalized === 'weekday' || normalized === 'weekdays') {
    return weekday >= 1 && weekday <= 5
  }
  return false
}

function windowsForDate(
  windows: readonly ShuttleServiceWindow[],
  date: LocalDateTime,
): readonly ShuttleServiceWindow[] {
  const key = dateKey(date.year, date.month, date.day)
  const dated = windows.filter((serviceWindow) => serviceWindow.dates.includes(key))
  if (dated.length > 0) return dated
  return windows.filter((serviceWindow) => dayTypeMatches(serviceWindow.dayType, date.weekday))
}

function minutesFromTime(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHour = hours % 12 || 12
  return `${displayHour}:${remainder.toString().padStart(2, '0')} ${suffix}`
}

function nextDate(date: LocalDateTime, offset: number): LocalDateTime {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + offset))
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
    weekday: value.getUTCDay(),
    minutes: 0,
  }
}

function nextStartDetails(
  windows: readonly ShuttleServiceWindow[],
  date: LocalDateTime,
): ShuttleServiceStart | null {
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidateDate = nextDate(date, offset)
    const candidateWindows = windowsForDate(windows, candidateDate)
    const starts = candidateWindows
      .map((serviceWindow) => minutesFromTime(serviceWindow.firstTime))
      .filter((minutes): minutes is number => minutes !== null)
      .filter((minutes) => offset > 0 || minutes > date.minutes)
      .sort((first, second) => first - second)
    const start = starts[0]
    if (start === undefined) continue
    const dayLabel = offset === 0 ? 'today' : offset === 1
      ? 'tomorrow'
      : candidateDate.weekday === 1 ? 'Monday'
        : candidateDate.weekday === 2 ? 'Tuesday'
          : candidateDate.weekday === 3 ? 'Wednesday'
            : candidateDate.weekday === 4 ? 'Thursday'
              : candidateDate.weekday === 5 ? 'Friday'
                : candidateDate.weekday === 6 ? 'Saturday' : 'Sunday'
    return {
      minutesUntil: offset * 24 * 60 + start - date.minutes,
      label: `${dayLabel} at ${formatTime(start)}`,
    }
  }
  return null
}

export function getNextShuttleServiceStart(
  windows: readonly ShuttleServiceWindow[],
  now = new Date(),
): ShuttleServiceStart | null {
  return nextStartDetails(windows, localDateTime(now))
}

export function evaluateShuttleService(
  windows: readonly ShuttleServiceWindow[],
  now = new Date(),
): ShuttleServiceEvaluation {
  const date = localDateTime(now)
  const candidates = windowsForDate(windows, date)
  const ranges = candidates.flatMap((serviceWindow) => {
    const first = minutesFromTime(serviceWindow.firstTime)
    const last = minutesFromTime(serviceWindow.lastTime)
    return first === null || last === null || last < first ? [] : [{ first, last }]
  })
  if (ranges.some(({ first, last }) => date.minutes >= first && date.minutes <= last)) {
    return { status: 'active', nextStartLabel: null }
  }

  const nextStart = nextStartDetails(windows, date)
  if (ranges.some(({ first }) => date.minutes < first)) {
    return { status: 'before-start', nextStartLabel: nextStart?.label ?? null }
  }
  if (ranges.length > 0) return { status: 'after-end', nextStartLabel: nextStart?.label ?? null }
  return { status: 'unavailable', nextStartLabel: nextStart?.label ?? null }
}

export function describeShuttleServiceUnavailable(
  evaluation: ShuttleServiceEvaluation,
): string {
  if (evaluation.status === 'before-start') {
    return `bus service has not started yet${evaluation.nextStartLabel ? `. It resumes ${evaluation.nextStartLabel}` : ''}.`
  }
  if (evaluation.status === 'after-end') {
    return `bus service has ended for today${evaluation.nextStartLabel ? `. It resumes ${evaluation.nextStartLabel}` : ''}.`
  }
  return 'bus service hours are unavailable right now.'
}
