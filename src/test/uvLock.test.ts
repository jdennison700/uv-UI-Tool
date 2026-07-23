import * as assert from 'assert';

import { buildDependenciesPayload, parseDependencyNamesFromArrayBlock, parseUvLockDependencies } from '../extension';

const SAMPLE_LOCK = `version = 1
requires-python = ">=3.11"

[[package]]
name = "certifi"
version = "2024.8.30"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "requests"
version = "2.32.3"
source = { registry = "https://pypi.org/simple" }
dependencies = [
    { name = "certifi" },
    { name = "urllib3" },
]

[[package]]
name = "urllib3"
version = "2.2.3"
source = { registry = "https://pypi.org/simple" }
`;

suite('uv.lock parsing', () => {
  test('parses package names, versions, and dependencies', () => {
    const packages = parseUvLockDependencies(SAMPLE_LOCK);

    assert.strictEqual(packages.length, 3);
    assert.deepStrictEqual(packages.map(pkg => pkg.name), ['certifi', 'requests', 'urllib3']);

    const requests = packages.find(pkg => pkg.name === 'requests');
    assert.ok(requests);
    assert.strictEqual(requests.version, '2.32.3');
    assert.deepStrictEqual(requests.dependencies, ['certifi', 'urllib3']);
  });

  test('records packages without dependencies as empty arrays', () => {
    const packages = parseUvLockDependencies(SAMPLE_LOCK);
    const certifi = packages.find(pkg => pkg.name === 'certifi');

    assert.ok(certifi);
    assert.deepStrictEqual(certifi.dependencies, []);
  });

  test('handles a single-line dependency array', () => {
    const lock = `[[package]]
name = "flask"
version = "3.0.0"
dependencies = [{ name = "click" }, { name = "jinja2" }]
`;

    const packages = parseUvLockDependencies(lock);
    assert.strictEqual(packages.length, 1);
    assert.deepStrictEqual(packages[0].dependencies, ['click', 'jinja2']);
  });

  test('stops the dependency block at the closing bracket', () => {
    const lock = `[[package]]
name = "alpha"
dependencies = [
    { name = "beta" },
]

[[package]]
name = "beta"
`;

    const packages = parseUvLockDependencies(lock);
    const alpha = packages.find(pkg => pkg.name === 'alpha');
    const beta = packages.find(pkg => pkg.name === 'beta');

    assert.deepStrictEqual(alpha?.dependencies, ['beta']);
    assert.deepStrictEqual(beta?.dependencies, []);
  });

  test('de-duplicates and sorts dependency names', () => {
    const lock = `[[package]]
name = "alpha"
dependencies = [
    { name = "zeta" },
    { name = "beta" },
    { name = "zeta" },
]
`;

    const packages = parseUvLockDependencies(lock);
    assert.deepStrictEqual(packages[0].dependencies, ['beta', 'zeta']);
  });

  test('ignores lines that appear before the first package header', () => {
    const lock = `version = 1
name = "not-a-package"

[[package]]
name = "real"
`;

    const packages = parseUvLockDependencies(lock);
    assert.deepStrictEqual(packages.map(pkg => pkg.name), ['real']);
  });

  test('skips package blocks that never declare a name', () => {
    const lock = `[[package]]
version = "1.0.0"

[[package]]
name = "named"
`;

    const packages = parseUvLockDependencies(lock);
    assert.deepStrictEqual(packages.map(pkg => pkg.name), ['named']);
  });

  test('parses CRLF line endings', () => {
    const packages = parseUvLockDependencies(SAMPLE_LOCK.replace(/\n/g, '\r\n'));
    assert.deepStrictEqual(packages.map(pkg => pkg.name), ['certifi', 'requests', 'urllib3']);
  });

  test('returns no packages for empty content', () => {
    assert.deepStrictEqual(parseUvLockDependencies(''), []);
  });
});

suite('parseDependencyNamesFromArrayBlock', () => {
  test('extracts unique names from a block', () => {
    const names = parseDependencyNamesFromArrayBlock('dependencies = [{ name = "a" }, { name = "b" }, { name = "a" }]');
    assert.deepStrictEqual(names, ['a', 'b']);
  });

  test('returns an empty array when no names are present', () => {
    assert.deepStrictEqual(parseDependencyNamesFromArrayBlock('dependencies = []'), []);
  });
});

suite('buildDependenciesPayload', () => {
  test('sorts packages and aggregates counts', () => {
    const payload = buildDependenciesPayload([
      { name: 'requests', dependencies: ['certifi', 'urllib3'] },
      { name: 'certifi', dependencies: [] },
      { name: 'urllib3', dependencies: [] }
    ]);

    assert.deepStrictEqual(payload.packages.map(pkg => pkg.name), ['certifi', 'requests', 'urllib3']);
    assert.strictEqual(payload.packageCount, 3);
    assert.strictEqual(payload.edgeCount, 2);
    assert.strictEqual(payload.withoutDependenciesCount, 2);
  });

  test('does not mutate the input array order', () => {
    const input = [
      { name: 'b', dependencies: [] },
      { name: 'a', dependencies: [] }
    ];

    buildDependenciesPayload(input);
    assert.deepStrictEqual(input.map(pkg => pkg.name), ['b', 'a']);
  });

  test('handles an empty package list', () => {
    const payload = buildDependenciesPayload([]);

    assert.strictEqual(payload.packageCount, 0);
    assert.strictEqual(payload.edgeCount, 0);
    assert.strictEqual(payload.withoutDependenciesCount, 0);
    assert.deepStrictEqual(payload.packages, []);
  });
});
