export type ResolveProvider = 'google' | 'nominatim' | 'wikidata';

export interface Candidate {
  provider: ResolveProvider;
  name: string;
  lat: number;
  lon: number;
  address: string | null;
  country: string | null;
  website: string | null;
  googlePlaceId: string | null;
  wikidataId: string | null;
  lodging: boolean;
}

export interface SearchInput {
  name: string;
  location?: string | undefined;
  url?: string | undefined;
}
