/**
 * WHICH REAL RESOURCE SUPPLIED A KEYWORD.
 *
 * ===========================================================================
 * THE QUESTION THIS FILE ANSWERS
 * ===========================================================================
 *
 * Every keyword shown on the page wears a tag naming the REAL DATA RESOURCE
 * the word came from - a marketplace, a storefront, a search-console account.
 * Not how the application produced the wording. "GEN", "Generated",
 * "Terminology", "Product Name" and "Product Type" are methods, and a method
 * is not a resource: it tells the reader nothing about where to go and check.
 *
 * So the tag has to be earned from data, and this file is where it is earned.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS PROOF
 * ---------------------------------------------------------------------------
 *
 * A resource supplied a keyword when THAT KEYWORD'S WORDS ACTUALLY APPEAR IN A
 * REAL RECORD THAT RESOURCE HOLDS AGAINST THIS PRODUCT. Nothing weaker counts.
 *
 * In particular, a product merely BEING listed on Amazon does not prove Amazon
 * supplied the word "Door Handle". That is an assumption about a platform, not
 * evidence about a word, and tagging on that basis would invent a provenance
 * the data cannot support. The product must be listed there AND the resource's
 * own record must contain the phrase.
 *
 * Each piece of evidence therefore carries the exact table and column it was
 * read from, and that text becomes the pill's tooltip - so any tag on the page
 * can be checked against the database row that justifies it.
 *
 * ---------------------------------------------------------------------------
 * WHEN NOTHING CAN BE PROVEN
 * ---------------------------------------------------------------------------
 *
 * The keyword is displayed unchanged and wears NO tag. A blank tag is the
 * honest answer, and it is deliberately preferred to a method name. Keywords in
 * this position are counted and reported rather than quietly filled in.
 *
 * This module is pure: it takes evidence that resources.js has already read
 * from the database and decides what each keyword earned. It issues no SQL and
 * it changes no keyword value.
 */

/**
 * THE REAL RESOURCES.
 *
 * The slug drives the pill's COLOUR (one class per resource in page.html), so
 * it comes from this bounded list. The pill's TEXT is carried separately on
 * each piece of evidence, because one of these resources is not a single
 * website: ledsone runs several Shopify storefronts, and a keyword proven from
 * the Electricalsone storefront should say "Electricalsone", which is the real
 * business name, rather than the generic platform it happens to run on.
 */
export const SOURCE = Object.freeze({
  AMAZON: 'amazon',
  EBAY: 'ebay',
  SHOPIFY: 'shopify',
  BANDQ: 'bandq',
  SEARCH_CONSOLE: 'google-search-console',
});

/**
 * The name each resource goes by when the evidence carries no better one.
 *
 * Every one of these is a real place a reader can go and check, and not one of
 * them names a method. The Shopify entry is the only one that is usually
 * overridden: evidence from a storefront carries that storefront's own name -
 * "Electricalsone", "Vintagelite", "LEDSone" - because that is the business
 * the keyword actually came from, and "Shopify" is only the software it runs
 * on. The slug stays `shopify` either way, so all of them share one pill
 * colour.
 */
export const SOURCE_LABEL = Object.freeze({
  [SOURCE.AMAZON]: 'Amazon',
  [SOURCE.EBAY]: 'eBay',
  [SOURCE.SHOPIFY]: 'Shopify',
  [SOURCE.BANDQ]: 'B&Q',
  [SOURCE.SEARCH_CONSOLE]: 'Google Search Console',
});

/**
 * THE KINDS OF RECORD that can prove a keyword, strongest first.
 *
 * When one keyword is proven by several resources at once - and that is
 * common, since a good keyword tends to appear in more than one place - the
 * strongest record wins, so the tag names the most direct evidence rather than
 * whichever row the planner returned first.
 *
 * The ordering is by how directly the record is ABOUT keywords:
 *
 *   1 search-keywords  the seller's own backend search terms for the listing.
 *                      A record whose entire purpose is to hold keywords.
 *   2 search-query     a real query a shopper typed, recorded against this
 *                      product's page or ASIN. Evidence of actual demand.
 *   3 tag              a keyword-like label the business filed the product
 *                      under.
 *   4 listing-title    the resource's live listing title. A real, public,
 *                      checkable piece of that platform's content, but written
 *                      as prose rather than as keywords - so it ranks last.
 *
 * A lower number wins.
 */
export const EVIDENCE_RANK = Object.freeze({
  'search-keywords': 1,
  'search-query': 2,
  tag: 3,
  'listing-title': 4,
});

/**
 * Words that carry no meaning of their own in a keyword phrase.
 *
 * A single stop word matching inside some unrelated sentence would prove
 * nothing, so a keyword made only of these can never earn a tag. In practice
 * generated keywords are product terms, so this almost never fires; it is here
 * so that a one-word keyword like "and" cannot pick up a resource by accident.
 */
const STOP_WORDS = new Set(['and', 'or', 'the', 'a', 'an', 'of', 'for', 'with', 'in', 'on', 'to']);

