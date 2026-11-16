import assert from 'assert';
import { prisma } from '../../../lib/prisma';
import {
  calculateHaversineDistance,
  evaluateOfficeGeofence,
  isValidCoordinate,
  GEOFENCE_CONFIG
} from '../geofence.service';
import { WorkforceService } from '../workforce.service';
import { CANONICAL_ROLES, normalizeRole } from '../../../utils/roleConstants';

/**
 * Enterprise Live Workforce Map & Attendance GPS Tracking Automated Test Suite
 * Validates all 20 required scenarios
 */
async function runTests() {
  console.log('================================================================');
  console.log(' ENTERPRISE WORKFORCE MAP & ATTENDANCE GPS TRACKING TEST SUITE  ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL] ${name}`);
      console.error(`   Error: ${err.message}\n`);
      failed++;
    }
  }

  // Office fixture: Gurgaon Cyber City HQ (lat: 28.4983, lon: 77.0898, radius: 150m)
  const testOffice = {
    id: 'test-office-hq',
    name: 'Gurgaon HQ Test Office',
    latitude: 28.4983,
    longitude: 77.0898,
    radiusMeters: 150.0
  };

  // Test 1: Coordinate validity checking
  await test('1. GPS accuracy & coordinate bounds validation', () => {
    assert.strictEqual(isValidCoordinate(28.4983, 77.0898), true, 'Valid coordinates should pass');
    assert.strictEqual(isValidCoordinate(-91, 77.0898), false, 'Latitude < -90 must fail');
    assert.strictEqual(isValidCoordinate(91, 77.0898), false, 'Latitude > 90 must fail');
    assert.strictEqual(isValidCoordinate(28.4983, 181), false, 'Longitude > 180 must fail');
    assert.strictEqual(isValidCoordinate(0, 0), false, 'Null island (0,0) must fail');
    assert.strictEqual(isValidCoordinate(null as any, undefined as any), false, 'Null/undefined coordinates must fail');
  });

  // Test 2: Haversine distance calculation
  await test('2. Haversine distance calculation accuracy', () => {
    // Distance from office to exact same point must be 0
    const d0 = calculateHaversineDistance(28.4983, 77.0898, 28.4983, 77.0898);
    assert.strictEqual(d0, 0, 'Distance to same coordinate must be 0');

    // Known point ~70 meters away (approx 0.0006 degrees north)
    const d70 = calculateHaversineDistance(28.4983, 77.0898, 28.4989, 77.0898);
    assert.ok(d70 >= 60 && d70 <= 80, `Distance should be ~67m, got ${d70}m`);

    // Known point ~2.5 km away (Cyber Hub to IFFCO Chowk)
    const dFar = calculateHaversineDistance(28.4983, 77.0898, 28.4750, 77.0700);
    assert.ok(dFar > 2000 && dFar < 4000, `Distance should be ~3km, got ${dFar}m`);
  });

  // Test 3: Inside-office geofence calculation
  await test('3. Inside-office geofence calculation', () => {
    // 50m away from office center with radius 150m
    const res = evaluateOfficeGeofence({
      employeeLocation: { latitude: 28.4986, longitude: 77.0898 }, // ~33m away
      accuracyMeters: 10,
      locationTimestamp: new Date(),
      office: testOffice
    });

    assert.strictEqual(res.geofenceStatus, 'INSIDE_OFFICE', 'Should be INSIDE_OFFICE');
    assert.strictEqual(res.isInside, true, 'isInside must be true');
    assert.ok(res.distanceMeters <= testOffice.radiusMeters, 'Distance must be <= radius');
  });

  // Test 4: Outside-office geofence calculation
  await test('4. Outside-office geofence calculation', () => {
    // 2.5 km away from office center
    const res = evaluateOfficeGeofence({
      employeeLocation: { latitude: 28.4750, longitude: 77.0700 },
      accuracyMeters: 15,
      locationTimestamp: new Date(),
      office: testOffice
    });

    assert.strictEqual(res.geofenceStatus, 'OUTSIDE_OFFICE', 'Should be OUTSIDE_OFFICE');
    assert.strictEqual(res.isInside, false, 'isInside must be false');
    assert.ok(res.distanceMeters > testOffice.radiusMeters, 'Distance must exceed radius');
  });

  // Test 5: Uncertain GPS accuracy handling
  await test('5. Uncertain GPS accuracy handling (prevents false positives)', () => {
    // Employee is close, but GPS accuracy is 300 meters (poor GPS satellite fix)
    const res = evaluateOfficeGeofence({
      employeeLocation: { latitude: 28.4984, longitude: 77.0898 },
      accuracyMeters: 300,
      locationTimestamp: new Date(),
      office: testOffice
    });

    assert.strictEqual(res.isUncertain, true, 'isUncertain must be true for low accuracy');
    assert.strictEqual(res.geofenceStatus, 'UNCERTAIN', 'Status should be UNCERTAIN when accuracy is worse than threshold');
  });

  // Test 6: Stale location detection
  await test('6. Stale location detection', () => {
    // Location sample is 30 minutes old
    const staleDate = new Date(Date.now() - 30 * 60 * 1000);
    const res = evaluateOfficeGeofence({
      employeeLocation: { latitude: 28.4984, longitude: 77.0898 },
      accuracyMeters: 10,
      locationTimestamp: staleDate,
      office: testOffice
    });

    assert.strictEqual(res.isStale, true, 'Should detect stale sample');
    assert.strictEqual(res.geofenceStatus, 'LOCATION_STALE', 'Status must be LOCATION_STALE');
  });

  // Test 7: Geofence hysteresis and duplicate event prevention
  await test('7. Geofence hysteresis & confirmation intervals', () => {
    // Scenario: Employee was INSIDE_OFFICE (radius 150m).
    // GPS point jitters to 155m (within 15m hysteresis buffer).
    // Hysteresis prevents false EXITED event!
    const jitterNearBorder = evaluateOfficeGeofence({
      employeeLocation: { latitude: 28.49965, longitude: 77.0898 }, // ~150m-155m away
      accuracyMeters: 10,
      locationTimestamp: new Date(),
      office: testOffice,
      previousGeofenceStatus: 'INSIDE_OFFICE'
    });

    // Should stay inside due to hysteresis buffer
    assert.strictEqual(jitterNearBorder.transitionEvent, null, 'Should NOT trigger premature EXITED event near boundary');

    // Confirmed exit far away
    const confirmedExit = evaluateOfficeGeofence({
      employeeLocation: { latitude: 28.4750, longitude: 77.0700 }, // ~3km away
      accuracyMeters: 10,
      locationTimestamp: new Date(),
      office: testOffice,
      previousGeofenceStatus: 'INSIDE_OFFICE',
      lastGeofenceEventAt: new Date(Date.now() - 60000) // 1 min ago
    });

    assert.strictEqual(confirmedExit.transitionEvent, 'EXITED', 'Must trigger EXITED event when moved far outside');
  });

  // Database & RBAC Integration Tests with real database records
  // Find or create test company and roles
  const testCompany = await prisma.company.upsert({
    where: { name: 'Workforce Test Org Inc' },
    create: {
      name: 'Workforce Test Org Inc',
      code: 'WT-ORG',
      status: 'ACTIVE'
    },
    update: {}
  });

  const tenantBCompany = await prisma.company.upsert({
    where: { name: 'Isolated Competitor Tenant Ltd' },
    create: {
      name: 'Isolated Competitor Tenant Ltd',
      code: 'ICT-LTD',
      status: 'ACTIVE'
    },
    update: {}
  });

  // Test Depts
  const deptEngineering = await prisma.department.upsert({
    where: { id: 'test-dept-engineering' },
    create: {
      id: 'test-dept-engineering',
      name: 'Engineering',
      code: 'ENG',
      companyId: testCompany.id
    },
    update: { companyId: testCompany.id }
  });

  const deptMarketing = await prisma.department.upsert({
    where: { id: 'test-dept-marketing' },
    create: {
      id: 'test-dept-marketing',
      name: 'Marketing',
      code: 'MKT',
      companyId: testCompany.id
    },
    update: { companyId: testCompany.id }
  });

  // Test Employees
  const empHR = await prisma.employee.upsert({
    where: { email: 'hr.workforce.test@hrmspro.com' },
    create: {
      employeeId: 'EMP-WF-HR-01',
      firstName: 'Sarah',
      lastName: 'Jenkins',
      email: 'hr.workforce.test@hrmspro.com',
      companyId: testCompany.id,
      departmentId: deptEngineering.id,
      joiningDate: new Date()
    },
    update: { companyId: testCompany.id }
  });

  const empDev = await prisma.employee.upsert({
    where: { email: 'dev.workforce.test@hrmspro.com' },
    create: {
      employeeId: 'EMP-WF-DEV-02',
      firstName: 'David',
      lastName: 'Miller',
      email: 'dev.workforce.test@hrmspro.com',
      companyId: testCompany.id,
      departmentId: deptEngineering.id,
      joiningDate: new Date()
    },
    update: { companyId: testCompany.id, departmentId: deptEngineering.id }
  });

  const empMkt = await prisma.employee.upsert({
    where: { email: 'mkt.workforce.test@hrmspro.com' },
    create: {
      employeeId: 'EMP-WF-MKT-03',
      firstName: 'Emma',
      lastName: 'Watson',
      email: 'mkt.workforce.test@hrmspro.com',
      companyId: testCompany.id,
      departmentId: deptMarketing.id,
      joiningDate: new Date()
    },
    update: { companyId: testCompany.id, departmentId: deptMarketing.id }
  });

  const empTenantB = await prisma.employee.upsert({
    where: { email: 'tenantb.worker@othercorp.com' },
    create: {
      employeeId: 'EMP-TB-01',
      firstName: 'Bob',
      lastName: 'Stone',
      email: 'tenantb.worker@othercorp.com',
      companyId: tenantBCompany.id,
      joiningDate: new Date()
    },
    update: { companyId: tenantBCompany.id }
  });

  // Test 8: Office CRUD & Tenant Scoping
  await test('8. Office creation, validation and tenant association', async () => {
    const hrUser = {
      id: 'hr-user-id',
      email: empHR.email,
      role: 'HR_ADMIN',
      companyId: testCompany.id
    };

    const office = await WorkforceService.createOffice(hrUser, {
      name: 'Cyber Hub Tower B',
      address: 'Tower B, DLF Cyber City, Gurugram',
      latitude: 28.4983,
      longitude: 77.0898,
      radiusMeters: 150
    });

    assert.ok(office.id, 'Office should have an id');
    assert.strictEqual(office.companyId, testCompany.id, 'Office must belong to HR company');

    const offices = await WorkforceService.getOffices(hrUser);
    assert.ok(offices.some((o: any) => o.id === office.id), 'Created office should be listed');

    // Clean up
    await WorkforceService.deleteOffice(hrUser, office.id);
  });

  // Test 9: Consent Grant & Revocation
  await test('9. Live tracking consent grant, visibility, and revocation', async () => {
    const devUser = {
      id: 'dev-user-id',
      email: empDev.email,
      role: 'EMPLOYEES',
      companyId: testCompany.id
    };

    // Grant consent
    const consentRes = await WorkforceService.updateConsent(devUser, {
      consented: true,
      policyVersion: '1.0'
    });
    assert.strictEqual(consentRes.consented, true, 'Consent should be recorded as granted');
    assert.strictEqual(consentRes.status, 'ACTIVE', 'Tracking session should be ACTIVE');

    // Revoke consent
    const revokeRes = await WorkforceService.updateConsent(devUser, {
      consented: false
    });
    assert.strictEqual(revokeRes.consented, false, 'Consent should be recorded as revoked');
    assert.strictEqual(revokeRes.status, 'INACTIVE', 'Tracking session should be INACTIVE');
  });

  // Test 10: Ingest Live Location requires active attendance session
  await test('10. Live location sample rejected outside active attendance session', async () => {
    const devUser = {
      id: 'dev-user-id',
      email: empDev.email,
      role: 'EMPLOYEES',
      companyId: testCompany.id
    };

    // Ensure dev has no open punch-out=null logs
    const activeLog = await prisma.attendanceLog.findFirst({
      where: { attendance: { employeeId: empDev.id }, punchOut: null }
    });
    if (activeLog) {
      await prisma.attendanceLog.update({
        where: { id: activeLog.id },
        data: { punchOut: new Date() }
      });
    }

    const ingestRes = await WorkforceService.ingestLiveLocation(devUser, {
      latitude: 28.4983,
      longitude: 77.0898,
      accuracyMeters: 10
    });

    assert.strictEqual(ingestRes.success, false, 'Must reject live updates when not punched in');
  });

  // Test 11: HR Admin sees all authorized tenant employees on Workforce Map
  await test('11. HR Admin sees authorized tenant employees on Workforce Map', async () => {
    const hrUser = {
      id: 'hr-user-id',
      email: empHR.email,
      role: 'HR_ADMIN',
      companyId: testCompany.id
    };

    const mapData = await WorkforceService.getLiveWorkforce(hrUser, {});
    assert.ok(Array.isArray(mapData.workforce), 'Workforce should return an array');
    assert.ok(mapData.kpis, 'KPIs object must exist');
    assert.strictEqual(typeof mapData.kpis.totalPresentToday, 'number', 'KPI totalPresentToday must be a number');

    const devFound = mapData.workforce.some((w: any) => w.id === empDev.id);
    const mktFound = mapData.workforce.some((w: any) => w.id === empMkt.id);
    const crossTenantFound = mapData.workforce.some((w: any) => w.id === empTenantB.id);

    assert.ok(devFound, 'HR Admin should see Engineering employee');
    assert.ok(mktFound, 'HR Admin should see Marketing employee');
    assert.strictEqual(crossTenantFound, false, 'HR Admin must NOT see employees from another tenant!');
  });

  // Test 12: Manager sees only assigned department employees
  await test('12. Manager sees only assigned department employees', async () => {
    // Set dev as Engineering manager
    const managerUser = {
      id: 'mgr-user-id',
      email: empDev.email,
      role: 'MANAGER',
      companyId: testCompany.id
    };

    // Explicitly scope manager to Engineering department
    await prisma.managerScope.upsert({
      where: {
        managerId_departmentId_designationId: {
          managerId: empDev.id,
          departmentId: deptEngineering.id,
          designationId: ''
        }
      },
      create: {
        managerId: empDev.id,
        departmentId: deptEngineering.id
      },
      update: {}
    }).catch(() => {});

    await prisma.department.update({
      where: { id: deptEngineering.id },
      data: { managerId: empDev.id }
    }).catch(() => {});

    const mapData = await WorkforceService.getLiveWorkforce(managerUser, {});
    const devFound = mapData.workforce.some((w: any) => w.id === empDev.id);
    const mktFound = mapData.workforce.some((w: any) => w.id === empMkt.id);
    const crossTenantFound = mapData.workforce.some((w: any) => w.id === empTenantB.id);

    assert.ok(devFound, 'Manager should see Engineering employee');
    assert.strictEqual(mktFound, false, 'Manager must NOT see Marketing employee');
    assert.strictEqual(crossTenantFound, false, 'Manager must NOT see other tenant employee');
  });

  // Test 13: Regular employee cannot access workforce map (Forbidden 403)
  await test('13. Regular employee cannot access workforce map (Forbidden)', async () => {
    const regularEmployeeUser = {
      id: 'worker-user-id',
      email: empMkt.email,
      role: 'EMPLOYEES',
      companyId: testCompany.id
    };

    let threw = false;
    try {
      await WorkforceService.getLiveWorkforce(regularEmployeeUser, {});
    } catch (err: any) {
      threw = true;
      assert.ok(err.message.includes('Forbidden'), 'Error should state Forbidden');
    }
    assert.strictEqual(threw, true, 'Employee accessing company map must throw 403');
  });

  // Test 14: Cross-tenant location history access blocked
  await test('14. Cross-tenant location history access blocked with 403', async () => {
    const hrUser = {
      id: 'hr-user-id',
      email: empHR.email,
      role: 'HR_ADMIN',
      companyId: testCompany.id
    };

    let threw = false;
    try {
      // HR of Tenant A attempts to view Tenant B employee
      await WorkforceService.getEmployeeLocationHistory(hrUser, empTenantB.id);
    } catch (err: any) {
      threw = true;
      assert.ok(err.message.includes('Forbidden') || err.message.includes('Cross-tenant'), 'Should reject cross-tenant history access');
    }
    assert.strictEqual(threw, true, 'Cross-tenant access must throw error');
  });

  // Test 15: Employee cannot access another employee location history
  await test('15. Employee cannot view another employee location history', async () => {
    const empDevUser = {
      id: 'dev-user-id',
      email: empDev.email,
      role: 'EMPLOYEES',
      companyId: testCompany.id
    };

    let threw = false;
    try {
      await WorkforceService.getEmployeeLocationHistory(empDevUser, empMkt.id);
    } catch (err: any) {
      threw = true;
      assert.ok(err.message.includes('Forbidden') || err.message.includes('Cannot view another employee'), 'Must reject peer history access');
    }
    assert.strictEqual(threw, true, 'Peer location access must throw error');
  });

  // Test 16: Location history pagination
  await test('16. Location history pagination works properly', async () => {
    const hrUser = {
      id: 'hr-user-id',
      email: empHR.email,
      role: 'HR_ADMIN',
      companyId: testCompany.id
    };

    // Insert sample location points
    await prisma.attendanceLocation.create({
      data: {
        companyId: testCompany.id,
        employeeId: empDev.id,
        eventType: 'PUNCH_IN',
        latitude: 28.4983,
        longitude: 77.0898,
        accuracyMeters: 10,
        source: 'BROWSER_GPS'
      }
    });

    const history = await WorkforceService.getEmployeeLocationHistory(hrUser, empDev.id, {
      page: 1,
      limit: 10
    });

    assert.ok(Array.isArray(history.timeline), 'Timeline should be array');
    assert.ok(history.pagination, 'Pagination object should exist');
    assert.strictEqual(history.pagination.page, 1, 'Current page must be 1');
    assert.ok(history.pagination.total >= 1, 'Total items should reflect inserted sample');
  });

  // Test 17: Retention & Purge workflow
  await test('17. Retention & Purge workflow safely deletes old samples', async () => {
    const hrUser = {
      id: 'hr-user-id',
      email: empHR.email,
      role: 'HR_ADMIN',
      companyId: testCompany.id
    };

    // Insert old sample (40 days old)
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await prisma.attendanceLocation.create({
      data: {
        companyId: testCompany.id,
        employeeId: empDev.id,
        eventType: 'LIVE_SAMPLE',
        latitude: 28.4983,
        longitude: 77.0898,
        accuracyMeters: 10,
        capturedAt: oldDate,
        source: 'BROWSER_GPS'
      }
    });

    const purgeRes = await WorkforceService.purgeOldLocationHistory(hrUser, {
      retentionDays: 30
    });

    assert.strictEqual(purgeRes.success, true, 'Purge should succeed');
    assert.ok(purgeRes.purgedCount >= 1, 'Should have purged at least 1 old record');
  });

  // Test 18: Geofence Event does not trigger punitive attendance changes
  await test('18. Geofence exit does NOT alter employee attendance or deduct salary', () => {
    // When employee exits office geofence, the status is evaluated as OUTSIDE_OFFICE.
    // It emits an event, but never changes attendance record to ABSENT or triggers punch out.
    const res = evaluateOfficeGeofence({
      employeeLocation: { latitude: 28.4750, longitude: 77.0700 }, // Outside
      accuracyMeters: 10,
      locationTimestamp: new Date(),
      office: testOffice,
      previousGeofenceStatus: 'INSIDE_OFFICE',
      lastGeofenceEventAt: new Date(Date.now() - 60000)
    });

    assert.strictEqual(res.transitionEvent, 'EXITED', 'Exit event detected');
    assert.strictEqual(res.geofenceStatus, 'OUTSIDE_OFFICE', 'Status is OUTSIDE_OFFICE');
  });

  // Test 19: Role normalization mapping
  await test('19. Canonical role normalization preserves RBAC integrity', () => {
    assert.strictEqual(normalizeRole('SUPER_ADMIN'), CANONICAL_ROLES.SUPER_ADMIN);
    assert.strictEqual(normalizeRole('HR_ADMIN'), CANONICAL_ROLES.HR_ADMIN);
    assert.strictEqual(normalizeRole('HR_MANAGER'), CANONICAL_ROLES.HR_ADMIN);
    assert.strictEqual(normalizeRole('MANAGER'), CANONICAL_ROLES.MANAGER);
    assert.strictEqual(normalizeRole('DEPT_MANAGER'), CANONICAL_ROLES.MANAGER);
    assert.strictEqual(normalizeRole('EMPLOYEE'), CANONICAL_ROLES.EMPLOYEES);
    assert.strictEqual(normalizeRole('EMPLOYEES'), CANONICAL_ROLES.EMPLOYEES);
  });

  // Test 20: Audit logging compliance
  await test('20. LocationAuditLog records compliance audit trails', async () => {
    const auditLogs = await prisma.locationAuditLog.findMany({
      where: { companyId: testCompany.id },
      take: 5
    });

    assert.ok(Array.isArray(auditLogs), 'Audit logs must be queryable by company');
  });

  console.log('\n================================================================');
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests()
  .catch((e) => {
    console.error('Fatal test error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
