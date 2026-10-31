const fs = require('node:fs');
const path = require('node:path');

// Copy only application settings and the encryption state, before Electron is
// ready. Keep the old profile intact, and never replace an existing new file.
function migrateProfile(legacyDir, targetDir) {
  if (path.resolve(legacyDir) === path.resolve(targetDir) || !fs.existsSync(legacyDir)) return [];
  fs.mkdirSync(targetDir, { recursive: true });
  const copied = [];
  for (const name of ['Local State', 'Preferences', 'desktop.json', 'settings.json', 'bridge-token']) {
    const source = path.join(legacyDir, name), destination = path.join(targetDir, name);
    if (!fs.existsSync(source) || fs.existsSync(destination)) continue;
    const info = fs.lstatSync(source);
    if (!info.isFile() || info.isSymbolicLink()) continue;
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    copied.push(name);
  }
  return copied;
}
module.exports = { migrateProfile };
