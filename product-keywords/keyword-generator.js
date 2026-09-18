/**
 * Deterministic product-search keyword generation.
 *
 * ---------------------------------------------------------------------------
 * KEYWORD GUIDANCE
 *
 * There is no Keyword Guidance PDF in this repository. Nothing here pretends
 * to quote one. The rules below are the existing keyword rules this project
 * already worked to, kept as the documented fallback until real guidance is
 * supplied:
 *
 *   - Every term must be supported by the Product Name
 *     (`inventory.products.title`). Nothing is read from anywhere else.
 *   - The four categories have four different search purposes, so no category
 *     is a copy of the product name or of another category.
 *   - No brand, company, competitor name, model number, price, measurement or
 *     specification is ever introduced. The competitor category holds
 *     alternative WORDING for the same product type, never a seller.
 *   - Output is a pure function of the title: same name in, same keywords out.
 *   - When the name supports nothing meaningful, the value is null and the
 *     page shows a genuinely empty cell rather than placeholder text.
 *
 * ---------------------------------------------------------------------------
 * HOW A NAME BECOMES KEYWORDS
 *
 *   Product Name
 *      -> product TYPE      (PRODUCT_TYPES: generic product terminology)
 *      -> ATTRIBUTES        (ATTRIBUTE_GROUPS: words already in the name)
 *      -> Primary / Secondary / Long-Tail / Competitor
 *
 * PRODUCT_TYPES is a terminology map of product KINDS - the words a catalogue
 * of lighting and fittings uses for a thing - not a list of products, and not
 * keyed on any product id. Any product whose name contains the terminology is
 * matched, including products added to the database later. Nothing in this
 * file refers to a product id, a SKU, or a row.
 */

/** Words a long-tail phrase may not exceed, so it stays a search phrase. */
const MAX_PHRASE_WORDS = 8;

/** Attribute terms added to a secondary list. */
const MAX_SECONDARY_ATTRIBUTES = 2;

/** Attribute terms used to qualify a long-tail phrase. */
const MAX_LONG_TAIL_ATTRIBUTES = 3;

/**
 * Generic product terminology, most specific first.
 *
 * `primary`    - the concise term for the type.
 * `secondary`  - synonyms and closely related terms a shopper may search.
 * `competitor` - alternative wording other listings use for the same type.
 * `longTail`   - a longer phrase for the type itself, used only when the name
 *                supplies no attribute to qualify it. Built from the type's
 *                own terminology, so it adds no fact about the product. It is
 *                null where no honest expansion exists; the cell stays blank.
 */
