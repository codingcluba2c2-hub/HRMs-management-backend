export const REQUIRED_WORKING_MINUTES = 480; // 8 Hours
export const HALF_DAY_THRESHOLD_MINUTES = 240; // 4 Hours

export type AttendanceStatus = 'INSUFFICIENT_HOURS' | 'HALF_DAY' | 'PRESENT' | 'ABSENT' | 'LEAVE' | 'HOLIDAY' | 'WEEKEND';

/**
 * Calculates official attendance status strictly based on total daily effective working minutes.
 * 
 * Rules:
 * - < 240 minutes (< 4.0h) ➔ INSUFFICIENT_HOURS (NOT Present)
 * - 240 to 479 minutes (4.0h - 7.99h) ➔ HALF_DAY
 * - >= 480 minutes (>= 8.0h) ➔ PRESENT
 */
export function calculateAttendanceStatus(totalEffectiveMinutes: number): AttendanceStatus {
  if (totalEffectiveMinutes < HALF_DAY_THRESHOLD_MINUTES) {
    return 'INSUFFICIENT_HOURS';
  }
  if (totalEffectiveMinutes < REQUIRED_WORKING_MINUTES) {
    return 'HALF_DAY';
  }
  return 'PRESENT';
}

export function formatMinutesToHoursMinutes(minutes: number): string {
  const safeMins = Math.max(0, Math.floor(minutes));
  const hrs = Math.floor(safeMins / 60);
  const mins = safeMins % 60;
  if (hrs === 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
}
