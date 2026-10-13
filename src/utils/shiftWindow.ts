import { prisma } from '../lib/prisma';

export interface ShiftWindowContext {
  shift: {
    id: string;
    name: string;
    startTime: string; // "HH:mm" e.g. "15:00"
    endTime: string;   // "HH:mm" e.g. "00:00" or "03:00"
    graceTime: number; // in minutes
    breakDuration: number;
    weeklyOff: string[];
    isOvernight: boolean;
  };
  shiftDate: Date; // UTC Midnight of shift start day (e.g. 2026-10-13T00:00:00.000Z)
  shiftDateStr: string; // "2026-10-13"
  shiftStartDateTime: Date; // Actual start timestamp
  shiftEndDateTime: Date;   // Actual end timestamp
  
  // Window boundaries
  punchInWindowStart: Date; // 60 mins before shift start
  punchInWindowEnd: Date;   // 60 mins after shift start
  gracePeriodEnd: Date;     // shiftStart + graceTime mins
  shiftOngoingEnd: Date;    // shiftEnd + 120 mins buffer

  // States
  canPunchIn: boolean;      // True if within initial window and never punched in
  canResume: boolean;       // True if has prior logs and shift is ongoing
  isBeforeWindow: boolean;
  isWithinWindow: boolean;
  isAfterWindow: boolean;
  isLatePunch: boolean;
  
  formattedWindowStart: string; // e.g. "02:00 PM"
  formattedWindowEnd: string;   // e.g. "04:00 PM"
  formattedShiftStart: string;  // e.g. "03:00 PM"
  formattedShiftEnd: string;    // e.g. "12:00 AM"
  windowMessage: string;
}

/**
 * Normalizes any Date or date string to UTC Midnight (00:00:00.000Z)
 * using the local calendar year, month, and date of the provided value.
 */
export function getUtcMidnight(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0));
}

/**
 * Formats a Date object to "hh:mm a" (e.g. "02:00 PM")
 */
export function formatTime12h(date: Date): string {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // hour '0' should be '12'
  const minutesStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
  const hoursStr = hours < 10 ? `0${hours}` : `${hours}`;
  return `${hoursStr}:${minutesStr} ${ampm}`;
}

/**
 * Parses "HH:mm" time string into a Date on a given base date.
 */
function createDateTime(baseDate: Date, timeStr: string, addDays: number = 0): Date {
  const [h, m] = (timeStr || "09:00").split(':').map(Number);
  const result = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + addDays, h, m, 0, 0);
  return result;
}

/**
 * Checks if shift is overnight (crosses midnight).
 * e.g. 18:00 to 03:00 -> overnight.
 * 15:00 to 00:00 -> overnight (ends at midnight).
 * 16:00 to 01:00 -> overnight.
 */
export function isShiftCrossMidnight(startTime: string, endTime: string): boolean {
  const [sH, sM] = startTime.split(':').map(Number);
  const [eH, eM] = endTime.split(':').map(Number);
  const startMin = sH * 60 + sM;
  const endMin = eH * 60 + eM;
  return endMin <= startMin;
}

/**
 * Resolves the active shift context for an employee at a given moment in time (`now`).
 * Accurately handles:
 * 1. Daytime shifts (e.g. 09:00 - 18:00)
 * 2. Cross-midnight shifts (e.g. 18:00 - 03:00, 15:00 - 00:00, 16:00 - 01:00)
 * 3. Initial 60-minute early to 60-minute late punch-in window
 * 4. Session Resume for employees who punched in and later punched out
 */
