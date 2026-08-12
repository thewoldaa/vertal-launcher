'use strict';
/**
 * Offline account management.
 *
 * Vertal Launcher never talks to Mojang/Microsoft auth servers. It only
 * ever fetches PUBLIC, unauthenticated resources (version manifests, client
 * jars, libraries, assets) — exactly like any other launcher does — and then
 * launches the game the same way MultiMC/PrismLauncher's "offline" account
 * type does: a locally-generated username + deterministic UUID + a dummy
 * access token. Vanilla Minecraft does not validate the access token unless
 * you try to join an online-mode server, so this works perfectly for
 * singleplayer, LAN, and offline-mode servers.
 *
 * The UUID is derived exactly the way Java's `UUID.nameUUIDFromBytes` does
 * for `"OfflinePlayer:" + username` — this is the same "offline UUID"
 * algorithm used by Bukkit/Spigot/Paper offline-mode servers, so a player's
 * offline UUID here matches what a self-hosted offline server would assign
 * them.
 */
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { accountsStore, getConfig, setConfig } = require('./config');

/** Java-compatible UUID v3-ish "nameUUIDFromBytes" — MD5 of raw bytes, no namespace prefix. */
function offlineUUID(username) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + username, 'utf8').digest();
  // Set version (3) and variant bits per RFC 4122, exactly like java.util.UUID#nameUUIDFromBytes
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const hex = md5.toString('hex');
  const dashed = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
  return { dashed, dashless: hex };
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

function validateUsername(name) {
  if (typeof name !== 'string') return 'Username is required.';
  if (!USERNAME_RE.test(name)) {
    return 'Username must be 3-16 characters: letters, numbers and underscores only.';
  }
  return null;
}

function listAccounts() {
  return accountsStore.read();
}

function addAccount(username) {
  const err = validateUsername(username);
  if (err) throw new Error(err);
  const accounts = accountsStore.read();
  if (accounts.some((a) => a.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('An offline profile with that username already exists.');
  }
  const { dashed, dashless } = offlineUUID(username);
  const account = {
    id: randomUUID(),
    username,
    uuid: dashed,
    uuidDashless: dashless,
    type: 'offline',
    createdAt: Date.now(),
  };
  accountsStore.update((cur) => [...cur, account]);
  const cfg = getConfig();
  if (!cfg.activeAccountId) setConfig({ activeAccountId: account.id });
  return account;
}

function removeAccount(id) {
  accountsStore.update((cur) => cur.filter((a) => a.id !== id));
  const cfg = getConfig();
  if (cfg.activeAccountId === id) {
    const remaining = accountsStore.read();
    setConfig({ activeAccountId: remaining[0] ? remaining[0].id : null });
  }
}

function setActiveAccount(id) {
  const accounts = accountsStore.read();
  if (!accounts.some((a) => a.id === id)) throw new Error('Unknown account id.');
  setConfig({ activeAccountId: id });
}

function getActiveAccount() {
  const cfg = getConfig();
  const accounts = accountsStore.read();
  return accounts.find((a) => a.id === cfg.activeAccountId) || accounts[0] || null;
}

module.exports = {
  offlineUUID,
  validateUsername,
  listAccounts,
  addAccount,
  removeAccount,
  setActiveAccount,
  getActiveAccount,
};
