'use strict';
/**
 * tests/help-window.test.js
 * Tests for core/help-window.js — AIOS Help Window System v4.0.0
 */
const { createHelpWindow } = require('../core/help-window');

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
describe('createHelpWindow()', () => {
  test('returns expected API shape', () => {
    const h = createHelpWindow();
    expect(h.name).toBe('help-window');
    expect(h.version).toBe('4.0.0');
    expect(typeof h.renderMain).toBe('function');
    expect(typeof h.renderCategory).toBe('function');
    expect(typeof h.renderCommand).toBe('function');
    expect(typeof h.renderAddon).toBe('function');
    expect(typeof h.renderCommandText).toBe('function');
    expect(typeof h.renderMainText).toBe('function');
    expect(typeof h.parseKey).toBe('function');
    expect(typeof h.commands.help).toBe('function');
  });

  test('exposes CMD_DB with 61 commands', () => {
    const h = createHelpWindow();
    expect(Object.keys(h.CMD_DB).length).toBe(61);
  });

  test('ALL_CMDS is sorted', () => {
    const h = createHelpWindow();
    const sorted = [...h.ALL_CMDS].sort();
    expect(h.ALL_CMDS).toEqual(sorted);
  });

  test('has 8 categories', () => {
    const h = createHelpWindow();
    expect(h.CATEGORIES.length).toBe(8);
  });

  test('category keys are A-H', () => {
    const h = createHelpWindow();
    const keys = h.CATEGORIES.map(c => c.key);
    expect(keys).toEqual(['A','B','C','D','E','F','G','H']);
  });

  test('has 5 addons', () => {
    const h = createHelpWindow();
    expect(h.ADDONS.length).toBe(5);
    const keys = h.ADDONS.map(a => a.key);
    expect(keys).toEqual(['bash','zsh','python','git','pkg']);
  });
});