const PRODUCT_TYPES = [
  {
    pattern: /\b(spring\s+clips?|shade\s+clips?|clip\s+retainers?)\b/i,
    primary: 'Lamp Shade Clip',
    secondary: ['Shade Spring Clip', 'Shade Retainer'],
    competitor: ['Lampshade Clip', 'Shade Ring'],
    longTail: 'Lamp Shade Spring Clip',
  },
  {
    pattern: /\b(lamp\s?holders?|bulb\s+holders?|bulb\s+sockets?|light\s+sockets?|lamp\s+sockets?|batten\s+holders?)\b/i,
    primary: 'Lamp Holder',
    secondary: ['Bulb Holder', 'Light Socket'],
    competitor: ['Bulb Socket', 'Lamp Socket'],
    longTail: 'Light Bulb Lamp Holder',
  },
  {
    pattern: /\b(lamp\s?shades?|light\s+shades?|shade\s+carriers?)\b/i,
    primary: 'Lamp Shade',
    secondary: ['Lampshade', 'Light Shade'],
    competitor: ['Ceiling Shade', 'Pendant Shade'],
    longTail: 'Light Shade Cover',
  },
  {
    pattern: /\bdimmer(s|\s+switch(es)?)?\b/i,
    primary: 'Dimmer Switch',
    secondary: ['Dimmer', 'Light Dimmer'],
    competitor: ['Dimming Switch', 'Dimmer Plate'],
    longTail: 'Wall Dimmer Switch',
  },
  {
    // A bare "switch" counts, because a name such as "Wall light switches
    // Black Round 1 Gang" describes a switch, not a wall light. The type sits
    // above the light types for the same reason. "Switching" is a different
    // word and is not matched.
    pattern: /\b(switch(es)?\s+plates?|(light|wall|rocker|toggle)\s+switch(es)?|switch(es)?)\b/i,
    primary: 'Light Switch',
    secondary: ['Wall Switch', 'Switch Plate'],
    competitor: ['Light Switch Cover', 'Wall Plate Switch'],
    longTail: 'Wall Light Switch',
  },
  {
    pattern: /\b(plug\s+sockets?|wall\s+sockets?|socket\s+outlets?|mains\s+sockets?)\b/i,
    primary: 'Plug Socket',
    secondary: ['Wall Socket', 'Mains Socket'],
    competitor: ['Socket Outlet', 'Power Socket'],
    longTail: 'Wall Plug Socket',
  },
  {
    pattern: /\b(threaded\s+rods?|rod\s+nipples?|allthread|hollow\s+tubes?|threaded\s+tubes?)\b/i,
    primary: 'Threaded Rod',
    secondary: ['Rod Nipple', 'Lamp Rod'],
    competitor: ['Hollow Tube', 'Threaded Tube'],
    longTail: 'Threaded Lamp Rod',
  },
  {
    // Deliberately no bare "connector": a rod whose name mentions the screw
    // connectors it fits is a rod, not a connector.
    pattern:
      /\b(wire\s+connectors?|cable\s+connectors?|connector\s+blocks?|terminal\s+blocks?|splicing\s+connectors?|wire\s+nuts?|electrical\s+connectors?)\b/i,
    primary: 'Wire Connector',
    secondary: ['Cable Connector', 'Terminal Connector'],
    competitor: ['Connector Block', 'Wire Terminal'],
    longTail: 'Electrical Wire Connector',
  },
  {
    pattern: /\b(led\s+drivers?|power\s+suppl(y|ies)|transformers?)\b/i,
    primary: 'LED Driver',
    secondary: ['LED Transformer', 'Power Supply'],
    competitor: ['Lighting Transformer', 'LED Power Supply'],
    longTail: 'LED Light Driver',
  },
  {
    pattern: /\bdoor\s+handles?\b/i,
    primary: 'Door Handle',
    secondary: ['Door Pull', 'Pull Handle'],
    competitor: ['Cabinet Handle', 'Cupboard Handle'],
    longTail: 'Door Pull Handle',
  },
  {
    pattern:
      /\b(drawer\s+pulls?|cupboard\s+knobs?|cabinet\s+knobs?|pull\s+knobs?|door\s+knobs?|furniture\s+handles?|cabinet\s+handles?|cupboard\s+handles?|drawer\s+handles?|pull\s+handles?|knobs?)\b/i,
    primary: 'Cabinet Knob',
    secondary: ['Drawer Pull', 'Cupboard Knob'],
    competitor: ['Furniture Handle', 'Drawer Handle'],
    longTail: 'Cupboard Drawer Knob',
  },
  {
    pattern:
      /\b(electric(al)?\s+cables?|lamp\s+cables?|lighting\s+cables?|textile\s+cables?|fabric\s+cables?|braided\s+cables?|flexible\s+cables?|cable\s+wire|lamp\s+flex|cables?)\b/i,
    primary: 'Lighting Cable',
    secondary: ['Lamp Cable', 'Flex Cable'],
    competitor: ['Lamp Wire', 'Flex Cord'],
    longTail: 'Lamp Flex Cable',
  },
  {
    pattern: /\b(wire\s+cages?|bulb\s+cages?|cage\s+shades?)\b/i,
    primary: 'Bulb Cage',
    secondary: ['Wire Cage', 'Cage Shade'],
    competitor: ['Lamp Cage', 'Cage Light Shade'],
    longTail: 'Wire Cage Lamp Shade',
  },
  {
    pattern: /\b(led\s+strip\s+lights?|strip\s+lights?|led\s+strips?|led\s+tapes?)\b/i,
    primary: 'LED Strip Light',
    secondary: ['LED Tape Light', 'Strip Light'],
    competitor: ['LED Light Strip', 'Tape Light'],
    longTail: 'Flexible LED Strip Light',
  },
  {
    pattern: /\b(panel\s+lights?|led\s+panels?|light\s+panels?)\b/i,
    primary: 'LED Panel Light',
    secondary: ['Ceiling Panel Light', 'Flat Panel Light'],
    competitor: ['LED Light Panel', 'Panel Ceiling Light'],
    longTail: 'Ceiling LED Panel Light',
  },
  {
    pattern: /\b(down\s?lights?|recessed\s+lights?|spot\s?lights?)\b/i,
    primary: 'Downlight',
    secondary: ['Recessed Light', 'Ceiling Spotlight'],
    competitor: ['Spot Light', 'Recessed Ceiling Light'],
    longTail: 'Recessed Ceiling Downlight',
  },
  {
    pattern: /\b(pendant\s+(lights?|lamps?|fittings?|sets?)|hanging\s+lights?|ceiling\s+pendants?|pendants?)\b/i,
    primary: 'Pendant Light',
    secondary: ['Hanging Light', 'Pendant Lamp'],
    competitor: ['Ceiling Pendant', 'Hanging Lamp'],
    longTail: 'Pendant Ceiling Light',
  },
  {
    pattern: /\bceiling\s+roses?\b/i,
    primary: 'Ceiling Rose',
    secondary: ['Pendant Ceiling Rose', 'Ceiling Plate'],
    competitor: ['Ceiling Cup', 'Pendant Rose'],
    longTail: 'Pendant Light Ceiling Rose',
  },
  {
    pattern: /\b(wall\s+(lights?|lamps?|sconces?)|sconces?)\b/i,
    primary: 'Wall Light',
    secondary: ['Wall Lamp', 'Wall Sconce'],
    competitor: ['Sconce Light', 'Wall Mounted Lamp'],
    longTail: 'Wall Mounted Light Fitting',
  },
  {
    pattern: /\b(ceiling\s+(lights?|lamps?)|flush\s+lights?)\b/i,
    primary: 'Ceiling Light',
    secondary: ['Ceiling Lamp', 'Light Fixture'],
    competitor: ['Light Fitting', 'Ceiling Fitting'],
    longTail: 'Ceiling Light Fitting',
  },
  {
    pattern: /\bchandeliers?\b/i,
    primary: 'Chandelier',
    secondary: ['Chandelier Lighting', 'Ceiling Chandelier'],
    competitor: ['Chandelier Light', 'Candelabra Light'],
    longTail: 'Ceiling Chandelier Light',
  },
  {
    pattern: /\btable\s+lamps?\b/i,
    primary: 'Table Lamp',
    secondary: ['Desk Lamp', 'Bedside Lamp'],
    competitor: ['Table Light', 'Side Lamp'],
    longTail: null,
  },
  {
    pattern: /\b(floor\s+lamps?|standard\s+lamps?)\b/i,
    primary: 'Floor Lamp',
    secondary: ['Standing Lamp', 'Floor Light'],
    competitor: ['Standard Lamp', 'Floor Standing Lamp'],
    longTail: null,
  },
  // The catalogue is mostly lighting and fittings, but not only. These are the
  // other families its product names actually use; the same rules apply.
  {
    pattern: /\bhair\s+combs?\b/i,
    primary: 'Hair Comb',
    secondary: ['Hair Slide', 'Hair Accessory'],
    competitor: ['Decorative Hair Comb', 'Hair Pin Comb'],
    longTail: 'Hair Comb Accessory',
  },
  {
    pattern: /\b(hair\s+(clips?|pins?|slides?|sliders?|barrettes?|grips?|bands?|accessor(y|ies)|pieces?)|headpieces?)\b/i,
    primary: 'Hair Clip',
    secondary: ['Hair Slide', 'Hair Accessory'],
    competitor: ['Hair Barrette', 'Hair Grip'],
    longTail: 'Hair Clip Accessory',
  },
  {
    pattern: /\bshorts\b/i,
    primary: 'Mens Shorts',
    secondary: ['Short Trousers', 'Casual Shorts'],
    competitor: ['Summer Shorts', 'Mens Short Trousers'],
    longTail: 'Mens Casual Shorts',
  },
  {
    pattern: /\b(flannel\s+bottoms?|lounge\s+(pants|bottoms|trousers)|pyjama\s+bottoms?|pajama\s+bottoms?)\b/i,
    primary: 'Lounge Pants',
    secondary: ['Pyjama Bottoms', 'Lounge Bottoms'],
    competitor: ['Pyjama Pants', 'Loungewear Trousers'],
    longTail: 'Mens Lounge Pants',
  },
  {
    // After the light types, so a name such as "Water Pipe Wall Lamp" stays a
    // wall light.
    pattern: /\b(pipe\s+fittings?|pipe\s+nipples?|galvani[sz]ed\s+pipes?|steel\s+pipes?|pipes?)\b/i,
    primary: 'Pipe Fitting',
    secondary: ['Pipe Nipple', 'Threaded Pipe'],
    competitor: ['Steel Pipe', 'Pipe Connector'],
    longTail: 'Threaded Pipe Fitting',
  },
  {
    // Last, so that a holder, socket or shade whose name mentions the bulb it
    // takes keeps its own type. Only a name with nothing more specific in it
    // reaches this entry.
    pattern: /\b((led|light|filament|edison)\s+(bulbs?|lamps?)|neon\s+lamps?|bulbs?)\b/i,
    primary: 'Light Bulb',
    secondary: ['LED Bulb', 'Lamp Bulb'],
    competitor: ['Bulb Lamp', 'Light Globe'],
    longTail: 'LED Light Bulb',
  },
];

