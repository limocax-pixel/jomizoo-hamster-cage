// Regenerates the data-driven blocks of README.md from data/species.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { readmeFactsBlock, readmeSourcesBlock, replaceBlock } from '../src/render.js';
import { defaultState } from '../src/state.js';

const readmePath = new URL('../README.md', import.meta.url);
const species = JSON.parse(readFileSync(new URL('../data/species.json', import.meta.url), 'utf8'));

let readme = readFileSync(readmePath, 'utf8');
readme = replaceBlock(readme, 'facts', readmeFactsBlock(species, defaultState().bedding.allowance));
readme = replaceBlock(readme, 'sources', readmeSourcesBlock(species.sources));
writeFileSync(readmePath, readme);
console.log('README.md updated');
