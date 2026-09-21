/**
 * The constraint guard.
 *
 * Task 4 was built under explicit, non-negotiable limits: read `ledsone` and
 * nothing else, never write to it, and never reach into the second database
 * where the classified keyword and competitor tables live.
 *
 * Comments promising all that are worth very little on their own - the next
 * person to edit these files will not have read them. So the promises are
 * asserted here instead, against the code as it actually is. Add a write
 * statement or a reference to the other database and the test suite fails.
 *
 * Comments and JSDoc are stripped before scanning, because the prose in this
 * project legitimately discusses INSERT, UPDATE and DELETE at length while the
 * code contains none of them.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The application's own modules - the test files are not part of the app. */
const SOURCE_FILES = readdirSync(HERE)
  .filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'))
  .sort();

/**
 * The Vercel entry point, which sits OUTSIDE this directory.
 *
 * Every sweep below runs over the application's modules, and api/index.js is
 * one of them: it is a second way into the same code, so a write statement or
 * a reach into the second database would count there exactly as it would in
 * server.js. Being in another folder is not a reason to trust it less or scan
 * it less.
 */
const VERCEL_ENTRY = join(HERE, '..', 'api', 'index.js');

/** Every application module, wherever it lives, as {name, code}. */
const EVERY_MODULE = [
  ...SOURCE_FILES.map((name) => ({ name, path: join(HERE, name) })),
  { name: 'api/index.js', path: VERCEL_ENTRY },
];

/**
 * Remove block and line comments, and the contents of template/quoted strings
 * are left alone - it is the executable SQL we care about.
 *
 * @param {string} code
 * @returns {string}
 */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

/** Statements that would change the database. */
const WRITE_STATEMENTS = [
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+[a-z_${}.]+\s+SET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bDROP\s+(TABLE|SCHEMA|DATABASE|INDEX|VIEW)\b/i,
  /\bCREATE\s+(TABLE|SCHEMA|DATABASE|INDEX|VIEW)\b/i,
  /\bALTER\s+(TABLE|SCHEMA|DATABASE)\b/i,
  /\bTRUNCATE\b/i,
  /\bGRANT\b/i,
  /\bCOPY\s+.*\bFROM\b/i,
];

test('the application ships at least the five modules it is supposed to have', () => {
  for (const expected of ['db.js', 'render.js', 'router.js', 'server.js', 'source.js']) {
    assert.ok(SOURCE_FILES.includes(expected), `${expected} is missing`);
  }
});

test('no module contains a statement that could write to the database', () => {
  for (const { name, path: file } of EVERY_MODULE) {
    const code = stripComments(readFileSync(file, 'utf8'));

    for (const pattern of WRITE_STATEMENTS) {
      assert.ok(!pattern.test(code), `${name} contains a write statement matching ${pattern}`);
    }
  }
});

test('the read-only latch is set as a connection option, not left to a statement', () => {
  const code = readFileSync(join(HERE, 'db.js'), 'utf8');
  assert.match(code, /options:\s*'-c default_transaction_read_only=on'/);
});

test('startup refuses to continue if the role can write to the source', () => {
  const code = readFileSync(join(HERE, 'db.js'), 'utf8');

  assert.match(code, /has_table_privilege/);
  assert.match(code, /Refusing to start/);
});

test('no module reaches into the second database', () => {
  // order_management_copy holds listing_generator, where the classified
  // keyword and competitor tables live. This version must not read it.
  for (const { name, path: file } of EVERY_MODULE) {
    const code = stripComments(readFileSync(file, 'utf8'));

    assert.ok(!/order_management_copy/i.test(code), `${name} references order_management_copy`);
    assert.ok(!/listing_generator/i.test(code), `${name} references listing_generator`);
    assert.ok(!/amazon_competitors/i.test(code), `${name} references amazon_competitors`);
  }
});

test('only the two permitted schemas are read', () => {
  const code = stripComments(readFileSync(join(HERE, 'source.js'), 'utf8'));

  // Every table reference is qualified with one of the two configured schema
  // constants, never a hard-coded schema of its own.
  const qualified = [...code.matchAll(/(?:FROM|JOIN)\s+([A-Za-z_${}.]+)/g)].map((match) => match[1]);
  const external = qualified.filter((reference) => reference.includes('.') && !reference.startsWith('${'));

  assert.deepEqual(external, [], `source.js reads an unqualified schema: ${external.join(', ')}`);
});

