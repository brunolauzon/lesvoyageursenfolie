import type { FieldValue, Photo } from '../schema/facilities';
import { loadFacilitiesCache, type ResortEntry } from './data';
import { mergeFacilities } from './merge';
import { loadOverride } from './overrides';

export interface ResortFacts {
  fields: Record<string, FieldValue>;
  photos: Photo[];
  /** free text from the override file */
  note: string | null;
  fetchedAt: string | null;
}

/** Fetched facts merged with hand-written overrides. */
export function loadFacts(entry: ResortEntry): ResortFacts {
  const cache = loadFacilitiesCache(entry.slug);
  const override = loadOverride(entry.slug);
  return {
    fields: mergeFacilities(cache?.providers ?? {}, {}, override),
    photos: cache?.photos ?? [],
    note: override?.note ?? null,
    fetchedAt: cache?.fetchedAt ?? null,
  };
}

export const googleMapsUrl = (placeId: string) => `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