/**
 * Reduce text to comparable words.
 *
 * Case, punctuation and runs of whitespace all differ between a product title,
 * an Amazon keyword blob and a Google query, and none of those differences
 * changes which words are present. Everything that is not a letter or a digit
 * becomes a separator, so "knobs for cupboards & draws" and "Knobs For
 * Cupboards and Draws" reduce to the same word list - except "and", which is
 * a word either way and is handled by the caller, not here.
 *
 * @param {unknown} text
 * @returns {string[]}
 */
export function words(text) {
  if (typeof text !== 'string') return [];

  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '');
}

/**
 * Fold a plural down to its singular.
 *
 * "Door Handle" and "door handles" are the same keyword as far as provenance
 * goes: a listing that says "Door Handles" is evidence for the keyword "Door
 * Handle". Only a trailing "s" is removed, and only where doing so is safe:
 *
 *   - short words are left alone, so "gas" does not become "ga"
 *   - "ss" is left alone, so "brass" does not become "bras"
 *   - "us" and "is" are left alone, so "bus" and "axis" survive
 *
 * This is deliberately conservative. A missed plural costs one blank tag; a
 * wrong fold would credit a resource with a word it does not hold.
 *
 * @param {string} word
 * @returns {string}
 */
export function singular(word) {
  if (word.length <= 3) return word;
  if (!word.endsWith('s')) return word;
  if (word.endsWith('ss') || word.endsWith('us') || word.endsWith('is')) return word;

  return word.slice(0, -1);
}

/** The comparable form of a piece of text: its words, each folded to singular. */
function comparable(text) {
  return words(text).map(singular);
}

/**
 * Does this keyword's phrase actually appear in this text?
 *
 * The keyword's words must appear CONSECUTIVELY and in order. That is the
 * whole point: "Cupboard Handle" is proven by "vintage cupboard handles" but
 * NOT by "Kitchen Cupboard Wardrobe Door Handles", where the two words are
 * both present but describe different things. Scattered word matching would
 * hand out tags for phrases a resource never said.
 *
 * Matching is on whole words, so "Brass" is not proven by "brasserie".
 *
 * @param {string} term    The keyword as displayed.
 * @param {string} text    A real record's text.
 * @returns {boolean}
 */
export function phraseAppears(term, text) {
  const needle = comparable(term);
  const haystack = comparable(text);

  if (needle.length === 0 || haystack.length < needle.length) return false;
  // A keyword made only of stop words would match almost any sentence.
  if (needle.every((word) => STOP_WORDS.has(word))) return false;

  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let all = true;

    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        all = false;
        break;
      }
    }

    if (all) return true;
  }

  return false;
}

/** The longest quoted record a tooltip carries before it is cut short. */
const MAX_QUOTE = 140;

/**
 * The record's own words, short enough to sit in a tooltip.
 *
 * An Amazon backend keyword field can be a paragraph of stuffed terms, and the
 * tooltip only needs to show enough to recognise the record.
 */
function quote(text) {
  const tidy = text.replace(/\s+/g, ' ').trim();
  return tidy.length <= MAX_QUOTE ? tidy : `${tidy.slice(0, MAX_QUOTE - 1)}…`;
}

/**
 * The resource that proves this keyword, or null when none does.
 *
 * Evidence is every real record the page's resources hold against this one
 * product - read by resources.js, never invented here. The first record that
 * actually contains the phrase wins, strongest kind first; where two records
 * are equally strong the order resources.js supplied them is kept, so the
 * answer is stable between page loads.
 *
 * Returning null is a normal, expected outcome and means the keyword is shown
 * with no tag.
 *
 * @param {string} term
 * @param {Array<{source: string, label: string, kind: string, detail: string, text: string}>} evidence
 * @returns {{source: string, label: string, detail: string}|null}
 */
export function resourceForTerm(term, evidence) {
  if (typeof term !== 'string' || term.trim() === '') return null;
  if (!Array.isArray(evidence) || evidence.length === 0) return null;

  let best = null;
  let bestRank = Infinity;

  for (const record of evidence) {
    if (!record || typeof record.text !== 'string') continue;

    const rank = EVIDENCE_RANK[record.kind] ?? Infinity;
    // Already holding something at least as strong, so this cannot win and
    // does not need the more expensive phrase check.
    if (rank >= bestRank) continue;
    if (!phraseAppears(term, record.text)) continue;

    // The tooltip quotes the RECORD THAT ACTUALLY MATCHED, not just the table
    // it came from. A product can hold two hundred Google queries, and naming
    // the column alone would leave the reader hunting for which one proved the
    // word. With the quote, any tag on the page can be checked directly.
    best = {
      source: record.source,
      label: record.label,
      detail: `${record.detail}: "${quote(record.text)}"`,
    };
    bestRank = rank;

    // Nothing can beat the strongest kind, so stop looking.
    if (bestRank === 1) break;
  }

  return best;
}
