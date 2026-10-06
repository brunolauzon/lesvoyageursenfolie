/**
 * Prebuild orchestrator. Phase 1: validate inputs only.
 * Later phases add resolve + providers + cache. Must stay a no-op when the cache is fresh.
 */
import { loadResortInputs, loadTrip } from '../src/lib/data';

loadTrip();
const resorts = loadResortInputs();
console.log(`[fetch] ${resorts.length} hôtels valides, aucune donnée à rafraîchir (phase 1).`);
