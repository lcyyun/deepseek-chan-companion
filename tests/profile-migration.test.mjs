import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import migration from '../desktop/profile-migration.cjs';

test('renaming the pet preserves encrypted settings and pairing without copying caches or replacing new preferences', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'l2d-profile-migration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const old = path.join(root, 'old'), next = path.join(root, 'new');
  await fs.mkdir(old); await fs.mkdir(next);
  const encrypted = JSON.stringify({ encryptedSecrets: 'encrypted-fixture', settings: { provider: 'api' } });
  await fs.writeFile(path.join(old, 'settings.json'), encrypted);
  await fs.writeFile(path.join(old, 'desktop.json'), '{"petScale":2}');
  await fs.writeFile(path.join(old, 'bridge-token'), 'fixture-pairing');
  await fs.writeFile(path.join(old, 'Local State'), 'encryption-state');
  await fs.writeFile(path.join(old, 'Cache'), 'do-not-copy');
  await fs.writeFile(path.join(next, 'desktop.json'), '{"petScale":1.5}');
  const copied = migration.migrateProfile(old, next);
  assert.deepEqual(copied.sort(), ['Local State', 'bridge-token', 'settings.json'].sort());
  assert.equal(await fs.readFile(path.join(next, 'settings.json'), 'utf8'), encrypted);
  assert.equal(await fs.readFile(path.join(next, 'desktop.json'), 'utf8'), '{"petScale":1.5}');
  assert.equal(await fs.readFile(path.join(next, 'bridge-token'), 'utf8'), 'fixture-pairing');
  await assert.rejects(fs.access(path.join(next, 'Cache')));
  assert.equal(await fs.readFile(path.join(old, 'settings.json'), 'utf8'), encrypted);
  assert.deepEqual(migration.migrateProfile(old, next), []);
});