// ---------------------------------------------------------------------------
// CMD_DB completeness
// ---------------------------------------------------------------------------
describe('CMD_DB entries', () => {
  const h = createHelpWindow();
  const requiredCmds = [
    'ai','aios','aura','capabilities','cat','cd','chat','collective',
    'consciousness','cp','cpu','date','df','diagnostics','echo','env',
    'export','free','help','hostname','ifconfig','init','kernel','kill',
    'loop','ls','memcore','memory','mesh','mirror','mkdir','mode','models',
    'mv','pkg','port','procfs','ps','pwd','rm','sched','self-model','selftest',
    'shell','stat','su','sudo','svc','sysinfo','sysreport','termux','touch',
    'tree','uname','units','upgrade','uptime','version','vps','whoami','write',
  ];

  requiredCmds.forEach(cmd => {
    test(`CMD_DB has entry for: ${cmd}`, () => {
      expect(h.CMD_DB[cmd]).toBeDefined();
      expect(typeof h.CMD_DB[cmd].purpose).toBe('string');
      expect(Array.isArray(h.CMD_DB[cmd].usage)).toBe(true);
      expect(h.CMD_DB[cmd].usage.length).toBeGreaterThan(0);
      expect(Array.isArray(h.CMD_DB[cmd].notes)).toBe(true);
      expect(h.CMD_DB[cmd].notes.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Category command membership
// ---------------------------------------------------------------------------
describe('CATEGORIES — command membership', () => {
  const h = createHelpWindow();

  test('cat A (AIOS Core) contains ai, aios, aura, chat, loop', () => {
    const catA = h.CATEGORIES.find(c => c.key === 'A');
    expect(catA.commands).toEqual(expect.arrayContaining(['ai','aios','aura','chat','loop']));
  });

  test('cat B (System/Kernel) contains cpu, kernel, ps, kill, vps', () => {
    const catB = h.CATEGORIES.find(c => c.key === 'B');
    expect(catB.commands).toEqual(expect.arrayContaining(['cpu','kernel','ps','kill','vps']));
  });

  test('cat C (Filesystem) contains ls, cat, cd, mkdir, rm', () => {
    const catC = h.CATEGORIES.find(c => c.key === 'C');
    expect(catC.commands).toEqual(expect.arrayContaining(['ls','cat','cd','mkdir','rm']));
  });

  test('cat D (Network) contains ifconfig, mirror, port, svc', () => {
    const catD = h.CATEGORIES.find(c => c.key === 'D');
    expect(catD.commands).toEqual(expect.arrayContaining(['ifconfig','mirror','port','svc']));
  });

  test('cat E (Environment) contains env, export, hostname, uname, units', () => {
    const catE = h.CATEGORIES.find(c => c.key === 'E');
    expect(catE.commands).toEqual(expect.arrayContaining(['env','export','hostname','uname','units']));
  });

  test('cat F (Execution/Privilege) contains sudo, su, shell, termux', () => {
    const catF = h.CATEGORIES.find(c => c.key === 'F');
    expect(catF.commands).toEqual(expect.arrayContaining(['sudo','su','shell','termux']));
  });

  test('cat G is marked isAddons', () => {
    const catG = h.CATEGORIES.find(c => c.key === 'G');
    expect(catG.isAddons).toBe(true);
  });

  test('cat H is marked isAll', () => {
    const catH = h.CATEGORIES.find(c => c.key === 'H');
    expect(catH.isAll).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderMain()
// ---------------------------------------------------------------------------
describe('renderMain()', () => {
  const h = createHelpWindow();

  test('returns 24 lines', () => {
    const lines = h.renderMain(0);
    expect(lines.length).toBe(24);
  });

  test('contains frame corners', () => {
    const out = h.renderMain(0).join('\n');
    expect(out).toMatch(/╔/);
    expect(out).toMatch(/╗/);
    expect(out).toMatch(/╚/);
    expect(out).toMatch(/╝/);
  });

  test('contains AIOS HELP SYSTEM', () => {
    const out = h.renderMain(0).join('\n');
    expect(out).toMatch(/AIOS HELP SYSTEM/);
  });

  test('contains all category keys A-H and Q', () => {
    const out = h.renderMain(0).join('\n');
    ['A)','B)','C)','D)','E)','F)','G)','H)','Q)'].forEach(k => expect(out).toMatch(k));
  });

  test('selected item index 0 renders with highlight', () => {
    const h2 = createHelpWindow();
    const plain  = h2.renderMain(0).join('').replace(/\x1b\[[0-9;]*m/g,'');
    expect(plain).toMatch(/AIOS Core/);
  });
});

// ---------------------------------------------------------------------------
// renderCategory()
// ---------------------------------------------------------------------------
describe('renderCategory()', () => {
  const h = createHelpWindow();

  test('returns 24 lines for cat A', () => {
    const catA = h.CATEGORIES[0];
    const lines = h.renderCategory(catA, 0, 0);
    expect(lines.length).toBe(24);
  });

  test('contains command names', () => {
    const catC = h.CATEGORIES.find(c => c.key === 'C');
    const out  = h.renderCategory(catC, 0, 0).join('\n').replace(/\x1b\[[0-9;]*m/g,'');
    expect(out).toMatch(/ls/);
    expect(out).toMatch(/mkdir/);
  });

  test('shows purpose preview for selected command', () => {
    const catC = h.CATEGORIES.find(c => c.key === 'C');
    const out  = h.renderCategory(catC, 0, 0).join('\n').replace(/\x1b\[[0-9;]*m/g,'');
    expect(out).toMatch(/Print the contents/i);
  });
});

// ---------------------------------------------------------------------------
// renderCommand()
// ---------------------------------------------------------------------------
describe('renderCommand()', () => {
  const h = createHelpWindow();
  const catA = h.CATEGORIES[0];

  test('returns 24 lines', () => {
    const lines = h.renderCommand('kernel', catA, 0);
    expect(lines.length).toBe(24);
  });

  test('contains PURPOSE, USAGE, NOTES sections', () => {
    const out = h.renderCommand('kernel', catA, 0).join('\n').replace(/\x1b\[[0-9;]*m/g,'');
    expect(out).toMatch(/PURPOSE/);
    expect(out).toMatch(/USAGE/);
    expect(out).toMatch(/NOTES/);
  });

  test('contains the command name in header', () => {
    const out = h.renderCommand('kernel', catA, 0).join('\n').replace(/\x1b\[[0-9;]*m/g,'');
    expect(out).toMatch(/COMMAND: kernel/);
  });

  test('scroll shifts content', () => {
    const out0 = h.renderCommand('kernel', catA, 0).join('\n').replace(/\x1b\[[0-9;]*m/g,'');
    const out3 = h.renderCommand('kernel', catA, 3).join('\n').replace(/\x1b\[[0-9;]*m/g,'');
    expect(out0).not.toBe(out3);
  });
});

// ---------------------------------------------------------------------------
// renderAddon()
// ---------------------------------------------------------------------------
describe('renderAddon()', () => {
  const h = createHelpWindow();

  test('returns 24 lines', () => {
    const lines = h.renderAddon(h.ADDONS[0], 0);
    expect(lines.length).toBe(24);
  });

  test('shows addon name', () => {
    const out = h.renderAddon(h.ADDONS[0], 0).join('\n').replace(/\x1b\[[0-9;]*m/g,'');
    expect(out).toMatch(/bash/);
  });
});

// ---------------------------------------------------------------------------
// renderCommandText()
// ---------------------------------------------------------------------------
describe('renderCommandText()', () => {
  const h = createHelpWindow();

  test('returns string for known command', () => {
    const t = h.renderCommandText('ls');
    expect(typeof t).toBe('string');
    expect(t).toMatch(/COMMAND: ls/);
    expect(t).toMatch(/PURPOSE/);
    expect(t).toMatch(/USAGE/);
    expect(t).toMatch(/NOTES/);
  });

  test('returns error text for unknown command', () => {
    const t = h.renderCommandText('notacommand');
    expect(t).toMatch(/No help entry for/);
  });
});

// ---------------------------------------------------------------------------
// renderMainText()
// ---------------------------------------------------------------------------
describe('renderMainText()', () => {
  const h = createHelpWindow();

  test('returns a non-empty string', () => {
    const t = h.renderMainText();
    expect(typeof t).toBe('string');
    expect(t.length).toBeGreaterThan(0);
  });

  test('contains all category labels', () => {
    const t = h.renderMainText();
    ['AIOS Core','System/Kernel','Filesystem','Network','Environment',
     'Execution/Privilege','Add-Ons/Plugins','All Commands'].forEach(label => {
      expect(t).toMatch(label);
    });
  });
});

// ---------------------------------------------------------------------------
// parseKey()
// ---------------------------------------------------------------------------
describe('parseKey()', () => {
  const h = createHelpWindow();

  test('parses arrow keys', () => {
    expect(h.parseKey(Buffer.from('\x1b[A'))).toBe('up');
    expect(h.parseKey(Buffer.from('\x1b[B'))).toBe('down');
    expect(h.parseKey(Buffer.from('\x1b[C'))).toBe('right');
    expect(h.parseKey(Buffer.from('\x1b[D'))).toBe('left');
  });

  test('parses page keys', () => {
    expect(h.parseKey(Buffer.from('\x1b[5~'))).toBe('pageup');
    expect(h.parseKey(Buffer.from('\x1b[6~'))).toBe('pagedown');
  });

  test('parses ESC', () => {
    expect(h.parseKey(Buffer.from('\x1b'))).toBe('esc');
  });

  test('parses ENTER', () => {
    expect(h.parseKey(Buffer.from('\r'))).toBe('enter');
    expect(h.parseKey(Buffer.from('\n'))).toBe('enter');
  });

  test('parses Ctrl-C/Ctrl-D as quit', () => {
    expect(h.parseKey(Buffer.from('\x03'))).toBe('quit');
    expect(h.parseKey(Buffer.from('\x04'))).toBe('quit');
  });

  test('parses letter keys as lowercase', () => {
    expect(h.parseKey(Buffer.from('A'))).toBe('a');
    expect(h.parseKey(Buffer.from('q'))).toBe('q');
    expect(h.parseKey(Buffer.from('H'))).toBe('h');
  });
});

// ---------------------------------------------------------------------------
// commands.help() — non-TTY mode (stdio not a TTY in Jest)
// ---------------------------------------------------------------------------
describe('commands.help()', () => {
  const h = createHelpWindow();

  test('returns ok with main listing when no args', async () => {
    const r = await h.commands.help([]);
    expect(r.status).toBe('ok');
    expect(r.command).toBe('help');
    expect(typeof r.result).toBe('string');
  });

  test('returns ok with command text when given known command', async () => {
    const r = await h.commands.help(['ls']);
    expect(r.status).toBe('ok');
    expect(r.result).toMatch(/COMMAND: ls/);
  });

  test('returns error for unknown command', async () => {
    const r = await h.commands.help(['unknowncmd123']);
    expect(r.status).toBe('error');
    expect(r.result).toMatch(/No help entry/);
  });
});
