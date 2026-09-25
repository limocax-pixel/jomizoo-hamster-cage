import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { renderLlmsTxt, renderSitemap, renderStaticParts } from './src/prerender.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const DATA_FILES = ['species.json', 'enclosures.json'];

/** Prerender data-driven content into index.html; publish the open data, llms.txt and sitemap.xml. */
function habitatContent() {
  return {
    name: 'habitat-content',
    transformIndexHtml(html) {
      return renderStaticParts(html, {
        species: JSON.parse(read('./data/species.json')),
        enclosures: JSON.parse(read('./data/enclosures.json')),
      });
    },
    generateBundle() {
      for (const file of DATA_FILES) {
        this.emitFile({ type: 'asset', fileName: `data/${file}`, source: read(`./data/${file}`) });
      }
      const species = JSON.parse(read('./data/species.json'));
      this.emitFile({ type: 'asset', fileName: 'llms.txt', source: renderLlmsTxt({ species }) });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: renderSitemap() });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [habitatContent()],
  build: { target: 'es2022', chunkSizeWarningLimit: 700 },
});
