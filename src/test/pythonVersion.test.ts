import * as assert from 'assert';

import {
  buildUvPinArgs,
  buildUvPinCommandPreview,
  comparePythonVersionsDescending,
  isStablePythonVersion,
  normalizePythonPinRequest,
  parseUvPythonListOutput
} from '../extension';

suite('isStablePythonVersion', () => {
  test('accepts major.minor and major.minor.patch', () => {
    assert.strictEqual(isStablePythonVersion('3.12'), true);
    assert.strictEqual(isStablePythonVersion('3.12.7'), true);
  });

  test('rejects pre-releases, suffixes, and partial versions', () => {
    for (const version of ['3', '3.13.0rc1', '3.12.0b1', '3.12.4+free-threaded', 'pypy-3.10', '3.12.', '']) {
      assert.strictEqual(isStablePythonVersion(version), false, `expected ${JSON.stringify(version)} to be rejected`);
    }
  });
});

suite('comparePythonVersionsDescending', () => {
  test('orders newer versions first', () => {
    assert.ok(comparePythonVersionsDescending('3.13.0', '3.12.7') < 0);
    assert.ok(comparePythonVersionsDescending('3.12.7', '3.13.0') > 0);
  });

  test('compares numerically rather than lexically', () => {
    assert.ok(comparePythonVersionsDescending('3.10', '3.9') < 0);
  });

  test('treats a missing patch segment as zero', () => {
    assert.strictEqual(comparePythonVersionsDescending('3.12', '3.12.0'), 0);
    assert.ok(comparePythonVersionsDescending('3.12.1', '3.12') < 0);
  });

  test('returns 0 for identical versions', () => {
    assert.strictEqual(comparePythonVersionsDescending('3.12.7', '3.12.7'), 0);
  });

  test('sorts a list newest-first', () => {
    const versions = ['3.9.18', '3.13.0', '3.10.14', '3.12.7'];
    assert.deepStrictEqual(
      [...versions].sort(comparePythonVersionsDescending),
      ['3.13.0', '3.12.7', '3.10.14', '3.9.18']
    );
  });
});

suite('parseUvPythonListOutput', () => {
  const entry = (version: string, implementation = 'cpython', variant: string | undefined = 'default') => ({
    version,
    implementation,
    ...(variant === undefined ? {} : { variant })
  });

  test('returns stable CPython versions newest-first', () => {
    const versions = parseUvPythonListOutput(JSON.stringify([
      entry('3.12.7'),
      entry('3.13.0'),
      entry('3.11.9')
    ]));

    assert.deepStrictEqual(versions, ['3.13.0', '3.12.7', '3.11.9']);
  });

  test('filters out non-CPython implementations', () => {
    const versions = parseUvPythonListOutput(JSON.stringify([
      entry('3.12.7'),
      entry('3.10.13', 'pypy')
    ]));

    assert.deepStrictEqual(versions, ['3.12.7']);
  });

  test('filters out non-default variants but keeps entries with no variant', () => {
    const versions = parseUvPythonListOutput(JSON.stringify([
      entry('3.13.0', 'cpython', 'freethreaded'),
      entry('3.12.7', 'cpython', undefined)
    ]));

    assert.deepStrictEqual(versions, ['3.12.7']);
  });

  test('filters out pre-release versions', () => {
    const versions = parseUvPythonListOutput(JSON.stringify([
      entry('3.14.0rc1'),
      entry('3.13.0')
    ]));

    assert.deepStrictEqual(versions, ['3.13.0']);
  });

  test('de-duplicates repeated versions', () => {
    const versions = parseUvPythonListOutput(JSON.stringify([entry('3.12.7'), entry('3.12.7')]));
    assert.deepStrictEqual(versions, ['3.12.7']);
  });

  test('skips malformed entries instead of throwing', () => {
    const versions = parseUvPythonListOutput(JSON.stringify([
      null,
      'not-an-object',
      { implementation: 'cpython' },
      entry('  3.12.7  '),
      entry('')
    ]));

    assert.deepStrictEqual(versions, ['3.12.7']);
  });

  test('handles an empty array', () => {
    assert.deepStrictEqual(parseUvPythonListOutput('[]'), []);
  });

  test('throws when the output is not an array', () => {
    assert.throws(() => parseUvPythonListOutput('{"version":"3.12.7"}'), /did not return an array/);
  });

  test('throws when the output is not valid JSON', () => {
    assert.throws(() => parseUvPythonListOutput('not json'));
  });
});

suite('normalizePythonPinRequest', () => {
  test('accepts a stable version and trims it', () => {
    const { request, error } = normalizePythonPinRequest({ version: '  3.12.7  ' });

    assert.strictEqual(error, undefined);
    assert.deepStrictEqual(request, { version: '3.12.7' });
  });

  test('errors when no version is provided', () => {
    for (const message of [{ version: '' }, { version: '   ' }, { version: 42 }, {}, undefined, null]) {
      const { request, error } = normalizePythonPinRequest(message);
      assert.strictEqual(request, undefined);
      assert.strictEqual(error, 'Select a Python version before continuing.');
    }
  });

  test('errors on an unsupported version format', () => {
    const { request, error } = normalizePythonPinRequest({ version: '3.13.0rc1' });

    assert.strictEqual(request, undefined);
    assert.strictEqual(error, 'Unsupported Python version format: 3.13.0rc1');
  });

  test('rejects a version carrying shell metacharacters', () => {
    const { request, error } = normalizePythonPinRequest({ version: '3.12 && rm -rf /' });

    assert.strictEqual(request, undefined);
    assert.ok(error?.startsWith('Unsupported Python version format:'));
  });
});

suite('buildUvPinArgs', () => {
  test('builds the uv python pin argument list', () => {
    assert.deepStrictEqual(buildUvPinArgs({ version: '3.12.7' }), ['python', 'pin', '3.12.7']);
  });

  test('renders a readable command preview', () => {
    assert.strictEqual(buildUvPinCommandPreview({ version: '3.12.7' }), 'uv python pin 3.12.7');
  });
});