test('the paged query passes its limit and offset as parameters', () => {
  const code = readFileSync(join(HERE, 'source.js'), 'utf8');

  assert.match(code, /LIMIT \$1 OFFSET \$2/, 'paging must be parameterised, not interpolated');
  assert.match(code, /\[limit, offset\]/);
});

test('the application serves no JavaScript and allows none', () => {
  const code = readFileSync(join(HERE, 'http-headers.js'), 'utf8');

  assert.match(code, /default-src 'none'/);
  assert.ok(!/script-src 'self'/.test(code), 'this application serves no script');
});

test('both ways in send the same headers, from the one definition', () => {
  // There are two entry points now. A second copy of the policy would be a
  // copy that could drift - the deployed page quietly served without a CSP
  // while the local one kept it - so neither is allowed to define its own.
  for (const [name, file] of [
    ['server.js', join(HERE, 'server.js')],
    ['api/index.js', VERCEL_ENTRY],
  ]) {
    const code = readFileSync(file, 'utf8');

    assert.match(code, /import { SECURITY_HEADERS } from '[^']*http-headers.js'/, `${name} imports the headers`);
    assert.ok(!/const SECURITY_HEADERS = /.test(code), `${name} must not define its own`);
    assert.match(code, /\.\.\.SECURITY_HEADERS/, `${name} actually sends them`);
  }
});

test('images are allowed only from the named product-image hosts', () => {
  // Comments stripped: the prose above the header legitimately discusses what
  // img-src must not become.
  const code = stripComments(readFileSync(join(HERE, 'http-headers.js'), 'utf8'));

  // The Product Image column needs img-src, but it must stay an allowlist:
  // a wildcard would let any URL in a database row make the page fetch from
  // anywhere.
  assert.match(code, /img-src \$\{IMAGE_HOSTS\.join\(' '\)\}/);
  assert.match(code, /const IMAGE_HOSTS = Object\.freeze\(\[/);

  const hosts = /const IMAGE_HOSTS = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(code)?.[1] ?? '';
  assert.ok(hosts.trim() !== '', 'at least one image host is named');
  assert.ok(!hosts.includes('*'), 'img-src must not be a wildcard');
  assert.ok(!/\bdata:|\bblob:/.test(hosts), 'img-src must not allow data: or blob: URLs');
  for (const [, host] of hosts.matchAll(/'([^']+)'/g)) {
    assert.match(host, /^https?:\/\/[a-z0-9.-]+$/i, `${host} must be a plain host origin`);
  }

  assert.match(code, /'referrer-policy': 'no-referrer'/);
});

test('only the permitted schemas are read for product images', () => {
  const code = stripComments(readFileSync(join(HERE, 'source.js'), 'utf8'));

  // The image tables are in the inventory schema, reached through the schema
  // constant like every other table.
  assert.match(code, /\$\{INVENTORY_SCHEMA\}\.product_media/);
  assert.match(code, /\$\{INVENTORY_SCHEMA\}\.product_images/);

  // Not the listings, google_ads or suppliers image tables: they belong to
  // other applications and were not asked for.
  for (const elsewhere of [
    'amazon_listing_images',
    'ebay_listing_images',
    'shopify_listing_images',
    'merchant_products',
    'main_image_url',
  ]) {
    assert.ok(!code.includes(elsewhere), `source.js must not read ${elsewhere}`);
  }
});

test('the page template introduces no script and no external request', () => {
  // page.html is editable by hand, which is the point of it. These are the two
  // things an edit must not smuggle in: the page runs no JavaScript, and it
  // fetches nothing from outside - the server's own Content-Security-Policy
  // would block both, so an edit doing it would fail silently in a browser.
  const template = readFileSync(join(HERE, 'page.html'), 'utf8');

  assert.ok(!/<script/i.test(template), 'page.html must not contain a script tag');
  assert.ok(!/\son[a-z]+\s*=/i.test(template), 'page.html must not contain an inline event handler');
  assert.ok(!/https?:\/\//i.test(template), 'page.html must not load anything from off-site');
});
