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
  for (const name of SOURCE_FILES) {
    const code = stripComments(readFileSync(join(HERE, name), 'utf8'));

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
  for (const name of SOURCE_FILES) {
    const code = stripComments(readFileSync(join(HERE, name), 'utf8'));

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

test('the server serves no JavaScript and allows none', () => {
  const code = readFileSync(join(HERE, 'server.js'), 'utf8');

  assert.match(code, /default-src 'none'/);
  assert.ok(!/script-src 'self'/.test(code), 'this application serves no script');
});
