'use strict';
/**
 * help-window.js — AIOS Help Window System v4.0.0
 *
 * Full-screen interactive help for the AIOS shell.
 * Fits 80x24 terminal (Termux-compatible).
 *
 * Navigation:
 *   A-H, Q      : select category / quit
 *   Arrow keys  : move cursor
 *   ENTER       : open selected item
 *   ESC         : back one level
 *   H           : home (main menu)
 *   PageUp/Down : scroll long content
 *
 * Zero external npm dependencies. Pure Node.js CommonJS.
 */

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
const COLS      = 80;
const ROWS      = 24;
const IW        = 78;   // inner width between border chars
const CONTENT_H = 18;   // usable content rows
const HELP_VER  = '4.0.0';

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------
const ANSI = process.stdout.isTTY !== false;
function esc(s)     { return ANSI ? `\x1b[${s}` : ''; }
function ansi(c, t) { return ANSI ? `\x1b[${c}m${t}\x1b[0m` : t; }

const A = {
  clear:  () => esc('2J') + esc('H'),
  hide:   () => esc('?25l'),
  show:   () => esc('?25h'),
  bold:   t  => ansi('1',    t),
  dim:    t  => ansi('2',    t),
  inv:    t  => ansi('7',    t),
  yellow: t  => ansi('33',   t),
  cyan:   t  => ansi('36',   t),
  bYellow:t  => ansi('1;33', t),
  bCyan:  t  => ansi('1;36', t),
  bGreen: t  => ansi('1;32', t),
  bWhite: t  => ansi('1;37', t),
};

