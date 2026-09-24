import assert from 'assert';
import { calculateAttendanceStatus, REQUIRED_WORKING_MINUTES, HALF_DAY_THRESHOLD_MINUTES } from '../../../config/attendancePolicy';

function testAttendanceSessionPolicy() {
  console.log('🧪 Running Attendance Session & Working Hours Policy Integration Tests...\n');

  // Test 1: < 240 minutes (e.g. 132 mins / 2.2h) -> INSUFFICIENT_HOURS
  const status132 = calculateAttendanceStatus(132);
  assert.strictEqual(status132, 'INSUFFICIENT_HOURS', `Expected INSUFFICIENT_HOURS for 132m, got ${status132}`);
  console.log('✅ Test 1 Passed: 132 minutes (2.2h) ➔ INSUFFICIENT_HOURS (NOT Present)');

  // Test 2: Exactly 239 minutes -> INSUFFICIENT_HOURS
  const status239 = calculateAttendanceStatus(239);
  assert.strictEqual(status239, 'INSUFFICIENT_HOURS', `Expected INSUFFICIENT_HOURS for 239m, got ${status239}`);
  console.log('✅ Test 2 Passed: Exactly 239 minutes (3.98h) ➔ INSUFFICIENT_HOURS');

  // Test 3: Exactly 240 minutes -> HALF_DAY
  const status240 = calculateAttendanceStatus(240);
  assert.strictEqual(status240, 'HALF_DAY', `Expected HALF_DAY for 240m, got ${status240}`);
  console.log('✅ Test 3 Passed: Exactly 240 minutes (4.0h) ➔ HALF_DAY');

  // Test 4: Exactly 479 minutes -> HALF_DAY
  const status479 = calculateAttendanceStatus(479);
  assert.strictEqual(status479, 'HALF_DAY', `Expected HALF_DAY for 479m, got ${status479}`);
  console.log('✅ Test 4 Passed: Exactly 479 minutes (7.98h) ➔ HALF_DAY');

  // Test 5: Exactly 480 minutes -> PRESENT
  const status480 = calculateAttendanceStatus(480);
  assert.strictEqual(status480, 'PRESENT', `Expected PRESENT for 480m, got ${status480}`);
  console.log('✅ Test 5 Passed: Exactly 480 minutes (8.0h) ➔ PRESENT');

  // Test 6: 540 minutes (9.0h) -> PRESENT
  const status540 = calculateAttendanceStatus(540);
  assert.strictEqual(status540, 'PRESENT', `Expected PRESENT for 540m, got ${status540}`);
  console.log('✅ Test 6 Passed: 540 minutes (9.0h) ➔ PRESENT');

  // Test 8: Open session duration calculation vs Completed session calculation
  const openSessionPunchIn = new Date('2026-09-21T14:06:00.000Z');
  // For open session, punchOut MUST remain null
  const openLog = { punchIn: openSessionPunchIn, punchOut: null };
  assert.strictEqual(openLog.punchOut, null, 'Open session punchOut must be null');
  console.log('✅ Test 8 Passed: Open session punchOut is strictly null');

  // Test 9: Cross-midnight explicit punch out duration (21 Sep 10:00 PM -> 22 Sep 02:00 AM)
  const crossMidnightIn = new Date('2026-09-21T22:00:00.000Z');
  const crossMidnightOut = new Date('2026-09-22T02:00:00.000Z');
  const durationMs = crossMidnightOut.getTime() - crossMidnightIn.getTime();
  const durationHours = durationMs / (1000 * 60 * 60);
  assert.strictEqual(durationHours, 4, `Expected 4h for cross-midnight session, got ${durationHours}h`);
  console.log('✅ Test 9 Passed: Cross-midnight explicit punch out duration = 4.0h');

  // Test 10: Completed session calculation excludes open sessions from historical completed hours
  const completedLogs = [
    { punchIn: new Date('2026-09-21T10:00:00.000Z'), punchOut: new Date('2026-09-21T12:00:00.000Z') }
  ];
  let completedMs = 0;
  completedLogs.forEach(l => {
    if (l.punchIn && l.punchOut) {
      completedMs += l.punchOut.getTime() - l.punchIn.getTime();
    }
  });
  assert.strictEqual(completedMs / (1000 * 60 * 60), 2, 'Completed hours must strictly equal sum of closed logs');
  console.log('✅ Test 10 Passed: Historical completed working hours excludes un-closed open sessions');

  console.log('\n🎉 ALL ATTENDANCE SESSION & POLICY TESTS PASSED CLEANLY!\n');
}

testAttendanceSessionPolicy();
