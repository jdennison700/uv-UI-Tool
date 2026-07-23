import * as assert from 'assert';

import {
  buildUvAddArgs,
  buildUvAddCommandPreview,
  escapeShellArgForDisplay,
  isValidPackageName,
  normalizeDependencyTarget,
  normalizePackageAddRequest,
  normalizeVersionSpecifier,
  toPackageSpecifier
} from '../extension';

suite('isValidPackageName', () => {
  test('accepts names allowed by PyPI', () => {
    for (const name of ['requests', 'zope.interface', 'python-dateutil', 'typing_extensions', 'py2neo', '4ib']) {
      assert.strictEqual(isValidPackageName(name), true, `expected ${name} to be valid`);
    }
  });

  test('rejects empty, prefixed, and shell-unsafe names', () => {
    for (const name of ['', '-flag', '.hidden', '_leading', 'bad name', 'rm;ls', 'pkg$(id)', 'pkg&&ls']) {
      assert.strictEqual(isValidPackageName(name), false, `expected ${JSON.stringify(name)} to be invalid`);
    }
  });
});

suite('normalizeDependencyTarget', () => {
  test('maps "dev" to the dev target', () => {
    assert.strictEqual(normalizeDependencyTarget('dev'), 'dev');
  });

  test('falls back to the regular target for anything else', () => {
    assert.strictEqual(normalizeDependencyTarget('regular'), 'regular');
    assert.strictEqual(normalizeDependencyTarget('DEV'), 'regular');
    assert.strictEqual(normalizeDependencyTarget(undefined), 'regular');
    assert.strictEqual(normalizeDependencyTarget(1), 'regular');
  });
});

suite('normalizeVersionSpecifier', () => {
  test('keeps a specifier that already has an operator', () => {
    assert.strictEqual(normalizeVersionSpecifier('==2.32.3'), '==2.32.3');
    assert.strictEqual(normalizeVersionSpecifier('>=2.30'), '>=2.30');
    assert.strictEqual(normalizeVersionSpecifier('~=1.4'), '~=1.4');
    assert.strictEqual(normalizeVersionSpecifier('!=1.0'), '!=1.0');
    assert.strictEqual(normalizeVersionSpecifier('<3'), '<3');
  });

  test('prefixes a bare version with ==', () => {
    assert.strictEqual(normalizeVersionSpecifier('2.32.3'), '==2.32.3');
  });

  test('trims surrounding whitespace before deciding', () => {
    assert.strictEqual(normalizeVersionSpecifier('  >=2.30  '), '>=2.30');
    assert.strictEqual(normalizeVersionSpecifier('  2.30  '), '==2.30');
  });

  test('returns undefined for blank or non-string input', () => {
    assert.strictEqual(normalizeVersionSpecifier(''), undefined);
    assert.strictEqual(normalizeVersionSpecifier('   '), undefined);
    assert.strictEqual(normalizeVersionSpecifier(undefined), undefined);
    assert.strictEqual(normalizeVersionSpecifier({}), undefined);
  });
});

suite('toPackageSpecifier', () => {
  test('appends the specifier when present', () => {
    assert.strictEqual(toPackageSpecifier('requests', '==2.32.3'), 'requests==2.32.3');
  });

  test('returns the bare name when no specifier is given', () => {
    assert.strictEqual(toPackageSpecifier('requests'), 'requests');
  });
});

