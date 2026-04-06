'use strict';
/**
 * core/vnet.js — AIOS Virtual Network Interface v1.0.0
 *
 * Wraps the existing core/network.js module as a VHAL-registered device
 * so the network stack obeys the same plug-and-play contract as every
 * other virtual hardware component.
 *
 * VHAL device id  : "vnet-0"
 * VHAL device type: "network"
 * caps            : ['http', 'https', 'dns', 'tcp', 'ws']
 *
 * ioctl commands:
 *   get    { url, opts }                → http GET
 *   post   { url, body, opts }          → http POST
 *   dns    { host }                     → DNS lookup
 *   ping   { host }                     → ping
 *
 * Emits on kernel bus:
 *   vnet:request   { method, url }
 *   vnet:response  { method, url, status }
 *   vnet:error     { method, url, error }
 *
 * Zero external npm dependencies.
 */

const nodeos = require('os');

// ---------------------------------------------------------------------------
// createVNet — factory
// ---------------------------------------------------------------------------
function createVNet(networkModule, kernel) {
  const VERSION = '1.0.0';
  const _net    = networkModule;           // createNetwork(…) instance
  const _bus    = (kernel && kernel.bus) ? kernel.bus : { emit: () => {} };

  // ── helpers ──────────────────────────────────────────────────────────────

  function _emitReq(method, url) {
    _bus.emit('vnet:request', { method, url });
  }
  function _emitRes(method, url, status) {
    _bus.emit('vnet:response', { method, url, status });
  }
  function _emitErr(method, url, error) {
    _bus.emit('vnet:error', { method, url, error });
  }

  // ── public methods ────────────────────────────────────────────────────────

  async function get(url, opts) {
    _emitReq('GET', url);
    try {
      const r = await _net.http.get(url, opts || {});
      _emitRes('GET', url, r.status || 200);
      return r;
    } catch (e) {
      _emitErr('GET', url, e.message);
      throw e;
    }
  }

  async function post(url, body, opts) {
    _emitReq('POST', url);
    try {
      const r = await _net.http.post(url, body, opts || {});
      _emitRes('POST', url, r.status || 200);
      return r;
    } catch (e) {
      _emitErr('POST', url, e.message);
      throw e;
    }
  }

  async function dns(host) {
    _emitReq('DNS', host);
    try {
      const r = await _net.dns.lookup(host);
      _emitRes('DNS', host, 'resolved');
      return r;
    } catch (e) {
      _emitErr('DNS', host, e.message);
      throw e;
    }
  }

  function interfaces() {
    const ifaces = nodeos.networkInterfaces();
    return Object.keys(ifaces).map(name => ({
      name,
      addresses: (ifaces[name] || []).map(a => ({ family: a.family, address: a.address })),
    }));
  }

  // ── VHAL device descriptor ───────────────────────────────────────────────
  const device = {
    id:      'vnet-0',
    type:    'network',
    version: VERSION,
    caps:    ['http', 'https', 'dns', 'tcp', 'ws'],
    init:    async () => {
      const ifaces = interfaces();
      return { ok: true, interfaces: ifaces.length };
    },
    read:    (_addr) => ({ interfaces: interfaces() }),
    write:   (_addr, _val) => undefined,
    ioctl:   (cmd, args) => {
      const a = args || {};
      if (cmd === 'get')  return get(a.url, a.opts);
      if (cmd === 'post') return post(a.url, a.body, a.opts);
      if (cmd === 'dns')  return dns(a.host);
      if (cmd === 'interfaces') return { ok: true, result: interfaces() };
      return null;
    },
    hotplug: () => undefined,
    unplug:  () => undefined,
  };

  return {
    name:       'vnet',
    version:    VERSION,
    device,
    get,
    post,
    dns,
    interfaces,
  };
}

module.exports = { createVNet };
