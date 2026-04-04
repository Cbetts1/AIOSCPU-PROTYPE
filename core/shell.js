'use strict';
/**
 * shell.js — AIOS Shell Interpreter v2.0.0
 *
 * A real shell engine built into AIOS. Supports:
 *   Variables     : VAR=value, $VAR, ${VAR}, export VAR
 *   Pipes         : cmd1 | cmd2 | cmd3
 *   Redirects     : cmd > file, cmd >> file, cmd 2>&1
 *   Conditionals  : if cmd; then ... elif ...; else ...; fi
 *   Loops         : while cond; do ...; done / for x in ...; do ...; done
 *   Functions     : function name() { ... }
 *   Command sub   : $(cmd) in strings
 *   Arithmetic    : $((expr))
 *   Script files  : source /path, . /path
 *   Background    : cmd & (fire-and-forget)
 *   Exit code     : $? tracks last exit status
 *   Special vars  : $0 $1 $@ $# $$ $!
 *   Builtins      : echo, read, set, unset, export, source, return, exit, true, false
 *   AND/OR        : cmd1 && cmd2, cmd1 || cmd2
 *   Semicolon     : cmd1; cmd2
 *
 * The self-hosting loop: shell scripts stored in the AIOS VFS can read/write
 * other VFS files, start services, ask the AI, and reconfigure the OS at runtime.
 *
 * Zero external npm dependencies. Pure Node.js CommonJS.
 */

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------
const TT = Object.freeze({
  WORD: 'WORD', PIPE: 'PIPE', SEMI: 'SEMI', AMP: 'AMP',
  AND: 'AND', OR: 'OR', REDIR_OUT: 'REDIR_OUT', REDIR_APPEND: 'REDIR_APPEND',
  REDIR_IN: 'REDIR_IN', NEWLINE: 'NEWLINE', EOF: 'EOF',
  IF: 'IF', THEN: 'THEN', ELSE: 'ELSE', ELIF: 'ELIF', FI: 'FI',
  WHILE: 'WHILE', DO: 'DO', DONE: 'DONE', FOR: 'FOR', IN: 'IN',
  FUNCTION: 'FUNCTION', LBRACE: 'LBRACE', RBRACE: 'RBRACE',
});

const KEYWORDS = new Set(['if','then','else','elif','fi','while','do','done','for','in','function']);

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const len = src.length;

  while (i < len) {
    const ch = src[i];

    // whitespace (not newline)
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }

    // comment
    if (ch === '#') { while (i < len && src[i] !== '\n') i++; continue; }

    // newline
    if (ch === '\n') { tokens.push({ type: TT.NEWLINE }); i++; continue; }

    // operators
    if (ch === '|') {
      if (src[i+1] === '|') { tokens.push({ type: TT.OR }); i+=2; }
      else                  { tokens.push({ type: TT.PIPE }); i++; }
      continue;
    }
    if (ch === '&') {
      if (src[i+1] === '&') { tokens.push({ type: TT.AND }); i+=2; }
      else                  { tokens.push({ type: TT.AMP }); i++; }
      continue;
    }
    if (ch === ';') { tokens.push({ type: TT.SEMI }); i++; continue; }
    if (ch === '>') {
      if (src[i+1] === '>') { tokens.push({ type: TT.REDIR_APPEND }); i+=2; }
      else                  { tokens.push({ type: TT.REDIR_OUT }); i++; }
      continue;
    }
    if (ch === '<') { tokens.push({ type: TT.REDIR_IN }); i++; continue; }
    if (ch === '{') { tokens.push({ type: TT.LBRACE }); i++; continue; }
    if (ch === '}') { tokens.push({ type: TT.RBRACE }); i++; continue; }

    // quoted string
    if (ch === '"' || ch === "'") {
      const quote = ch; i++;
      let word = '';
      while (i < len && src[i] !== quote) {
        if (quote === '"' && src[i] === '\\' && i+1 < len) {
          i++; word += src[i++];
        } else {
          word += src[i++];
        }
      }
      i++; // closing quote
      tokens.push({ type: TT.WORD, value: word, quoted: true });
      continue;
    }

    // word
    let word = '';
    while (i < len && !/[\s|&;<>{}#"'`]/.test(src[i])) {
      if (src[i] === '\\' && i+1 < len) { i++; word += src[i++]; }
      else word += src[i++];
    }
    if (word) {
      const upper = word.toUpperCase();
      const kwMap = {
        'if': TT.IF, 'then': TT.THEN, 'else': TT.ELSE, 'elif': TT.ELIF,
        'fi': TT.FI, 'while': TT.WHILE, 'do': TT.DO, 'done': TT.DONE,
        'for': TT.FOR, 'in': TT.IN, 'function': TT.FUNCTION,
      };
      const kw = kwMap[word.toLowerCase()];
      tokens.push({ type: kw || TT.WORD, value: word });
    }
  }
  tokens.push({ type: TT.EOF });
  return tokens;
}

