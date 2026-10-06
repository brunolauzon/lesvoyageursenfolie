# Vacances en Famille 2027 : Départ de YUL

Comparateur de resorts (interface en français, `fr-CA`) pour la semaine du **16 au 23 janvier 2027**, départ de Montréal-Trudeau.
Vous ne fournissez que des **noms de resorts** ; un script récupère le reste avant chaque build.

## Démarrage rapide

```bash
npm install
npm run dev        # enrichit les données, puis lance http://localhost:4321
```

1. Éditez `src/data/resorts-input.json` : un tableau de noms de resorts.
2. Relancez `npm run dev` (ou `npm run build`). Les données sont mises en cache 14 jours ; `npm run enrich:force` force un rafraîchissement.

## Ce que le script récupère (`scripts/fetch-resort-data.js`)

| Donnée | Source | Clé requise |
| :-- | :-- | :-- |
| Position du resort, destination | OpenStreetMap Nominatim, Wikipédia, Open-Meteo Geocoding | non |
| Météo du 16 au 23 janvier (moyenne des 5 derniers Janviers) | Open-Meteo Archive | non |
| Aéroport le plus proche, transfert routier | OSRM (calcul sur la route) | non |
| Durée de vol (estimée), vol direct répertorié | Distance à vol d’oiseau, OpenFlights (historique) | non |
| Photos | Wikipédia, Wikimedia Commons (crédits affichés) | non |
| Infrastructures | Texte de l’article Wikipédia, s’il existe | non |
| Note, nombre d’avis, photos, infrastructures | Google Places (New) | `GOOGLE_PLACES_API_KEY` |

**Rien n’est inventé** : ce qu’aucune source ne confirme reste `null` et s’affiche « À confirmer ». Sans clé Google, la plupart des
infrastructures (parc aquatique, club enfants, nombre de restaurants…) seront à confirmer. Les points forts et faibles sont calculés
uniquement à partir des données collectées.

Les durées de vol, les transferts et la météo sont des **estimations** (la météo est une réanalyse, pas une prévision). Validez les
vols directs et les infrastructures sur les sites des transporteurs et des resorts avant de réserver.

## Corriger ou compléter à la main : `src/data/resorts-overrides.json`

Clé = id du resort (visible dans l’URL de sa fiche) ou son nom exact. Les valeurs remplacent les données automatiques.

```json
{
  "riu-palace-aruba": {
    "infrastructures": { "clubEnfants": true, "nombreRestaurants": 6, "qualitePlage": "5/5 (sable blanc)" },
    "pointsForts": ["Plage de Palm Beach à deux pas"],
    "noteGenerale": 4.4
  },
  "hotel-xcaret-mexico": { "aeroport": "CUN" }
}
```

- `pays` : force le pays utilisé pour regrouper et trier le tableau comparatif (sinon déduit de la destination).
- `aeroport` : force l’aéroport d’arrivée (code IATA) et recalcule vol et transfert.
- Après avoir retiré une correction, lancez `npm run enrich:force` pour retrouver la valeur automatique.

## Compléter les « À confirmer » automatiquement

```bash
npm run enrich:web            # lit les pages officielles de chaque resort
npm run enrich                # intègre les résultats au site
```

Le script cherche la page de chaque resort (OpenStreetMap, plan du site de la marque) et ne garde une page que si le **nom du resort** est dans son titre ou son adresse. Il respecte `robots.txt`. Pour forcer des pages : `src/data/resorts-sources.json`.

Il travaille en deux couches, de la plus fiable à la moins fiable :

1. **Règles, sans IA.** Les données structurées de la page officielle : liste des équipements (schema.org JSON-LD), note TripAdvisor et nombre d'avis affichés par le resort, catégorie en étoiles, nombres écrits dans le texte (« 10 restaurants »), nombre de restaurants listés sur la page gastronomie. Si une page se contredit (5 piscines ici, 6 là), la contradiction est signalée.
2. **IA locale (Ollama), seulement pour ce qui reste.** Elle doit citer la phrase exacte, et le script vérifie qu'elle est bien dans la page. Seuls les « oui » et les nombres explicites sont gardés. Installation : `ollama pull qwen3:8b`. Sans Ollama, seules les règles tournent.

Options : `--only <id>`, `--force`, `--rules-only`, `--dry`. Résultats dans `src/data/resorts-web.json`. Dans le site, chaque valeur lue porte un lien vers sa source ; « Non précisé » veut dire que le site du resort n'en parle pas, « À confirmer » que rien n'a été trouvé. Vos corrections dans `resorts-overrides.json` passent toujours en premier.

## Météo

`npm run enrich -- --weather` rafraîchit seulement la météo (rapide). Pour chaque jour du séjour, le site garde ce qui s’est passé à cette date chaque année des 5 dernières années. Ce n’est pas une prévision : les vraies prévisions n’existent qu’environ 2 semaines avant le départ.

## PDF

« Exporter en PDF » ouvre l'impression du navigateur (choisir « Enregistrer au format PDF »). L'impression passe en couleurs claires, en paysage, sans les éléments interactifs.

## Déploiement (GitHub Pages)

1. Dans le dépôt GitHub : **Settings > Pages > Source : GitHub Actions**.
2. Poussez sur `main` : `.github/workflows/deploy.yml` exécute `npm run build` (enrichissement inclus) et publie le site.
3. L’URL et le chemin de base (`/nom-du-depot`) sont déduits automatiquement du dépôt. Pour un autre domaine, définissez `SITE_URL` et `BASE_PATH`.
4. Optionnel : ajoutez le secret `GOOGLE_PLACES_API_KEY` (Settings > Secrets and variables > Actions).

`src/data/resorts-enriched.json` est versionné : il sert de cache et de secours si une API est indisponible pendant le build.

## Design

Le style est décrit dans `src/styles/global.css` (jetons en haut du fichier).

- **Idée** : on quitte l'hiver montréalais. La page s'ouvre sur l'écart de température avec Montréal (calculé sur les mêmes dates), puis suit le voyage.
- **Sobre** : l'interface est neutre. La couleur est réservée aux chiffres qui comptent : jaune pour la chaleur et les meilleures valeurs, bleu pour la pluie, glace pour le froid de Montréal.
- **Typographie** : Archivo (largeur variable : large pour « Vacances en Famille », étroite pour les titres et les noms) et Atkinson Hyperlegible Next pour le texte.
- **Thèmes** : sombre « nuit de plage » par défaut, clair « sable » avec le bouton soleil/lune.
- **Mouvement** : un seul, les barres du héros qui s'étirent depuis 0 °C au chargement (désactivé si le système demande moins d'animations).

Les règles du projet (et les pièges déjà rencontrés) sont dans `AGENT.md`.

## Structure

```text
scripts/fetch-resort-data.js   noms -> données (géocodage, trajet, météo, photos), fusion des résultats web
scripts/enrich-web.js          lecture des pages officielles (règles, puis IA locale facultative)
scripts/data/airports.js       table d’aéroports
src/content.config.ts          schéma Zod de la collection « resorts »
src/data/                      entrées, corrections, résultats générés
src/components/                Hero, Verdict, Voyage, ComparisonTable, WeatherOverview, ResortPanel, WeatherCard…
src/lib/                       carte (geo), mots (plain), météo (weather), ordre par pays (resorts)
src/pages/index.astro          tableau de bord
src/pages/hotel/[id].astro     fiche détaillée
```
