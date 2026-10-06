/**
 * Optional fallback: asks Claude to read the official site text and fill what is still missing.
 * Never invents: every field is nullable and the prompt says to return null unless stated in the text.
 */
import { z } from 'zod';
import { FIELD_BY_KEY, validValue, type FieldDef } from '../../../src/schema/facility-fields';
import { httpJson } from '../../lib/http';
import type { FactEntry } from './types';

export const MODEL = 'claude-sonnet-5-5';
/** LLM values never exceed this, so the UI always shows "to verify". */
export const MAX_CONFIDENCE = 0.6;
const MAX_TEXT = 30_000;

const LABELS: Record<string, string> = {
  stars: 'official star rating (1-5)', rating: 'guest rating on a 0-5 scale, only if the text gives one', reviewCount: 'number of guest reviews',
  allInclusive: 'all-inclusive: yes, partial or no', adultsOnly: 'adults-only resort', kidsClub: 'has a kids club', familyRooms: 'has family rooms',
  beachfront: 'directly on the beach', beachType: 'beach type', swimmingSafe: 'text says swimming is safe', beachDistanceM: 'distance to the beach in metres',
  hasPool: 'has a swimming pool', poolCount: 'number of pools', heatedPool: 'has a heated pool', swimUpBar: 'has a swim-up bar', kidsPool: 'has a kids pool',
  adultsOnlyPool: 'has an adults-only pool', restaurantCount: 'number of restaurants', aLaCarteReservation: 'a la carte restaurants require a reservation',
  barCount: 'number of bars', buffet: 'has a buffet', snack24h: '24-hour snacks or room service', vegetarian: 'vegetarian options', glutenFree: 'gluten-free options',
  alcoholTier: 'alcohol brands: national or premium', roomSizeM2: 'smallest standard room size in square metres', swimUpRooms: 'has swim-up rooms',
  suites: 'has suites', oceanView: 'has ocean-view rooms', roomFeatures: 'room features as short phrases',
  waterSportsNonMotorized: 'non-motorized water sports', waterSportsMotorized: 'motorized water sports', tennis: 'tennis courts', golf: 'golf',
  spaIncluded: 'spa access included in the rate', gym: 'gym or fitness centre', nightlyShows: 'nightly shows', excursions: 'excursions offered', diving: 'diving',
  kidsActivities: 'kids activities', wifiFree: 'free Wi-Fi', wifiAllAreas: 'Wi-Fi in all areas', nearestTownKm: 'distance to nearest town in km',
  wheelchair: 'wheelchair accessible', pets: 'pets allowed', languages: 'languages spoken by staff', checkIn: 'check-in time', checkOut: 'check-out time',
  roomCount: 'total number of rooms', renovationYear: 'year of last renovation', openingYear: 'opening year',
};

function jsonSchemaFor(def: FieldDef): Record<string, unknown> {
  const description = LABELS[def.key] ?? def.key;
  switch (def.type) {
    case 'bool': return { type: ['boolean', 'null'], description };
    case 'number': return { type: ['number', 'null'], description };
    case 'text': return { type: ['string', 'null'], description };
    case 'enum': return { enum: [...(def.options ?? []), null], description };
    case 'list': return { type: ['array', 'null'], items: { type: 'string' }, description };
  }
}

export function buildRequest(text: string, keys: string[]) {
  const defs = keys.map((k) => FIELD_BY_KEY.get(k)).filter((d): d is FieldDef => Boolean(d));
  return {
    model: MODEL,
    max_tokens: 2048,
    system:
      'You extract facts about a resort from text copied from its official website. ' +
      'Return a value for a field ONLY if the text states it explicitly. If the text does not say, return null. ' +
      'Never guess, never infer from the hotel category, never use outside knowledge.',
    tools: [{
      name: 'record_facts',
      description: 'Record the facts found in the text; null for anything not stated.',
      input_schema: { type: 'object', additionalProperties: false, required: defs.map((d) => d.key), properties: Object.fromEntries(defs.map((d) => [d.key, jsonSchemaFor(d)])) },
    }],
    tool_choice: { type: 'tool', name: 'record_facts' },
    messages: [{ role: 'user', content: text.slice(0, MAX_TEXT) }],
  };
}

const ResponseSchema = z.object({ content: z.array(z.object({ type: z.string(), input: z.unknown().optional() })) });

/** Keep only non-null values that are valid for their field. */
export function acceptFacts(input: unknown, keys: string[], url: string | null): Record<string, FactEntry> {
  const out: Record<string, FactEntry> = {};
  if (!input || typeof input !== 'object') return out;
  for (const key of keys) {
    const def = FIELD_BY_KEY.get(key);
    const raw = (input as Record<string, unknown>)[key];
    if (!def || raw === null || raw === undefined) continue;
    const value = validValue(def, raw);
    if (value !== undefined) out[key] = { value, confidence: MAX_CONFIDENCE, url };
  }
  return out;
}

export async function llm(text: string, missing: string[], url: string | null): Promise<Record<string, FactEntry>> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !text.trim() || missing.length === 0) return {};
  const raw = await httpJson('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(buildRequest(text, missing)),
    ttlMs: 30 * 86_400_000,
    intervalMs: 1000,
  });
  const tool = ResponseSchema.parse(raw).content.find((c) => c.type === 'tool_use');
  return acceptFacts(tool?.input, missing, url);
}
