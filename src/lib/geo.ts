const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance in km. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}
