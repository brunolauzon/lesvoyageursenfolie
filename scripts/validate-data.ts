import { loadMeta, loadResortInputs, loadTrip } from '../src/lib/data';

loadTrip();
const resorts = loadResortInputs();
const resolved = resorts.filter((r) => loadMeta(r.slug)).length; // throws on an invalid cache file
console.log(`[check] trip.yml and resorts.yml are valid; ${resolved}/${resorts.length} resorts have valid cache.`);
