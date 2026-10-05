/**
 * Canned Gemini responses for fixture mode.
 *
 * Keyed by the SHA-256 of the image buffer, so a given test image always
 * produces the same verdict without a network call. Tests pick an outcome by
 * choosing which fixture image to upload — no magic request fields, no
 * environment-specific branching inside the service.
 *
 * The hashes correspond to the images in `server/test/fixtures/`, which are
 * tiny generated PNGs (74 bytes each). Their visual content is irrelevant:
 * in fixture mode nothing is ever sent to a model.
 *
 * Anything not listed here falls back to DEFAULT_RELEVANT, so a test that just
 * needs "a report that passes the gate" can upload any image at all.
 */

/** Shape matches exactly what gemini.service.js returns to its callers. */
const relevantRoadDamage = {
  relevance: {
    isRelevant: true,
    category: 'road_damage',
    confidence: 0.96,
    reason: 'The image shows a damaged public road surface requiring repair.',
  },
  cost: {
    minCost: 7000,
    expectedCost: 10500,
    maxCost: 16000,
    severity: 'high',
    observedIssue: 'A large pothole in the asphalt carriageway with exposed sub-base material.',
    breakdown: [
      { item: 'Site preparation and debris removal', cost: 700 },
      { item: 'Hot mix asphalt and tack coat', cost: 7350 },
      { item: 'Compaction and finishing', cost: 750 },
      { item: 'Traffic management', cost: 500 },
      { item: 'Contingency and overheads', cost: 1200 },
    ],
    assumptions: [
      'Pothole assumed to be roughly 1.5 m x 1.0 m with an average depth of 0.2 m.',
      'Standard hot mix asphalt repair method.',
    ],
    confidence: 0.8,
  },
};

const relevantStreetLighting = {
  relevance: {
    isRelevant: true,
    category: 'street_lighting',
    confidence: 0.91,
    reason: 'The image shows a failed public street light.',
  },
  cost: {
    minCost: 2500,
    expectedCost: 4000,
    maxCost: 6500,
    severity: 'medium',
    observedIssue: 'Street light head not functioning; housing appears intact.',
    breakdown: [
      { item: 'Replacement LED luminaire', cost: 2800 },
      { item: 'Electrician labour and access equipment', cost: 1200 },
    ],
    assumptions: ['Assumes the pole and wiring are serviceable and only the luminaire needs replacing.'],
    confidence: 0.7,
  },
};

const irrelevant = {
  relevance: {
    isRelevant: false,
    category: 'not_infrastructure',
    confidence: 0.98,
    reason:
      'This image does not show public civic infrastructure. Please submit a photo of a damaged road, footpath, drain, street light or other public facility.',
  },
  cost: null,
};

/** sha256(imageBuffer) → canned response. */
export const AI_FIXTURES = Object.freeze({
  dbe4973ef899290a91c73601b375d1f4afcf1a82499e140ad3cb14f28c9b9e75: relevantRoadDamage,
  ba32abc07b03db77577d64ba52ce0530e1367f78c1e127f64d8cbe085fbda3bf: relevantStreetLighting,
  '086508437024f1328d51651b4963f0cd82c2a1621ae874b4ad5b901e49ae09bd': irrelevant,
});

export const DEFAULT_RELEVANT = relevantRoadDamage;

/** Named exports so tests can assert against the exact expected numbers. */
export const FIXTURE_RESPONSES = Object.freeze({
  relevantRoadDamage,
  relevantStreetLighting,
  irrelevant,
});
