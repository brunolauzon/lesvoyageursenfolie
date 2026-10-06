import { loadMeta, loadResortInputs, loadTravel, loadWeather, loadTrip, type ResortEntry } from './data';
import { loadFacts, type ResortFacts } from './facilities';
import type { Meta } from '../schema/meta';
import type { Travel } from '../schema/travel';
import type { Weather } from '../schema/weather';

/** Everything known about one resort, loaded once for the pages. */
export interface ResortView {
  entry: ResortEntry;
  meta: Meta | null;
  weather: Weather | null;
  travel: Travel | null;
  facts: ResortFacts;
}

export function loadResortViews(): ResortView[] {
  return loadResortInputs().map((entry) => ({
    entry,
    meta: loadMeta(entry.slug),
    weather: loadWeather(entry.slug),
    travel: loadTravel(entry.slug),
    facts: loadFacts(entry),
  }));
}

export { loadTrip };
