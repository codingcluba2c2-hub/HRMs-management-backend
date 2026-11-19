import { prisma } from '../../lib/prisma';
import { getManagerScopedEmployeeFilter, resolveUserManagerScope } from '../../utils/managerScope';
import { normalizeRole, CANONICAL_ROLES } from '../../utils/roleConstants';
import { getOrCreateEmployeeForUser } from '../../utils/employeeUtils';
import {
  calculateHaversineDistance,
  evaluateOfficeGeofence,
  isValidCoordinate,
  GEOFENCE_CONFIG,
  GeofenceStatus
} from './geofence.service';
import { emitWorkforceEvent } from '../../lib/socket';

export class WorkforceService {
  /**
   * Helper: Resolves authenticated employee and tenant company ID
   */
  static async resolveAuthContext(user: any) {
    const rawRole = typeof user?.role === 'string' ? user.role : user?.role?.name || '';
    const role = normalizeRole(rawRole);
    let companyId = user?.companyId;

    const emp = await getOrCreateEmployeeForUser(user);
    if (emp?.companyId) {
      companyId = emp.companyId;
    }

    if (!companyId && user?.id) {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { companyId: true }
      });
      if (dbUser?.companyId) companyId = dbUser.companyId;
    }

    return { role, companyId, employee: emp };
  }

  /**
   * Seed a default HQ office for a company if none exists
   */
  static async seedDefaultOfficeIfNone(companyId: string, createdById?: string) {
    if (!companyId) return null;
    const count = await prisma.officeLocation.count({ where: { companyId } });
    if (count === 0) {
      return await prisma.officeLocation.create({
        data: {
          companyId,
          name: 'Gurgaon Main Office',
          address: 'DLF Cyber City, Building 10, Tower B, Gurugram, Haryana 122002',
          latitude: 28.4983,
          longitude: 77.0898,
          radiusMeters: 150.0,
          isActive: true,
          createdById: createdById || null
        }
      });
    }
    return null;
  }

  /**
   * Get all offices for the tenant
   */
  static async getOffices(user: any) {
    const { role, companyId, employee } = await this.resolveAuthContext(user);
    if (!companyId && role !== CANONICAL_ROLES.SUPER_ADMIN) {
      return [];
    }

    if (companyId) {
      await this.seedDefaultOfficeIfNone(companyId, user?.id);
    }

    const where: any = {};
    if (role !== CANONICAL_ROLES.SUPER_ADMIN) {
      where.companyId = companyId;
    }

    return await prisma.officeLocation.findMany({
      where,
      include: {
        department: { select: { id: true, name: true, code: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  /**
   * Create Office Location (HR_ADMIN, SUPER_ADMIN)
   */
  static async createOffice(user: any, data: {
    name: string;
    address?: string;
    latitude: number;
    longitude: number;
    radiusMeters?: number;
    departmentId?: string;
    isActive?: boolean;
  }) {
    const { role, companyId } = await this.resolveAuthContext(user);
    if (role !== CANONICAL_ROLES.SUPER_ADMIN && role !== CANONICAL_ROLES.HR_ADMIN) {
      throw new Error('Forbidden: Only HR Admins can create office locations');
    }

    if (!isValidCoordinate(data.latitude, data.longitude)) {
      throw new Error('Invalid GPS coordinates for office location');
    }

    const radius = Math.max(10, Number(data.radiusMeters) || 150);

    const office = await prisma.officeLocation.create({
      data: {
        companyId: companyId || null,
        name: data.name.trim(),
        address: data.address?.trim() || null,
        latitude: data.latitude,
        longitude: data.longitude,
        radiusMeters: radius,
        departmentId: data.departmentId || null,
        isActive: data.isActive !== false,
        createdById: user.id
      },
      include: { department: { select: { id: true, name: true } } }
    });

    // Audit log
    await prisma.locationAuditLog.create({
      data: {
        companyId,
        actorId: user.id,
        action: 'OFFICE_CREATED',
        details: { officeId: office.id, name: office.name, radius: office.radiusMeters }
      }
    }).catch(() => {});

    return office;
  }

  /**
   * Update Office Location (HR_ADMIN, SUPER_ADMIN)
   */
  static async updateOffice(user: any, id: string, data: Partial<{
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    departmentId: string | null;
    isActive: boolean;
  }>) {
    const { role, companyId } = await this.resolveAuthContext(user);
    if (role !== CANONICAL_ROLES.SUPER_ADMIN && role !== CANONICAL_ROLES.HR_ADMIN) {
      throw new Error('Forbidden: Only HR Admins can update office locations');
    }

    const office = await prisma.officeLocation.findUnique({ where: { id } });
    if (!office) throw new Error('Office location not found');

    if (role !== CANONICAL_ROLES.SUPER_ADMIN && office.companyId !== companyId) {
      throw new Error('Forbidden: Office location does not belong to your company');
    }

    if (data.latitude !== undefined && data.longitude !== undefined) {
      if (!isValidCoordinate(data.latitude, data.longitude)) {
        throw new Error('Invalid GPS coordinates for office location');
      }
    }

    const updated = await prisma.officeLocation.update({
      where: { id },
      data: {
        name: data.name !== undefined ? data.name.trim() : undefined,
        address: data.address !== undefined ? data.address.trim() : undefined,
        latitude: data.latitude !== undefined ? data.latitude : undefined,
        longitude: data.longitude !== undefined ? data.longitude : undefined,
        radiusMeters: data.radiusMeters !== undefined ? Math.max(10, Number(data.radiusMeters)) : undefined,
        departmentId: data.departmentId !== undefined ? data.departmentId : undefined,
        isActive: data.isActive !== undefined ? data.isActive : undefined
      },
      include: { department: { select: { id: true, name: true } } }
    });

    await prisma.locationAuditLog.create({
      data: {
        companyId,
        actorId: user.id,
        action: 'OFFICE_UPDATED',
        details: { officeId: id, changes: data }
      }
    }).catch(() => {});

    return updated;
  }

  /**
   * Delete Office Location
   */
  static async deleteOffice(user: any, id: string) {
    const { role, companyId } = await this.resolveAuthContext(user);
    if (role !== CANONICAL_ROLES.SUPER_ADMIN && role !== CANONICAL_ROLES.HR_ADMIN) {
      throw new Error('Forbidden: Only HR Admins can delete office locations');
    }

    const office = await prisma.officeLocation.findUnique({ where: { id } });
    if (!office) throw new Error('Office location not found');

    if (role !== CANONICAL_ROLES.SUPER_ADMIN && office.companyId !== companyId) {
      throw new Error('Forbidden: Office location does not belong to your company');
    }

    await prisma.officeLocation.delete({ where: { id } });

    await prisma.locationAuditLog.create({
      data: {
        companyId,
        actorId: user.id,
        action: 'OFFICE_DELETED',
        details: { officeId: id, name: office.name }
      }
    }).catch(() => {});

    return { success: true };
  }

  /**
   * Get Live Workforce Map data with calculated KPIs and real database records
   */
  static async getLiveWorkforce(user: any, queryFilters: {
    departmentId?: string;
    designationId?: string;
    shiftId?: string;
    attendanceStatus?: string;
    geofenceStatus?: string;
    liveTrackingStatus?: string;
    search?: string;
  } = {}) {
    const scope = await resolveUserManagerScope(user);

    // Employees cannot access company workforce map
    if (scope.isEmployeeOnly) {
      throw new Error('Forbidden: Regular employees cannot view workforce tracking map');
    }

    const { companyId } = await this.resolveAuthContext(user);
    if (companyId) {
      await this.seedDefaultOfficeIfNone(companyId, user?.id);
    }

    // Tenant & Department Scoped Employee Filter
    const employeeWhere = await getManagerScopedEmployeeFilter(user);

    // Apply additional filters
    if (queryFilters.departmentId) {
      // Security: if manager, ensure department is within allowed scope
      if (scope.isManager && !scope.departmentIds.includes(queryFilters.departmentId)) {
        throw new Error('Forbidden: You are not authorized to view this department');
      }
      employeeWhere.departmentId = queryFilters.departmentId;
    }

    if (queryFilters.designationId) {
      employeeWhere.designationId = queryFilters.designationId;
    }

    if (queryFilters.shiftId) {
      employeeWhere.shiftId = queryFilters.shiftId;
    }

    if (queryFilters.search) {
      const q = queryFilters.search.trim();
      employeeWhere.OR = [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { employeeId: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } }
      ];
    }

    // Active Offices for this tenant
    const officeWhere: any = { isActive: true };
    if (!scope.isSuperAdmin && companyId) {
      officeWhere.companyId = companyId;
    }
    const offices = await prisma.officeLocation.findMany({
      where: officeWhere,
      include: { department: true },
      orderBy: { updatedAt: 'desc' }
    });

    const defaultOffice = offices[0] || null;

    // Timezone-resilient today normalization (both UTC midnight and local day bounds)
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const recentSessionThreshold = new Date(Date.now() - 24 * 3600 * 1000);

    // Query employees with latest location, department, designation, shift, and today's attendance record
    const employees = await prisma.employee.findMany({
      where: employeeWhere,
      include: {
        department: { select: { id: true, name: true, code: true } },
        designation: { select: { id: true, name: true, level: true } },
        shift: { select: { id: true, name: true, startTime: true, endTime: true } },
        locationLatest: true,
        attendanceRecords: {
          where: {
            OR: [
              { date: todayUtc },
              { date: { gte: startOfDay, lte: endOfDay } },
              { logs: { some: { punchIn: { gte: recentSessionThreshold } } } }
            ]
          },
          include: {
            logs: { orderBy: { punchIn: 'desc' } },
            breaks: true
          },
          orderBy: { date: 'desc' },
          take: 1
        }
      },
      orderBy: { firstName: 'asc' }
    });

    const nowMs = Date.now();
    const workforceItems: any[] = [];

    // KPI Counters
    let totalPresentToday = 0;
    let insideOfficeCount = 0;
    let outsideOfficeCount = 0;
    let liveTrackingCount = 0;
    let locationUnavailableCount = 0;
    let staleLocationCount = 0;

    for (const emp of employees) {
      const todayRecord = emp.attendanceRecords?.[0] || null;
      const latestLog = todayRecord?.logs?.[0] || null;
      const loc = emp.locationLatest;

      // Check if employee has punched in today or in current work session
      const isPunchInRecent = loc?.punchInCapturedAt && (nowMs - new Date(loc.punchInCapturedAt).getTime() < 24 * 3600 * 1000);
      const hasPunchedIn = Boolean(latestLog?.punchIn || (isPunchInRecent && loc?.punchInLatitude));
      
      // True active session status:
      // If latestLog exists, employee is currently punched in ONLY if punchOut is null!
      let isCurrentlyPunchedIn = false;
      if (latestLog) {
        isCurrentlyPunchedIn = !latestLog.punchOut;
      } else if (loc?.punchInLatitude && isPunchInRecent) {
        isCurrentlyPunchedIn = !loc.punchOutCapturedAt;
      }

      // Attendance status
      let attendanceStatus = 'NOT_PUNCHED_IN';
      if (isCurrentlyPunchedIn) {
        const onBreak = todayRecord?.breaks?.some((b: any) => !b.breakEnd);
        attendanceStatus = onBreak ? 'ON_BREAK' : 'PRESENT';
      } else if (latestLog?.punchOut || loc?.punchOutCapturedAt) {
        attendanceStatus = 'PUNCHED_OUT';
      } else if (todayRecord) {
        attendanceStatus = todayRecord.status || 'ABSENT';
      }

      // Location details
      const isLiveTracking = Boolean(loc?.isLiveTracking && isCurrentlyPunchedIn);
      if (isLiveTracking) {
        liveTrackingCount++;
      }

      // Primary headquarters office is the master geofence reference
      const assignedOffice = offices[0] || (emp.departmentId 
        ? offices.find(o => o.departmentId === emp.departmentId) 
        : null) || defaultOffice;

      // Determine active coordinate (live location if available, otherwise punch-in location)
      // If employee is not currently punched in (i.e. punched out), do not broadcast active coordinates on the live map
      let activeLat: number | null = null;
      let activeLon: number | null = null;
      let activeAccuracy: number = 0;
      let lastUpdated: Date | null = null;
      let locationSource: 'LIVE' | 'PUNCH_IN' | 'NONE' = 'NONE';

      if (isCurrentlyPunchedIn) {
        if (loc && isValidCoordinate(loc.latitude, loc.longitude)) {
          activeLat = loc.latitude!;
          activeLon = loc.longitude!;
          activeAccuracy = loc.accuracyMeters || 10;
          lastUpdated = loc.lastUpdatedAt || loc.updatedAt;
          locationSource = 'LIVE';
        } else if (loc && isValidCoordinate(loc.punchInLatitude, loc.punchInLongitude)) {
          activeLat = loc.punchInLatitude!;
          activeLon = loc.punchInLongitude!;
          activeAccuracy = loc.punchInAccuracyMeters || 15;
          lastUpdated = loc.punchInCapturedAt || todayRecord?.createdAt || null;
          locationSource = 'PUNCH_IN';
        }
      }

      // Evaluate geofence
      let geofenceStatus: GeofenceStatus = 'LOCATION_UNAVAILABLE';
      let distanceMeters: number | null = null;
      let isStale = false;

      if (activeLat !== null && activeLon !== null && assignedOffice) {
        const evalResult = evaluateOfficeGeofence({
          employeeLocation: { latitude: activeLat, longitude: activeLon },
          accuracyMeters: activeAccuracy,
          locationTimestamp: lastUpdated || new Date(),
          office: assignedOffice,
          previousGeofenceStatus: loc?.geofenceStatus,
          lastGeofenceEventAt: loc?.lastGeofenceEventAt,
          isLiveTracking
        });

        geofenceStatus = evalResult.geofenceStatus;
        distanceMeters = evalResult.distanceMeters;
        isStale = evalResult.isStale;
      }

      // KPI tallying - ONLY count currently active (punched in) workforce on map!
      if (!isCurrentlyPunchedIn) {
        locationUnavailableCount++;
      } else if (geofenceStatus === 'INSIDE_OFFICE') {
        insideOfficeCount++;
        totalPresentToday++;
      } else if (geofenceStatus === 'OUTSIDE_OFFICE' || geofenceStatus === 'UNCERTAIN') {
        outsideOfficeCount++;
        totalPresentToday++;
      } else if (geofenceStatus === 'LOCATION_STALE') {
        staleLocationCount++;
        totalPresentToday++;
      } else {
        locationUnavailableCount++;
        totalPresentToday++;
      }

      // Marker style determination
      let markerColor: 'green' | 'orange' | 'blue' | 'grey' | 'red' = 'grey';
      let markerLabel = 'Location Unavailable';

      if (!isCurrentlyPunchedIn) {
        markerColor = 'grey';
        markerLabel = latestLog?.punchOut ? 'Punched Out' : 'Not Punched In';
      } else if (isLiveTracking) {
        markerColor = 'blue';
        markerLabel = `Live Sharing (${geofenceStatus === 'INSIDE_OFFICE' ? 'Inside' : 'Outside'})`;
      } else if (geofenceStatus === 'INSIDE_OFFICE') {
        markerColor = 'green';
        markerLabel = `Inside ${assignedOffice?.name || 'Office'}`;
      } else if (geofenceStatus === 'OUTSIDE_OFFICE' || geofenceStatus === 'UNCERTAIN') {
        markerColor = 'orange';
        markerLabel = `Outside Office (${distanceMeters ? (distanceMeters > 1000 ? `${(distanceMeters/1000).toFixed(1)} km` : `${Math.round(distanceMeters)} m`) : ''})`;
      } else if (geofenceStatus === 'LOCATION_STALE' && isLiveTracking) {
        markerColor = 'grey';
        markerLabel = 'Live Signal Stale';
      } else if (loc?.punchInUnavailableReason) {
        markerColor = 'red';
        markerLabel = 'GPS Permission Denied';
      } else {
        markerColor = 'grey';
        markerLabel = 'Location Unavailable';
      }

      // Filter checks
      if (queryFilters.attendanceStatus && queryFilters.attendanceStatus !== 'ALL') {
        if (attendanceStatus !== queryFilters.attendanceStatus) continue;
      }

      if (queryFilters.geofenceStatus && queryFilters.geofenceStatus !== 'ALL') {
        if (geofenceStatus !== queryFilters.geofenceStatus) continue;
      }

      if (queryFilters.liveTrackingStatus && queryFilters.liveTrackingStatus !== 'ALL') {
        const matches = queryFilters.liveTrackingStatus === 'ACTIVE' ? isLiveTracking : !isLiveTracking;
        if (!matches) continue;
      }

      workforceItems.push({
        id: emp.id,
        employeeId: emp.employeeId,
        firstName: emp.firstName,
        lastName: emp.lastName,
        photo: emp.photo,
        email: emp.email,
        department: emp.department?.name || 'Unassigned',
        departmentId: emp.departmentId,
        designation: emp.designation?.name || 'Associate',
        shift: emp.shift ? `${emp.shift.name} (${emp.shift.startTime} - ${emp.shift.endTime})` : 'Standard',
        attendanceStatus,
        isCurrentlyPunchedIn,
        punchInTime: isCurrentlyPunchedIn ? (latestLog?.punchIn || loc?.punchInCapturedAt || null) : null,
        punchOutTime: isCurrentlyPunchedIn ? null : (latestLog?.punchOut || loc?.punchOutCapturedAt || null),
        punchInCoordinates: (isCurrentlyPunchedIn && loc?.punchInLatitude && loc?.punchInLongitude) ? {
          latitude: loc.punchInLatitude,
          longitude: loc.punchInLongitude,
          accuracyMeters: loc.punchInAccuracyMeters,
          capturedAt: loc.punchInCapturedAt
        } : null,
        activeLocation: (isCurrentlyPunchedIn && activeLat !== null && activeLon !== null) ? {
          latitude: activeLat,
          longitude: activeLon,
          accuracyMeters: activeAccuracy,
          lastUpdatedAt: lastUpdated,
          source: locationSource
        } : null,
        geofenceStatus,
        distanceMeters,
        assignedOffice: assignedOffice ? {
          id: assignedOffice.id,
          name: assignedOffice.name,
          radiusMeters: assignedOffice.radiusMeters,
          latitude: assignedOffice.latitude,
          longitude: assignedOffice.longitude
        } : null,
        isLiveTracking,
        trackingConsentStatus: isLiveTracking ? 'CONSENTED_ACTIVE' : (loc ? 'CONSENTED_INACTIVE' : 'NO_CONSENT'),
        markerColor,
        markerLabel
      });
    }

    // Audit log
    await prisma.locationAuditLog.create({
      data: {
        companyId,
        actorId: user.id,
        action: 'WORKFORCE_MAP_VIEW',
        details: { employeeCount: workforceItems.length }
      }
    }).catch(() => {});

    return {
      workforce: workforceItems,
      employees: workforceItems,
      offices,
      kpis: {
        totalEmployees: employees.length,
        totalPresentToday,
        insideOfficeCount,
        outsideOfficeCount,
        liveTrackingCount,
        locationUnavailableCount,
        staleLocationCount
      }
    };
  }

  /**
   * Get Single Employee Location Details & Session History
   */
  static async getEmployeeLocationDetails(user: any, employeeId: string) {
    const scope = await resolveUserManagerScope(user);
    const { companyId } = await this.resolveAuthContext(user);

    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        department: true,
        designation: true,
        shift: true,
        locationLatest: true
      }
    });

    if (!emp) throw new Error('Employee not found');

    // Tenant Check
    if (!scope.isSuperAdmin && emp.companyId !== companyId) {
      throw new Error('Forbidden: Employee belongs to another tenant');
    }

    // Manager Scope Check
    if (scope.isManager && (!emp.departmentId || !scope.departmentIds.includes(emp.departmentId))) {
      throw new Error('Forbidden: You are not authorized to access employees outside your department');
    }

    // Regular Employee Check
    if (scope.isEmployeeOnly && scope.managerEmployeeId !== emp.id) {
      throw new Error('Forbidden: You can only view your own location status');
    }

    const offices = await prisma.officeLocation.findMany({
      where: { companyId: emp.companyId || undefined, isActive: true }
    });

    const assignedOffice = (emp.departmentId ? offices.find(o => o.departmentId === emp.departmentId) : null) || offices[0] || null;

    let distanceMeters: number | null = null;
    const latestLoc = emp.locationLatest;
    if (latestLoc?.latitude && latestLoc?.longitude && assignedOffice) {
      distanceMeters = calculateHaversineDistance(
        latestLoc.latitude,
        latestLoc.longitude,
        assignedOffice.latitude,
        assignedOffice.longitude
      );
    }

    // Log audit
    await prisma.locationAuditLog.create({
      data: {
        companyId,
        actorId: user.id,
        targetEmployeeId: emp.id,
        action: 'EMPLOYEE_LOCATION_VIEW'
      }
    }).catch(() => {});

    return {
      employee: {
        id: emp.id,
        employeeId: emp.employeeId,
        firstName: emp.firstName,
        lastName: emp.lastName,
        photo: emp.photo,
        email: emp.email,
        department: emp.department?.name || 'Unassigned',
        designation: emp.designation?.name || 'Associate',
        shift: emp.shift?.name || 'Standard'
      },
      assignedOffice,
      distanceMeters,
      locationLatest: emp.locationLatest
    };
  }

  /**
   * Get Chronological Location History Timeline (Paginated)
   */
  static async getEmployeeLocationHistory(user: any, employeeId: string, options: {
    date?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const scope = await resolveUserManagerScope(user);
    const { companyId } = await this.resolveAuthContext(user);

    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, companyId: true, departmentId: true, firstName: true, lastName: true }
    });

    if (!emp) throw new Error('Employee not found');

    if (!scope.isSuperAdmin && emp.companyId !== companyId) {
      throw new Error('Forbidden: Cross-tenant access denied');
    }

    if (scope.isManager && (!emp.departmentId || !scope.departmentIds.includes(emp.departmentId))) {
      throw new Error('Forbidden: Cross-department access denied');
    }

    if (scope.isEmployeeOnly && scope.managerEmployeeId !== emp.id) {
      throw new Error('Forbidden: Cannot view another employee location history');
    }

    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(10, Number(options.limit) || 20));
    const skip = (page - 1) * limit;

    const dateFilter: any = {};
    if (options.date) {
      const d = new Date(options.date);
      const startOfDay = new Date(d);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(d);
      endOfDay.setHours(23, 59, 59, 999);
      dateFilter.gte = startOfDay;
      dateFilter.lte = endOfDay;
    }

    // Fetch AttendanceLocation samples
    const locWhere: any = { employeeId: emp.id };
    if (options.date) locWhere.capturedAt = dateFilter;

    const [locations, totalLocations] = await Promise.all([
      prisma.attendanceLocation.findMany({
        where: locWhere,
        orderBy: { capturedAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.attendanceLocation.count({ where: locWhere })
    ]);

    // Fetch Geofence Events
    const geofenceWhere: any = { employeeId: emp.id };
    if (options.date) geofenceWhere.occurredAt = dateFilter;

    const geofenceEvents = await prisma.geofenceEvent.findMany({
      where: geofenceWhere,
      include: { officeLocation: { select: { id: true, name: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 50
    });

    // Merge into chronological timeline items
    const timelineItems: any[] = [];

    locations.forEach(loc => {
      timelineItems.push({
        id: loc.id,
        type: loc.eventType, // PUNCH_IN, PUNCH_OUT, LIVE_SAMPLE
        timestamp: loc.capturedAt,
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracyMeters: loc.accuracyMeters,
        source: loc.source,
        reason: loc.locationUnavailableReason,
        description: loc.eventType === 'PUNCH_IN'
          ? 'Punched in with GPS location'
          : loc.eventType === 'PUNCH_OUT'
          ? 'Punched out with GPS location'
          : 'Live tracking sample recorded'
      });
    });

    geofenceEvents.forEach(evt => {
      timelineItems.push({
        id: evt.id,
        type: `GEOFENCE_${evt.eventType}`, // GEOFENCE_ENTERED, GEOFENCE_EXITED
        timestamp: evt.occurredAt,
        latitude: evt.latitude,
        longitude: evt.longitude,
        accuracyMeters: evt.accuracyMeters,
        officeName: evt.officeLocation?.name || 'Office',
        description: evt.eventType === 'ENTERED'
          ? `Entered office geofence (${evt.officeLocation?.name})`
          : `Exited office geofence (${evt.officeLocation?.name})`
      });
    });

    // Sort descending by timestamp
    timelineItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Audit log
    await prisma.locationAuditLog.create({
      data: {
        companyId,
        actorId: user.id,
        targetEmployeeId: emp.id,
        action: 'LOCATION_HISTORY_VIEW',
        details: { page, limit, date: options.date }
      }
    }).catch(() => {});

    return {
      timeline: timelineItems,
      pagination: {
        total: totalLocations,
        page,
        limit,
        totalPages: Math.ceil(totalLocations / limit)
      }
    };
  }

  /**
   * Update Tracking Consent (Grant or Revoke)
   */
  static async updateConsent(user: any, data: { consented: boolean; policyVersion?: string }) {
    const { employee, companyId } = await this.resolveAuthContext(user);
    if (!employee) throw new Error('Employee profile not found');

    const now = new Date();
    const policyVersion = data.policyVersion || '1.0';

    if (data.consented) {
      // Create or activate session
      await prisma.employeeLocationSession.create({
        data: {
          companyId,
          employeeId: employee.id,
          consentedAt: now,
          consentPolicyVersion: policyVersion,
          startedAt: now,
          status: 'ACTIVE'
        }
      });

      await prisma.employeeLocationLatest.upsert({
        where: { employeeId: employee.id },
        create: {
          companyId,
          employeeId: employee.id,
          isLiveTracking: true,
          trackingStatus: 'ACTIVE'
        },
        update: {
          isLiveTracking: true,
          trackingStatus: 'ACTIVE'
        }
      });

      emitWorkforceEvent(companyId, 'employee:tracking-started', {
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        departmentId: employee.departmentId,
        status: 'ACTIVE'
      }, employee.departmentId || undefined);

      await prisma.locationAuditLog.create({
        data: {
          companyId,
          actorId: user.id,
          targetEmployeeId: employee.id,
          action: 'CONSENT_GRANTED',
          details: { policyVersion }
        }
      }).catch(() => {});

      return { status: 'ACTIVE', consented: true };
    } else {
      // Stop and revoke sessions
      await prisma.employeeLocationSession.updateMany({
        where: { employeeId: employee.id, status: 'ACTIVE' },
        data: { stoppedAt: now, status: 'REVOKED' }
      });

      await prisma.employeeLocationLatest.updateMany({
        where: { employeeId: employee.id },
        data: { isLiveTracking: false, trackingStatus: 'INACTIVE' }
      });

      emitWorkforceEvent(companyId, 'employee:tracking-stopped', {
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        departmentId: employee.departmentId,
        status: 'INACTIVE'
      }, employee.departmentId || undefined);

      await prisma.locationAuditLog.create({
        data: {
          companyId,
          actorId: user.id,
          targetEmployeeId: employee.id,
          action: 'CONSENT_REVOKED'
        }
      }).catch(() => {});

      return { status: 'INACTIVE', consented: false };
    }
  }

  /**
   * Ingest Live Location update transmitted by employee browser watcher
   */
  static async ingestLiveLocation(user: any, data: {
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    timestamp?: string | number;
  }) {
    const { employee, companyId } = await this.resolveAuthContext(user);
    if (!employee) throw new Error('Employee profile not found');

    // Security & Policy: Live tracking is strictly forbidden outside active work session!
    const activeLog = await prisma.attendanceLog.findFirst({
      where: {
        attendance: { employeeId: employee.id },
        punchOut: null
      },
      include: { attendance: true },
      orderBy: { punchIn: 'desc' }
    });

    if (!activeLog) {
      // Auto-stop tracking if not punched in
      await prisma.employeeLocationLatest.updateMany({
        where: { employeeId: employee.id },
        data: { isLiveTracking: false, trackingStatus: 'INACTIVE' }
      }).catch(() => {});
      return { success: false, message: 'Tracking stopped: No active attendance session' };
    }

    if (!isValidCoordinate(data.latitude, data.longitude)) {
      throw new Error('Invalid GPS coordinate bounds');
    }

    const accuracy = Math.max(1, Number(data.accuracyMeters) || 10);
    const sampleTimestamp = data.timestamp ? new Date(data.timestamp) : new Date();

    // Check rate limit and movement threshold against latest known record
    const latest = await prisma.employeeLocationLatest.findUnique({
      where: { employeeId: employee.id }
    });

    const nowMs = Date.now();
    let shouldSaveSample = true;

    if (latest && latest.latitude && latest.longitude && latest.lastUpdatedAt) {
      const msSinceLast = nowMs - new Date(latest.lastUpdatedAt).getTime();
      const distanceMoved = calculateHaversineDistance(
        latest.latitude,
        latest.longitude,
        data.latitude,
        data.longitude
      );

      // Throttling: If under 15 seconds and under 10 meters, suppress duplicate update
      if (msSinceLast < GEOFENCE_CONFIG.MIN_SAMPLE_INTERVAL_MS && distanceMoved < GEOFENCE_CONFIG.MIN_MOVEMENT_THRESHOLD_METERS) {
        shouldSaveSample = false;
      }
    }

    // Find assigned office for geofencing
    const offices = await prisma.officeLocation.findMany({
      where: { companyId, isActive: true }
    });
    const office = (employee.departmentId ? offices.find(o => o.departmentId === employee.departmentId) : null) || offices[0];

    let geofenceStatus: GeofenceStatus = 'LOCATION_UNAVAILABLE';
    let distanceMeters: number | null = null;
    let transitionEvent: 'ENTERED' | 'EXITED' | null = null;

    if (office) {
      const evalResult = evaluateOfficeGeofence({
        employeeLocation: { latitude: data.latitude, longitude: data.longitude },
        accuracyMeters: accuracy,
        locationTimestamp: sampleTimestamp,
        office,
        previousGeofenceStatus: latest?.geofenceStatus,
        lastGeofenceEventAt: latest?.lastGeofenceEventAt
      });

      geofenceStatus = evalResult.geofenceStatus;
      distanceMeters = evalResult.distanceMeters;
      transitionEvent = evalResult.transitionEvent;
    }

    // Database writes inside a transaction
    await prisma.$transaction(async (tx) => {
      // 1. Record transition GeofenceEvent if confirmed enter/exit
      if (transitionEvent && office) {
        await tx.geofenceEvent.create({
          data: {
            companyId,
            employeeId: employee.id,
            attendanceSessionId: activeLog.attendanceId,
            officeLocationId: office.id,
            eventType: transitionEvent,
            latitude: data.latitude,
            longitude: data.longitude,
            accuracyMeters: accuracy,
            occurredAt: sampleTimestamp
          }
        });
      }

      // 2. Save throttled sample to AttendanceLocation
      if (shouldSaveSample) {
        await tx.attendanceLocation.create({
          data: {
            companyId,
            employeeId: employee.id,
            attendanceSessionId: activeLog.attendanceId,
            eventType: 'LIVE_SAMPLE',
            latitude: data.latitude,
            longitude: data.longitude,
            accuracyMeters: accuracy,
            capturedAt: sampleTimestamp,
            source: 'BROWSER_GPS'
          }
        });
      }

      // 3. Upsert EmployeeLocationLatest for fast O(1) workforce lookup
      await tx.employeeLocationLatest.upsert({
        where: { employeeId: employee.id },
        create: {
          companyId,
          employeeId: employee.id,
          latitude: data.latitude,
          longitude: data.longitude,
          accuracyMeters: accuracy,
          lastUpdatedAt: sampleTimestamp,
          trackingStatus: 'ACTIVE',
          geofenceStatus,
          currentOfficeId: office?.id || null,
          distanceMeters,
          isLiveTracking: true,
          attendanceStatus: 'PRESENT',
          lastGeofenceEventAt: transitionEvent ? sampleTimestamp : undefined
        },
        update: {
          latitude: data.latitude,
          longitude: data.longitude,
          accuracyMeters: accuracy,
          lastUpdatedAt: sampleTimestamp,
          trackingStatus: 'ACTIVE',
          geofenceStatus,
          currentOfficeId: office?.id || null,
          distanceMeters,
          isLiveTracking: true,
          lastGeofenceEventAt: transitionEvent ? sampleTimestamp : undefined
        }
      });
    });

    // Real-Time Socket.IO broadcasts
    const payload = {
      employeeId: employee.id,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      departmentId: employee.departmentId,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracyMeters: accuracy,
      geofenceStatus,
      distanceMeters,
      officeName: office?.name,
      lastUpdatedAt: sampleTimestamp.toISOString()
    };

    emitWorkforceEvent(companyId, 'employee:location-updated', payload, employee.departmentId || undefined);

    if (transitionEvent === 'ENTERED') {
      emitWorkforceEvent(companyId, 'employee:entered-office', payload, employee.departmentId || undefined);
    } else if (transitionEvent === 'EXITED') {
      emitWorkforceEvent(companyId, 'employee:exited-office', payload, employee.departmentId || undefined);
    }

    return {
      success: true,
      geofenceStatus,
      distanceMeters,
      transitionEvent
    };
  }

  /**
   * Secure Deletion & Retention Workflow (Purge old GPS points)
   */
  static async purgeOldLocationHistory(user: any, options: { retentionDays?: number }) {
    const { role, companyId } = await this.resolveAuthContext(user);
    if (role !== CANONICAL_ROLES.SUPER_ADMIN && role !== CANONICAL_ROLES.HR_ADMIN) {
      throw new Error('Forbidden: Only HR Admins can execute data retention purges');
    }

    const retentionDays = Math.max(7, Number(options.retentionDays) || 30);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const where: any = {
      capturedAt: { lt: cutoffDate },
      eventType: 'LIVE_SAMPLE' // Keep punch-in and punch-out compliance records by default
    };

    if (role !== CANONICAL_ROLES.SUPER_ADMIN && companyId) {
      where.companyId = companyId;
    }

    const deleteResult = await prisma.attendanceLocation.deleteMany({ where });

    await prisma.locationAuditLog.create({
      data: {
        companyId,
        actorId: user.id,
        action: 'PURGE_HISTORY',
        details: { retentionDays, purgedCount: deleteResult.count, cutoffDate }
      }
    }).catch(() => {});

    return {
      success: true,
      purgedCount: deleteResult.count,
      retentionDays,
      cutoffDate
    };
  }
}