export async function resolveEmployeeActiveShiftContext(
  employeeId: string,
  now: Date = new Date()
): Promise<ShiftWindowContext> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { shift: true }
  });

  if (!employee) {
    throw new Error("Employee profile not found");
  }

  // 1. First, check if employee currently has an OPEN attendance log (actively punched in right now)
  const openLog = await prisma.attendanceLog.findFirst({
    where: {
      attendance: { employeeId: employee.id },
      punchOut: null
    },
    include: {
      attendance: {
        include: { shift: true, logs: true }
      }
    },
    orderBy: { punchIn: 'desc' }
  });

  if (openLog && openLog.attendance) {
    const record = openLog.attendance;
    const shift = record.shift || employee.shift || await getDefaultShift();
    return buildShiftContext(shift, record.date, now, record.logs || []);
  }

  // 2. Check if YESTERDAY had a cross-midnight shift that is still actively ongoing
  const yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayUtcMidnight = getUtcMidnight(yesterdayDate);

  const yesterdayShift = await getShiftForEmployeeOnDate(employee.id, yesterdayUtcMidnight, employee.shift);
  if (yesterdayShift && isShiftCrossMidnight(yesterdayShift.startTime, yesterdayShift.endTime)) {
    // Yesterday's overnight shift end timestamp (on today's calendar day)
    const yesterdayShiftStart = createDateTime(yesterdayDate, yesterdayShift.startTime, 0);
    const yesterdayShiftEnd = createDateTime(yesterdayDate, yesterdayShift.endTime, 1);
    const bufferEnd = new Date(yesterdayShiftEnd.getTime() + 120 * 60 * 1000); // 2 hr buffer

    // If current time is before yesterday's shift buffer end (e.g. currently 02:00 AM for 18:00 - 03:00 shift)
    if (now <= bufferEnd) {
      // Check if yesterday has an existing attendance record
      const yesterdayRecord = await prisma.attendanceRecord.findUnique({
        where: { employeeId_date: { employeeId: employee.id, date: yesterdayUtcMidnight } },
        include: { logs: true, shift: true }
      });

      if (yesterdayRecord && yesterdayRecord.logs && yesterdayRecord.logs.length > 0) {
        // Employee started yesterday's night shift! Active shift context belongs to yesterday!
        return buildShiftContext(yesterdayShift, yesterdayUtcMidnight, now, yesterdayRecord.logs);
      }
    }
  }

  // 3. Normal Today's Shift Context
  const todayUtcMidnight = getUtcMidnight(now);
  const todayShift = await getShiftForEmployeeOnDate(employee.id, todayUtcMidnight, employee.shift);

  const todayRecord = await prisma.attendanceRecord.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: todayUtcMidnight } },
    include: { logs: true }
  });

  return buildShiftContext(todayShift, todayUtcMidnight, now, todayRecord?.logs || []);
}

/**
 * Builds the complete window and state context for a given shift on a specific shift date.
 */
