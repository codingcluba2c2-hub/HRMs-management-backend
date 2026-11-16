/**
 * Enterprise Geofencing & Geolocation Engine
 * HRMS Pro - Workforce Map & Attendance GPS Tracking
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface GeofenceEvaluationInput {
  employeeLocation: LatLng;
  accuracyMeters: number;
  locationTimestamp: Date;
  office: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
  };
  previousGeofenceStatus?: string | null;
  lastGeofenceEventAt?: Date | null;
  isLiveTracking?: boolean;
}

export type GeofenceStatus = 
  | 'INSIDE_OFFICE'
  | 'OUTSIDE_OFFICE'
  | 'LOCATION_UNAVAILABLE'
  | 'LOCATION_STALE'
  | 'UNCERTAIN';

export interface GeofenceEvaluationResult {
  geofenceStatus: GeofenceStatus;
  distanceMeters: number;
  isInside: boolean;
  accuracyMeters: number;
  isStale: boolean;
  isUncertain: boolean;
  transitionEvent: 'ENTERED' | 'EXITED' | null;
  officeId: string;
  officeName: string;
}

// Configurable Constants
export const GEOFENCE_CONFIG = {
  DEFAULT_ACCURACY_THRESHOLD_METERS: 150,
  HYSTERESIS_METERS: 15,
  MIN_CONFIRMATION_INTERVAL_MS: 30 * 1000, // 30 seconds between alternating transition events
  STALE_LOCATION_THRESHOLD_MS: 15 * 60 * 1000, // 15 minutes
  MIN_MOVEMENT_THRESHOLD_METERS: 10, // Minimum movement to save live sample
  MIN_SAMPLE_INTERVAL_MS: 15 * 1000 // Throttle live samples to at most once per 15s per employee
};

/**
 * Calculates great-circle distance between two GPS coordinates using the Haversine formula in meters.
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (lat1 === lat2 && lon1 === lon2) {
    return 0;
  }

  const R = 6371000; // Mean Earth radius in meters
  const toRad = Math.PI / 180;

  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;

  const rLat1 = lat1 * toRad;
  const rLat2 = lat2 * toRad;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c * 10) / 10; // Round to 1 decimal place
}

/**
 * Validates GPS coordinate bounds
 */
export function isValidCoordinate(latitude?: number | null, longitude?: number | null): boolean {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return false;
  if (isNaN(latitude) || isNaN(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  // (0,0) is Null Island - usually default uninitialized coordinates
  if (latitude === 0 && longitude === 0) return false;
  return true;
}

/**
 * Evaluates employee position relative to office geofence with hysteresis, accuracy gating, and transition detection.
 */
export function evaluateOfficeGeofence(input: GeofenceEvaluationInput): GeofenceEvaluationResult {
  const {
    employeeLocation,
    accuracyMeters,
    locationTimestamp,
    office,
    previousGeofenceStatus,
    lastGeofenceEventAt
  } = input;

  // 1. Check validity
  if (!isValidCoordinate(employeeLocation.latitude, employeeLocation.longitude)) {
    return {
      geofenceStatus: 'LOCATION_UNAVAILABLE',
      distanceMeters: -1,
      isInside: false,
      accuracyMeters,
      isStale: false,
      isUncertain: false,
      transitionEvent: null,
      officeId: office.id,
      officeName: office.name
    };
  }

  // 2. Check Staleness
  // Only continuous live-streamed tracking samples go stale after 15m.
  // Punch-in coordinates remain valid for the employee's work session (24 hours).
  const now = Date.now();
  const sampleTime = new Date(locationTimestamp).getTime();
  const isStale = Boolean(input.isLiveTracking)
    ? (now - sampleTime) > GEOFENCE_CONFIG.STALE_LOCATION_THRESHOLD_MS
    : (now - sampleTime) > (24 * 60 * 60 * 1000);

  // 3. Distance calculation
  const distance = calculateHaversineDistance(
    employeeLocation.latitude,
    employeeLocation.longitude,
    office.latitude,
    office.longitude
  );

  // 4. GPS Accuracy Check
  // An employee position is only uncertain if low accuracy overlaps the geofence perimeter.
  // If distance - accuracy > office radius, the employee is definitively OUTSIDE the office.
  const accuracyLimit = Math.max(office.radiusMeters * 1.5, GEOFENCE_CONFIG.DEFAULT_ACCURACY_THRESHOLD_METERS);
  const boundaryOverlap = distance <= (office.radiusMeters + accuracyMeters) && distance >= Math.max(0, office.radiusMeters - accuracyMeters);
  const isUncertain = accuracyMeters > accuracyLimit && boundaryOverlap;

  if (isUncertain) {
    return {
      geofenceStatus: isStale ? 'LOCATION_STALE' : 'UNCERTAIN',
      distanceMeters: distance,
      isInside: distance <= office.radiusMeters,
      accuracyMeters,
      isStale,
      isUncertain: true,
      transitionEvent: null,
      officeId: office.id,
      officeName: office.name
    };
  }

  // 5. Hysteresis calculation for stable transitions
  const radius = office.radiusMeters;
  const hysteresis = Math.min(GEOFENCE_CONFIG.HYSTERESIS_METERS, radius * 0.2);

  let newStatus: GeofenceStatus;

  if (previousGeofenceStatus === 'INSIDE_OFFICE') {
    // Requires moving beyond radius + hysteresis to count as exited
    newStatus = distance > (radius + hysteresis) ? 'OUTSIDE_OFFICE' : 'INSIDE_OFFICE';
  } else if (previousGeofenceStatus === 'OUTSIDE_OFFICE') {
    // Requires moving within radius - hysteresis to count as entered
    newStatus = distance <= (radius - hysteresis) ? 'INSIDE_OFFICE' : 'OUTSIDE_OFFICE';
  } else {
    // Standard boundary when no prior status or uncertain
    newStatus = distance <= radius ? 'INSIDE_OFFICE' : 'OUTSIDE_OFFICE';
  }

  if (isStale) {
    newStatus = 'LOCATION_STALE';
  }

  // 6. Transition Event Detection with Confirmation Interval
  let transitionEvent: 'ENTERED' | 'EXITED' | null = null;
  const timeSinceLastEvent = lastGeofenceEventAt ? (now - new Date(lastGeofenceEventAt).getTime()) : Infinity;

  if (timeSinceLastEvent >= GEOFENCE_CONFIG.MIN_CONFIRMATION_INTERVAL_MS) {
    if (newStatus === 'INSIDE_OFFICE' && previousGeofenceStatus === 'OUTSIDE_OFFICE') {
      transitionEvent = 'ENTERED';
    } else if (newStatus === 'OUTSIDE_OFFICE' && previousGeofenceStatus === 'INSIDE_OFFICE') {
      transitionEvent = 'EXITED';
    }
  }

  return {
    geofenceStatus: newStatus,
    distanceMeters: distance,
    isInside: newStatus === 'INSIDE_OFFICE',
    accuracyMeters,
    isStale,
    isUncertain: false,
    transitionEvent,
    officeId: office.id,
    officeName: office.name
  };
}
