import { FIELDS, validValue } from '../schema/facility-fields';
import { SOURCES, type FieldValue, type ProviderResult, type Source } from '../schema/facilities';

export interface HandWritten {
  /** key -> value; null means "explicitly unknown" */
  values: Record<string, unknown>;
}

/**
 * Per field, the first source in SOURCES order that has a valid value wins:
 * override (human) > manual (resorts.yml) > official site > OpenStreetMap > Wikidata > LLM.
 * An override of `null` blanks the field so a wrong fetched value can be hidden.
 */
export function mergeFacilities(
  fetched: Partial<Record<string, ProviderResult>>,
  manual: Record<string, unknown>,
  override: Record<string, unknown> | null,
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const def of FIELDS) {
    if (override && def.key in override) {
      const v = override[def.key];
      if (v === null || v === undefined) continue; // explicitly unknown
      out[def.key] = { value: v, source: 'override', confidence: 1, fetchedAt: null, url: null };
      continue;
    }
    for (const source of SOURCES.filter((s): s is Exclude<Source, 'override'> => s !== 'override')) {
      if (source === 'manual') {
        const v = validValue(def, manual[def.key]);
        if (v !== undefined) {
          out[def.key] = { value: v, source, confidence: 1, fetchedAt: null, url: null };
          break;
        }
        continue;
      }
      const result = fetched[source];
      const entry = result?.fields[def.key];
      const v = entry ? validValue(def, entry.value) : undefined;
      if (entry && v !== undefined) {
        out[def.key] = { value: v, source, confidence: entry.confidence, fetchedAt: result!.fetchedAt, url: entry.url ?? null };
        break;
      }
    }
  }
  return out;
}

/** Fields still missing after a merge, in registry order. */
export const missingKeys = (merged: Record<string, FieldValue>) => FIELDS.map((f) => f.key).filter((k) => !(k in merged));
