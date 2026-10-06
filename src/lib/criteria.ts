import { FIELD_BY_KEY } from '../schema/facility-fields';
import type { Trip } from '../schema/trip';
import { nights } from './dates';
import { t } from './i18n';
import type { ResortView } from './resorts';
import type { Criterion, Sub } from './score';
import { doorToDoor } from './travel';

export const CRITERIA_KEYS = ['weather', 'travel', 'beach', 'food', 'pool', 'kids', 'price', 'rating', 'activities'] as const;
const ACTIVITY_KEYS = ['waterSportsNonMotorized', 'waterSportsMotorized', 'tennis', 'golf', 'spaIncluded', 'gym', 'nightlyShows', 'excursions', 'diving', 'kidsActivities'];

/** Numeric view of a facility value: booleans 1/0, enums by position, numbers as-is. */
function facilityNumber(v: ResortView, key: string): number | null {
  const f = v.facts.fields[key];
  if (!f) return null;
  const def = FIELD_BY_KEY.get(key)!;
  if (def.type === 'bool') return f.value ? 1 : 0;
  if (def.type === 'enum') return def.options!.indexOf(f.value as string);
  return typeof f.value === 'number' ? f.value : null;
}

/** The sub-metrics behind each score criterion. Labels are shown in the breakdown. */
export function buildCriteria(views: ResortView[], trip: Trip): Criterion[] {
  const sub = (key: string, label: string, dir: 'high' | 'low', pick: (v: ResortView) => number | null): Sub => ({
    key, label, dir, values: Object.fromEntries(views.map((v) => [v.entry.slug, pick(v)])),
  });
  const fac = (key: string, dir: 'high' | 'low' = 'high') => sub(key, t(`fields.${key}`), dir, (v) => facilityNumber(v, key));
  const n = nights(trip);
  const criterion = (key: string, subs: Sub[]): Criterion => ({ key, label: t(`score.criteria.${key}`), subs });

  return [
    criterion('weather', [
      sub('avgHigh', t('fields.w_avgHigh'), 'high', (v) => v.weather?.summary.avgHigh ?? null),
      sub('sunshine', t('fields.w_sunshine'), 'high', (v) => v.weather?.summary.sunshineHoursPerDay ?? null),
      sub('rainy', t('fields.w_rainyDayPct'), 'low', (v) => v.weather?.summary.rainyDayPct ?? null),
    ]),
    criterion('travel', [sub('total', t('fields.t_total'), 'low', (v) => (v.travel ? doorToDoor(v.travel, trip.travel).total : null))]),
    criterion('beach', [fac('beachfront'), fac('beachDistanceM', 'low'), fac('beachType'), fac('swimmingSafe')]),
    criterion('food', [fac('restaurantCount'), fac('barCount'), fac('snack24h'), fac('allInclusive'), fac('alcoholTier'), fac('vegetarian')]),
    criterion('pool', [fac('poolCount'), fac('swimUpBar'), fac('heatedPool'), fac('hasPool')]),
    criterion('kids', [fac('kidsClub'), fac('kidsPool'), fac('familyRooms'), fac('kidsActivities')]),
    criterion('price', [sub('price', t('fields.price'), 'low', (v) => (v.entry.price_cad == null ? null : v.entry.price_cad / n))]),
    criterion('rating', [fac('rating'), fac('stars')]),
    criterion('activities', [
      sub('activityCount', t('score.activityCount'), 'high', (v) => {
        const known = ACTIVITY_KEYS.map((k) => facilityNumber(v, k)).filter((x): x is number => x !== null);
        return known.length ? known.reduce((a, b) => a + b, 0) : null;
      }),
    ]),
  ];
}
