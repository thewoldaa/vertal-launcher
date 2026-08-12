'use strict';
/** Evaluates Mojang's {action, os, features} rule arrays used throughout version JSON. */

function currentOsName() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'osx';
  return 'linux';
}

function currentOsArch() {
  // Mojang's os.arch values are "x86" (32-bit) or unset for 64-bit; arm64 appears as "arm64" on newer entries.
  if (process.arch === 'arm64') return 'arm64';
  if (process.arch === 'ia32') return 'x86';
  return 'x86_64';
}

/**
 * @param {Array} rules
 * @param {object} featureFlags - e.g. { is_demo_user: false, has_custom_resolution: true, has_quick_plays_support: false }
 * @returns {boolean}
 */
function rulesAllow(rules, featureFlags = {}) {
  if (!rules || !rules.length) return true;
  let allowed = false;
  for (const rule of rules) {
    let matches = true;
    if (rule.os) {
      if (rule.os.name && rule.os.name !== currentOsName()) matches = false;
      if (rule.os.arch && rule.os.arch !== currentOsArch()) matches = false;
    }
    if (rule.features) {
      for (const [key, val] of Object.entries(rule.features)) {
        if (Boolean(featureFlags[key]) !== Boolean(val)) matches = false;
      }
    }
    if (matches) allowed = rule.action === 'allow';
  }
  return allowed;
}

module.exports = { currentOsName, currentOsArch, rulesAllow };
