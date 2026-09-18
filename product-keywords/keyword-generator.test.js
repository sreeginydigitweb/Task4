/**
 * Tests for deterministic Product Name keyword generation.
 *
 * The checks that matter most are not that a term appears, but that nothing
 * appears which the product name does not support: no brand, no competitor
 * company, no specification, and no product id anywhere in the logic.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generateKeywordsFromTitle,
  matchProductType,
  normaliseProductTitle,
  productAttributes,
  resolveKeywordCategories,
} from './keyword-generator.js';

const all = (keywords) => Object.values(keywords).filter(Boolean).join(' | ');

test('Pendant Light produces meaningful, search-oriented values in every category', () => {
  const keywords = generateKeywordsFromTitle('Pendant Light');

  assert.equal(keywords.primary, 'Pendant Light');
  assert.match(keywords.secondary, /Hanging Light/);
  assert.match(keywords.longTail, /Pendant Ceiling Light/);
  assert.match(keywords.competitor, /Ceiling Pendant/);

  // A long-tail value is a phrase, not a single word.
  assert.ok(keywords.longTail.split(' ').length >= 2);
});

test('the four categories are four different values, not one repeated', () => {
  for (const title of [
    'Pendant Light',
    'Screwless Flat plate Wall light switches Black Round 1 Gang',
    'Vintage 3 core Electric round cable covered with colored fabric',
    'Kitchen Drawer Pull Knob Retro Cupboard Furniture Handle',
  ]) {
    const values = Object.values(generateKeywordsFromTitle(title)).filter(Boolean);

    assert.equal(new Set(values).size, values.length, `categories repeat for: ${title}`);
    assert.ok(values.length >= 4, `not every category was generated for: ${title}`);
  }
});

test('a missing Secondary Keywords value is generated from the Product Name', () => {
  const keywords = generateKeywordsFromTitle('Black Round 2 Gang Screwless Flat plate Wall light switches');

  assert.match(keywords.secondary, /Wall Switch/);
  // Attributes come from the name itself, never from elsewhere.
  assert.match(keywords.secondary, /Black|2 Gang/);
});

test('a missing Long-Tail Keywords value is generated from the Product Name', () => {
  const keywords = generateKeywordsFromTitle('Vintage 3 core Electric round cable covered with colored fabric');

  assert.equal(keywords.primary, 'Lighting Cable');
  assert.match(keywords.longTail, /Lighting Cable$/);
  assert.ok(keywords.longTail.split(' ').length > keywords.primary.split(' ').length);
});

test('a missing Competitor Keywords value is generated from the Product Name', () => {
  const keywords = generateKeywordsFromTitle('Lever Wire Connectors Compact Splicing Wire Connector 3 Port');

  assert.equal(keywords.competitor, 'Connector Block, Wire Terminal');
});

test('generation uses the Product Name: a different name gives different keywords', () => {
  const cable = generateKeywordsFromTitle('Vintage 3 core Electric fabric cable');
  const handle = generateKeywordsFromTitle('Brass Door Handle');

  assert.notEqual(cable.primary, handle.primary);
  assert.notEqual(cable.secondary, handle.secondary);
  assert.notEqual(cable.competitor, handle.competitor);
});

test('generation is deterministic', () => {
  for (const title of ['Pendant Light', 'Vintage Metal E27 Lamp Holder', 'Kitchen Drawer Pull Knob']) {
    assert.deepEqual(generateKeywordsFromTitle(title), generateKeywordsFromTitle(title), title);
  }
});

test('generated keywords are relevant to the Product Name', () => {
  const relevant = [
    ['Screwless Flat plate Wall light switches Black Round 1 Gang', /switch/i],
    ['Vintage Antique Retro Metal Bulb Socket Lamp Holder E27', /holder|socket/i],
    ['Modern Metal Green Brass Easy Fit Cone Shape Lampshade', /shade/i],
    ['M10 threaded aluminium rod nipple hollow tube', /rod|tube/i],
  ];

  for (const [title, expected] of relevant) {
    assert.match(all(generateKeywordsFromTitle(title)), expected, title);
  }
});

test('competitor keywords are alternative wording, never an invented competitor brand', () => {
  const brandish = /amazon|ebay|screwfix|wickes|b&q|ikea|philips|osram|dunelm|argos|homebase|toolstation|brand/i;

  for (const title of [
    'Pendant Light',
    'Black Round 2 Gang Screwless Wall light switches',
    'Vintage 3 core fabric cable',
    'Brass Pull and Push Door Handle',
    'LED Strip light IP65 Waterproof Flexible',
  ]) {
    const { competitor } = generateKeywordsFromTitle(title);

    assert.ok(competitor, `no competitor terms for: ${title}`);
    assert.doesNotMatch(competitor, brandish, title);
    // Alternative wording is lower-case product terminology, so nothing here
    // should look like a company: no ™, ®, .com or Ltd.
    assert.doesNotMatch(competitor, /[®™]|\.com|\bltd\b|\binc\b/i, title);
  }
});

test('generated terms do not introduce unsupported specifications', () => {
  // None of these words is in the name, so none may appear in the output.
  assert.doesNotMatch(all(generateKeywordsFromTitle('Pendant Light')), /adjustable|dimmable|metal|E27|60W|IP44/i);
});

test('attributes are only ever words the product name already contains', () => {
  const title = 'Vintage Antique Retro Metal Bulb Socket Lamp Holder Industrial Edison E27 IP20';
  const clean = normaliseProductTitle(title).toLowerCase();

  for (const attribute of productAttributes(title)) {
    assert.ok(clean.includes(attribute.toLowerCase()), `${attribute} is not in the name`);
  }
});

test('at most one attribute is taken from each group, so a phrase stays readable', () => {
  // The name lists four style words; only one may reach the keywords.
  const keywords = generateKeywordsFromTitle(
    'Vintage Antique Retro Industrial Metal Bulb Socket Lamp Holder E27',
  );

  assert.equal(keywords.longTail, 'Vintage Metal E27 Lamp Holder');
});

test('a name with no recognised terminology keeps its own phrase and guesses nothing', () => {
  assert.deepEqual(generateKeywordsFromTitle('Vintage Garden Ornament'), {
    primary: 'Vintage Garden Ornament',
    secondary: null,
    longTail: null,
    competitor: null,
  });
});

test('a meaningless name leaves the generated categories blank rather than filled', () => {
  const keywords = generateKeywordsFromTitle('Combo Default Title.');

  assert.equal(keywords.secondary, null);
  assert.equal(keywords.longTail, null);
  assert.equal(keywords.competitor, null);
});

test('a long marketing name is shortened rather than copied whole into a keyword', () => {
  const title =
    'M10 1mm Fine pitch threaded aluminium rod nipple hollow tube in various length Screw connectors easy installation lamps, chandeliers, candelabras';
  const keywords = generateKeywordsFromTitle(title);

  assert.equal(keywords.primary, 'Threaded Rod');
  for (const value of Object.values(keywords)) {
    assert.ok(value.length < title.length / 2, `a category repeats the whole name: ${value}`);
  }
});

test('a passing mention does not decide the type: a rod is not a connector', () => {
  assert.equal(matchProductType('threaded aluminium rod nipple with Screw connectors')?.primary, 'Threaded Rod');
});

test('a switch named as a wall light is still a switch', () => {
  assert.equal(matchProductType('1 Gang Screwless Flat plate Wall light Black Square switches')?.primary, 'Light Switch');
  assert.equal(matchProductType('Twin Steampunk Water Pipe Wall Lamp')?.primary, 'Wall Light');
});

test('missing titles are safe and blank', () => {
  for (const title of [undefined, null, '', '   ', 42]) {
    assert.deepEqual(generateKeywordsFromTitle(title), {
      primary: null,
      secondary: null,
      longTail: null,
      competitor: null,
    });
  }
});

test('title normalisation removes separators without adding words', () => {
  assert.equal(normaliseProductTitle('  Pendant / Light,  '), 'Pendant Light');
});

test('nothing in the generator is keyed on a product id or SKU', () => {
  // The same name gives the same keywords whatever row it belongs to: the
  // generator is never told an id, so it cannot special-case one.
  const first = generateKeywordsFromTitle('Screwless Flat plate Wall light switches Black Round 1 Gang');

  assert.equal(generateKeywordsFromTitle.length, 1, 'the generator takes a title and nothing else');
  assert.deepEqual(
    generateKeywordsFromTitle('Screwless Flat plate Wall light switches Black Round 1 Gang'),
    first,
  );
});

test('an existing recorded value is preserved rather than overwritten', () => {
  const keywords = resolveKeywordCategories('Pendant Light', {
    secondary: 'Recorded Secondary',
    longTail: 'Recorded Long Tail Phrase',
    competitor: 'Recorded Alternative Wording',
  });

  assert.equal(keywords.secondary, 'Recorded Secondary');
  assert.equal(keywords.longTail, 'Recorded Long Tail Phrase');
  assert.equal(keywords.competitor, 'Recorded Alternative Wording');
  // Only the category with no recorded value is generated.
  assert.equal(keywords.primary, 'Pendant Light');
});