/**
 * Attribute vocabulary, grouped by what the word describes.
 *
 * A term is used only when the product name already contains it, so an
 * attribute is never a claim this file invented. At most one term is taken
 * from each group, which keeps a phrase readable - a name listing "Vintage
 * Antique Retro Industrial" contributes one style word, not four.
 *
 * Group order is also phrase order: style, colour, material, configuration,
 * fitting, form.
 */
const ATTRIBUTE_GROUPS = [
  ['Vintage', 'Retro', 'Industrial', 'Antique', 'Modern', 'Traditional', 'Rustic', 'Steampunk'],
  ['Rose Gold', 'Black', 'White', 'Green', 'Grey', 'Gold', 'Silver', 'Blue', 'Red', 'Pink', 'Amber', 'Bronze'],
  [
    'Brass',
    'Copper',
    'Chrome',
    'Satin Nickel',
    'Nickel',
    'Ceramic',
    'Aluminium',
    'Stainless Steel',
    'Fabric',
    'Textile',
    'Glass',
    'Wooden',
    'Metal',
    'Plastic',
    'Rattan',
    'Bamboo',
  ],
  ['1 Gang', '2 Gang', '3 Gang', '2 Core', '3 Core', 'Twin', 'Single', 'Double'],
  ['E27', 'E14', 'E26', 'B22', 'GU10', 'G9', 'MR16', 'IP20', 'IP44', 'IP65'],
  [
    'Screwless',
    'Dimmable',
    'Adjustable',
    'Braided',
    'Twisted',
    'Flat Plate',
    'Easy Fit',
    'Hard Wired',
    'Plug In',
    'Round',
    'Square',
    'Cone',
    'Dome',
    'Flush',
  ],
];