suite('normalizePackageAddRequest', () => {
  test('accepts a valid payload', () => {
    const { request, error } = normalizePackageAddRequest({
      packageNames: ['requests', 'flask'],
      dependencyTarget: 'dev',
      versionSpecifier: '2.0'
    });

    assert.strictEqual(error, undefined);
    assert.deepStrictEqual(request, {
      packageNames: ['requests', 'flask'],
      dependencyTarget: 'dev',
      versionSpecifier: '==2.0'
    });
  });

  test('trims, de-duplicates, and drops blank names', () => {
    const { request } = normalizePackageAddRequest({
      packageNames: [' requests ', 'requests', '', '   ', 'flask']
    });

    assert.deepStrictEqual(request?.packageNames, ['requests', 'flask']);
  });

  test('ignores non-string entries in the name list', () => {
    const { request } = normalizePackageAddRequest({ packageNames: [1, null, 'requests'] });
    assert.deepStrictEqual(request?.packageNames, ['requests']);
  });

  test('errors when no packages are selected', () => {
    for (const message of [{ packageNames: [] }, { packageNames: 'requests' }, {}, undefined, null]) {
      const { request, error } = normalizePackageAddRequest(message);
      assert.strictEqual(request, undefined);
      assert.strictEqual(error, 'Please select one or more packages before continuing.');
    }
  });

  test('errors on an invalid package name and names the offender', () => {
    const { request, error } = normalizePackageAddRequest({ packageNames: ['requests', 'bad name'] });

    assert.strictEqual(request, undefined);
    assert.strictEqual(error, 'Invalid package name: bad name');
  });

  test('rejects shell metacharacters in package names', () => {
    const { request, error } = normalizePackageAddRequest({ packageNames: ['requests; rm -rf /'] });

    assert.strictEqual(request, undefined);
    assert.ok(error?.startsWith('Invalid package name:'));
  });

  test('defaults the dependency target and omits an empty specifier', () => {
    const { request } = normalizePackageAddRequest({ packageNames: ['requests'], versionSpecifier: '  ' });

    assert.strictEqual(request?.dependencyTarget, 'regular');
    assert.strictEqual(request?.versionSpecifier, undefined);
  });
});

suite('buildUvAddArgs', () => {
  test('builds args for a regular dependency', () => {
    const args = buildUvAddArgs({ packageNames: ['requests'], dependencyTarget: 'regular' });
    assert.deepStrictEqual(args, ['add', 'requests']);
  });

  test('inserts --dev before the package names', () => {
    const args = buildUvAddArgs({ packageNames: ['pytest'], dependencyTarget: 'dev' });
    assert.deepStrictEqual(args, ['add', '--dev', 'pytest']);
  });

  test('applies the version specifier to every package', () => {
    const args = buildUvAddArgs({
      packageNames: ['requests', 'flask'],
      dependencyTarget: 'regular',
      versionSpecifier: '>=2.0'
    });

    assert.deepStrictEqual(args, ['add', 'requests>=2.0', 'flask>=2.0']);
  });
});

suite('buildUvAddCommandPreview', () => {
  test('renders a runnable preview string', () => {
    const preview = buildUvAddCommandPreview({ packageNames: ['requests'], dependencyTarget: 'dev' });
    assert.strictEqual(preview, 'uv add --dev requests');
  });

  test('quotes specifiers that contain shell-significant characters', () => {
    const preview = buildUvAddCommandPreview({
      packageNames: ['requests'],
      dependencyTarget: 'regular',
      versionSpecifier: '>=2.0, <3.0'
    });

    assert.strictEqual(preview, 'uv add "requests>=2.0, <3.0"');
  });
});

suite('escapeShellArgForDisplay', () => {
  test('leaves simple arguments unquoted', () => {
    assert.strictEqual(escapeShellArgForDisplay('uv'), 'uv');
    assert.strictEqual(escapeShellArgForDisplay('requests==2.32.3'), 'requests==2.32.3');
  });

  test('quotes arguments containing whitespace', () => {
    assert.strictEqual(escapeShellArgForDisplay('two words'), '"two words"');
  });

  test('escapes embedded double quotes', () => {
    assert.strictEqual(escapeShellArgForDisplay('say "hi"'), '"say \\"hi\\""');
  });

  test('renders an empty argument as an empty quoted string', () => {
    assert.strictEqual(escapeShellArgForDisplay(''), '""');
  });
});
