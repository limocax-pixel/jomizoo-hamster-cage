// Build-time rendering: fills the <!--@key--> placeholders in index.html with content generated
// from the data files, so the numbers, tables, FAQ and structured data are in the static HTML
// (readable by search engines and AI crawlers that don't run JavaScript).
import { evaluate } from './calc.js';
import {
  describeScene, esc, faqEntries, keyFacts, renderChecks, renderFaq, renderKeyFacts, renderMetricChips,
  renderPresetOptions, renderSources, renderSpeciesFacts, renderSpeciesOptions, renderSpeciesTable, renderVerdictPill,
} from './render.js';
import { defaultState } from './state.js';

export const SITE = {
  url: 'https://limocax-pixel.github.io/hamster-habitat-planner/',
  repo: 'https://github.com/limocax-pixel/hamster-habitat-planner',
  updated: '2026-09-25',
};

const ORG_ID = 'https://jomizoo.com/#organization';

export function buildJsonLd({ list, faq, dataVersion }) {
  const organization = {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: 'JOMIZOO',
    url: 'https://jomizoo.com/',
    logo: 'https://jomizoo.com/jomizoo-logo.png',
    description: 'Small-pet brand making natural bedding for hamsters and other small animals.',
    sameAs: [
      'https://x.com/JOMIZOO_PET',
      'https://www.instagram.com/jomizoo_pet/',
      'https://www.amazon.co.jp/stores/page/CCB64697-C5A5-4BD9-AF51-11820B246364',
    ],
  };
  const app = {
    '@type': 'WebApplication',
    '@id': `${SITE.url}#app`,
    name: 'Hamster Habitat Planner',
    url: SITE.url,
    description:
      'Free 3D planner for hamster enclosures: arrange the wheel, hide, sand bath and bowl by dragging them, and check minimum floor space, height, bedding depth, burrowing depth, liters of bedding to buy and wheel size for Syrian, dwarf and Chinese hamsters.',
    applicationCategory: 'LifestyleApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript. The 3D preview needs WebGL.',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    inLanguage: 'en',
    license: 'https://opensource.org/licenses/MIT',
    dateModified: SITE.updated,
    image: `${SITE.url}og-image.jpg`,
    creator: { '@id': ORG_ID },
    publisher: { '@id': ORG_ID },
  };
  const code = {
    '@type': 'SoftwareSourceCode',
    name: 'hamster-habitat-planner',
    codeRepository: SITE.repo,
    programmingLanguage: 'JavaScript',
    license: 'https://opensource.org/licenses/MIT',
    author: { '@id': ORG_ID },
    targetProduct: { '@id': `${SITE.url}#app` },
  };
  const dataset = {
    '@type': 'Dataset',
    '@id': `${SITE.url}#data`,
    name: 'Hamster habitat parameters by species',
    description: `Minimum unbroken floor space, minimum bedding depth, burrowing depth, minimum wheel diameter, bar spacing, adult size, weight and lifespan for ${list.length} pet hamster species (${list
      .map((s) => s.name)
      .join(', ')}), each value linked to its source.`,
    url: `${SITE.url}#data`,
    license: 'https://creativecommons.org/licenses/by/4.0/',
    isAccessibleForFree: true,
    version: dataVersion,
    dateModified: SITE.updated,
    creator: { '@id': ORG_ID },
    keywords: ['hamster', 'hamster cage size', 'hamster bedding depth', 'hamster wheel size', 'animal welfare', 'Syrian hamster', 'dwarf hamster'],
    distribution: [
      { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE.url}data/species.json` },
    ],
  };
  const faqPage = {
    '@type': 'FAQPage',
    mainEntity: faq.map((e) => ({ '@type': 'Question', name: e.q, acceptedAnswer: { '@type': 'Answer', text: e.a } })),
  };
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': [organization, app, code, dataset, faqPage] });
  return `<script type="application/ld+json">${json.replace(/</g, '\\u003c')}</script>`;
}

export function renderStaticParts(html, { species, enclosures }) {
  const state = defaultState();
  const list = species.species;
  const sp = list.find((s) => s.id === state.species);
  const results = evaluate(state, sp);
  const facts = keyFacts(list, state.bedding.allowance);
  const faq = faqEntries(list, facts, state.bedding.allowance);
  const parts = {
    'key-facts': renderKeyFacts(facts),
    'species-options': renderSpeciesOptions(list, state.species),
    'species-facts': renderSpeciesFacts(sp, state.units),
    'preset-options': renderPresetOptions(enclosures.presets),
    'verdict-pill': renderVerdictPill(results),
    'verdict-level': results.verdict.level,
    'metric-chips': renderMetricChips(results, state.units),
    checks: renderChecks(results, sp, state.units, state),
    'scene-description': esc(describeScene(state, results, sp, state.units)),
    'species-table': renderSpeciesTable(list, species.sources),
    faq: renderFaq(faq),
    sources: renderSources(species.sources),
    'json-ld': buildJsonLd({ list, faq, dataVersion: species.version }),
    updated: SITE.updated,
    'data-version': esc(species.version),
    'site-url': SITE.url,
    'repo-url': SITE.repo,
  };
  return html.replace(/<!--@([a-z-]+)-->/g, (match, key) => (key in parts ? parts[key] : match));
}

/** llms.txt: a plain-text summary for AI crawlers, generated from the same data as the page. */
export function renderLlmsTxt({ species }) {
  const list = species.species;
  const facts = keyFacts(list, defaultState().bedding.allowance);
  return `# Hamster Habitat Planner (by JOMIZOO)

> Free, open-source 3D planner that checks a hamster enclosure against welfare guidelines: minimum floor space, bedding depth, burrowing depth, bedding volume in liters and wheel size, for ${list.map((s) => s.name).join(', ')}.

Key numbers (data/species.json, version ${species.version}, CC BY 4.0):

- ${facts.floor}
- ${facts.depth}
- ${facts.wheel}
- ${facts.volume}

## Tool

- [Hamster Habitat Planner](${SITE.url}): interactive 3D planner with a checklist, bedding calculator and shareable links.

## Data

- [species.json](${SITE.url}data/species.json): per-species minimums with a source for every value.
- [enclosures.json](${SITE.url}data/enclosures.json): common enclosure sizes.

## Source code

- [GitHub repository](${SITE.repo}): MIT license. Corrections with sources are welcome as issues.

## About

- [JOMIZOO](https://jomizoo.com/): small-pet brand making natural paper and aspen bedding for hamsters and other small animals.
`;
}

export function renderSitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE.url}</loc>
    <lastmod>${SITE.updated}</lastmod>
  </url>
</urlset>
`;
}
