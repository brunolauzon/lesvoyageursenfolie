import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';
import { z } from 'astro/zod';

// Every enriched field can be null: the script never guesses what its sources cannot confirm.
const num = z.number().nullish();
const str = z.string().nullish();
const bool = z.boolean().nullish();

const resorts = defineCollection({
  loader: file('src/data/resorts-enriched.json'),
  schema: z.object({
    id: z.string(),
    nom: z.string(),
    destination: str,
    pays: str, // optional manual override of the country used to group the comparison matrix
    image: str,
    imageGenerique: z.boolean().default(false),
    galerie: z.array(z.object({ url: z.string(), credit: z.string(), source: z.string() })).default([]),
    noteGenerale: num,
    nombreAvis: num,
    siteOfficiel: str,
    lienTripadvisor: str,
    etoiles: num,
    lienWikipedia: str,
    pointsForts: z.array(z.string()).default([]),
    pointsFaibles: z.array(z.string()).default([]),
    logistiqueTransport: z
      .object({
        aeroportDepart: str,
        aeroportArrivee: str,
        dureeVol: str,
        dureeVolMinutes: num,
        distanceVolKm: num,
        volDirect: bool,
        tempsTransfertResort: str,
        tempsTransfertMinutes: num,
        distanceTransfertKm: num,
        tempsTrajetTotalMinutes: num,
        estimationVol: bool,
      })
      .nullish(),
    meteoHistoriqueJanvier16: z
      .object({
        tempMaxC: num,
        tempMinC: num,
        probabilitePluiePct: num,
        heuresSoleilParJour: num,
        couvertureNuageusePct: num,
        annees: z.array(z.number()).default([]),
        parJour: z
          .array(
            z.object({
              date: z.string(),
              tempMaxC: num,
              tempMaxBasC: num,
              tempMaxHautC: num,
              tempMinC: num,
              tempMinBasC: num,
              tempMinHautC: num,
              precipMm: num,
              probabilitePluiePct: num,
              couvertureNuageusePct: num,
              heuresSoleil: num,
            }),
          )
          .default([]),
        // Each past year, day by day (same dates as the trip).
        parAnnee: z
          .array(
            z.object({
              annee: z.number(),
              jours: z.array(z.object({ tempMaxC: num, tempMinC: num, precipMm: num, nuagesPct: num })),
            }),
          )
          .default([]),
      })
      .nullish(),
    infrastructures: z.object({
      qualitePlage: str,
      nombrePiscines: num,
      clubEnfants: bool,
      parcAquatique: bool,
      nombreRestaurants: num,
      nombreBars: num,
      qualiteWifi: str,
      spaSurPlace: bool,
      serviceChambre24h: bool,
    }),
    // Age of the building: opening, last renovation, what was redone. Always sourced; null when unknown.
    etat: z
      .object({
        ouvertureAnnee: num,
        ouvertureMois: num,
        renovationAnnee: num,
        renovationMois: num,
        renovationNote: str,
        note: str,
        /** A renovation that has not happened yet (planned reopening). */
        prevu: bool,
        /** Something to check before booking (closure, reopening date…). */
        alerte: str,
        sources: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
      })
      .nullish(),
    // Room photos from the resort's own site (hotlinked, credited, with the page they come from).
    chambres: z.object({ photos: z.array(z.string()).default([]), source: z.string(), credit: z.string() }).nullish(),
    coordonnees: z.object({ lat: z.number(), lon: z.number(), precision: z.string() }).nullish(),
    meta: z.object({
      enrichedAt: z.string(),
      sources: z.array(z.string()).default([]),
      avertissements: z.array(z.string()).default([]),
      aeroportForce: str,
      champsManuels: z.array(z.string()).default([]),
      // Fields read from the resort's own pages (npm run enrich:web): by a rule or by the local AI, with source and quote.
      champsIA: z.record(z.string(), z.object({ url: z.string(), quote: z.string(), model: z.string().nullish(), date: z.string().nullish(), methode: z.string().nullish() })).default({}),
      sourceOfficielle: z.boolean().default(false),
    }),
  }),
});

export const collections = { resorts };