// ---------------------------------------------------------------------------
// Shell factory
// ---------------------------------------------------------------------------
function createShell(router, filesystem, kernel, hostBridge) {
  // Environment (shell variables)
  const _env   = Object.create(null);
  const _funcs = Object.create(null);  // function name → body tokens

  // Seed from process.env
  Object.assign(_env, {
    HOME:    '/home/user',
    PATH:    '/bin:/usr/bin',
    SHELL:   'aios-shell',
    USER:    'aios',
    PWD:     filesystem ? filesystem.pwd() : '/',
    OLDPWD:  '/',
    PS1:     'aios:$PWD$ ',
    IFS:     ' \t\n',
    $$:      String(process.pid),
    '?':     '0',
  });

  // ---------------------------------------------------------------------------
  // Variable expansion
  // ---------------------------------------------------------------------------
  function _expand(str, args) {
    if (!str) return str;

    // $((arithmetic))
    str = str.replace(/\$\(\(([^)]+)\)\)/g, (_, expr) => {
      try {
        const expanded = _expand(expr, args);
        // Safe arithmetic eval — only numbers and operators
        if (/^[\d\s+\-*/%()]+$/.test(expanded)) {
          return String(Function('"use strict"; return (' + expanded + ')')());
        }
      } catch (_) {}
      return '0';
    });

    // $(command substitution)
    str = str.replace(/\$\(([^)]+)\)/g, (_, cmd) => {
      const r = _execSync(_expand(cmd, args));
      return (r.output || '').replace(/\n$/, '');
    });

    // ${VAR} and $VAR
    str = str.replace(/\$\{([^}]+)\}/g, (_, name) => _getVar(name, args));
    str = str.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*|\?|#|@|\*|\$|!|[0-9]+)/g, (_, name) => _getVar(name, args));

    return str;
  }

  function _getVar(name, args) {
    if (name === '?') return _env['?'] || '0';
    if (name === '$') return String(process.pid);
    if (name === '#') return String(args ? args.length : 0);
    if (name === '@' || name === '*') return args ? args.join(' ') : '';
    if (/^\d+$/.test(name)) {
      const idx = parseInt(name, 10);
      return args ? (args[idx] || '') : '';
    }
    return _env[name] !== undefined ? _env[name] : (process.env[name] || '');
  }

  // ---------------------------------------------------------------------------
  // Synchronous command execution (captures output as string)
  // ---------------------------------------------------------------------------
  function _execSync(cmdStr) {
    const lines = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // Intercept stdout temporarily
    let captured = '';
    process.stdout.write = (data) => { captured += String(data); return true; };
    try {
      const r = _runLine(cmdStr.trim(), []);
      // Flush any sync output
    } catch (_) {}
    process.stdout.write = origWrite;
    return { output: captured, ok: _env['?'] === '0' };
  }

  // ---------------------------------------------------------------------------
  // Run a pipeline segment (single command or builtin)
  // ---------------------------------------------------------------------------
  async function _runCmd(argv, redirects, context) {
    if (!argv || !argv.length) return { ok: true, output: '' };

    const name = argv[0];
    const args = argv.slice(1);

    // ── Shell builtins ──────────────────────────────────────────────────────
    if (name === 'echo') {
      const out = args.map(a => _expand(a, context && context.args)).join(' ');
      process.stdout.write(out + '\n');
      _env['?'] = '0';
      return { ok: true };
    }

    if (name === 'printf') {
      const fmt = args[0] || '';
      const fargs = args.slice(1);
      let result = _expand(fmt, context && context.args);
      result = result.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      // %s substitution
      let idx = 0;
      result = result.replace(/%s/g, () => fargs[idx++] || '');
      result = result.replace(/%d/g, () => String(parseInt(fargs[idx++] || '0', 10)));
      process.stdout.write(result);
      _env['?'] = '0';
      return { ok: true };
    }

    if (name === 'export') {
      args.forEach(a => {
        const eq = a.indexOf('=');
        if (eq > 0) {
          const k = a.slice(0, eq);
          const v = _expand(a.slice(eq + 1), context && context.args);
          _env[k] = v;
          process.env[k] = v;
        } else {
          process.env[a] = _env[a] || '';
        }
      });
      _env['?'] = '0';
      return { ok: true };
    }

    if (name === 'set' || name === 'declare') {
      if (!args.length) {
        Object.keys(_env).sort().forEach(k =>
          process.stdout.write(k + '=' + _env[k] + '\n')
        );
      } else {
        args.forEach(a => {
          const eq = a.indexOf('=');
          if (eq > 0) {
            _env[a.slice(0, eq)] = _expand(a.slice(eq + 1), context && context.args);
          }
        });
      }
      _env['?'] = '0';
      return { ok: true };
    }

    if (name === 'unset') {
      args.forEach(a => { delete _env[a]; delete process.env[a]; });
      _env['?'] = '0';
      return { ok: true };
    }

    if (name === 'cd') {
      const target = _expand(args[0] || _env.HOME || '/home/user', context && context.args);
      if (filesystem) {
        const oldpwd = filesystem.pwd();
        const r = filesystem.cd(target);
        if (r.ok) {
          _env.OLDPWD = oldpwd;
          _env.PWD = r.path;
          _env['?'] = '0';
        } else {
          process.stderr.write('cd: ' + r.error + '\n');
          _env['?'] = '1';
        }
      }
      return { ok: _env['?'] === '0' };
    }

    if (name === 'pwd') {
      const cwd = filesystem ? filesystem.pwd() : _env.PWD || '/';
      process.stdout.write(cwd + '\n');
      _env['?'] = '0';
      return { ok: true };
    }

    if (name === 'read') {
      // Non-interactive read — just returns empty (would block in interactive mode)
      const varName = args[0] || 'REPLY';
      _env[varName] = '';
      _env['?'] = '0';
      return { ok: true };
    }

    if (name === 'true')  { _env['?'] = '0'; return { ok: true }; }
    if (name === 'false') { _env['?'] = '1'; return { ok: false }; }

    if (name === 'sleep') {
      const secs = parseFloat(args[0]) || 1;
      await new Promise(r => setTimeout(r, secs * 1000));
      _env['?'] = '0';
      return { ok: true };
    }

    if (name === 'return') {
      const code = parseInt(args[0] || '0', 10);
      _env['?'] = String(code);
      const err = new Error('__return__');
      err.returnCode = code;
      throw err;
    }

    if (name === 'exit') {
      const code = parseInt(args[0] || '0', 10);
      if (kernel) kernel.shutdown();
      process.exit(code);
    }

    if (name === 'source' || name === '.') {
      const path = _expand(args[0] || '', context && context.args);
      return _sourceFile(path, args.slice(1));
    }

    if (name === 'test' || name === '[') {
      return _runTest(args, context);
    }

    if (name === 'alias') {
      // Simple alias store
      if (!_env.__aliases) _env.__aliases = '{}';
      const aliases = (() => { try { return JSON.parse(_env.__aliases); } catch(_) { return {}; } })();
      if (!args.length) {
        Object.keys(aliases).forEach(k => process.stdout.write(`alias ${k}='${aliases[k]}'\n`));
      } else {
        args.forEach(a => {
          const eq = a.indexOf('=');
          if (eq > 0) aliases[a.slice(0, eq)] = a.slice(eq+1).replace(/^'(.*)'$/, '$1');
        });
        _env.__aliases = JSON.stringify(aliases);
      }
      _env['?'] = '0';
      return { ok: true };
    }

    if (name === 'type') {
      const target = args[0] || '';
      let msg;
      if (router && router.getCommands().includes(target)) {
        msg = target + ' is an AIOS router command';
      } else {
        const which = require('child_process').spawnSync('which', [target], { encoding: 'utf8' });
        msg = which.stdout.trim() ? target + ' is ' + which.stdout.trim() : target + ': not found';
      }
      process.stdout.write(msg + '\n');
      _env['?'] = '0';
      return { ok: true };
    }

    // ── User-defined function call ──────────────────────────────────────────
    if (_funcs[name]) {
      try {
        await _runBody(_funcs[name], args);
        _env['?'] = '0';
      } catch (e) {
        if (e.returnCode !== undefined) _env['?'] = String(e.returnCode);
        else { _env['?'] = '1'; process.stderr.write(name + ': ' + e.message + '\n'); }
      }
      return { ok: _env['?'] === '0' };
    }

    // ── AIOS router command ─────────────────────────────────────────────────
    if (router) {
      const expandedArgs = args.map(a => _expand(a, context && context.args));
      const cmdStr = [name, ...expandedArgs].join(' ');
      try {
        const result = await router.handle(cmdStr, { fromShell: true, filesystem, kernel, hostBridge });
        if (result && result.result !== undefined && result.result !== '') {
          process.stdout.write(String(result.result) + '\n');
        }
        _env['?'] = result && result.status === 'error' ? '1' : '0';
        return { ok: _env['?'] === '0', result };
      } catch (e) {
        // fall through to host shell
      }
    }

    // ── Host shell fallback ─────────────────────────────────────────────────
    if (hostBridge) {
      const expandedArgs = args.map(a => _expand(a, context && context.args));
      const cmdStr = [name, ...expandedArgs].join(' ');
      const r = hostBridge.execShell(cmdStr);
      if (r.stdout) process.stdout.write(r.stdout.replace(/\n$/, '') + '\n');
      if (r.stderr) process.stderr.write(r.stderr.replace(/\n$/, '') + '\n');
      _env['?'] = r.ok ? '0' : String(r.code || 1);
      return { ok: r.ok };
    }

    process.stderr.write(name + ': command not found\n');
    _env['?'] = '127';
    return { ok: false };
  }

  // ---------------------------------------------------------------------------
  // test / [ builtin
  // ---------------------------------------------------------------------------
  function _runTest(args, _ctx) {
    // Remove trailing ] if present
    const targs = args[args.length - 1] === ']' ? args.slice(0, -1) : args;
    let result = false;
    if (targs.length === 1) {
      result = targs[0] !== '' && targs[0] !== '0';
    } else if (targs.length === 2 && targs[0] === '!') {
      result = !targs[1] || targs[1] === '' || targs[1] === '0';
    } else if (targs.length === 3) {
      const [a, op, b] = targs;
      switch (op) {
        case '=': case '==': result = a === b; break;
        case '!=':           result = a !== b; break;
        case '-eq':          result = parseInt(a,10) === parseInt(b,10); break;
        case '-ne':          result = parseInt(a,10) !== parseInt(b,10); break;
        case '-lt':          result = parseInt(a,10) <   parseInt(b,10); break;
        case '-le':          result = parseInt(a,10) <=  parseInt(b,10); break;
        case '-gt':          result = parseInt(a,10) >   parseInt(b,10); break;
        case '-ge':          result = parseInt(a,10) >=  parseInt(b,10); break;
        case '-z':           result = a === ''; break;
        case '-n':           result = a !== ''; break;
      }
    } else if (targs.length === 2) {
      const [flag, val] = targs;
      if (flag === '-f' && filesystem) {
        const s = filesystem.stat(val);
        result = s.ok && s.type === 'file';
      } else if (flag === '-d' && filesystem) {
        const s = filesystem.stat(val);
        result = s.ok && s.type === 'dir';
      } else if (flag === '-e' && filesystem) {
        result = filesystem.stat(val).ok;
      } else if (flag === '-z') {
        result = val === '';
      } else if (flag === '-n') {
        result = val !== '';
      }
    }
    _env['?'] = result ? '0' : '1';
    return { ok: result };
  }

  // ---------------------------------------------------------------------------
  // Run a list of tokens as a body (if/while/for blocks, function bodies)
  // ---------------------------------------------------------------------------
  async function _runBody(tokens, args) {
    // Simple sequential runner — parse statements from tokens
    const src = tokens.map(t => t.value || '').join(' ');
    return runScript(src, args);
  }

  // ---------------------------------------------------------------------------
  // Source a file from AIOS VFS
  // ---------------------------------------------------------------------------
  async function _sourceFile(path, args) {
    if (!filesystem) return { ok: false };
    const r = filesystem.read(path);
    if (!r.ok) {
      process.stderr.write('source: ' + r.error + '\n');
      _env['?'] = '1';
      return { ok: false };
    }
    return runScript(r.content, args);
  }

  // ---------------------------------------------------------------------------
  // Parse and run a complete script string
  // ---------------------------------------------------------------------------
  async function runScript(src, args) {
    const lines = src.split('\n');
    const context = { args: args || [] };
    let i = 0;

    while (i < lines.length) {
      let line = lines[i].trim();

      // Skip empty / comment
      if (!line || line.startsWith('#')) { i++; continue; }

      // Variable assignment: VAR=value (no spaces around =)
      const assignMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/);
      if (assignMatch && !line.includes(' ')) {
        _env[assignMatch[1]] = _expand(assignMatch[2], args);
        _env['?'] = '0';
        i++;
        continue;
      }

      // if statement
      if (line.startsWith('if ') || line === 'if') {
        const block = _collectBlock(lines, i, 'if', 'fi');
        i = block.end + 1;
        await _execIf(block.lines, args);
        continue;
      }

      // while loop
      if (line.startsWith('while ') || line === 'while') {
        const block = _collectBlock(lines, i, 'while', 'done');
        i = block.end + 1;
        await _execWhile(block.lines, args);
        continue;
      }

      // for loop
      if (line.startsWith('for ') || line === 'for') {
        const block = _collectBlock(lines, i, 'for', 'done');
        i = block.end + 1;
        await _execFor(block.lines, args);
        continue;
      }

      // function definition
      const funcMatch = line.match(/^(?:function\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*\)\s*\{?\s*$/);
      if (funcMatch) {
        const block = _collectBlock(lines, i, '{', '}');
        _funcs[funcMatch[1]] = block.lines.map(l => ({ value: l }));
        i = block.end + 1;
        continue;
      }

      // Regular command(s) — handle ; separated commands on one line
      const stmts = _splitStatements(line);
      for (const stmt of stmts) {
        const expanded = _expand(stmt.trim(), args);
        if (expanded) await _runStatement(expanded, context);
      }
      i++;
    }
    return { ok: _env['?'] === '0' };
  }

  // ---------------------------------------------------------------------------
  // Split a line on ; (respecting quotes)
  // ---------------------------------------------------------------------------
  function _splitStatements(line) {
    const parts = [];
    let cur = '';
    let inQ = false, inDQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "'" && !inDQ) inQ = !inQ;
      else if (c === '"' && !inQ) inDQ = !inDQ;
      else if (c === ';' && !inQ && !inDQ) { parts.push(cur); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
  }

  // ---------------------------------------------------------------------------
  // Collect a multi-line block (if..fi, while..done, function body)
  // ---------------------------------------------------------------------------
  function _collectBlock(lines, startIdx, openKw, closeKw) {
    const collected = [];
    let depth = 1;
    let i = startIdx;
    while (i < lines.length) {
      const l = lines[i].trim();
      if (i > startIdx) {
        // check for nested open
        if (l.startsWith(openKw + ' ') || l === openKw || l.startsWith('function ')) depth++;
        if (l === closeKw || l.startsWith(closeKw + ' ') || l.startsWith(closeKw + ';')) depth--;
        if (depth === 0) return { lines: collected, end: i };
        collected.push(lines[i]);
      } else {
        collected.push(lines[i]);
      }
      i++;
    }
    return { lines: collected, end: i - 1 };
  }

  // ---------------------------------------------------------------------------
  // Execute if block
  // ---------------------------------------------------------------------------
  async function _execIf(lines, args) {
    // Find then / else / elif / fi boundaries
    let condLines = [], thenLines = [], elseLines = [];
    let phase = 'cond';
    for (const l of lines) {
      const t = l.trim();
      if (t === 'then' || t.endsWith('; then')) { phase = 'then'; continue; }
      if (t === 'else') { phase = 'else'; continue; }
      if (t === 'fi')   { break; }
      if (phase === 'cond') condLines.push(l);
      else if (phase === 'then') thenLines.push(l);
      else if (phase === 'else') elseLines.push(l);
    }
    // Run condition
    const condSrc = condLines.map(l => l.trim().replace(/^if\s+/, '')).join(' ');
    await _runStatement(_expand(condSrc, args), { args });
    const condOk = _env['?'] === '0';
    if (condOk) {
      await runScript(thenLines.join('\n'), args);
    } else if (elseLines.length) {
      await runScript(elseLines.join('\n'), args);
    }
  }

  // ---------------------------------------------------------------------------
  // Execute while loop
  // ---------------------------------------------------------------------------
  async function _execWhile(lines, args) {
    let condLines = [], bodyLines = [];
    let phase = 'cond';
    for (const l of lines) {
      const t = l.trim();
      if (t === 'do' || t.endsWith('; do')) { phase = 'body'; continue; }
      if (t === 'done') break;
      if (phase === 'cond') condLines.push(l);
      else bodyLines.push(l);
    }
    const condSrc = condLines.map(l => l.trim().replace(/^while\s+/, '')).join(' ');
    let iterations = 0;
    const MAX_ITER = 100000;
    while (iterations++ < MAX_ITER) {
      await _runStatement(_expand(condSrc, args), { args });
      if (_env['?'] !== '0') break;
      await runScript(bodyLines.join('\n'), args);
    }
  }

  // ---------------------------------------------------------------------------
  // Execute for loop
  // ---------------------------------------------------------------------------
  async function _execFor(lines, args) {
    const header = lines[0] ? lines[0].trim() : '';
    // for VAR in word1 word2 ...; do
    const m = header.match(/^for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+(.+?)\s*(?:;|do|$)/);
    if (!m) return;
    const varName = m[1];
    const wordSrc = _expand(m[2], args);
    const words   = wordSrc.split(/\s+/).filter(Boolean);
    const bodyLines = lines.slice(1).filter(l => {
      const t = l.trim();
      return t !== 'do' && t !== 'done';
    });
    for (const word of words) {
      _env[varName] = word;
      await runScript(bodyLines.join('\n'), args);
    }
  }

  // ---------------------------------------------------------------------------
  // Run a single statement string (handles pipes, &&, ||, &)
  // ---------------------------------------------------------------------------
  async function _runStatement(stmt, context) {
    if (!stmt || !stmt.trim()) return;
    const trimmed = stmt.trim();

    // Background execution
    if (trimmed.endsWith('&')) {
      const bgCmd = trimmed.slice(0, -1).trim();
      setImmediate(async () => {
        try { await _runPipeline(bgCmd, context); } catch(_) {}
      });
      _env['?'] = '0';
      return;
    }

    // AND chain: cmd1 && cmd2
    if (trimmed.includes(' && ')) {
      const parts = trimmed.split(' && ');
      for (const p of parts) {
        await _runStatement(p.trim(), context);
        if (_env['?'] !== '0') return;
      }
      return;
    }

    // OR chain: cmd1 || cmd2
    if (trimmed.includes(' || ')) {
      const parts = trimmed.split(' || ');
      for (const p of parts) {
        await _runStatement(p.trim(), context);
        if (_env['?'] === '0') return;
      }
      return;
    }

    await _runPipeline(trimmed, context);
  }

  // ---------------------------------------------------------------------------
  // Run a pipeline: cmd1 | cmd2 | cmd3
  // ---------------------------------------------------------------------------
  async function _runPipeline(stmt, context) {
    // Split on pipe (not inside quotes)
    const segments = _splitPipe(stmt);

    if (segments.length === 1) {
      await _runSingleCmd(segments[0].trim(), context);
      return;
    }

    // Pipe chain: capture each segment's stdout and pass to next
    let pipeInput = null;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i].trim();
      const isLast = i === segments.length - 1;
      const captured = await _captureCmd(seg, context, pipeInput);
      if (!isLast) {
        pipeInput = captured;
      } else {
        // Last segment — print to stdout
        if (captured) process.stdout.write(captured);
      }
    }
  }

  function _splitPipe(stmt) {
    const parts = [];
    let cur = '', inQ = false, inDQ = false;
    for (let i = 0; i < stmt.length; i++) {
      const c = stmt[i];
      if (c === "'" && !inDQ) inQ = !inQ;
      else if (c === '"' && !inQ) inDQ = !inDQ;
      else if (c === '|' && !inQ && !inDQ && stmt[i+1] !== '|') {
        parts.push(cur); cur = ''; continue;
      }
      cur += c;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
  }

  // Capture command output as a string (for pipes)
  async function _captureCmd(cmdStr, context, inputStr) {
    let captured = '';
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (data) => { captured += String(data); return true; };
    try {
      // If there's pipe input, set it as $PIPE_INPUT variable
      if (inputStr !== null && inputStr !== undefined) {
        _env.PIPE_INPUT = inputStr;
        // Many standard tools (grep, sort, etc.) read stdin — handle common cases
        await _runSingleCmd(cmdStr, context, inputStr);
      } else {
        await _runSingleCmd(cmdStr, context, null);
      }
    } finally {
      process.stdout.write = orig;
    }
    return captured;
  }

  // ---------------------------------------------------------------------------
  // Run a single command (possibly with redirects)
  // ---------------------------------------------------------------------------
  async function _runSingleCmd(cmdStr, context, pipeInput) {
    // Handle redirects
    let stdout_file = null, stdout_append = false, stdin_file = null;
    let cleaned = cmdStr;

    const redir_out    = cmdStr.match(/\s+>>\s+(\S+)/);
    const redir_append = cmdStr.match(/\s+>>\s+/);
    const redir_in     = cmdStr.match(/\s+<\s+(\S+)/);
    const redir_out1   = cmdStr.match(/\s+>\s+(\S+)/);

    if (redir_append && redir_out) {
      stdout_file = _expand(redir_out[1], context && context.args);
      stdout_append = true;
      cleaned = cleaned.replace(/\s+>>\s+\S+/, '');
    } else if (redir_out1) {
      stdout_file = _expand(redir_out1[1], context && context.args);
      cleaned = cleaned.replace(/\s+>\s+\S+/, '');
    }
    if (redir_in) {
      stdin_file = _expand(redir_in[1], context && context.args);
      cleaned = cleaned.replace(/\s+<\s+\S+/, '');
    }

    // Parse argv with word splitting
    const argv = _parseArgv(cleaned.trim(), context);
    if (!argv.length) return;

    // Variable assignment: VAR=value or VAR+=value (must check here too,
    // so that semicolon-split statements like "A=1; B=2" work correctly)
    if (argv.length === 1) {
      const assignMatch = argv[0].match(/^([a-zA-Z_][a-zA-Z0-9_]*)(\+?=)(.*)$/);
      if (assignMatch) {
        const [, k, op, v] = assignMatch;
        _env[k] = op === '+=' ? ((_env[k] || '') + v) : v;
        _env['?'] = '0';
        return;
      }
    }

    // Redirect stdout to file
    if (stdout_file) {
      let out = '';
      const orig = process.stdout.write.bind(process.stdout);
      process.stdout.write = (d) => { out += String(d); return true; };
      await _runCmd(argv, {}, context);
      process.stdout.write = orig;
      if (filesystem) {
        if (stdout_append) filesystem.append(stdout_file, out);
        else               filesystem.write(stdout_file, out);
      }
    } else if (pipeInput !== null && pipeInput !== undefined) {
      // Inject pipe input for common pipeline commands
      await _runCmdWithInput(argv, pipeInput, context);
    } else {
      await _runCmd(argv, {}, context);
    }
  }

  // Handle pipe input for common commands (grep, sort, head, tail, wc, etc.)
  async function _runCmdWithInput(argv, input, context) {
    const name = argv[0];
    const args = argv.slice(1);
    const lines = input.split('\n').filter(l => l !== '');

    switch (name) {
      case 'grep': {
        const pattern = args[0] || '';
        const flags   = args.includes('-i') ? 'i' : '';
        const re = new RegExp(pattern, flags);
        const invert = args.includes('-v');
        const count  = args.includes('-c');
        const matched = lines.filter(l => invert ? !re.test(l) : re.test(l));
        if (count) {
          process.stdout.write(String(matched.length) + '\n');
        } else {
          matched.forEach(l => process.stdout.write(l + '\n'));
        }
        _env['?'] = matched.length ? '0' : '1';
        return;
      }
      case 'sort': {
        const sorted = [...lines].sort();
        if (args.includes('-r')) sorted.reverse();
        if (args.includes('-u')) {
          const seen = new Set();
          sorted.filter(l => { if (seen.has(l)) return false; seen.add(l); return true; })
                .forEach(l => process.stdout.write(l + '\n'));
        } else {
          sorted.forEach(l => process.stdout.write(l + '\n'));
        }
        _env['?'] = '0';
        return;
      }
      case 'head': {
        const n = parseInt(args[args.indexOf('-n')+1] || args.find(a => /^\d+$/.test(a)) || '10', 10);
        lines.slice(0, n).forEach(l => process.stdout.write(l + '\n'));
        _env['?'] = '0';
        return;
      }
      case 'tail': {
        const n = parseInt(args[args.indexOf('-n')+1] || args.find(a => /^\d+$/.test(a)) || '10', 10);
        lines.slice(-n).forEach(l => process.stdout.write(l + '\n'));
        _env['?'] = '0';
        return;
      }
      case 'wc': {
        const byLines = args.includes('-l');
        const byWords = args.includes('-w');
        const byChars = args.includes('-c') || args.includes('-m');
        if (!byLines && !byWords && !byChars) {
          process.stdout.write(`${lines.length} ${input.split(/\s+/).filter(Boolean).length} ${input.length}\n`);
        } else {
          if (byLines) process.stdout.write(String(lines.length) + '\n');
          if (byWords) process.stdout.write(String(input.split(/\s+/).filter(Boolean).length) + '\n');
          if (byChars) process.stdout.write(String(input.length) + '\n');
        }
        _env['?'] = '0';
        return;
      }
      case 'uniq': {
        const uniqLines = lines.filter((l, i) => i === 0 || l !== lines[i-1]);
        uniqLines.forEach(l => process.stdout.write(l + '\n'));
        _env['?'] = '0';
        return;
      }
      case 'tr': {
        const from = (args[0] || '').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        const to   = (args[1] || '').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        let out = input;
        if (args.includes('-d')) {
          // delete chars
          out = input.split('').filter(c => !from.includes(c)).join('');
        } else {
          for (let i = 0; i < from.length; i++) {
            out = out.split(from[i]).join(to[i] || '');
          }
        }
        process.stdout.write(out);
        _env['?'] = '0';
        return;
      }
      case 'awk': {
        // Very minimal awk: print $N
        const prog = args.find(a => !a.startsWith('-')) || '{print}';
        const printField = prog.match(/\{print \$(\d+)\}/);
        lines.forEach(l => {
          if (printField) {
            const fields = l.split(/\s+/);
            process.stdout.write((fields[parseInt(printField[1],10) - 1] || '') + '\n');
          } else {
            process.stdout.write(l + '\n');
          }
        });
        _env['?'] = '0';
        return;
      }
      case 'sed': {
        const expr = args.find(a => !a.startsWith('-')) || '';
        const subMatch = expr.match(/^s\/([^/]*)\/([^/]*)\/([gi]*)$/);
        if (subMatch) {
          const re = new RegExp(subMatch[1], subMatch[3].includes('g') ? 'g' : '');
          lines.forEach(l => process.stdout.write(l.replace(re, subMatch[2]) + '\n'));
        } else {
          lines.forEach(l => process.stdout.write(l + '\n'));
        }
        _env['?'] = '0';
        return;
      }
      case 'cut': {
        const delimIdx = args.indexOf('-d');
        const delim = delimIdx >= 0 ? args[delimIdx+1] : '\t';
        const fieldIdx = args.indexOf('-f');
        const field = fieldIdx >= 0 ? parseInt(args[fieldIdx+1], 10) - 1 : 0;
        lines.forEach(l => process.stdout.write((l.split(delim)[field] || '') + '\n'));
        _env['?'] = '0';
        return;
      }
      case 'xargs': {
        const xcmd = args[0] || 'echo';
        const xargs2 = args.slice(1);
        const allArgs = lines.join(' ').split(/\s+/).filter(Boolean);
        const fullCmd = [xcmd, ...xargs2, ...allArgs].join(' ');
        await _runStatement(fullCmd, context);
        return;
      }
      default:
        // Fall through to normal command execution
        await _runCmd(argv, {}, context);
    }
  }

  // ---------------------------------------------------------------------------
  // Parse a command string into an argv array (handles quotes, backslash)
  // ---------------------------------------------------------------------------
  function _parseArgv(cmdStr, context) {
    const argv = [];
    let cur = '';
    let inQ = false, inDQ = false;
    for (let i = 0; i < cmdStr.length; i++) {
      const c = cmdStr[i];
      if (c === "'" && !inDQ) { inQ = !inQ; continue; }
      if (c === '"' && !inQ)  { inDQ = !inDQ; continue; }
      if (c === '\\' && !inQ && i+1 < cmdStr.length) { cur += cmdStr[++i]; continue; }
      if ((c === ' ' || c === '\t') && !inQ && !inDQ) {
        if (cur) { argv.push(cur); cur = ''; }
        continue;
      }
      cur += c;
    }
    if (cur) argv.push(cur);

    // Expand variables in each arg (unless single-quoted)
    return argv.map(a => _expand(a, context && context.args));
  }

  // Placeholder for sync exec (used in $() substitution)
  function _runLine(cmdStr, args) {
    // Best-effort synchronous execution via host bridge
    if (hostBridge) {
      const r = hostBridge.execShell(cmdStr);
      if (r.stdout) process.stdout.write(r.stdout);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  return {
    name:       'shell',
    version:    '2.0.0',
    runScript,
    runLine:    (line, args) => _runStatement(_expand(line, args), { args: args || [] }),
    sourceFile: _sourceFile,
    getEnv:     () => Object.assign({}, _env),
    setVar:     (k, v) => { _env[k] = String(v); },
    getVar:     (k) => _env[k],
    expand:     (s) => _expand(s, []),
    commands: {
      sh: async (args) => {
        if (!args.length) return { status: 'error', result: 'Usage: sh <script-path> [args...]' };
        const path = args[0];
        const r = filesystem ? filesystem.read(path) : { ok: false, error: 'No filesystem' };
        if (!r.ok) return { status: 'error', result: r.error };
        try {
          await runScript(r.content, args.slice(1));
          return { status: 'ok', result: '' };
        } catch (e) {
          return { status: 'error', result: e.message };
        }
      },
      source: async (args) => {
        if (!args.length) return { status: 'error', result: 'Usage: source <script-path>' };
        const r = await _sourceFile(args[0], args.slice(1));
        return r.ok ? { status: 'ok', result: '' } : { status: 'error', result: 'source failed' };
      },
      env: (args) => {
        const lines = Object.entries(_env)
          .filter(([k]) => !k.startsWith('__'))
          .map(([k, v]) => k + '=' + v);
        return { status: 'ok', result: lines.join('\n') };
      },
    },
  };
}

module.exports = { createShell };
