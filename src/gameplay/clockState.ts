import { hourAt, startHourFor, type ClockSettings } from '../world';

/** The day's clock after a change: how long a day lasts, whether time stands still, or (`hour`) what time it is now. */
export function changeClock(clock: ClockSettings, change: Partial<Pick<ClockSettings, 'dayMinutes' | 'frozen'>> & { hour?: number }, time: number): ClockSettings {
  const { hour, ...rest } = change;
  const now = hourAt(time, clock); // keep the time of day when only the speed changes
  const next = { ...clock, ...rest };
  next.startHour = startHourFor(hour ?? now, time, next);
  return next;
}
