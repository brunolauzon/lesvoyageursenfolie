// Airports used to find the nearest gateway for a resort.
// Coordinates are approximate (± 2 km), which is plenty for transfer estimates.

export const ORIGIN = {
  code: 'YUL',
  ville: 'Montréal-Trudeau',
  label: 'YUL (Montréal-Trudeau)',
  lat: 45.4706,
  lon: -73.7408,
};

export const AIRPORTS = [
  // République dominicaine
  { code: 'PUJ', ville: 'Punta Cana', lat: 18.5674, lon: -68.3634 },
  { code: 'POP', ville: 'Puerto Plata', lat: 19.7579, lon: -70.57 },
  { code: 'SDQ', ville: 'Saint-Domingue', lat: 18.4297, lon: -69.6689 },
  { code: 'LRM', ville: 'La Romana', lat: 18.4507, lon: -68.9118 },
  { code: 'AZS', ville: 'Samaná', lat: 19.267, lon: -69.742 },
  // Mexique
  { code: 'CUN', ville: 'Cancún', lat: 21.0365, lon: -86.8771 },
  { code: 'CZM', ville: 'Cozumel', lat: 20.5224, lon: -86.9256 },
  { code: 'PVR', ville: 'Puerto Vallarta', lat: 20.6801, lon: -105.2544 },
  { code: 'SJD', ville: 'Los Cabos', lat: 23.1518, lon: -109.721 },
  { code: 'ZIH', ville: 'Ixtapa-Zihuatanejo', lat: 17.6016, lon: -101.4606 },
  { code: 'MZT', ville: 'Mazatlán', lat: 23.1614, lon: -106.2661 },
  { code: 'HUX', ville: 'Huatulco', lat: 15.7753, lon: -96.2626 },
  { code: 'MID', ville: 'Mérida', lat: 20.937, lon: -89.6577 },
  // Cuba
  { code: 'VRA', ville: 'Varadero', lat: 23.0344, lon: -81.4353 },
  { code: 'HAV', ville: 'La Havane', lat: 22.9892, lon: -82.4091 },
  { code: 'HOL', ville: 'Holguín', lat: 20.7856, lon: -76.3151 },
  { code: 'CCC', ville: 'Cayo Coco', lat: 22.513, lon: -78.511 },
  { code: 'SNU', ville: 'Santa Clara', lat: 22.4922, lon: -79.9437 },
  { code: 'CYO', ville: 'Cayo Largo', lat: 21.6165, lon: -81.546 },
  // Antilles et Caraïbes
  { code: 'MBJ', ville: 'Montego Bay', lat: 18.5037, lon: -77.9134 },
  { code: 'KIN', ville: 'Kingston', lat: 17.9357, lon: -76.7875 },
  { code: 'NAS', ville: 'Nassau', lat: 25.039, lon: -77.4662 },
  { code: 'PLS', ville: 'Providenciales', lat: 21.7736, lon: -72.2659 },
  { code: 'GCM', ville: 'Grand Cayman', lat: 19.2928, lon: -81.3577 },
  { code: 'AUA', ville: 'Aruba', lat: 12.5014, lon: -70.0152 },
  { code: 'CUR', ville: 'Curaçao', lat: 12.1889, lon: -68.9598 },
  { code: 'BON', ville: 'Bonaire', lat: 12.1311, lon: -68.2685 },
  { code: 'SXM', ville: 'Saint-Martin (Sint Maarten)', lat: 18.041, lon: -63.1089 },
  { code: 'SJU', ville: 'San Juan', lat: 18.4394, lon: -66.0018 },
  { code: 'UVF', ville: 'Sainte-Lucie', lat: 13.7332, lon: -60.9526 },
  { code: 'BGI', ville: 'Barbade', lat: 13.0746, lon: -59.4925 },
  { code: 'ANU', ville: 'Antigua', lat: 17.1367, lon: -61.7927 },
  { code: 'GND', ville: 'Grenade', lat: 12.0042, lon: -61.7862 },
  { code: 'SKB', ville: 'Saint-Kitts', lat: 17.3112, lon: -62.7187 },
  { code: 'TAB', ville: 'Tobago', lat: 11.1497, lon: -60.8322 },
  // Amérique centrale et Colombie
  { code: 'BZE', ville: 'Belize', lat: 17.5391, lon: -88.3082 },
  { code: 'LIR', ville: 'Liberia (Costa Rica)', lat: 10.5933, lon: -85.5444 },
  { code: 'SJO', ville: 'San José (Costa Rica)', lat: 9.9939, lon: -84.2088 },
  { code: 'PTY', ville: 'Panama', lat: 9.0714, lon: -79.3835 },
  { code: 'CTG', ville: 'Carthagène', lat: 10.4424, lon: -75.513 },
  // Floride
  { code: 'MIA', ville: 'Miami', lat: 25.7959, lon: -80.287 },
  { code: 'FLL', ville: 'Fort Lauderdale', lat: 26.0726, lon: -80.1527 },
  { code: 'MCO', ville: 'Orlando', lat: 28.4312, lon: -81.3081 },
];