/** The groups above, compiled once, as whole-word patterns. */
const ATTRIBUTE_PATTERNS = ATTRIBUTE_GROUPS.map((group) =>
  group.map((term) => ({
    term,
    pattern: new RegExp(`\\b${term.replace(/\s+/g, '\\s+')}\\b`, 'i'),
  })),
);

/** @returns {{primary: string|null, secondary: string|null, longTail: string|null, competitor: string|null}} */
function emptyCategories() {
  return { primary: null, secondary: null, longTail: null, competitor: null };
}

/** Case-insensitive uniqueness, first occurrence wins. */
function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * A short phrase taken from the front of the name.
 *
 * Used as the primary term when no product terminology is recognised: a
 * shortened name is still the product's own wording, which a whole marketing
 * sentence is not.
 *
 * @param {string} clean  An already-normalised title.
 * @returns {string}
 */
function conciseTitlePhrase(clean) {
  return clean
    .split('.')[0]
    .split('(')[0]
    .trim()
    .split(' ')
    .slice(0, MAX_PHRASE_WORDS)
    .join(' ')
    .trim();
}

/**
 * Make title text safe and predictable for keyword use without adding words.
 *
 * @param {unknown} title
 * @returns {string}
 */
export function normaliseProductTitle(title) {
  if (typeof title !== 'string') return '';
  return title
    .replace(/[|/]+/g, ' ')
    .replace(/[,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The attribute words the product name itself contains, at most one per group.
 *
 * @param {unknown} title
 * @returns {string[]}
 */
export function productAttributes(title) {
  const clean = normaliseProductTitle(title);
  if (!clean) return [];

  return ATTRIBUTE_PATTERNS.map((group) => group.find(({ pattern }) => pattern.test(clean)))
    .filter(Boolean)
    .map(({ term }) => term);
}

/**
 * The product type the name describes, or null when none is recognised.
 *
 * @param {unknown} title
 * @returns {object|null}
 */
export function matchProductType(title) {
  const clean = normaliseProductTitle(title);
  if (!clean) return null;

  return PRODUCT_TYPES.find((candidate) => candidate.pattern.test(clean)) ?? null;
}

/**
 * Generate the four search categories from a product name alone.
 *
 * A name with no recognised terminology still yields its own concise phrase
 * and any attribute words it contains; it yields no synonyms and no
 * alternative wording, because guessing those would need a product type this
 * file does not have. Those cells stay blank.
 *
 * @param {unknown} title
 * @returns {{primary: string|null, secondary: string|null, longTail: string|null, competitor: string|null}}
 */
export function generateKeywordsFromTitle(title) {
  const clean = normaliseProductTitle(title);
  if (!clean) return emptyCategories();

  const attributes = productAttributes(clean);
  const type = matchProductType(clean);

  if (!type) {
    const phrase = conciseTitlePhrase(clean);
    const supporting = unique(attributes).filter(
      (term) => !phrase.toLowerCase().includes(term.toLowerCase()),
    );

    return {
      primary: phrase || null,
      secondary: supporting.length > 0 ? supporting.join(', ') : null,
      longTail: null,
      competitor: null,
    };
  }

  // An attribute already inside the type term would only repeat it.
  const qualifiers = attributes.filter(
    (term) => !type.primary.toLowerCase().includes(term.toLowerCase()),
  );

  const longTailWords = qualifiers.slice(0, MAX_LONG_TAIL_ATTRIBUTES);
  const qualified = longTailWords.length > 0 ? `${longTailWords.join(' ')} ${type.primary}` : '';
  const longTail = qualified || type.longTail || null;

  const secondary = unique([...type.secondary, ...qualifiers.slice(0, MAX_SECONDARY_ATTRIBUTES)]).join(', ');

  return {
    primary: type.primary,
    secondary: secondary || null,
    longTail: longTail && longTail.toLowerCase() !== type.primary.toLowerCase() ? longTail : null,
    competitor: type.competitor.join(', ') || null,
  };
}

/**
 * Prefer a confirmed recorded category, then fill only its missing values from
 * the deterministic Product Name generator.
 *
 * A recorded value is never overwritten, and a recorded value that is blank or
 * whitespace is treated as missing rather than as data.
 *
 * @param {unknown} title
 * @param {Partial<{primary: string|null, secondary: string|null, longTail: string|null, competitor: string|null}>} [recorded]
 * @returns {{primary: string|null, secondary: string|null, longTail: string|null, competitor: string|null}}
 */
export function resolveKeywordCategories(title, recorded = {}) {
  const generated = generateKeywordsFromTitle(title);
  const value = (name) => {
    const candidate = recorded?.[name];
    return typeof candidate === 'string' && candidate.trim() !== '' ? candidate : generated[name];
  };

  return {
    primary: value('primary'),
    secondary: value('secondary'),
    longTail: value('longTail'),
    competitor: value('competitor'),
  };
}
