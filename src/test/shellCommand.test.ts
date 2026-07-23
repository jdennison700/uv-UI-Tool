import * as assert from 'assert';

import { containsOsError5, isUvSyncCommand, normalizeThemeName } from '../extension';

suite('isUvSyncCommand', () => {
  test('matches uv sync with and without arguments', () => {
    assert.strictEqual(isUvSyncCommand('uv sync'), true);
    assert.strictEqual(isUvSyncCommand('uv sync --frozen'), true);
    assert.strictEqual(isUvSyncCommand('uv  sync'), true);
  });

  test('ignores surrounding whitespace and casing', () => {
    assert.strictEqual(isUvSyncCommand('  uv sync  '), true);
    assert.strictEqual(isUvSyncCommand('UV SYNC'), true);
  });

  test('does not match other uv commands', () => {
    for (const command of ['uv lock', 'uv syncthing', 'uv run sync', 'uvsync', 'echo uv sync', '']) {
      assert.strictEqual(isUvSyncCommand(command), false, `expected ${JSON.stringify(command)} not to match`);
    }
  });
});

suite('containsOsError5', () => {
  test('detects the Windows access-denied marker in any casing', () => {
    assert.strictEqual(containsOsError5('failed to remove file (os error 5)'), true);
    assert.strictEqual(containsOsError5('Access is denied. (OS Error 5)'), true);
  });

  test('returns false for unrelated stderr output', () => {
    assert.strictEqual(containsOsError5('error: No `pyproject.toml` found'), false);
    assert.strictEqual(containsOsError5('os error 32'), false);
    assert.strictEqual(containsOsError5(''), false);
  });
});

suite('normalizeThemeName', () => {
  test('passes through the supported theme names', () => {
    assert.strictEqual(normalizeThemeName('light'), 'light');
    assert.strictEqual(normalizeThemeName('dark'), 'dark');
  });

  test('maps the legacy matte-black theme to dark', () => {
    assert.strictEqual(normalizeThemeName('matte-black'), 'dark');
  });

  test('falls back to dark for unknown or missing values', () => {
    assert.strictEqual(normalizeThemeName(undefined), 'dark');
    assert.strictEqual(normalizeThemeName(null), 'dark');
    assert.strictEqual(normalizeThemeName('Light'), 'dark');
    assert.strictEqual(normalizeThemeName(7), 'dark');
  });
});
