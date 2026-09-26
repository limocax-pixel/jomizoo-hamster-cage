// HTML/text builders shared by the browser (live updates) and the build-time prerender
// (static, crawlable content). Pure functions: data in, strings out.
import {
  fmtArea, fmtAreaBoth, fmtAreaPair, fmtDims, fmtLen, fmtLenBoth, fmtLiters, fmtNumber, fmtPercent, fmtVolume,
  isImperial, lenToDisplay, lenUnit,
} from './units.js';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICONS = { pass: '✓', fail: '✕', warn: '!', info: 'i', great: '★' };

export const ENCLOSURE_NAMES = { tank: 'glass tank', bin: 'bin cage', wood: 'wooden enclosure', wire: 'wire cage' };

function fmtRange([a, b], unit, digits = 0) {
  return a === b ? `${fmtNumber(a, digits)} ${unit}` : `${fmtNumber(a, digits)}–${fmtNumber(b, digits)} ${unit}`;
}

function fmtTempRange({ min, max }, units) {
  if (isImperial(units)) return `${fmtNumber((min * 9) / 5 + 32, 0)}–${fmtNumber((max * 9) / 5 + 32, 0)} °F`;
  return `${fmtNumber(min, 0)}–${fmtNumber(max, 0)} °C`;
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** Join names: "A", "A and B", "A, B and C". */
export function joinNames(names) {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Group species that share a value so summaries read naturally. */
function groupBy(list, keyFn) {
  const groups = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function renderSpeciesOptions(list, selectedId) {
  return list
    .map(
      (s) =>
        `<label class="chip"><input type="radio" name="species" value="${esc(s.id)}"${s.id === selectedId ? ' checked' : ''}><span>${esc(s.shortName)}</span></label>`,
    )
    .join('');
}

export function renderSpeciesFacts(sp, units) {
  const a = sp.adult;
  const parts = [fmtRange(a.weightG, 'g'), fmtRange(a.lifespanYears, 'yrs', 1), fmtTempRange(sp.temperatureC, units)];
  const badge = sp.health ? ` <span class="badge" title="${esc(sp.health.note)}">Diabetes-prone</span>` : '';
  return `${parts.join(' · ')}${badge}`;
}

export function renderPresetOptions(presets) {
  return [
    '<option value="">Load a common size…</option>',
    ...presets.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`),
  ].join('');
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

const FAIL_NAMES = {
  floor: 'floor space',
  height: 'enclosure height',
  depth: 'bedding depth',
  'wheel-size': 'wheel size',
  'wheel-fit': 'wheel height',
};

export function verdictText(r, sp, units) {
  const { level, failing } = r.verdict;
  if (level === 'excellent') {
    return {
      level,
      title: 'Excellent setup',
      text: `Meets every minimum for ${sp.namePlural} and includes a ${fmtLen(r.depth.burrowCm, units)}+ burrowing area.`,
    };
  }
  if (level === 'meets') {
    return {
      level,
      title: 'Meets the minimums',
      text: `Add a ${fmtLen(r.depth.burrowCm, units)} deep area so your hamster can build a real burrow.`,
    };
  }
  const names = failing.map((id) => FAIL_NAMES[id] ?? id);
  return {
    level,
    title: 'Below the minimum',
    text: `${failing.length} ${failing.length === 1 ? 'thing' : 'things'} to fix: ${joinNames(names)}.`,
  };
}

function checkText(check, r, sp, units, state) {
  const L = (cm) => fmtLen(cm, units);
  const { floor, depth, wheel, volume } = r;
  switch (check.id) {
    case 'floor': {
      const better =
        floor.recommendedAreaCm2 && floor.areaCm2 < floor.recommendedAreaCm2
          ? ` About ${fmtArea(floor.recommendedAreaCm2, units)} is better.`
          : '';
      if (check.status === 'fail') {
        return {
          title: `Floor space ${fmtArea(floor.areaCm2, units)} — too small`,
          detail: `${capitalize(sp.namePlural)} need at least ${fmtDims(floor.minLengthCm, floor.minWidthCm, units)} (${fmtArea(floor.minAreaCm2, units)}) of unbroken floor. This enclosure has ${fmtPercent(floor.ratio)} of that.`,
        };
      }
      if (check.status === 'warn') {
        return {
          title: `Floor space ${fmtArea(floor.areaCm2, units)} — but narrow`,
          detail: `The area meets the minimum, but the shortest side is ${L(floor.shortSideCm)}. Guidelines ask for at least ${fmtDims(floor.minLengthCm, floor.minWidthCm, units)}.${better}`,
        };
      }
      return {
        title: `Floor space ${fmtArea(floor.areaCm2, units)}`,
        detail: `${fmtPercent(floor.ratio)} of the ${fmtDims(floor.minLengthCm, floor.minWidthCm, units)} minimum for ${sp.namePlural}. Only unbroken floor counts — platforms and levels don't add to it.${better}`,
      };
    }
    case 'height':
      return check.status === 'pass'
        ? { title: `Height ${L(r.height.cm)}`, detail: `Meets the ${L(r.height.minCm)} minimum. Use a secure mesh lid on tanks and bins.` }
        : {
            title: `Height ${L(r.height.cm)} — too low`,
            detail: `${capitalize(sp.namePlural)} need an enclosure at least ${L(r.height.minCm)} tall, so deep bedding, a wheel and climbing room fit.`,
          };
    case 'depth':
      if (depth.spills) {
        return {
          title: 'Bedding would spill over the base',
          detail: `The base only holds ${L(depth.fillLimitCm)} of bedding. Add a bedding guard or choose an enclosure with a deeper base.`,
        };
      }
      return check.status === 'pass'
        ? { title: `Bedding ${L(depth.standardCm)} deep`, detail: `Meets the ${L(depth.minCm)} minimum for ${sp.namePlural} across the whole floor.` }
        : {
            title: `Bedding ${L(depth.standardCm)} — too shallow`,
            detail: `Aim for at least ${L(depth.minCm)} across the whole floor so your hamster can dig.`,
          };
    case 'burrow':
      if (depth.burrow === 'full') {
        return {
          title: `Burrowing area ${L(depth.maxCm)} deep`,
          detail: `Deep enough for a full burrow with a nest chamber. In a study of Syrian hamsters, every animal given 40 or 80 cm of bedding dug burrows, while those on 10 cm gnawed the cage wire significantly more (Hauzenberger et al., 2006).`,
        };
      }
      if (depth.burrow === 'partial') {
        return {
          title: 'Add a deeper burrowing area',
          detail: `Your deepest bedding is ${L(depth.maxCm)}. Piling part of the enclosure to ${L(depth.burrowCm)} lets your hamster build a real burrow system.`,
        };
      }
      return {
        title: 'No room to burrow',
        detail: `With less than ${L(depth.minCm)} of bedding your hamster can't dig tunnels.`,
      };
    case 'wheel-size':
      return check.status === 'pass'
        ? {
            title: `Wheel Ø ${L(wheel.diameterCm)}`,
            detail: `At least ${L(wheel.minCm)} for ${sp.namePlural}${wheel.recommendedCm > wheel.minCm ? `; ${L(wheel.recommendedCm)} or more is better` : ''}. The back should stay straight while running, on a solid surface with no rungs or mesh.`,
          }
        : {
            title: `Wheel Ø ${L(wheel.diameterCm)} — too small`,
            detail: `${capitalize(sp.namePlural)} need a wheel of at least ${L(wheel.minCm)}. In a smaller wheel the back arches while running.`,
          };
    case 'wheel-fit':
      return check.status === 'pass'
        ? {
            title: 'Wheel fits',
            detail: `Needs ${L(wheel.topCm)} of height (bedding, stand and wheel); the enclosure is ${L(wheel.heightCm)} tall.`,
          }
        : {
            title: "Wheel doesn't fit",
            detail: `Needs ${L(wheel.topCm)} of height (${L(depth.standardCm)} bedding + stand + ${L(wheel.diameterCm)} wheel) but the enclosure is ${L(wheel.heightCm)} tall. Choose a taller enclosure or keep the bedding lower under the wheel.`,
          };
    case 'bars':
      return {
        title: 'Wire cage checks',
        detail: `Bar gaps no wider than ${L(sp.bars.maxGapCm)} for ${sp.namePlural}. Bedding can only be as deep as the plastic base (${L(state.enclosure.baseHeightCm)}). German veterinary guidance (TVT) considers wire cages unsuitable; the RSPCA prefers barred sides for ventilation.`,
      };
    case 'sand':
      return {
        title: 'Add a sand bath',
        detail: `At least ${fmtDims(sp.sandBath.minLengthCm, sp.sandBath.minWidthCm, units)} of very fine, round-grained sand, such as chinchilla sand. Not chinchilla dust, and not quartz, bird or building sand.`,
      };
    default:
      return { title: check.id, detail: '' };
  }
}

const CHIP_ICONS = {
  area: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="1.5"/></svg>',
  bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  packs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8l8-4 8 4v8l-8 4-8-4V8Z"/><path d="M4 8l8 4 8-4M12 12v8"/></svg>',
};

/** Three compact numbers over the 3D view: floor space, bedding to buy, packs. */
export function renderMetricChips(r, units) {
  const { floor, volume } = r;
  const chip = (icon, text, label, status = '') =>
    `<span class="chip${status ? ` chip--${status}` : ''}" title="${label}" aria-label="${label}: ${esc(text)}">${CHIP_ICONS[icon]}${esc(text)}</span>`;
  return [
    chip('area', fmtArea(floor.areaCm2, units), 'Floor space', floor.status),
    chip('bag', fmtLiters(volume.buyL), `Bedding to buy (${fmtLiters(volume.settledL)} settled + ${fmtPercent(volume.allowance)})`),
    volume.packs ? chip('packs', `${fmtNumber(volume.packs, 0)} × ${fmtLiters(volume.packSizeL)}`, 'Packs to buy') : '',
  ].join('');
}

/** Collapsible checklist: one short line per check, details on tap. */
export function renderChecks(r, sp, units, state) {
  return r.checks
    .map((check) => {
      const { title, detail } = checkText(check, r, sp, units, state);
      return `<li class="check check--${check.status}"><details><summary><span class="check__icon" aria-hidden="true">${ICONS[check.status]}</span><span>${esc(title)}</span></summary><p>${esc(detail)}</p></details></li>`;
    })
    .join('');
}

const VERDICT_SHORT = { excellent: ['★', 'Excellent'], meets: ['✓', 'Meets minimums'] };

/** Inner HTML of the verdict pill; the level goes in its class (verdict-pill--<level>). */
export function renderVerdictPill(r) {
  const { level, failing } = r.verdict;
  const [icon, text] = VERDICT_SHORT[level] ?? ['!', `${failing.length} to fix`];
  return `<span class="verdict-pill__icon" aria-hidden="true">${icon}</span><span>${text}</span><svg class="verdict-pill__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
}

/** Strings for the 3D labels. */
export function sceneText(state, r, sp, units) {
  const L = (cm) => fmtLen(cm, units);
  return {
    length: L(state.enclosure.lengthCm),
    width: L(state.enclosure.widthCm),
    height: L(state.enclosure.heightCm),
    depth: L(r.depth.standardCm),
    deep: L(r.depth.deepCm ?? r.depth.standardCm),
    wheel: `Ø ${L(state.wheel.diameterCm)}${r.wheel.fits ? '' : ' · too tall'}`,
    nest: 'Nest',
    store: 'Food store',
    minFootprint: `Minimum ${fmtDims(sp.floor.minLengthCm, sp.floor.minWidthCm, units)}`,
  };
}

export function describeScene(state, r, sp, units) {
  const e = state.enclosure;
  const deep = r.depth.deepCm ? ` with a ${fmtLen(r.depth.deepCm, units)} deep burrowing area` : '';
  return `3D preview of a ${ENCLOSURE_NAMES[e.type]} ${fmtDims(e.lengthCm, e.widthCm, units)} and ${fmtLen(e.heightCm, units)} tall for a ${sp.name.toLowerCase()}: bedding ${fmtLen(r.depth.standardCm, units)} deep${deep}, a ${fmtLen(state.wheel.diameterCm, units)} wheel, a sand bath, a hide and a water bowl.`;
}

// ---------------------------------------------------------------------------
// Static knowledge content (both unit systems, generated from data/species.json)
// ---------------------------------------------------------------------------

/** Numbered citations, e.g. [1, 3, 4], each linking to its entry in the sources list. */
function citer(sources) {
  const numbers = new Map(Object.keys(sources).map((id, i) => [id, i + 1]));
  return (ids = []) =>
    ids.length
      ? `<sup class="cite">[${[...ids]
          .sort((a, b) => numbers.get(a) - numbers.get(b))
          .map((id) => `<a href="#src-${esc(id)}" title="${esc(sources[id]?.title ?? id)}">${numbers.get(id)}</a>`)
          .join(', ')}]</sup>`
      : '';
}

export function renderSpeciesTable(list, sources) {
  const cite = citer(sources);
  const rows = list
    .map((s) => {
      const name = `${esc(s.name)}<br><em class="muted">${esc(s.scientificName)}</em>${s.health ? `<br><span class="muted">${esc(s.health.note)}</span>${cite(s.health.sources)}` : ''}`;
      const enclosure = `${fmtNumber(s.floor.minLengthCm, 0)} × ${fmtNumber(s.floor.minWidthCm, 0)} cm floor${cite(s.floor.sources)}<br><span class="muted">${fmtAreaBoth(s.floor.minAreaCm2)}</span><br>${fmtLenBoth(s.height.minCm)} tall${cite(s.height.sources)}`;
      const bedding = `${fmtLenBoth(s.bedding.minDepthCm)}<br><span class="muted">burrowing area ${fmtLenBoth(s.bedding.burrowDepthCm)}</span>${cite(s.bedding.sources)}`;
      const wheel = `${fmtLenBoth(s.wheel.minDiameterCm)}${s.wheel.recommendedDiameterCm > s.wheel.minDiameterCm ? `<br><span class="muted">${fmtNumber(s.wheel.recommendedDiameterCm, 0)} cm+ recommended</span>` : ''}${cite(s.wheel.sources)}`;
      const bars = `≤ ${fmtLenBoth(s.bars.maxGapCm)}${cite(s.bars.sources)}`;
      const adult = `${fmtRange(s.adult.weightG, 'g')}<br><span class="muted">${fmtRange(s.adult.lifespanYears, 'years', 1)}</span>${cite(s.adult.sources)}`;
      return `<tr><th scope="row">${name}</th><td>${enclosure}</td><td>${bedding}</td><td>${wheel}</td><td>${bars}</td><td>${adult}</td></tr>`;
    })
    .join('');
  return `<div class="table-wrap"><table class="species-table"><caption>Minimum requirements by hamster species</caption><thead><tr><th scope="col">Species</th><th scope="col">Enclosure</th><th scope="col">Bedding depth</th><th scope="col">Wheel diameter</th><th scope="col">Wire bar gap</th><th scope="col">Adult weight · lifespan</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderSources(sources) {
  return Object.entries(sources)
    .map(
      ([id, s], i) =>
        `<li id="src-${esc(id)}"><span class="source-id">[${i + 1}]</span> ${s.authors ? `${esc(s.authors)} ` : ''}${s.year ? `(${esc(s.year)}). ` : ''}<a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a>${s.publisher ? `. ${esc(s.publisher)}` : ''}.${s.note ? ` <span class="muted">${esc(s.note)}</span>` : ''}</li>`,
    )
    .join('');
}

/** "Syrian hamsters", "the smaller species", "all hamster species", or a list of names. */
function groupLabel(group, list) {
  if (group.length === list.length) return 'all hamster species';
  const others = list.filter((s) => s.id !== 'syrian');
  if (group.length === others.length && group.every((s) => s.id !== 'syrian')) return 'the smaller species';
  return `${joinNames(group.map((s) => s.groupName))} hamsters`;
}

/** Summarise a value across species, grouping species that share it. */
function summarise(list, valueFn, formatFn) {
  return joinNames(groupBy(list, valueFn).map((group) => `${formatFn(group[0])} for ${groupLabel(group, list)}`));
}

/** Answer-first facts used in the hero, the FAQ, llms.txt and the README (plain text). */
export function keyFacts(list, allowance) {
  const floor = summarise(
    list,
    (s) => s.floor.minAreaCm2,
    (s) => `${fmtNumber(s.floor.minLengthCm, 0)} × ${fmtNumber(s.floor.minWidthCm, 0)} cm (${fmtAreaPair(s.floor.minAreaCm2)})`,
  );
  const height = summarise(list, (s) => s.height.minCm, (s) => fmtLenBoth(s.height.minCm));
  const uniform = (fn) => new Set(list.map(fn)).size === 1;
  const first = list[0];
  const floorFact =
    uniform((s) => s.floor.minAreaCm2) && uniform((s) => s.height.minCm)
      ? `Minimum enclosure for every hamster species, dwarfs included: ${fmtNumber(first.floor.minLengthCm, 0)} × ${fmtNumber(first.floor.minWidthCm, 0)} cm (${fmtAreaPair(first.floor.minAreaCm2)}) of unbroken floor space and at least ${fmtLenBoth(first.height.minCm)} tall.`
      : `Minimum unbroken floor space: ${floor}; minimum height ${height}.`;
  return {
    floor: floorFact,
    depth: `Bedding depth: at least ${summarise(list, (s) => s.bedding.minDepthCm, (s) => fmtLenBoth(s.bedding.minDepthCm))}, plus a deeper burrowing area of ${summarise(list, (s) => s.bedding.burrowDepthCm, (s) => fmtLenBoth(s.bedding.burrowDepthCm))}.`,
    wheel: `Wheel diameter: at least ${summarise(list, (s) => s.wheel.minDiameterCm, (s) => fmtLenBoth(s.wheel.minDiameterCm))}, with a solid running surface.`,
    volume: `Bedding volume in liters = length × width × average depth in cm ÷ 1,000. A 100 × 50 cm enclosure filled 25 cm deep holds 125 L of settled bedding; buy about ${fmtPercent(allowance)} more, because bedding compacts when it is pressed down to hold tunnels.`,
  };
}

export function renderKeyFacts(facts) {
  return Object.values(facts)
    .map((f) => `<li>${esc(f)}</li>`)
    .join('');
}

export function faqEntries(list, facts, allowance) {
  const syrian = list.find((s) => s.id === 'syrian') ?? list[0];
  const smaller = list.filter((s) => s.id !== syrian.id);
  const narrowestBars = list.reduce((a, b) => (b.bars.maxGapCm < a.bars.maxGapCm ? b : a));
  const sameFloor = list.every((s) => s.floor.minAreaCm2 === syrian.floor.minAreaCm2);
  const smallDepth = Math.min(...smaller.map((s) => s.bedding.minDepthCm));
  const smallWheel = Math.min(...smaller.map((s) => s.wheel.minDiameterCm));
  return [
    {
      q: 'How big should a hamster cage be?',
      a: `${facts.floor} Only unbroken floor counts: platforms, shelves and extra levels don't add to it. Bigger is better — German veterinary guidance (TVT) says Syrian hamsters do best with about 1 m², and a study found signs of better welfare in 10,000 cm² cages than in smaller ones (Fischer, Gebhardt-Henrich & Steiger, 2007).`,
    },
    {
      q: 'Is a 40-gallon tank big enough for a hamster?',
      a: `Not by current welfare guidance. A 40-gallon breeder tank is about 91 × 46 cm (36 × 18 in): 4,180 cm² (648 sq in), below the ${fmtNumber(syrian.floor.minLengthCm, 0)} × ${fmtNumber(syrian.floor.minWidthCm, 0)} cm (${fmtAreaPair(syrian.floor.minAreaCm2)}) minimum, and about 41 cm (16 in) tall, under the ${fmtLenBoth(syrian.height.minCm)} minimum height. A 75-gallon tank (about 122 × 46 cm, 48 × 18 in) has enough floor area but is narrower than 50 cm.`,
    },
    {
      q: 'How deep should hamster bedding be?',
      a: `${facts.depth} In a controlled study, 45 Syrian hamsters were kept on 10, 40 or 80 cm of bedding. Every hamster on 40 or 80 cm dug burrows; those on 10 cm gnawed the cage wire significantly more and ran more in their wheels, and at 80 cm wire-gnawing was never seen. The authors concluded that at least 40 cm of bedding seemed to enhance welfare (Hauzenberger, Gebhardt-Henrich & Steiger, 2006).`,
    },
    {
      q: 'How much bedding do I need for a hamster cage?',
      a: `Multiply length × width × average depth in centimeters and divide by 1,000 to get liters. Example: 100 × 50 cm at 25 cm deep = 125 L. Bedding compacts when it is pressed down to hold tunnels — keepers report needing 1.5–2× the calculated volume — so the planner adds ${fmtPercent(allowance)} by default. Then divide by the expanded volume printed on the pack.`,
    },
    {
      q: 'What size wheel does a hamster need?',
      a: `${facts.wheel} The hamster's back should stay straight while running; if it arches upward, the wheel is too small. Given the choice, Syrian hamsters preferred a 35 cm wheel to a 23 cm one (Reebs & St-Onge, 2005), and wheels with rod running surfaces caused paw wounds (Beaulieu & Reebs, 2009).`,
    },
    {
      q: 'Can I use a wire cage for a hamster?',
      a: `Opinions differ: German veterinary guidance (TVT) considers wire cages unsuitable, while the RSPCA prefers barred or mesh sides for ventilation. If you use one, it must meet the floor-space minimum, its plastic base must hold the full bedding depth (${fmtLenBoth(syrian.bedding.minDepthCm)} for Syrian hamsters), and the bar gaps must be no wider than ${fmtLenBoth(syrian.bars.maxGapCm)} for Syrian hamsters and ${fmtLenBoth(narrowestBars.bars.maxGapCm)} for ${narrowestBars.namePlural}. Most pet-store wire cages are too small and have shallow bases.`,
    },
    {
      q: 'Do dwarf hamsters need a smaller cage than Syrian hamsters?',
      a: sameFloor
        ? `No. Welfare guidance asks for the same ${fmtNumber(syrian.floor.minLengthCm, 0)} × ${fmtNumber(syrian.floor.minWidthCm, 0)} cm minimum floor for dwarf hamsters as for Syrian hamsters: they are small but very active and dig tunnels too. Their bedding can be a little shallower (at least ${fmtLenBoth(smallDepth)}) and their wheels smaller (at least ${fmtLenBoth(smallWheel)}).`
        : 'Dwarf hamsters are small but very active and dig tunnels too; see the table for species-specific minimums.',
    },
    {
      q: 'Which bedding should I avoid for hamsters?',
      a: 'Avoid cedar: softwood bedding induced liver enzymes in laboratory mice and rats (Vesell, 1967), and the Merck Veterinary Manual advises avoiding cedar and pine shavings. The evidence on pine is mixed — hamsters kept on pine for 50 days showed no paw or weight effects (Lanteigne & Reebs, 2006). Avoid cotton or "fluffy" nesting material, which TVT, the RSPCA, PDSA, Blue Cross and Woodgreen all advise against, and scented bedding, which can irritate the airways (PDSA).',
    },
    {
      q: 'What temperature do hamsters need?',
      a: `Keep the room at ${fmtTempRange(syrian.temperatureC, 'metric')} (${fmtTempRange(syrian.temperatureC, 'imperial')}); German veterinary guidance (TVT) warns that higher temperatures risk heatstroke. Happy Hamsters UK advises never letting the room drop below 15 °C (59 °F).`,
    },
    {
      q: 'Can I reuse these numbers or embed the planner?',
      a: 'Yes. The code is MIT-licensed and the data is CC BY 4.0 — reuse it freely with credit to "JOMIZOO Hamster Habitat Planner" and a link.',
    },
  ];
}

export function renderFaq(entries) {
  return entries
    .map((e) => `<details class="faq"><summary><h3>${esc(e.q)}</h3></summary><p>${esc(e.a)}</p></details>`)
    .join('');
}

// ---------------------------------------------------------------------------
// README blocks (Markdown), kept in sync with the data by `npm run readme` and the tests
// ---------------------------------------------------------------------------

export function readmeFactsBlock(speciesData, allowance) {
  const list = speciesData.species;
  const facts = keyFacts(list, allowance);
  const rows = list.map(
    (s) =>
      `| ${s.name} (*${s.scientificName}*) | ${fmtNumber(s.floor.minLengthCm, 0)} × ${fmtNumber(s.floor.minWidthCm, 0)} cm, ${fmtNumber(s.height.minCm, 0)} cm tall | ${fmtLenBoth(s.bedding.minDepthCm)} | ${fmtLenBoth(s.bedding.burrowDepthCm)} | ${fmtLenBoth(s.wheel.minDiameterCm)} | ${fmtLenBoth(s.bars.maxGapCm)} | ${fmtRange(s.adult.weightG, 'g')}, ${fmtRange(s.adult.lifespanYears, 'years', 1)} |`,
  );
  return [
    ...Object.values(facts).map((f) => `- ${f}`),
    '',
    '| Species | Enclosure (min) | Bedding depth (min) | Burrowing area | Wheel diameter (min) | Wire bar gap (max) | Adult weight, lifespan |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `Data version ${speciesData.version}. Every value links to its source in [\`data/species.json\`](data/species.json).`,
  ].join('\n');
}

export function readmeSourcesBlock(sources) {
  return Object.entries(sources)
    .map(
      ([id, s]) =>
        `- **[${id}]** ${s.authors ? `${s.authors} ` : ''}${s.year ? `(${s.year}). ` : ''}[${s.title}](${s.url})${s.publisher ? `. ${s.publisher}` : ''}.${s.note ? ` ${s.note}` : ''}`,
    )
    .join('\n');
}

/** Replace the content between <!-- name:start --> and <!-- name:end --> markers. */
export function replaceBlock(text, name, content) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i < 0 || j < i) throw new Error(`README is missing the ${name} markers`);
  return `${text.slice(0, i + start.length)}\n${content}\n${text.slice(j)}`;
}
