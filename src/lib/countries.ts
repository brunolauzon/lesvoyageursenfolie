// French country names (as produced by the enrichment script) -> ISO code and the Natural Earth name used by world-atlas.

export const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

const TABLE: [fr: string, iso2: string, en: string][] = [
  ['Mexique', 'MX', 'Mexico'],
  ['Jamaïque', 'JM', 'Jamaica'],
  ['République dominicaine', 'DO', 'Dominican Rep.'],
  ['Aruba', 'AW', 'Aruba'],
  ['Curaçao', 'CW', 'Curaçao'],
  ['Cuba', 'CU', 'Cuba'],
  ['Bahamas', 'BS', 'Bahamas'],
  ['Costa Rica', 'CR', 'Costa Rica'],
  ['Panama', 'PA', 'Panama'],
  ['Barbade', 'BB', 'Barbados'],
  ['Sainte-Lucie', 'LC', 'Saint Lucia'],
  ['Antigua-et-Barbuda', 'AG', 'Antigua and Barb.'],
  ['Grenade', 'GD', 'Grenada'],
  ['Belize', 'BZ', 'Belize'],
  ['Îles Turques-et-Caïques', 'TC', 'Turks and Caicos Is.'],
  ['Îles Caïmans', 'KY', 'Cayman Is.'],
  ['Porto Rico', 'PR', 'Puerto Rico'],
  ['Colombie', 'CO', 'Colombia'],
  ['Haïti', 'HT', 'Haiti'],
  ['Honduras', 'HN', 'Honduras'],
  ['Guatemala', 'GT', 'Guatemala'],
  ['Trinité-et-Tobago', 'TT', 'Trinidad and Tobago'],
  ['Saint-Christophe-et-Niévès', 'KN', 'St. Kitts and Nevis'],
  ['Dominique', 'DM', 'Dominica'],
  ['Bermudes', 'BM', 'Bermuda'],
  ['États-Unis', 'US', 'United States of America'],
  ['Canada', 'CA', 'Canada'],
];

const BY_NAME = new Map(TABLE.map(([fr, iso2, en]) => [norm(fr), { iso2, en }]));

export const countryInfo = (fr: string | null | undefined) => (fr ? BY_NAME.get(norm(fr)) ?? null : null);

/** Flag emoji for a French country name, or '' when unknown. */
export function flagOf(fr: string | null | undefined): string {
  const info = countryInfo(fr);
  return info ? String.fromCodePoint(...[...info.iso2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '';
}
