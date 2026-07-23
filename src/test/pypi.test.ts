import * as assert from 'assert';

import {
  decodeHtmlEntities,
  normalizePyPiSummary,
  normalizePyPiVersion,
  parsePyPiSimpleIndexNames,
  searchPyPiPackageIndex
} from '../extension';

suite('decodeHtmlEntities', () => {
  test('decodes the named entities used by the PyPI index', () => {
    assert.strictEqual(decodeHtmlEntities('&lt;tag&gt;'), '<tag>');
    assert.strictEqual(decodeHtmlEntities('&quot;quoted&quot;'), '"quoted"');
    assert.strictEqual(decodeHtmlEntities('it&#x27;s'), 'it\'s');
    assert.strictEqual(decodeHtmlEntities('it&apos;s'), 'it\'s');
    assert.strictEqual(decodeHtmlEntities('a&amp;b'), 'a&b');
  });

  test('decodes decimal and hexadecimal numeric entities', () => {
    assert.strictEqual(decodeHtmlEntities('&#65;&#66;'), 'AB');
    assert.strictEqual(decodeHtmlEntities('&#x41;&#x62;'), 'Ab');
  });

  test('leaves plain text untouched', () => {
    assert.strictEqual(decodeHtmlEntities('requests'), 'requests');
  });
});

suite('parsePyPiSimpleIndexNames', () => {
  test('extracts lower-cased package names from anchors', () => {
    const html = `<!DOCTYPE html><html><body>
      <a href="/simple/Requests/">Requests</a>
      <a href="/simple/urllib3/">urllib3</a>
    </body></html>`;

    assert.deepStrictEqual(parsePyPiSimpleIndexNames(html), ['requests', 'urllib3']);
  });

  test('de-duplicates names that appear more than once', () => {
    const html = '<a href="/simple/flask/">flask</a><a href="/simple/Flask/">Flask</a>';
    assert.deepStrictEqual(parsePyPiSimpleIndexNames(html), ['flask']);
  });

  test('drops anchor text that is not a valid package name', () => {
    const html = `<a href="/">home page</a>
      <a href="/simple/-bad/">-bad</a>
      <a href="/simple/good.name_1/">good.name_1</a>`;

    assert.deepStrictEqual(parsePyPiSimpleIndexNames(html), ['good.name_1']);
  });

  test('trims and decodes anchor text', () => {
    const html = '<a href="/simple/zope.interface/">  zope.interface  </a>';
    assert.deepStrictEqual(parsePyPiSimpleIndexNames(html), ['zope.interface']);
  });

  test('returns an empty array when there are no anchors', () => {
    assert.deepStrictEqual(parsePyPiSimpleIndexNames('<html><body>nothing</body></html>'), []);
  });
});

suite('searchPyPiPackageIndex', () => {
  const names = [
    'requests',
    'requests-oauthlib',
    'python-requests',
    'aiohttp-requests',
    'myrequestslib',
    'req'
  ];

  test('ranks an exact match first, then prefix, then separator matches', () => {
    const results = searchPyPiPackageIndex(names, 'requests').map(result => result.name);

    assert.strictEqual(results[0], 'requests');
    assert.strictEqual(results[1], 'requests-oauthlib');
    assert.ok(results.indexOf('python-requests') < results.indexOf('myrequestslib'));
  });

  test('only returns names containing the query', () => {
    const results = searchPyPiPackageIndex(names, 'requests').map(result => result.name);
    assert.ok(!results.includes('req'));
  });

  test('breaks ties by closeness in length, then alphabetically', () => {
    const results = searchPyPiPackageIndex(['ab-x-aaa', 'ab-x-aa', 'ab-x-ab'], 'x').map(result => result.name);
    assert.deepStrictEqual(results, ['ab-x-aa', 'ab-x-ab', 'ab-x-aaa']);
  });

  test('caps the result list at 20 entries', () => {
    const many = Array.from({ length: 50 }, (_, index) => `pkg-${index}`);
    assert.strictEqual(searchPyPiPackageIndex(many, 'pkg').length, 20);
  });

  test('returns an empty list when nothing matches', () => {
    assert.deepStrictEqual(searchPyPiPackageIndex(names, 'zzzz'), []);
  });
});

suite('PyPI metadata normalizers', () => {
  test('normalizePyPiSummary collapses whitespace', () => {
    assert.strictEqual(normalizePyPiSummary('  HTTP   for\n humans  '), 'HTTP for humans');
  });

  test('normalizePyPiSummary returns undefined for blank or non-string values', () => {
    assert.strictEqual(normalizePyPiSummary('   '), undefined);
    assert.strictEqual(normalizePyPiSummary(undefined), undefined);
    assert.strictEqual(normalizePyPiSummary(42), undefined);
  });

  test('normalizePyPiVersion trims the version string', () => {
    assert.strictEqual(normalizePyPiVersion(' 2.32.3 '), '2.32.3');
  });

  test('normalizePyPiVersion returns undefined for blank or non-string values', () => {
    assert.strictEqual(normalizePyPiVersion(''), undefined);
    assert.strictEqual(normalizePyPiVersion(null), undefined);
  });
});
