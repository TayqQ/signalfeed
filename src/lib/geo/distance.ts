export interface LatLon {
  lat: number;
  lon: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** Mean Earth radius. One degree of latitude is about 111.2 km. */
const EARTH_RADIUS_KM = 6371;
const RAD = Math.PI / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A latitude and longitude box that holds every point within `km` of the
 * centre. Use it as a cheap SQL prefilter before the exact distance test.
 * It does not wrap across the antimeridian, which is fine for the UK.
 */
export function boundingBox(centre: LatLon, km: number): BoundingBox {
  const angular = Math.max(0, km) / EARTH_RADIUS_KM;
  const minLat = centre.lat - angular / RAD;
  const maxLat = centre.lat + angular / RAD;
  if (minLat <= -90 || maxLat >= 90) {
    return {
      minLat: Math.max(-90, minLat),
      maxLat: Math.min(90, maxLat),
      minLon: -180,
      maxLon: 180,
    };
  }
  // Exact for a sphere: the widest longitude spread of a circle on it.
  const dLon =
    Math.asin(Math.min(1, Math.sin(angular) / Math.cos(centre.lat * RAD))) /
    RAD;
  return {
    minLat,
    maxLat,
    minLon: centre.lon - dLon,
    maxLon: centre.lon + dLon,
  };
}