function rawLen(s) { return s.replace(/\x1b\[[0-9;]*m/g, '').length; }
function pad(s, w) { return s + ' '.repeat(Math.max(0, w - rawLen(s))); }
function clip(s, w) { return s.length <= w ? s : s.slice(0, w - 1) + '\u2026'; }

// ---------------------------------------------------------------------------
// Frame drawing
// ---------------------------------------------------------------------------
const B = { tl:'╔', tr:'╗', bl:'╚', br:'╝', h:'═', v:'║', ml:'╠', mr:'╣' };

const fTop   = () => A.cyan(B.tl + B.h.repeat(IW) + B.tr);
const fSep   = () => A.cyan(B.ml + B.h.repeat(IW) + B.mr);
const fBot   = () => A.cyan(B.bl + B.h.repeat(IW) + B.br);
const fBlank = () => A.cyan(B.v) + ' '.repeat(IW) + A.cyan(B.v);
const fHRule = () => '  ' + A.dim('─'.repeat(IW - 4)) + '  ';

function fRow(content, selected) {
  const inner = ' ' + (selected ? A.inv(pad(content, IW - 2)) : pad(content, IW - 2)) + ' ';
  return A.cyan(B.v) + inner + A.cyan(B.v);
}

function fTitle(left, right) {
  const l = ' ' + A.bCyan(left);
  const r = right ? A.dim(right) + ' ' : '';
  const gap = IW - rawLen(l) - rawLen(r);
  return A.cyan(B.v) + l + ' '.repeat(Math.max(0, gap)) + r + A.cyan(B.v);
}

function fNavBar(msg) {
  const inner = pad(' ' + A.dim(msg), IW - 1) + ' ';
  return A.cyan(B.v) + inner + A.cyan(B.v);
}

// ---------------------------------------------------------------------------
// Command database — PURPOSE / USAGE / NOTES for every command
// ---------------------------------------------------------------------------
const CMD_DB = {
  ai: {
    purpose: 'Natural language AI engine. Routes your text to the active AIOS AI backend.',
    usage:   ['ai <query>', 'ai status', 'ai log', 'ai help'],
    notes:   ['Routes through configured backends (AIOS, AURA, Jarvis).', 'Requires Ollama running for live AI; kernel works fully offline.', 'Use `ai status` to inspect backend health and circuit breaker state.'],
  },
  aios: {
    purpose: 'AIOS personality AI — the always-on kernel intelligence layer.',
    usage:   ['aios <question>', 'aios status', 'aios clear', 'aios help'],
    notes:   ['Phone-first models: qwen2:0.5b → tinyllama → phi3.', 'Multi-turn conversation with persistent history.', 'Use `aios clear` to reset conversation context.'],
  },
  aura: {
    purpose: 'AURA hardware-intelligence AI — on-demand system analysis.',
    usage:   ['aura <question>', 'aura status', 'svc start aura', 'svc stop aura'],
    notes:   ['On-demand: start with `svc start aura`.', 'Specialises in hardware diagnostics and system analysis.', 'Models: phi3 → llama3 → mistral.'],
  },
  capabilities: {
    purpose: 'Display current AIOS capability tokens and the active privilege level.',
    usage:   ['capabilities', 'capabilities check <token>'],
    notes:   ['Tokens gate privileged operations (host:shell, host:root, etc.).', 'Level: user → operator → admin → root.', 'Use `su <level>` to change privilege level.'],
  },
  cat: {
    purpose: 'Print the contents of a file from the AIOS virtual filesystem.',
    usage:   ['cat <path>'],
    notes:   ['Reads from the in-memory AIOS VFS, not the host filesystem.', 'Use `!cat <path>` to read a real host file.', 'Returns an error if the path does not exist.'],
  },
  cd: {
    purpose: 'Change the current working directory in the AIOS virtual filesystem.',
    usage:   ['cd <path>', 'cd /'],
    notes:   ['Supports absolute and relative paths.', 'CWD is shown in the shell prompt automatically.', 'Use `pwd` to print the current directory.'],
  },
  chat: {
    purpose: 'Conversational AI — direct chat interface through the consciousness layer.',
    usage:   ['chat <message>'],
    notes:   ['Routes through consciousness layer in "chat" mode.', 'Session context is maintained while the terminal is open.', 'Alternative: `mode chat` then `ai <message>`.'],
  },
  collective: {
    purpose: 'Collective intelligence — multi-model perspective synthesis.',
    usage:   ['collective', 'collective status', 'collective log', 'collective ask <topic>'],
    notes:   ['Aggregates responses from multiple AI models.', 'Tracks per-model contribution counts.', 'Use `collective ask <topic>` to get a synthesised answer.'],
  },
  consciousness: {
    purpose: 'AIOS consciousness layer — unified AI context management.',
    usage:   ['consciousness', 'consciousness status', 'consciousness context', 'consciousness learn <fact>'],
    notes:   ['Manages mode, memory, and model health as one context.', 'Use `consciousness learn <fact>` to teach AIOS new information.', 'Use `consciousness proactive on|off` to toggle proactive suggestions.'],
  },
  cp: {
    purpose: 'Copy a file within the AIOS virtual filesystem.',
    usage:   ['cp <source> <destination>'],
    notes:   ['Both paths must be within the AIOS VFS.', 'Creates or overwrites the destination file.', 'Directories are not recursively copied.'],
  },
  cpu: {
    purpose: 'AIOSCPU virtual CPU — run programs, inspect registers, and run demos.',
    usage:   ['cpu demo', 'cpu run <program>', 'cpu status', 'cpu registers'],
    notes:   ['Executes AIOS instruction-set programs inside a virtual CPU.', 'Supports NEG, ABS, INC, DEC and standard arithmetic opcodes.', 'Syscalls bridge the virtual CPU to the AIOS kernel.'],
  },
  date: {
    purpose: 'Display the current date and time in ISO 8601 format.',
    usage:   ['date'],
    notes:   ['Returns UTC time from the Node.js runtime.', 'No arguments accepted; output is always ISO format.', 'Use `!date` to invoke the real host date command.'],
  },
  df: {
    purpose: 'Display real host disk usage via the host bridge.',
    usage:   ['df', 'df <path>'],
    notes:   ['Runs `df -h` on the real host OS.', 'Reflects actual storage — not the AIOS VFS.', 'Returns an error if the host `df` command is unavailable.'],
  },
  diagnostics: {
    purpose: 'AIOS diagnostics engine — health checks for models, ports, and system.',
    usage:   ['diagnostics', 'diagnostics status', 'diagnostics models', 'diagnostics ports'],
    notes:   ['Monitors all registered AI model HTTP endpoints.', 'Reports health for TCP ports and HTTP services.', 'Use `diagnostics start` / `diagnostics stop` to control monitoring.'],
  },
  echo: {
    purpose: 'Print text to the terminal output.',
    usage:   ['echo <text>'],
    notes:   ['Built-in router command — always available.', 'Arguments are joined with spaces and printed.', 'Useful for testing and shell scripting.'],
  },
  env: {
    purpose: 'Display or modify AIOS environment variables.',
    usage:   ['env', 'env get <KEY>', 'env set <KEY> <value>', 'env unset <KEY>', 'env reload'],
    notes:   ['Loads from /etc/aios/env.conf on first access.', 'Variables affect AI models, ports, and mode settings.', 'Use `export KEY=VALUE` to export a variable.'],
  },
  export: {
    purpose: 'Export a key-value pair to the AIOS environment.',
    usage:   ['export KEY=VALUE', 'export OLLAMA_HOST=localhost:11434'],
    notes:   ['Sets the variable in the environment loader.', 'Changes persist for the current session only.', 'Use `env reload` to restore from /etc/aios/env.conf.'],
  },
  free: {
    purpose: 'Display real host memory usage (total, used, free) in megabytes.',
    usage:   ['free'],
    notes:   ['Reads /proc/meminfo on Linux or uses Node.js os.freemem().', 'Reports AIOS host memory, not the virtual memory model.', 'For VRAM/VMEM stats use `memory stats` or `memcore stats`.'],
  },
  help: {
    purpose: 'Open the AIOS interactive help window (this system).',
    usage:   ['help', 'help <command>'],
    notes:   ['`help` alone opens the full TUI help window.', '`help <command>` prints a quick plain-text reference.', 'Navigation: A-H select category, Q quit, ESC back, H home.'],
  },
  hostname: {
    purpose: 'Display the AIOS system hostname from /etc/hostname.',
    usage:   ['hostname'],
    notes:   ['Reads /etc/hostname from the AIOS VFS.', 'Default hostname is "aioscpu".', 'To change: `write /etc/hostname <new-name>`.'],
  },
  ifconfig: {
    purpose: 'Display network interface information via the host bridge.',
    usage:   ['ifconfig'],
    notes:   ['Runs `ip addr` or `ifconfig` on the real host.', 'Output reflects actual host network interfaces.', 'For AI mesh agents see `mesh status`.'],
  },
  init: {
    purpose: 'AIOS PID-1 boot init — manage system targets and service units.',
    usage:   ['init status', 'init targets', 'init start <target>', 'init stop <target>'],
    notes:   ['Controls systemd-like targets: sysinit, basic, multi-user.', 'Service units are loaded from /etc/aios/services/*.json.', 'Use `svc` for fine-grained service control.'],
  },
  kernel: {
    purpose: 'AIOS software kernel — inspect state, modules, and syscalls.',
    usage:   ['kernel', 'kernel status', 'kernel modules', 'kernel syscalls', 'kernel health'],
    notes:   ['Shows kernel ID, uptime, error codes, and loaded modules.', 'v4.0.0 includes panic/assert, DependencyGraph, health-check registry.', 'Module list reflects all components loaded via kernel.modules.load().'],
  },
  kill: {
    purpose: 'Terminate a virtual or kernel process by PID.',
    usage:   ['kill <pid>'],
    notes:   ['Tries virtual processes first, then kernel process table.', 'Virtual PIDs are visible in `ps` output.', 'Does not signal real host processes by default.'],
  },
  loop: {
    purpose: 'Loop engine — start, stop, and query the AIOS self-loop controller.',
    usage:   ['loop status', 'loop start', 'loop stop', 'loop tick'],
    notes:   ['Drives autonomous OS self-optimisation cycles.', 'Runs on the AIOS process model scheduler.', 'Use `loop status` to see current state and tick count.'],
  },
  ls: {
    purpose: 'List directory contents in the AIOS virtual filesystem.',
    usage:   ['ls', 'ls <path>'],
    notes:   ['Displays type (d=dir, -=file) and name.', 'Defaults to the current working directory.', 'Use `tree` for a full recursive view.'],
  },
  memcore: {
    purpose: 'Memory core — unified cognitive memory layer for all AI model outputs.',
    usage:   ['memcore', 'memcore stats', 'memcore recall <query>', 'memcore learn <key> <value>'],
    notes:   ['All AI model outputs are automatically recorded here.', 'Use `memcore recall <query>` to search memory entries.', 'Use `memcore stats` to view entry counts and learned patterns.'],
  },
  memory: {
    purpose: 'Memory engine — interaction history, queries, and learning data.',
    usage:   ['memory', 'memory stats', 'memory query <text>', 'memory facts'],
    notes:   ['Persists across sessions via /var/lib/aios/memory.json.', 'Tracks AI interactions, factual learning, and command history.', 'Use `memory facts` to view all learned knowledge entries.'],
  },
  mesh: {
    purpose: 'AI mesh network — manage the multi-model remote agent network.',
    usage:   ['mesh', 'mesh status', 'mesh ask <query>', 'mesh agents'],
    notes:   ['Connects to 7 open-source models via llama.cpp / Ollama.', 'Agents: speed, chat, logic, reason, code, multi, write.', 'Circuit breakers auto-trip unhealthy agents.'],
  },
  mirror: {
    purpose: 'Mirror session — create and manage real OS mirror sessions.',
    usage:   ['mirror status', 'mirror create', 'mirror destroy', 'mirror list'],
    notes:   ['Mirrors a real host directory tree into the AIOS VFS.', 'Changes in the mirror can be replayed on the host.', 'Use `mirror list` to view all active sessions.'],
  },
  mkdir: {
    purpose: 'Create a directory in the AIOS virtual filesystem.',
    usage:   ['mkdir <path>', 'mkdir -p <path>'],
    notes:   ['Use `-p` to create parent directories as needed.', 'Returns an error if the path already exists without `-p`.', 'Paths are within the AIOS VFS only.'],
  },
  mode: {
    purpose: 'Operation mode manager — switch AIOS between AI operating modes.',
    usage:   ['mode', 'mode <name>', 'mode list'],
    notes:   ['Modes: chat, code, fix, help, learn, reason.', 'Each mode changes the AI system prompt and response style.', 'Use `mode list` to see all modes with descriptions.'],
  },
  models: {
    purpose: 'AI model registry — list, register, discover, and health-check models.',
    usage:   ['models', 'models list', 'models discover', 'models health', 'models register <name> <type>'],
    notes:   ['Discovers Ollama models via HTTP at localhost:11434.', 'Health checks verify each model is responding correctly.', 'Use `models discover` to auto-populate from a running Ollama server.'],
  },
  mv: {
    purpose: 'Move or rename a file in the AIOS virtual filesystem.',
    usage:   ['mv <source> <destination>'],
    notes:   ['Moves within the VFS only — does not touch host files.', 'Source file is removed after a successful move.', 'Returns an error if the source does not exist.'],
  },
  pkg: {
    purpose: 'Package manager bridge — install, remove, list, and update host packages.',
    usage:   ['pkg install <package>', 'pkg remove <package>', 'pkg list', 'pkg update'],
    notes:   ['Runs `pkg` or `apt` on the real host (Termux/Debian).', 'Requires network and host package manager availability.', 'AIOS modules can be upgraded separately via `upgrade`.'],
  },
  port: {
    purpose: 'AIOS port server — start/stop the single TCP communication port.',
    usage:   ['port', 'port status', 'port start', 'port stop', 'port request <json>'],
    notes:   ['Default port is 11435 (configurable via AIOS_PORT env var).', 'Accepts JSON command packets from external processes.', 'Use `port status` to see request and error counts.'],
  },
  procfs: {
    purpose: 'Process filesystem — read and navigate the AIOS /proc virtual tree.',
    usage:   ['procfs', 'procfs status', 'procfs read <path>', 'procfs list'],
    notes:   ['Populates /proc with live kernel, CPU, and process data.', 'Updated continuously by the procfs-updater service.', 'Use `procfs read /proc/meminfo` to read virtual /proc files.'],
  },
  ps: {
    purpose: 'List virtual and kernel processes, with optional real host processes.',
    usage:   ['ps', 'ps -a'],
    notes:   ['Shows vPID, PID, name, state, and layer (aios/kernel/host).', 'Use `ps -a` to include real host processes (up to 20 shown).', 'Kill a process with `kill <pid>`.'],
  },
  pwd: {
    purpose: 'Print the current working directory in the AIOS virtual filesystem.',
    usage:   ['pwd'],
    notes:   ['Returns the absolute VFS path.', 'Use `cd <path>` to change directory.', 'Shown automatically in the shell prompt.'],
  },
  rm: {
    purpose: 'Remove a file or directory from the AIOS virtual filesystem.',
    usage:   ['rm <path>', 'rm -r <path>'],
    notes:   ['Use `-r` for recursive directory removal.', 'No confirmation prompt — deletion is immediate.', 'Cannot be undone; use `snapshot` if you need a restore point.'],
  },
  sched: {
    purpose: 'Task scheduler — manage scheduled AIOS jobs.',
    usage:   ['sched', 'sched list', 'sched add <name> <interval_ms>', 'sched remove <name>'],
    notes:   ['Executes tasks at defined millisecond intervals.', 'Scheduler state is part of the AIOS process model.', 'Use `sched list` to view all registered tasks and states.'],
  },
  'self-model': {
    purpose: 'AIOS self-awareness layer — query and inspect the AIOS self-model.',
    usage:   ['self-model', 'self-model <question>'],
    notes:   ['Builds a real-time snapshot: identity, hardware, modules, history.', 'Recognises introspective questions: "what are you?", "what can you do?".', 'Use `self-model` alone to print the full self-snapshot.'],
  },
  selftest: {
    purpose: 'Run the AIOS system self-test suite to verify all core components.',
    usage:   ['selftest'],
    notes:   ['Tests kernel, CPU, filesystem, router, services, and AI layer.', 'Reports pass/fail for each component check.', 'Run after upgrades or config changes to verify system health.'],
  },
  shell: {
    purpose: 'AIOS shell interpreter — execute commands on the real host system.',
    usage:   ['shell <command>', 'shell ls -la /'],
    notes:   ['Passes commands to the host shell via the host bridge.', 'Both stdout and stderr are returned.', 'Equivalent to using the `!` prefix in the AIOS terminal.'],
  },
  stat: {
    purpose: 'Display metadata for a file or directory in the AIOS virtual filesystem.',
    usage:   ['stat <path>'],
    notes:   ['Returns type, name, created, and modified timestamps.', 'Output is formatted as JSON.', 'Returns an error if the path does not exist.'],
  },
  su: {
    purpose: 'Switch the current AIOS privilege level.',
    usage:   ['su', 'su <level>', 'su root', 'su user'],
    notes:   ['Levels: user, operator, admin, root.', 'Defaults to root when no level is specified.', 'Use `sudo <cmd>` to run a single command at elevated level.'],
  },
  sudo: {
    purpose: 'Execute a single command at root privilege level.',
    usage:   ['sudo <command> [args...]', 'sudo svc start ai-monitor'],
    notes:   ['Escalates to root, runs the command, then demotes back.', 'Privilege is restored automatically after the command completes.', 'All sudo invocations are logged to /var/log/audit.log.'],
  },
  svc: {
    purpose: 'Service manager — start, stop, restart, and query AIOS services.',
    usage:   ['svc list', 'svc start <name>', 'svc stop <name>', 'svc restart <name>', 'svc status <name>'],
    notes:   ['Built-in services: kernel-watchdog, cpu-idle, ai-monitor, procfs-updater.', 'AI services: aios-aura, jarvis-orchestrator.', 'Use `svc list` to see all services and their current state.'],
  },
  sysinfo: {
    purpose: 'Display real host system information via the host bridge.',
    usage:   ['sysinfo'],
    notes:   ['Shows hostname, platform, arch, CPU model, cores, uptime, Node.js version.', 'Data comes from the real host OS, not the AIOS VFS.', 'For AIOS-specific info use `kernel status` or `self-model`.'],
  },
  sysreport: {
    purpose: 'Generate a full AIOS system report covering all subsystems.',
    usage:   ['sysreport'],
    notes:   ['Covers: modules, modes, platform, memory, services, boot log, AI stats.', 'Useful for diagnosing boot or configuration issues.', 'Report is appended to /var/log/boot.log.'],
  },
  termux: {
    purpose: 'Termux host bridge — access Termux API features on Android.',
    usage:   ['termux', 'termux battery', 'termux wifi', 'termux notify <title> <msg>', 'termux vibrate [ms]'],
    notes:   ['Requires termux-api package: `pkg install termux-api`.', 'Shows Termux API availability when run without arguments.', 'Widget and boot scripts managed via `scripts/install-termux-widget.js`.'],
  },
  touch: {
    purpose: 'Create an empty file or update the modified timestamp of a VFS file.',
    usage:   ['touch <path>'],
    notes:   ['Creates the file with empty content if it does not exist.', 'Updates the modified timestamp if the file already exists.', 'Parent directory must already exist.'],
  },
  tree: {
    purpose: 'Display a recursive directory tree of the AIOS virtual filesystem.',
    usage:   ['tree', 'tree <path>'],
    notes:   ['Shows the full VFS tree from the given path (default: CWD).', 'Directories and files are displayed with indentation.', 'Useful for exploring the VFS after rootfs-builder runs.'],
  },
  uname: {
    purpose: 'Display AIOS kernel and platform identification string.',
    usage:   ['uname'],
    notes:   ['Format: AIOS UniKernel <version> AIOSCPU-Prototype-One node/<ver> <platform>.', 'Similar to Unix `uname -a` but for the AIOS environment.', 'For detailed hardware info use `sysinfo`.'],
  },
  units: {
    purpose: 'Convert values between common units (bytes, time).',
    usage:   ['units <value> <from> <to>', 'units 1024 B KB', 'units 1 GB MB', 'units 60 s m'],
    notes:   ['Supported: bytes (B/KB/MB/GB/TB), time (ms/s/m/h).', 'Unit names are case-insensitive.', 'Returns the converted value with the target unit label.'],
  },
  upgrade: {
    purpose: 'AIOS upgrade manager — check, plan, and apply component upgrades.',
    usage:   ['upgrade', 'upgrade plan', 'upgrade status', 'upgrade check', 'upgrade apply'],
    notes:   ['Tracks versions of all AIOS core components.', 'Use `upgrade check` to compare installed vs. available versions.', 'Use `upgrade apply` to install pending upgrades (requires network).'],
  },
  uptime: {
    purpose: 'Display AIOS kernel uptime and real host OS uptime in seconds.',
    usage:   ['uptime'],
    notes:   ['Shows both AIOS kernel uptime and host OS uptime.', 'AIOS uptime resets on each system restart.', 'For a formatted string the value is always in seconds.'],
  },
  version: {
    purpose: 'Display the AIOS system version string.',
    usage:   ['version'],
    notes:   ['Built-in router command — always available.', 'Returns the AIOS Router version.', 'For full system info use `kernel status` or `sysreport`.'],
  },
  vps: {
    purpose: 'Virtual process system — view and manage the AIOS virtual process table.',
    usage:   ['vps', 'vps list', 'vps spawn <name>', 'vps kill <vpid>'],
    notes:   ['Virtual processes run inside the AIOS process model layer.', 'Each vProcess has a virtual PID (vPID) separate from host PIDs.', 'Use `ps` for a combined view of virtual and kernel processes.'],
  },
  whoami: {
    purpose: 'Display current AIOS user identity and privilege level.',
    usage:   ['whoami'],
    notes:   ['Shows AIOS level, host root availability, capability count, and identity ID.', 'For full capability list use `capabilities`.', 'Identity is established during the AIOS boot sequence.'],
  },
  write: {
    purpose: 'Write text content to a file in the AIOS virtual filesystem.',
    usage:   ['write <path> <content...>'],
    notes:   ['Creates the file if it does not exist.', 'Overwrites existing content completely.', 'Use `cat <path>` to verify the written content.'],
  },
};

// ---------------------------------------------------------------------------
// Category definitions
// ---------------------------------------------------------------------------
const CATEGORIES = [
  {
    key: 'A', label: 'AIOS Core',
    commands: ['ai','aios','aura','chat','collective','consciousness','loop','memcore','memory','mesh','models','self-model','selftest','capabilities'],
  },
  {
    key: 'B', label: 'System/Kernel',
    commands: ['cpu','diagnostics','init','kernel','kill','mode','ps','procfs','sched','sysinfo','sysreport','upgrade','vps'],
  },
  {
    key: 'C', label: 'Filesystem',
    commands: ['cat','cd','cp','ls','mkdir','mv','pwd','rm','stat','touch','tree','write'],
  },
  {
    key: 'D', label: 'Network',
    commands: ['ifconfig','mirror','port','svc'],
  },
  {
    key: 'E', label: 'Environment',
    commands: ['date','df','echo','env','export','free','help','hostname','uname','units','uptime','version','whoami'],
  },
  {
    key: 'F', label: 'Execution/Privilege',
    commands: ['shell','stat','su','sudo','termux'],
  },
  {
    key: 'G', label: 'Add-Ons/Plugins',
    commands: [],
    isAddons: true,
  },
  {
    key: 'H', label: 'All Commands',
    commands: [],
    isAll: true,
  },
];

const ALL_CMDS = Object.keys(CMD_DB).sort();

// ---------------------------------------------------------------------------
// Addon/plugin definitions
// ---------------------------------------------------------------------------
const ADDONS = [
  {
    key:  'bash',
    name: 'bash — Bourne Again Shell',
    desc: 'Full bash shell. All standard bash builtins, scripts, and features available.',
    cmds: ['bash', 'bash -c <cmd>', 'bash <script.sh>', '!<bash-command>'],
  },
  {
    key:  'zsh',
    name: 'zsh — Z Shell',
    desc: 'Z Shell with extended glob, prompt themes, and plugin support. Install: `pkg install zsh`.',
    cmds: ['zsh', 'zsh -c <cmd>', 'zsh <script.zsh>'],
  },
  {
    key:  'python',
    name: 'python — Python 3 Interpreter',
    desc: 'Python 3 runtime. Run scripts, interactive REPL, pip packages. Install: `pkg install python`.',
    cmds: ['python', 'python -c <code>', 'python <script.py>', 'pip install <pkg>'],
  },
  {
    key:  'git',
    name: 'git — Version Control',
    desc: 'Git VCS for source management. Full git command set. Install: `pkg install git`.',
    cmds: ['git init', 'git clone <url>', 'git commit -m <msg>', 'git push / pull'],
  },
  {
    key:  'pkg',
    name: 'pkg — Termux Package Manager',
    desc: 'Termux/apt-based package manager. Use `pkg install <name>` to add tools and runtimes.',
    cmds: ['pkg install <package>', 'pkg uninstall <package>', 'pkg list-installed', 'pkg update'],
  },
];

// ---------------------------------------------------------------------------
// Screen renderers
// ---------------------------------------------------------------------------
function renderMain(selIdx) {
  const items = [
    ...CATEGORIES.map((c) => {
      let right;
      if (c.isAddons) right = 'bash:*, zsh:*, python:*, git:*, pkg:*';
      else if (c.isAll) right = '(complete alphabetical listing)';
      else right = clip(c.commands.slice(0, 4).join(', ') + (c.commands.length > 4 ? ' …' : ''), 34);
      return `${c.key})  ${c.label.padEnd(22)} ${right}`;
    }),
    'Q)  Quit Help',
  ];

  const lines = [];
  lines.push(fTop());
  lines.push(fTitle('AIOS HELP SYSTEM', `v${HELP_VER}`));
  lines.push(fSep());
  lines.push(fRow('  Select a category:'));
  lines.push(fBlank());
  items.forEach((item, i) => lines.push(fRow('  ' + item, i === selIdx)));
  while (lines.length < ROWS - 3) lines.push(fBlank());
  lines.push(fSep());
  lines.push(fNavBar('Keys: A\u2013H select \xb7 Q quit \xb7 \u2191\u2193 move \xb7 ENTER confirm \xb7 ESC back \xb7 H home'));
  lines.push(fBot());
  return lines;
}

function renderCategory(cat, selIdx, scroll) {
  const cmds = cat.isAll ? ALL_CMDS : cat.isAddons ? ADDONS.map(a => a.key + ':*') : cat.commands;
  const COL_W  = 16;
  const COLS_N = 4;
  const viewH  = CONTENT_H - 3;

  const gridRows = [];
  for (let i = 0; i < cmds.length; i += COLS_N) gridRows.push(cmds.slice(i, i + COLS_N));

  const maxScroll = Math.max(0, gridRows.length - viewH);
  const start     = Math.min(scroll, maxScroll);

  const lines = [];
  lines.push(fTop());
  lines.push(fTitle(`${cat.key}) ${cat.label}  \u2014 ${cmds.length} command${cmds.length !== 1 ? 's' : ''}`, `v${HELP_VER}`));
  lines.push(fSep());

  for (let r = 0; r < viewH; r++) {
    const rowIdx = start + r;
    if (rowIdx >= gridRows.length) { lines.push(fBlank()); continue; }
    const rowCmds = gridRows[rowIdx];
    const rowStart = rowIdx * COLS_N;
    let rowStr = '  ';
    rowCmds.forEach((cmd, ci) => {
      const cmdIdx = rowStart + ci;
      const cell   = pad(cmd, COL_W);
      rowStr += cmdIdx === selIdx ? A.inv(cell) + ' ' : A.bYellow(cell) + ' ';
    });
    lines.push(fRow(rowStr));
  }

  lines.push(fBlank());

  // preview line
  if (selIdx >= 0 && selIdx < cmds.length) {
    const sel  = cmds[selIdx];
    const info = CMD_DB[sel];
    if (info) {
      lines.push(fRow('  ' + A.bGreen('\u25b6') + '  ' + A.bold(sel) + '  \u2014 ' + clip(info.purpose, IW - 14)));
    } else if (cat.isAddons) {
      const addon = ADDONS.find(a => a.key + ':*' === sel);
      lines.push(addon ? fRow('  ' + A.bGreen('\u25b6') + '  ' + A.bold(sel) + '  \u2014 ' + clip(addon.desc, IW - 14)) : fBlank());
    } else {
      lines.push(fBlank());
    }
  } else {
    lines.push(fBlank());
  }

  lines.push(fRow(A.dim('  ENTER=details  ESC/H=home  \u2191\u2193\u2190\u2192 navigate') + (maxScroll > 0 ? A.dim('  PgUp/PgDn scroll') : '')));

  while (lines.length < ROWS - 3) lines.push(fBlank());
  lines.push(fSep());
  lines.push(fNavBar('ESC/H = main menu  \xb7  \u2191\u2193\u2190\u2192 navigate  \xb7  ENTER = details  \xb7  PgUp/Dn scroll'));
  lines.push(fBot());
  return lines;
}

function renderCommand(cmdName, cat, scroll) {
  const info     = CMD_DB[cmdName];
  const catLabel = cat ? cat.label : '';

  const content = [''];
  content.push(A.bold('  PURPOSE'));
  content.push(fHRule());
  if (info) {
    const words = info.purpose.split(' ');
    let line = '  ';
    words.forEach(w => {
      if (line.length + w.length + 1 > IW - 2) { content.push(line.trimEnd()); line = '  ' + w + ' '; }
      else line += w + ' ';
    });
    if (line.trim()) content.push(line.trimEnd());
  } else {
    content.push('  (No entry found for this command.)');
  }
  content.push('');
  content.push(A.bold('  USAGE'));
  content.push(fHRule());
  (info ? info.usage : []).forEach(u => content.push('  ' + A.bYellow(u)));
  content.push('');
  content.push(A.bold('  NOTES'));
  content.push(fHRule());
  (info ? info.notes : []).forEach((n, i) => content.push('  ' + A.dim(String(i + 1) + '.') + ' ' + n));
  content.push('');

  const maxScroll = Math.max(0, content.length - CONTENT_H);
  const start     = Math.min(scroll, maxScroll);

  const lines = [];
  lines.push(fTop());
  lines.push(fTitle('COMMAND: ' + A.bYellow(cmdName), '[' + catLabel + ']'));
  lines.push(fSep());
  content.slice(start, start + CONTENT_H).forEach(c => lines.push(fRow(c)));
  while (lines.length < ROWS - 3) lines.push(fBlank());
  lines.push(fSep());
  lines.push(fNavBar('ESC = category  \xb7  H = main menu  \xb7  \u2191\u2193 / PgUp/PgDn = scroll'));
  lines.push(fBot());
  return lines;
}

function renderAddon(addon, scroll) {
  const content = [
    '',
    A.bold('  ' + addon.name),
    '',
    fHRule(),
    '',
    '  ' + addon.desc,
    '',
    A.bold('  COMMANDS / USAGE'),
    fHRule(),
    ...addon.cmds.map(c => '  ' + A.bYellow(c)),
    '',
    A.dim('  Install via `pkg install ' + addon.key + '` on Termux if not already present.'),
    A.dim('  Use `shell ' + addon.key + ' --version` to verify installation.'),
    '',
  ];

  const maxScroll = Math.max(0, content.length - CONTENT_H);
  const start     = Math.min(scroll, maxScroll);

  const lines = [];
  lines.push(fTop());
  lines.push(fTitle('PLUGIN: ' + A.bYellow(addon.key + ':*'), '[Add-Ons/Plugins]'));
  lines.push(fSep());
  content.slice(start, start + CONTENT_H).forEach(c => lines.push(fRow(c)));
  while (lines.length < ROWS - 3) lines.push(fBlank());
  lines.push(fSep());
  lines.push(fNavBar('ESC = category  \xb7  H = main menu  \xb7  \u2191\u2193 / PgUp/PgDn = scroll'));
  lines.push(fBot());
  return lines;
}

// ---------------------------------------------------------------------------
// Plain-text fallback renderers (non-interactive / non-TTY)
// ---------------------------------------------------------------------------
function renderCommandText(cmdName) {
  const info = CMD_DB[cmdName.toLowerCase()];
  if (!info) return `No help entry for: ${cmdName}\nAll commands: ${ALL_CMDS.join(', ')}`;
  return [
    '',
    `  COMMAND: ${cmdName}`,
    '',
    '  PURPOSE',
    '  ' + '\u2500'.repeat(60),
    '  ' + info.purpose,
    '',
    '  USAGE',
    '  ' + '\u2500'.repeat(60),
    ...info.usage.map(u => '  ' + u),
    '',
    '  NOTES',
    '  ' + '\u2500'.repeat(60),
    ...info.notes.map((n, i) => `  ${i + 1}. ${n}`),
    '',
  ].join('\n');
}

function renderMainText() {
  const lines = [
    '',
    '  \u2554' + '\u2550'.repeat(50) + '\u2557',
    `  \u2551  AIOS HELP SYSTEM v${HELP_VER}${''.padEnd(29)}\u2551`,
    '  \u2560' + '\u2550'.repeat(50) + '\u2563',
  ];
  CATEGORIES.forEach(c => {
    const cmds = c.isAddons ? 'bash:*, zsh:*, python:*, git:*, pkg:*'
               : c.isAll    ? '(all commands)'
               : c.commands.slice(0, 4).join(', ') + (c.commands.length > 4 ? ' \u2026' : '');
    const row = `  ${c.key})  ${c.label}`.padEnd(28) + clip(cmds, 23);
    lines.push('  \u2551  ' + pad(row.slice(4), 48) + '\u2551');
  });
  lines.push('  \u2560' + '\u2550'.repeat(50) + '\u2563');
  lines.push('  \u2551  Type `help <command>` for a command reference.  \u2551');
  lines.push('  \u255a' + '\u2550'.repeat(50) + '\u255d');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Key parser
// ---------------------------------------------------------------------------
function parseKey(buf) {
  const s = buf.toString();
  if (s === '\x1b[A' || s === '\x1bOA') return 'up';
  if (s === '\x1b[B' || s === '\x1bOB') return 'down';
  if (s === '\x1b[C' || s === '\x1bOC') return 'right';
  if (s === '\x1b[D' || s === '\x1bOD') return 'left';
  if (s === '\x1b[5~')                  return 'pageup';
  if (s === '\x1b[6~')                  return 'pagedown';
  if (s === '\x1b')                     return 'esc';
  if (s === '\r' || s === '\n')         return 'enter';
  if (s === '\x03' || s === '\x04')     return 'quit';
  if (s.length === 1) return s.toLowerCase();
  return null;
}

// ---------------------------------------------------------------------------
// Interactive TUI session
// ---------------------------------------------------------------------------
function openInteractive(context) {
  return new Promise((resolve) => {
    const isTTY = process.stdin.isTTY && process.stdout.isTTY &&
                  typeof process.stdin.setRawMode === 'function';

    const term = context && context.terminal;
    if (term && typeof term.pause === 'function') term.pause();

    function cleanup() {
      process.stdin.removeListener('data', onData);
      try {
        if (isTTY) process.stdin.setRawMode(false);
        process.stdout.write(A.show());
        process.stdout.write(A.clear());
      } catch (_) {}
      if (term && typeof term.resume === 'function') term.resume();
      resolve();
    }

    // -- state machine -------------------------------------------------------
    const st = {
      screen:   'main',
      menuSel:  0,
      catIdx:   0,
      cmdSel:   0,
      addonSel: 0,
      scroll:   0,
    };

    const currentCat  = () => CATEGORIES[st.catIdx];
    const currentCmds = () => {
      const cat = currentCat();
      if (cat.isAll)    return ALL_CMDS;
      if (cat.isAddons) return ADDONS.map(a => a.key + ':*');
      return cat.commands;
    };

    function draw() {
      let scr;
      if (st.screen === 'main')     scr = renderMain(st.menuSel);
      else if (st.screen === 'category') scr = renderCategory(currentCat(), st.cmdSel, st.scroll);
      else if (st.screen === 'command')  scr = renderCommand(currentCmds()[st.cmdSel], currentCat(), st.scroll);
      else if (st.screen === 'addon')    scr = renderAddon(ADDONS[st.addonSel], st.scroll);
      else scr = renderMain(0);
      process.stdout.write(A.clear() + scr.join('\n') + '\n');
    }

    function goHome()  { st.screen = 'main'; st.menuSel = 0; st.scroll = 0; draw(); }
    function goBack()  {
      if (st.screen === 'command' || st.screen === 'addon') { st.screen = 'category'; st.scroll = 0; draw(); }
      else goHome();
    }

    function selectCategory(idx) {
      st.catIdx = idx; st.cmdSel = 0; st.scroll = 0; st.screen = 'category'; draw();
    }
    function selectItem() {
      const cat  = currentCat();
      const cmds = currentCmds();
      const sel  = cmds[st.cmdSel];
      if (!sel) return;
      if (cat.isAddons) {
        st.addonSel = ADDONS.findIndex(a => a.key + ':*' === sel);
        st.scroll = 0; st.screen = 'addon';
      } else {
        st.scroll = 0; st.screen = 'command';
      }
      draw();
    }

    function onData(buf) {
      const key = parseKey(buf);
      if (!key) return;
      if (key === 'quit') { cleanup(); return; }
      if (key === 'h')    { goHome();  return; }

      if (st.screen === 'main') {
        const total = CATEGORIES.length + 1;
        if (key === 'q')     { cleanup(); return; }
        if (key === 'up')    { st.menuSel = (st.menuSel - 1 + total) % total; draw(); return; }
        if (key === 'down')  { st.menuSel = (st.menuSel + 1) % total; draw(); return; }
        if (key === 'enter') { if (st.menuSel === CATEGORIES.length) { cleanup(); return; } selectCategory(st.menuSel); return; }
        const letter = key.toUpperCase();
        if (letter === 'Q') { cleanup(); return; }
        const ci = CATEGORIES.findIndex(c => c.key === letter);
        if (ci >= 0) { st.menuSel = ci; selectCategory(ci); }
        return;
      }

      if (st.screen === 'category') {
        const cmds = currentCmds();
        const total = cmds.length;
        if (key === 'esc')   { goHome(); return; }
        if (key === 'q')     { cleanup(); return; }
        if (key === 'enter') { selectItem(); return; }
        if (key === 'up' || key === 'left') {
          st.cmdSel = (st.cmdSel - 1 + total) % total;
          const row = Math.floor(st.cmdSel / 4);
          const vh  = CONTENT_H - 3;
          if (row < st.scroll)       st.scroll = row;
          if (row >= st.scroll + vh) st.scroll = row - vh + 1;
          draw(); return;
        }
        if (key === 'down' || key === 'right') {
          st.cmdSel = (st.cmdSel + 1) % total;
          const row = Math.floor(st.cmdSel / 4);
          const vh  = CONTENT_H - 3;
          if (row < st.scroll)       st.scroll = row;
          if (row >= st.scroll + vh) st.scroll = row - vh + 1;
          draw(); return;
        }
        if (key === 'pageup')   { st.scroll = Math.max(0, st.scroll - 5); draw(); return; }
        if (key === 'pagedown') { st.scroll += 5; draw(); return; }
        return;
      }

      if (st.screen === 'command' || st.screen === 'addon') {
        if (key === 'esc')      { goBack(); return; }
        if (key === 'q')        { cleanup(); return; }
        if (key === 'up')       { st.scroll = Math.max(0, st.scroll - 1); draw(); return; }
        if (key === 'down')     { st.scroll++; draw(); return; }
        if (key === 'pageup')   { st.scroll = Math.max(0, st.scroll - 5); draw(); return; }
        if (key === 'pagedown') { st.scroll += 5; draw(); return; }
      }
    }

    try {
      if (isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdout.write(A.hide());
    } catch (_) {}

    process.stdin.on('data', onData);
    draw();
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
function createHelpWindow() {
  const commands = {
    help: async (args, context) => {
      // Quick lookup: `help <command>`
      if (args && args.length > 0) {
        const q = args[0].toLowerCase();
        return { status: CMD_DB[q] ? 'ok' : 'error', command: 'help', result: renderCommandText(q) };
      }
      // Interactive TUI
      if (process.stdout.isTTY && process.stdin.isTTY) {
        await openInteractive(context || {});
        return { status: 'ok', command: 'help', result: '' };
      }
      // Non-TTY fallback
      return { status: 'ok', command: 'help', result: renderMainText() };
    },
  };

  return {
    name:    'help-window',
    version: '4.0.0',
    // Public API (also used by tests)
    renderMain,
    renderCategory,
    renderCommand,
    renderAddon,
    renderCommandText,
    renderMainText,
    parseKey,
    CATEGORIES,
    ALL_CMDS,
    CMD_DB,
    ADDONS,
    commands,
  };
}

module.exports = { createHelpWindow };
