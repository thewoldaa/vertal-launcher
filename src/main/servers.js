'use strict';
/**
 * Server list (quick-play targets).
 *
 * Like SKLauncher's server list: save a server (name + address), then hit
 * "Play" and Vertal launches the chosen installation straight into that
 * server's multiplayer screen using Mojang's quick-play game arguments
 * (`--server <addr> --port <port>`). Works with offline accounts on
 * offline-mode (cracked) servers, LAN worlds, and any server that doesn't
 * enforce online-mode authentication.
 */
const { randomUUID } = require('crypto');
const { serversStore } = require('./config');

const DEFAULT_PORT = 25565;

/** Splits "host" or "host:port" / "host:port:extra" into { address, port }. */
function parseServerAddress(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Server address is required.');
  let address = raw;
  let port = DEFAULT_PORT;

  // IPv6 literal like [::1]:25565 — handle brackets first.
  const bracketMatch = raw.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketMatch) {
    address = bracketMatch[1];
    if (bracketMatch[2]) port = parseInt(bracketMatch[2], 10);
  } else {
    const parts = raw.split(':');
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (/^\d+$/.test(last)) {
        address = parts.slice(0, parts.length - 1).join(':');
        port = parseInt(last, 10);
      }
    }
  }

  if (!address) throw new Error('Server address is required.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }
  return { address, port };
}

function normalizeName(name, address) {
  const trimmed = (name || '').trim();
  if (trimmed) return trimmed;
  const { address: addr, port } = parseServerAddress(address);
  return port === DEFAULT_PORT ? addr : `${addr}:${port}`;
}

function listServers() {
  return serversStore.read();
}

function getServer(id) {
  return serversStore.read().find((s) => s.id === id) || null;
}

function addServer(data) {
  if (!data || !data.address) throw new Error('Server address is required.');
  const { address, port } = parseServerAddress(data.address);
  const server = {
    id: randomUUID(),
    name: normalizeName(data.name, data.address),
    address,
    port,
    instanceId: data.instanceId || null, // null = use the active installation at play time
    createdAt: Date.now(),
    lastPlayedAt: null,
    playCount: 0,
  };
  serversStore.update((cur) => [...cur, server]);
  return server;
}

function updateServer(id, patch) {
  let updated = null;
  serversStore.update((cur) => cur.map((s) => {
    if (s.id !== id) return s;
    const next = { ...s, ...patch };
    if (patch && patch.address) {
      const { address, port } = parseServerAddress(patch.address);
      next.address = address;
      next.port = port;
    }
    if (patch && patch.name !== undefined) {
      next.name = normalizeName(patch.name, next.address);
    }
    updated = next;
    return next;
  }));
  if (!updated) throw new Error('Unknown server id.');
  return updated;
}

function removeServer(id) {
  serversStore.update((cur) => cur.filter((s) => s.id !== id));
  return true;
}

function recordPlayed(id) {
  let updated = null;
  serversStore.update((cur) => cur.map((s) => {
    if (s.id !== id) return s;
    updated = { ...s, lastPlayedAt: Date.now(), playCount: (s.playCount || 0) + 1 };
    return updated;
  }));
  return updated;
}

module.exports = {
  DEFAULT_PORT,
  parseServerAddress,
  listServers,
  getServer,
  addServer,
  updateServer,
  removeServer,
  recordPlayed,
};