function buildShiftContext(
  shift: any,
  shiftUtcDate: Date,
  now: Date,
  existingLogs: any[] = []
): ShiftWindowContext {
  const isOvernight = isShiftCrossMidnight(shift.startTime, shift.endTime);

  // Reconstruct local base date from UTC midnight date
  const baseDate = new Date(shiftUtcDate.getUTCFullYear(), shiftUtcDate.getUTCMonth(), shiftUtcDate.getUTCDate());

  const shiftStartDateTime = createDateTime(baseDate, shift.startTime, 0);
  const shiftEndDateTime = createDateTime(baseDate, shift.endTime, isOvernight ? 1 : 0);

  // Allowed initial punch-in window: 60 mins before shift start to 60 mins after shift start
  const punchInWindowStart = new Date(shiftStartDateTime.getTime() - 60 * 60 * 1000);
  const punchInWindowEnd = new Date(shiftStartDateTime.getTime() + 60 * 60 * 1000);
  const gracePeriodEnd = new Date(shiftStartDateTime.getTime() + (shift.graceTime || 15) * 60 * 1000);
  const shiftOngoingEnd = new Date(shiftEndDateTime.getTime() + 120 * 60 * 1000); // 2 hours buffer after shift

  const isBeforeWindow = now.getTime() < punchInWindowStart.getTime();
  const isWithinWindow = now.getTime() >= punchInWindowStart.getTime() && now.getTime() <= punchInWindowEnd.getTime();
  const isAfterWindow = now.getTime() > punchInWindowEnd.getTime();
  const isLatePunch = now.getTime() > gracePeriodEnd.getTime();

  const hasLogs = existingLogs && existingLogs.length > 0;
  const isShiftOngoing = now.getTime() >= punchInWindowStart.getTime() && now.getTime() <= shiftOngoingEnd.getTime();

  let canPunchIn = false;
  let canResume = false;
  let windowMessage = "";

  const formattedWindowStart = formatTime12h(punchInWindowStart);
  const formattedWindowEnd = formatTime12h(punchInWindowEnd);
  const formattedShiftStart = formatTime12h(shiftStartDateTime);
  const formattedShiftEnd = formatTime12h(shiftEndDateTime);

  if (hasLogs) {
    // Employee ALREADY punched in for this shift earlier!
    const openLog = existingLogs.find(l => !l.punchOut);
    if (openLog) {
      canPunchIn = false;
      canResume = false;
      windowMessage = "Currently working (Checked In)";
    } else {
      // Punched out earlier -> SESSION RESUME ELIGIBLE
      if (isShiftOngoing) {
        canResume = true;
        canPunchIn = false;
        windowMessage = `Shift is in progress. You can resume your session until ${formattedShiftEnd}.`;
      } else {
        canResume = false;
        canPunchIn = false;
        windowMessage = "Shift hours completed.";
      }
    }
  } else {
    // Initial punch-in attempt
    if (isBeforeWindow) {
      canPunchIn = false;
      canResume = false;
      windowMessage = `Punch-in opens at ${formattedWindowStart} (1 hour before ${shift.name}).`;
    } else if (isWithinWindow) {
      canPunchIn = true;
      canResume = false;
      windowMessage = `Punch-in window is open until ${formattedWindowEnd}.`;
    } else {
      // More than 1 hour after shift start and NEVER punched in
      canPunchIn = false;
      canResume = false;
      windowMessage = `Punch-in window closed at ${formattedWindowEnd} (1 hour after shift start). Marked Absent.`;
    }
  }

  const yyyy = shiftUtcDate.getUTCFullYear();
  const mm = String(shiftUtcDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shiftUtcDate.getUTCDate()).padStart(2, '0');
  const shiftDateStr = `${yyyy}-${mm}-${dd}`;

  return {
    shift: {
      id: shift.id,
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      graceTime: shift.graceTime || 15,
      breakDuration: shift.breakDuration || 60,
      weeklyOff: shift.weeklyOff || ["Sunday"],
      isOvernight
    },
    shiftDate: shiftUtcDate,
    shiftDateStr,
    shiftStartDateTime,
    shiftEndDateTime,
    punchInWindowStart,
    punchInWindowEnd,
    gracePeriodEnd,
    shiftOngoingEnd,
    canPunchIn,
    canResume,
    isBeforeWindow,
    isWithinWindow,
    isAfterWindow,
    isLatePunch,
    formattedWindowStart,
    formattedWindowEnd,
    formattedShiftStart,
    formattedShiftEnd,
    windowMessage
  };
}

/**
 * Retrieves the scheduled shift for an employee on a given UTC date:
 * First checks published WeeklyRoster entry, then Employee.shift, then default shift.
 */
async function getShiftForEmployeeOnDate(employeeId: string, dateUtc: Date, defaultShift: any): Promise<any> {
  try {
    const rosterEntry = await prisma.rosterEntry.findFirst({
      where: {
        employeeId,
        date: dateUtc,
        roster: { status: 'PUBLISHED' }
      },
      include: { shift: true }
    });

    if (rosterEntry && rosterEntry.shift) {
      return rosterEntry.shift;
    }
  } catch (e) {}

  if (defaultShift) return defaultShift;
  return await getDefaultShift();
}

/**
 * Fallback default shift
 */
async function getDefaultShift(): Promise<any> {
  const existing = await prisma.shift.findFirst({ where: { status: true } });
  if (existing) return existing;
  return {
    id: 'default-day-shift',
    name: 'General Day Shift',
    startTime: '09:00',
    endTime: '18:00',
    graceTime: 15,
    breakDuration: 60,
    weeklyOff: ['Saturday', 'Sunday'],
    status: true
  };
}
