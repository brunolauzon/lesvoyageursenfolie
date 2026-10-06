/**
 * The single list of facts we track per resort. It drives the cache schema, override validation,
 * the comparison table, the LLM extraction schema and the missing-data report.
 * Labels live in src/i18n/fr.json under fields.<key>, groups.<key> and enums.<key>.<option>.
 */
import { z } from 'zod';

export const GROUPS = ['overview', 'beach', 'pools', 'food', 'rooms', 'activities', 'practical'] as const;
export type GroupKey = (typeof GROUPS)[number];

export type FieldType = 'bool' | 'number' | 'text' | 'enum' | 'list';

export interface FieldDef {
  key: string;
  group: GroupKey;
  type: FieldType;
  /** Which direction counts as "better" in the comparison. Omit for neutral facts. */
  better?: 'high' | 'low';
  /** enum options, worst first (used for ordering and highlighting) */
  options?: readonly string[];
  unit?: string;
}

const bool = (key: string, group: GroupKey, better?: 'high' | 'low'): FieldDef => ({ key, group, type: 'bool', better });
const num = (key: string, group: GroupKey, better?: 'high' | 'low', unit?: string): FieldDef => ({ key, group, type: 'number', better, unit });

export const FIELDS: readonly FieldDef[] = [
  // overview
  num('stars', 'overview', 'high'),
  num('rating', 'overview', 'high'),
  num('reviewCount', 'overview', 'high'),
  { key: 'allInclusive', group: 'overview', type: 'enum', options: ['no', 'partial', 'yes'], better: 'high' },
  bool('adultsOnly', 'overview'),
  bool('kidsClub', 'overview', 'high'),
  bool('familyRooms', 'overview', 'high'),
  // beach
  bool('beachfront', 'beach', 'high'),
  { key: 'beachType', group: 'beach', type: 'enum', options: ['rock', 'pebble', 'mixed', 'sand'], better: 'high' },
  bool('swimmingSafe', 'beach', 'high'),
  num('beachDistanceM', 'beach', 'low', 'meter'),
  // pools
  bool('hasPool', 'pools', 'high'),
  num('poolCount', 'pools', 'high'),
  bool('heatedPool', 'pools', 'high'),
  bool('swimUpBar', 'pools', 'high'),
  bool('kidsPool', 'pools', 'high'),
  bool('adultsOnlyPool', 'pools'),
  // food
  num('restaurantCount', 'food', 'high'),
  bool('aLaCarteReservation', 'food', 'low'),
  num('barCount', 'food', 'high'),
  bool('buffet', 'food', 'high'),
  bool('snack24h', 'food', 'high'),
  bool('vegetarian', 'food', 'high'),
  bool('glutenFree', 'food', 'high'),
  { key: 'alcoholTier', group: 'food', type: 'enum', options: ['national', 'premium'], better: 'high' },
  // rooms
  num('roomSizeM2', 'rooms', 'high', 'square-meter'),
  bool('swimUpRooms', 'rooms', 'high'),
  bool('suites', 'rooms', 'high'),
  bool('oceanView', 'rooms', 'high'),
  { key: 'roomFeatures', group: 'rooms', type: 'list' },
  // activities
  bool('waterSportsNonMotorized', 'activities', 'high'),
  bool('waterSportsMotorized', 'activities', 'high'),
  bool('tennis', 'activities', 'high'),
  bool('golf', 'activities', 'high'),
  bool('spaIncluded', 'activities', 'high'),
  bool('gym', 'activities', 'high'),
  bool('nightlyShows', 'activities', 'high'),
  bool('excursions', 'activities', 'high'),
  bool('diving', 'activities', 'high'),
  bool('kidsActivities', 'activities', 'high'),
  // practical
  bool('wifiFree', 'practical', 'high'),
  bool('wifiAllAreas', 'practical', 'high'),
  num('nearestTownKm', 'practical', 'low', 'kilometer'),
  bool('wheelchair', 'practical', 'high'),
  bool('pets', 'practical'),
  { key: 'languages', group: 'practical', type: 'list' },
  { key: 'checkIn', group: 'practical', type: 'text' },
  { key: 'checkOut', group: 'practical', type: 'text' },
  num('roomCount', 'practical'),
  num('renovationYear', 'practical', 'high'),
  num('openingYear', 'practical'),
];

export const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

export function valueSchema(def: FieldDef): z.ZodType<unknown> {
  switch (def.type) {
    case 'bool': return z.boolean();
    case 'number': return z.number().nonnegative();
    case 'text': return z.string().min(1);
    case 'enum': return z.enum(def.options as [string, ...string[]]);
    case 'list': return z.array(z.string().min(1)).min(1);
  }
}

/** The value if it is valid for this field, else undefined. */
export function validValue(def: FieldDef, value: unknown): unknown {
  const r = valueSchema(def).safeParse(value);
  return r.success ? r.data : undefined;
}
