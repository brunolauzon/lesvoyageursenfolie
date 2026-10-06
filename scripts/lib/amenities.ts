/** Maps free-text amenity names (schema.org amenityFeature, page labels) to facility fields. */
export interface AmenityHit {
  key: string;
  value: boolean | string;
}

const RULES: { re: RegExp; hits: AmenityHit[] }[] = [
  { re: /swim.?up (bar|pool bar)|bar (de )?piscine|bar dans la piscine/i, hits: [{ key: 'swimUpBar', value: true }] },
  { re: /swim.?up (room|suite)|chambres? (avec )?acc[èe]s (direct )?(à|a) la piscine/i, hits: [{ key: 'swimUpRooms', value: true }] },
  { re: /heated (swimming )?pool|piscine chauff/i, hits: [{ key: 'hasPool', value: true }, { key: 'heatedPool', value: true }] },
  { re: /kids?.?s? pool|children.?s pool|pataugeoire|piscine (pour )?enfants/i, hits: [{ key: 'kidsPool', value: true }] },
  { re: /adults?.?only pool|piscine (pour )?adultes/i, hits: [{ key: 'adultsOnlyPool', value: true }] },
  { re: /\bpool\b|piscine/i, hits: [{ key: 'hasPool', value: true }] },
  { re: /kids?.?s? club|children.?s club|club (pour )?enfants|mini.?club/i, hits: [{ key: 'kidsClub', value: true }] },
  { re: /kids? activit|animation (pour )?enfants|activit[ée]s? (pour )?enfants/i, hits: [{ key: 'kidsActivities', value: true }] },
  { re: /family (room|suite)|chambres? familiale/i, hits: [{ key: 'familyRooms', value: true }] },
  { re: /adults?.?only|adultes seulement|r[ée]serv[ée] aux adultes/i, hits: [{ key: 'adultsOnly', value: true }] },
  { re: /all.?inclusive|tout inclus/i, hits: [{ key: 'allInclusive', value: 'yes' }] },
  { re: /beach.?front|on the beach|front de mer|pieds dans l.?eau|sur la plage/i, hits: [{ key: 'beachfront', value: true }] },
  { re: /vegetarian|v[ée]g[ée]tarien/i, hits: [{ key: 'vegetarian', value: true }] },
  { re: /gluten/i, hits: [{ key: 'glutenFree', value: true }] },
  { re: /24.?h(our)? (snack|food|dining)|snack.?bar 24|restauration 24/i, hits: [{ key: 'snack24h', value: true }] },
  { re: /buffet/i, hits: [{ key: 'buffet', value: true }] },
  { re: /non.?motori[sz]ed/i, hits: [{ key: 'waterSportsNonMotorized', value: true }] },
  { re: /motori[sz]ed (water|sport)|jet.?ski|sports nautiques motoris/i, hits: [{ key: 'waterSportsMotorized', value: true }] },
  { re: /\btennis\b/i, hits: [{ key: 'tennis', value: true }] },
  { re: /\bgolf\b/i, hits: [{ key: 'golf', value: true }] },
  { re: /\b(gym|fitness)\b|salle d.?entra[iî]nement|conditionnement physique/i, hits: [{ key: 'gym', value: true }] },
  { re: /nightly (show|entertainment)|evening (show|entertainment)|spectacles? (du soir|nocturne)/i, hits: [{ key: 'nightlyShows', value: true }] },
  { re: /\bdiving\b|plong[ée]e/i, hits: [{ key: 'diving', value: true }] },
  { re: /excursion/i, hits: [{ key: 'excursions', value: true }] },
  { re: /(free|complimentary|gratuit).{0,20}wi-?fi|wi-?fi.{0,20}(free|complimentary|gratuit)|internet gratuit/i, hits: [{ key: 'wifiFree', value: true }] },
  { re: /wheelchair|accessible aux personnes|mobilit[ée] r[ée]duite/i, hits: [{ key: 'wheelchair', value: true }] },
  { re: /ocean.?view|sea.?view|vue (sur )?(l.?oc[ée]an|la mer)/i, hits: [{ key: 'oceanView', value: true }] },
  { re: /\bsuites?\b/i, hits: [{ key: 'suites', value: true }] },
];

/** Facts implied by one amenity label. `present: false` flips booleans to false. */
export function mapAmenity(label: string, present = true): AmenityHit[] {
  for (const rule of RULES) {
    if (!rule.re.test(label)) continue;
    return rule.hits.map((h) => (typeof h.value === 'boolean' ? { ...h, value: present } : present ? h : { key: h.key, value: 'no' }));
  }
  return [];
}
