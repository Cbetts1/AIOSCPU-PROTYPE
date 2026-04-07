'use strict';
/**
 * filesystem.js — AIOS In-Memory Virtual Filesystem v4.0.0
 *
 * Created for: AIOSCPU Prototype One
 * Sources drawn from: Cbetts1/Files-system, Cbetts1/Backend-file-system-
 * (both were empty; this is a complete, fresh implementation)
 *
 * Provides a POSIX-like in-memory VFS:
 *   mkdir, ls, cd, pwd, touch, read, write, append, rm, stat, cp, mv, tree
 *
 * v1.1.0 additions:
 *   - Virtual mount table (mount, umount, getMounts)
 *   - Atomic write (writeAtomic — write to shadow then swap)
 *   - FS integrity check (fsck — validates tree consistency)
 *   - Persistent layer (snapshot / restore via host FS when available)
 *
 * Paths: Unix-style absolute (/home/user) or relative (docs/notes.txt)
 * Everything lives in a JS object tree — no disk I/O, runs fully offline.
 */

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------
const TYPE_DIR  = 'dir';
const TYPE_FILE = 'file';

function now() { return Date.now(); }

function makeDir(name) {
  return { type: TYPE_DIR, name, children: {}, created: now(), modified: now() };
}

function makeFile(name, content = '') {
  return { type: TYPE_FILE, name, content: String(content), created: now(), modified: now() };
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------
function normalizePath(base, rel) {
  if (typeof rel !== 'string') throw new TypeError('Path must be a string');
  const parts = [];
  const segments = (rel.startsWith('/') ? rel : `${base}/${rel}`).split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return '/' + parts.join('/');
}

function splitPath(p) {
  const norm   = p === '/' ? '/' : p.replace(/\/+$/, '');
  const slash  = norm.lastIndexOf('/');
  const parent = slash === 0 ? '/' : norm.slice(0, slash);
  const name   = norm.slice(slash + 1);
  return { parent: parent || '/', name };
}

// ---------------------------------------------------------------------------
// VFS factory
// ---------------------------------------------------------------------------
function createFilesystem() {
  // Root node — always a directory
  const root = makeDir('/');

  // Current working directory (absolute path string)
  let cwd = '/';

  // Virtual mount table: mountPoint -> { device, fsType, options, mountedAt }
  const _mounts = Object.create(null);

  // ---------------------------------------------------------------------------
  // Internal: walk path and return the node (or null)
  // ---------------------------------------------------------------------------
  function _resolve(path) {
    if (path === '/') return root;
    const parts = path.replace(/^\/+/, '').split('/');
    let node = root;
    for (const part of parts) {
      if (!part) continue;
      if (node.type !== TYPE_DIR || !node.children[part]) return null;
      node = node.children[part];
    }
    return node;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Return current working directory path. */
  function pwd() { return cwd; }

  /** Change directory. */
  function cd(path) {
    const abs  = normalizePath(cwd, path);
    const node = _resolve(abs);
    if (!node) return { ok: false, error: `cd: no such directory: ${path}` };
    if (node.type !== TYPE_DIR) return { ok: false, error: `cd: not a directory: ${path}` };
    cwd = abs;
    return { ok: true, path: cwd };
  }

  /** Make directory (with -p support). */
  function mkdir(path, { parents = false } = {}) {
    const abs    = normalizePath(cwd, path);
    const parts  = abs.replace(/^\/+/, '').split('/').filter(Boolean);
    let node     = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!node.children[part]) {
        if (i < parts.length - 1 && !parents) {
          return { ok: false, error: `mkdir: parent directory does not exist: ${path}` };
        }
        node.children[part] = makeDir(part);
        node.modified = now();
      } else if (node.children[part].type !== TYPE_DIR) {
        return { ok: false, error: `mkdir: not a directory: ${part}` };
      }
      node = node.children[part];
    }
    return { ok: true, path: abs };
  }

  /** List directory contents. */
  function ls(path = '.') {
    const abs  = normalizePath(cwd, path);
    const node = _resolve(abs);
    if (!node) return { ok: false, error: `ls: no such directory: ${path}` };
    if (node.type !== TYPE_DIR) return { ok: false, error: `ls: not a directory: ${path}` };
    const entries = Object.values(node.children).map(n => ({
      name:     n.name,
      type:     n.type,
      size:     n.type === TYPE_FILE ? n.content.length : 0,
      modified: n.modified,
    }));
    return { ok: true, entries };
  }

  /** Create an empty file (touch). */
  function touch(path) {
    const abs        = normalizePath(cwd, path);
    const { parent, name } = splitPath(abs);
    const parentNode = _resolve(parent);
    if (!parentNode) return { ok: false, error: `touch: no such directory: ${parent}` };
    if (parentNode.type !== TYPE_DIR) return { ok: false, error: `touch: not a directory: ${parent}` };
    if (!parentNode.children[name]) {
      parentNode.children[name] = makeFile(name);
    } else {
      parentNode.children[name].modified = now();
    }
    return { ok: true, path: abs };
  }

  /** Read file content. */
  function read(path) {
    const abs  = normalizePath(cwd, path);
    const node = _resolve(abs);
    if (!node) return { ok: false, error: `read: no such file: ${path}` };
    if (node.type !== TYPE_FILE) return { ok: false, error: `read: is a directory: ${path}` };
    return { ok: true, content: node.content, path: abs };
  }

  /** Write (overwrite) file content. */
  function write(path, content = '') {
    const abs        = normalizePath(cwd, path);
    const { parent, name } = splitPath(abs);
    const parentNode = _resolve(parent);
    if (!parentNode) return { ok: false, error: `write: no such directory: ${parent}` };
    if (parentNode.type !== TYPE_DIR) return { ok: false, error: `write: not a directory: ${parent}` };
    if (parentNode.children[name] && parentNode.children[name].type !== TYPE_FILE) {
      return { ok: false, error: `write: is a directory: ${path}` };
    }
    const node = parentNode.children[name] || makeFile(name);
    node.content  = String(content);
    node.modified = now();
    parentNode.children[name] = node;
    return { ok: true, path: abs, bytes: node.content.length };
  }

  /** Append to file. */
  function append(path, content = '') {
    const abs  = normalizePath(cwd, path);
    const node = _resolve(abs);
    if (!node) {
      // Auto-create
      return write(path, content);
    }
    if (node.type !== TYPE_FILE) return { ok: false, error: `append: is a directory: ${path}` };
    node.content  += String(content);
    node.modified  = now();
    return { ok: true, path: abs, bytes: node.content.length };
  }

  /** Remove file or empty directory. */
  function rm(path, { recursive = false } = {}) {
    const abs        = normalizePath(cwd, path);
    if (abs === '/') return { ok: false, error: 'rm: cannot remove root' };
    const { parent, name } = splitPath(abs);
    const parentNode = _resolve(parent);
    if (!parentNode || !parentNode.children[name]) {
      return { ok: false, error: `rm: no such file or directory: ${path}` };
    }
    const node = parentNode.children[name];
    if (node.type === TYPE_DIR && Object.keys(node.children).length > 0 && !recursive) {
      return { ok: false, error: `rm: directory not empty: ${path} (use -r)` };
    }
    delete parentNode.children[name];
    parentNode.modified = now();
    return { ok: true, path: abs };
  }

  /** Stat a path. */
  function stat(path) {
    const abs  = normalizePath(cwd, path);
    const node = _resolve(abs);
    if (!node) return { ok: false, error: `stat: no such file or directory: ${path}` };
    return {
      ok:       true,
      path:     abs,
      type:     node.type,
      name:     node.name,
      size:     node.type === TYPE_FILE ? node.content.length : 0,
      children: node.type === TYPE_DIR ? Object.keys(node.children).length : null,
      created:  node.created,
      modified: node.modified,
    };
  }

  /** Copy file (not directory). */
  function cp(src, dst) {
    const srcAbs = normalizePath(cwd, src);
    const srcNode = _resolve(srcAbs);
    if (!srcNode) return { ok: false, error: `cp: no such file: ${src}` };
    if (srcNode.type !== TYPE_FILE) return { ok: false, error: `cp: is a directory (use cp -r): ${src}` };
    return write(dst, srcNode.content);
  }

  /** Move / rename. */
  function mv(src, dst) {
    const srcAbs = normalizePath(cwd, src);
    const dstAbs = normalizePath(cwd, dst);
    if (srcAbs === dstAbs) return { ok: true, path: dstAbs };

    const srcNode = _resolve(srcAbs);
    if (!srcNode) return { ok: false, error: `mv: no such file or directory: ${src}` };

    const { parent: srcParent, name: srcName } = splitPath(srcAbs);
    const { parent: dstParent, name: dstName  } = splitPath(dstAbs);

    const srcParentNode = _resolve(srcParent);
    const dstParentNode = _resolve(dstParent);
    if (!dstParentNode) return { ok: false, error: `mv: destination parent does not exist: ${dstParent}` };

    srcNode.name = dstName;
    dstParentNode.children[dstName] = srcNode;
    dstParentNode.modified = now();
    delete srcParentNode.children[srcName];
    srcParentNode.modified = now();

    return { ok: true, path: dstAbs };
  }

  /** Recursive tree listing (returns string). */
  function tree(path = '.', indent = '') {
    const abs  = normalizePath(cwd, path);
    const node = _resolve(abs);
    if (!node) return `${path}: no such file or directory`;
    if (node.type === TYPE_FILE) return `${indent}${node.name}`;

    const lines = [`${indent}${path === '.' ? cwd : abs}`];
    const entries = Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of entries) {
      if (child.type === TYPE_DIR) {
        lines.push(tree(`${abs === '/' ? '' : abs}/${child.name}`, indent + '  '));
      } else {
        lines.push(`${indent}  ${child.name}`);
      }
    }
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Virtual mount table
  // ---------------------------------------------------------------------------
  function mount(mountPoint, device, fsType = 'vfs', options = {}) {
    const abs = normalizePath(cwd, mountPoint);
    // Ensure mount point directory exists
    const node = _resolve(abs);
    if (!node) {
      const mkr = mkdir(mountPoint, { parents: true });
      if (!mkr.ok) return { ok: false, error: `mount: cannot create mount point: ${mkr.error}` };
    }
    _mounts[abs] = { device, fsType, options, mountedAt: now() };
    return { ok: true, mountPoint: abs, device, fsType };
  }

  function umount(mountPoint) {
    const abs = normalizePath(cwd, mountPoint);
    if (!_mounts[abs]) return { ok: false, error: `umount: not mounted: ${mountPoint}` };
    delete _mounts[abs];
    return { ok: true, mountPoint: abs };
  }

  function getMounts() {
    return Object.entries(_mounts).map(([mp, info]) => ({ mountPoint: mp, ...info }));
  }

  // ---------------------------------------------------------------------------
  // Atomic write — write to a shadow copy, then swap (prevents partial writes)
  // ---------------------------------------------------------------------------
  function writeAtomic(path, content = '') {
    const abs = normalizePath(cwd, path);
    const shadowPath = abs + '.__atomic_tmp__';
    // Write to shadow
    const wr = write(shadowPath, content);
    if (!wr.ok) return { ok: false, error: `writeAtomic: shadow write failed: ${wr.error}` };
    // Verify shadow is readable
    const rr = read(shadowPath);
    if (!rr.ok || rr.content !== String(content)) {
      rm(shadowPath);
      return { ok: false, error: 'writeAtomic: verification failed' };
    }
    // Move shadow -> target (atomic swap)
    const mvr = mv(shadowPath, abs);
    if (!mvr.ok) {
      rm(shadowPath);
      return { ok: false, error: `writeAtomic: swap failed: ${mvr.error}` };
    }
    const result = read(abs);
    return { ok: true, path: abs, bytes: result.ok ? result.content.length : 0 };
  }

  // ---------------------------------------------------------------------------
  // FS integrity check — validates tree consistency
  // ---------------------------------------------------------------------------
  function fsck(path = '/') {
    const errors  = [];
    let   checked = 0;

    function _check(absPath, node) {
      checked++;
      if (!node || typeof node !== 'object') {
        errors.push(`${absPath}: null or non-object node`);
        return;
      }
      if (node.type !== TYPE_FILE && node.type !== TYPE_DIR) {
        errors.push(`${absPath}: unknown type "${node.type}"`);
        return;
      }
      if (typeof node.name !== 'string' || node.name === '') {
        errors.push(`${absPath}: missing or empty name`);
      }
      if (typeof node.created !== 'number') {
        errors.push(`${absPath}: missing created timestamp`);
      }
      if (typeof node.modified !== 'number') {
        errors.push(`${absPath}: missing modified timestamp`);
      }
      if (node.type === TYPE_FILE) {
        if (typeof node.content !== 'string') {
          errors.push(`${absPath}: file content is not a string`);
        }
      } else {
        if (!node.children || typeof node.children !== 'object') {
          errors.push(`${absPath}: directory missing children object`);
          return;
        }
        for (const [childName, childNode] of Object.entries(node.children)) {
          if (childNode.name !== childName) {
            errors.push(`${absPath}/${childName}: name mismatch (key="${childName}" name="${childNode.name}")`);
          }
          _check(`${absPath === '/' ? '' : absPath}/${childName}`, childNode);
        }
      }
    }

    const startNode = _resolve(normalizePath(cwd, path));
    if (!startNode) return { ok: false, error: `fsck: path not found: ${path}`, checked: 0, errors: [] };

    _check(path === '/' ? '/' : normalizePath(cwd, path), startNode);

    const clean = errors.length === 0;
    return { ok: clean, checked, errors, clean };
  }

  // ---------------------------------------------------------------------------
  // Persistent layer — snapshot/restore (uses host Node.js fs if available)
  // ---------------------------------------------------------------------------
  function _serializeNode(node) {
    if (node.type === TYPE_FILE) {
      return { type: TYPE_FILE, name: node.name, content: node.content, created: node.created, modified: node.modified };
    }
    const children = {};
    for (const [k, v] of Object.entries(node.children)) {
      children[k] = _serializeNode(v);
    }
    return { type: TYPE_DIR, name: node.name, children, created: node.created, modified: node.modified };
  }

  function _deserializeNode(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.type === TYPE_FILE) {
      return { type: TYPE_FILE, name: data.name, content: String(data.content || ''), created: data.created || now(), modified: data.modified || now() };
    }
    const children = {};
    for (const [k, v] of Object.entries(data.children || {})) {
      const child = _deserializeNode(v);
      if (child) children[k] = child;
    }
    return { type: TYPE_DIR, name: data.name, children, created: data.created || now(), modified: data.modified || now() };
  }

  function snapshot() {
    return JSON.stringify({ version: 1, cwd, root: _serializeNode(root) });
  }

  function restore(snapshotJson) {
    try {
      const data = JSON.parse(snapshotJson);
      if (!data || data.version !== 1) return { ok: false, error: 'restore: invalid snapshot version' };
      const newRoot = _deserializeNode(data.root);
      if (!newRoot) return { ok: false, error: 'restore: failed to deserialize root' };
      // Replace root contents
      root.children  = newRoot.children;
      root.modified  = newRoot.modified;
      cwd = (typeof data.cwd === 'string') ? data.cwd : '/';
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `restore: ${e.message}` };
    }
  }

  // Persist to host disk at given path (Node.js fs required)
  function persistTo(hostPath) {
    try {
      const nfs = require('fs');
      nfs.writeFileSync(hostPath, snapshot(), 'utf8');
      return { ok: true, path: hostPath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Load from host disk snapshot
  function loadFrom(hostPath) {
    try {
      const nfs = require('fs');
      const data = nfs.readFileSync(hostPath, 'utf8');
      return restore(data);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ---------------------------------------------------------------------------
  // Filesystem module interface (for kernel module registry)
  // ---------------------------------------------------------------------------
  const commands = {
    pwd:   (_args)           => ({ status: 'ok', result: pwd() }),
    cd:    ([p = '/'])       => {
      const r = cd(p);
      return r.ok ? { status: 'ok', result: r.path } : { status: 'error', result: r.error };
    },
    mkdir: ([p, flag])       => {
      const r = mkdir(p, { parents: flag === '-p' });
      return r.ok ? { status: 'ok', result: `Created ${r.path}` } : { status: 'error', result: r.error };
    },
    ls:    ([p])             => {
      const r = ls(p);
      if (!r.ok) return { status: 'error', result: r.error };
      const out = r.entries.map(e => `${e.type === TYPE_DIR ? 'd' : '-'}  ${e.name}`).join('\n') || '(empty)';
      return { status: 'ok', result: out };
    },
    touch: ([p])             => {
      if (!p) return { status: 'error', result: 'Usage: touch <path>' };
      const r = touch(p);
      return r.ok ? { status: 'ok', result: `Touched ${r.path}` } : { status: 'error', result: r.error };
    },
    cat:   ([p])             => {
      if (!p) return { status: 'error', result: 'Usage: cat <path>' };
      const r = read(p);
      return r.ok ? { status: 'ok', result: r.content } : { status: 'error', result: r.error };
    },
    write: ([p, ...rest])    => {
      const r = write(p, rest.join(' '));
      return r.ok ? { status: 'ok', result: `Wrote ${r.bytes} bytes` } : { status: 'error', result: r.error };
    },
    rm:    ([flag, p])       => {
      const isRecursive = flag === '-r' || flag === '-rf';
      const target      = isRecursive ? p : flag;
      const r           = rm(target, { recursive: isRecursive });
      return r.ok ? { status: 'ok', result: `Removed ${r.path}` } : { status: 'error', result: r.error };
    },
    stat:  ([p])             => {
      if (!p) return { status: 'error', result: 'Usage: stat <path>' };
      const r = stat(p);
      if (!r.ok) return { status: 'error', result: r.error };
      return { status: 'ok', result: JSON.stringify(r, null, 2) };
    },
    cp:    ([s, d])          => {
      if (!s || !d) return { status: 'error', result: 'Usage: cp <src> <dest>' };
      const r = cp(s, d);
      return r.ok ? { status: 'ok', result: `Copied to ${r.path}` } : { status: 'error', result: r.error };
    },
    mv:    ([s, d])          => {
      if (!s || !d) return { status: 'error', result: 'Usage: mv <src> <dest>' };
      const r = mv(s, d);
      return r.ok ? { status: 'ok', result: `Moved to ${r.path}` } : { status: 'error', result: r.error };
    },
    tree:  ([p])             => ({ status: 'ok', result: tree(p) }),
  };

  return {
    name:  'filesystem',
    // Raw API
    pwd, cd, mkdir, ls, touch, read, write, append, rm, stat, cp, mv, tree,
    // v1.1 additions
    writeAtomic, fsck,
    mount, umount, getMounts,
    snapshot, restore, persistTo, loadFrom,
    resolvePath: (p) => normalizePath(cwd, p),
    // For router module mounting
    commands,
  };
}

module.exports = { createFilesystem };
