/**
 * Tests for what counts as proof that a resource supplied a keyword.
 *
 * All pure - no database. The cases that matter most here are the ones proving
 * the matcher is CONSERVATIVE: it must refuse a resource that cannot be
 * justified far more readily than it hands one out, because a wrong tag on the
 * page is a lie about where a word came from, while a missing one is only a
 * blank.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EVIDENCE_RANK, SOURCE, SOURCE_LABEL, phraseAppears, resourceForTerm, singular, words } from './provenance.js';

/** One piece of evidence, with only what the test cares about spelled out. */
const record = (text, overrides = {}) => ({
  source: SOURCE.AMAZON,
  label: 'Amazon',
  kind: 'listing-title',
  detail: 'listings.amazon_listings.title',
  text,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Reducing text to comparable words.
// ---------------------------------------------------------------------------

test('words ignores case, punctuation and spacing', () => {
  assert.deepEqual(words('Knobs for cupboards & draws'), ['knobs', 'for', 'cupboards', 'draws']);
  assert.deepEqual(words('128mm  Brass | Cabinet-Handles'), ['128mm', 'brass', 'cabinet', 'handles']);
});

test('words of a non-string is empty rather than an error', () => {
  for (const value of [null, undefined, 42, {}]) assert.deepEqual(words(value), []);
});

test('singular folds a plural, but only where it is safe to', () => {
  assert.equal(singular('handles'), 'handle');
  assert.equal(singular('knobs'), 'knob');

  // Folding these would credit a resource with a word it does not hold.
  assert.equal(singular('brass'), 'brass', 'ss is not a plural');
  assert.equal(singular('gas'), 'gas', 'too short to fold');
  assert.equal(singular('axis'), 'axis', 'is is not a plural');
  assert.equal(singular('bonus'), 'bonus', 'us is not a plural');
  assert.equal(singular('handle'), 'handle', 'already singular');
});

// ---------------------------------------------------------------------------
// The phrase has to actually be there.
// ---------------------------------------------------------------------------

test('a keyword is proven by a consecutive phrase, in any case or spacing', () => {
  assert.ok(phraseAppears('Door Handle', 'traditional kitchen door handles'));
  assert.ok(phraseAppears('Cupboard Handle', 'cupboard handles vintage'));
  assert.ok(phraseAppears('Brass', '128mm Brass Cabinet Handles'));
  assert.ok(phraseAppears('Pull Handle', 'Cupboard Door Drawer Pull Handles kitchen'));
});

test('SCATTERED words prove nothing - this is the whole point', () => {
  // Both words are present and the phrase is still not there: the listing is
  // about cupboard doors and wardrobe door handles, not cupboard handles.
  assert.ok(!phraseAppears('Cupboard Handle', 'Kitchen Cupboard Wardrobe Door Handles'));
  // "Door Drawer Pull" is not "Door Pull".
  assert.ok(!phraseAppears('Door Pull', 'Cupboard Door Drawer Pull Handles'));
  // Out of order is not the phrase either.
  assert.ok(!phraseAppears('Handle Door', 'door handle'));
});

test('a keyword is matched on whole words, never inside a longer one', () => {
  assert.ok(!phraseAppears('Brass', 'brasserie lighting'));
  assert.ok(!phraseAppears('Lamp', 'lamppost'));
});

test('a keyword longer than the record cannot be proven by it', () => {
  assert.ok(!phraseAppears('Vintage Brass Door Handle', 'brass handle'));
});

test('empty and meaningless keywords prove nothing', () => {
  assert.ok(!phraseAppears('', 'anything at all'));
  assert.ok(!phraseAppears('   ', 'anything at all'));
  // A keyword of nothing but stop words would match almost any sentence.
  assert.ok(!phraseAppears('and', 'cupboards and draws'));
  assert.ok(!phraseAppears('for the', 'knobs for the cupboards'));
});

// ---------------------------------------------------------------------------
// Choosing which resource earned the keyword.
// ---------------------------------------------------------------------------

test('a keyword no record contains earns no resource', () => {
  assert.equal(resourceForTerm('Pendant Light', [record('Brass Door Handle Antique')]), null);
});

test('no evidence at all earns no resource', () => {
  for (const nothing of [[], null, undefined, 'not an array']) {
    assert.equal(resourceForTerm('Door Handle', nothing), null);
  }
});

test('the STRONGEST kind of record wins, not the first one listed', () => {
  // A listing title is a real place, but a backend keyword record is a record
  // whose entire purpose is keywords, so it is the better answer.
  const evidence = [
    record('Brass Door Handles for cupboards', { kind: 'listing-title', label: 'Amazon' }),
    record('door handles brass vintage', {
      kind: 'search-keywords',
      label: 'Amazon',
      detail: 'listings.amazon_listing_search_engine_keywords.keyword',
    }),
  ];

  const proven = resourceForTerm('Door Handle', evidence);
  assert.equal(proven.source, SOURCE.AMAZON);
  assert.ok(proven.detail.startsWith('listings.amazon_listing_search_engine_keywords.keyword'));
});

test('a storefront is named as the business, not as the platform it runs on', () => {
  const proven = resourceForTerm('Ceiling Pendant', [
    record('Ceiling Pendant', {
      source: SOURCE.SHOPIFY,
      label: 'Vintagelite',
      kind: 'tag',
      detail: 'listings.shopify_listing_tag.tag',
    }),
  ]);

  assert.equal(proven.source, SOURCE.SHOPIFY, 'the slug picks the colour');
  assert.equal(proven.label, 'Vintagelite', 'the pill shows the real business name');
});

test('the tooltip quotes the record that actually matched', () => {
  // Without the quote, a product with two hundred Google queries would leave
  // the reader hunting for which one proved the word.
  const proven = resourceForTerm('Door Handle', [
    record('traditional kitchen door handles', {
      source: SOURCE.SEARCH_CONSOLE,
      label: 'Google Search Console',
      kind: 'search-query',
      detail: 'google_search_console.query_page.query',
    }),
  ]);

  assert.equal(proven.detail, 'google_search_console.query_page.query: "traditional kitchen door handles"');
});

test('a very long record is quoted only as far as it is useful', () => {
  const long = `pendant light ${'x'.repeat(400)}`;
  const proven = resourceForTerm('Pendant Light', [record(long)]);

  assert.ok(proven.detail.length < 220, 'the tooltip stays readable');
  assert.ok(proven.detail.includes('…'), 'and says it was cut short');
});

test('a record with no usable text is skipped rather than throwing', () => {
  for (const broken of [{ ...record('x'), text: null }, { ...record('x'), text: 42 }, null]) {
    assert.doesNotThrow(() => resourceForTerm('Door Handle', [broken]));
  }
});

// ---------------------------------------------------------------------------
// The vocabulary itself.
// ---------------------------------------------------------------------------

test('every resource is a real place, and none of them is a method', () => {
  // The requirement this file exists to serve: these six words must never be
  // used as a resource name.
  const methods = ['GEN', 'MIX', 'Generated', 'Terminology', 'Product Name', 'Product Type', 'Product Name + Type'];

  for (const label of Object.values(SOURCE_LABEL)) {
    assert.ok(!methods.includes(label), `"${label}" is a method, not a resource`);
    assert.ok(label.trim() !== '', 'every resource has a name');
  }

  assert.deepEqual(Object.values(SOURCE).sort(), Object.keys(SOURCE_LABEL).sort(), 'every resource is named');
});

test('every kind of evidence has a rank, so nothing sorts arbitrarily', () => {
  const ranks = Object.values(EVIDENCE_RANK);

  assert.equal(new Set(ranks).size, ranks.length, 'no two kinds tie');
  assert.ok(ranks.every((rank) => Number.isInteger(rank) && rank > 0));
  assert.equal(EVIDENCE_RANK['search-keywords'], 1, 'a keyword record is the strongest proof');
});
