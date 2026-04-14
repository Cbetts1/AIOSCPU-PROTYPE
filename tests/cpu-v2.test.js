'use strict';
/**
 * tests/cpu-v2.test.js
 *
 * NOTE: This file tests v1.1 feature additions in core/cpu.js.
 * It is named "v2" because it was added in the Phase 1 hardening pass
 * alongside the existing tests/cpu.test.js (which covers the base ISA).
 * Both files test the same source: core/cpu.js.
 *   - tests/cpu.test.js       → base ISA (NOP, MOV, LOADI, ADD, SUB, …, SYSCALL)
 *   - tests/cpu-v2.test.js    → v1.1 additions (bounds checking, selfTest, NEG/ABS/INC/DEC)
 *
 * Tests for CPU v1.1 additions:
 *   - Memory bounds checking
 *   - selfTest()
 *   - NEG, ABS, INC, DEC opcodes
 */
const { createCPU } = require('../core/cpu');

// minimal kernel mock
function makeKernel() {
  return {
    registerSyscall: jest.fn(),
    bus: { emit: jest.fn() },
  };
}

// ── Version ───────────────────────────────────────────────────────────────────
describe('CPU version', () => {
  test('version is 4.0.0', () => {
    const cpu = createCPU();
    expect(cpu.version).toBe('4.0.0');
  });
});

// ── Memory bounds checking ────────────────────────────────────────────────────
describe('memory bounds checking', () => {
  test('getMem throws RangeError on negative address', () => {
    const cpu = createCPU();
    expect(() => cpu.getMem(-1)).toThrow(RangeError);
  });

  test('getMem throws RangeError on address >= 65536', () => {
    const cpu = createCPU();
    expect(() => cpu.getMem(65536)).toThrow(RangeError);
  });

  test('setMem throws RangeError on negative address', () => {
    const cpu = createCPU();
    expect(() => cpu.setMem(-1, 0)).toThrow(RangeError);
  });

  test('setMem throws RangeError on address >= 65536', () => {
    const cpu = createCPU();
    expect(() => cpu.setMem(65536, 0)).toThrow(RangeError);
  });

  test('bounds error has cpuCode E_CPU_BOUNDS', () => {
    const cpu = createCPU();
    let err;
    try { cpu.getMem(-1); } catch (e) { err = e; }
    expect(err.cpuCode).toBe('E_CPU_BOUNDS');
  });

  test('getMem works at address 0', () => {
    const cpu = createCPU();
    expect(() => cpu.getMem(0)).not.toThrow();
  });

  test('getMem works at address 65535', () => {
    const cpu = createCPU();
    expect(() => cpu.getMem(65535)).not.toThrow();
  });

  test('setMem works at address 0', () => {
    const cpu = createCPU();
    expect(() => cpu.setMem(0, 42)).not.toThrow();
    expect(cpu.getMem(0)).toBe(42);
  });

  test('setMem works at address 65535', () => {
    const cpu = createCPU();
    expect(() => cpu.setMem(65535, 7)).not.toThrow();
    expect(cpu.getMem(65535)).toBe(7);
  });

  test('kernel bus emits cpu:fault on bounds error', () => {
    const kernel = makeKernel();
    const cpu = createCPU(kernel);
    try { cpu.getMem(-1); } catch (_) {}
    expect(kernel.bus.emit).toHaveBeenCalledWith(
      'cpu:fault',
      expect.objectContaining({ type: 'bounds', op: 'read' })
    );
  });

  test('LOAD instruction with out-of-bounds addr throws', () => {
    const cpu = createCPU();
    expect(() => cpu.run([
      { op: 'LOAD', dst: 0, addr: -1 },
    ])).toThrow(RangeError);
  });

  test('STORE instruction with out-of-bounds addr throws', () => {
    const cpu = createCPU();
    expect(() => cpu.run([
      { op: 'STORE', addr: 99999, src: 0 },
    ])).toThrow(RangeError);
  });
});

// ── NEG opcode ────────────────────────────────────────────────────────────────
describe('NEG opcode', () => {
  test('negates a positive value', () => {
    const cpu = createCPU();
    const r = cpu.run([
      { op: 'LOADI', dst: 0, imm: 42 },
      { op: 'NEG',   dst: 1, src: 0  },
      { op: 'HALT' },
    ]);
    expect(r.regs[1]).toBe(-42);
  });

  test('negates a negative value to positive', () => {
    const cpu = createCPU();
    const r = cpu.run([
      { op: 'LOADI', dst: 0, imm: -10 },
      { op: 'NEG',   dst: 1, src: 0   },
      { op: 'HALT' },
    ]);
    expect(r.regs[1]).toBe(10);
  });

  test('negating zero produces zero', () => {
    const cpu = createCPU();
    const r = cpu.run([
      { op: 'LOADI', dst: 0, imm: 0 },
      { op: 'NEG',   dst: 1, src: 0 },
      { op: 'HALT' },
    ]);
    expect(r.regs[1]).toBe(0);
  });

  test('can use same register as src and dst', () => {
    const cpu = createCPU();
    const r = cpu.run([
      { op: 'LOADI', dst: 3, imm: 5 },
      { op: 'NEG',   dst: 3, src: 3 },
      { op: 'HALT' },
    ]);
    expect(r.regs[3]).toBe(-5);
  });
});

// ── ABS opcode ────────────────────────────────────────────────────────────────
describe('ABS opcode', () => {
  test('abs of positive is same value', () => {
    const cpu = createCPU();
    const r = cpu.run([
      { op: 'LOADI', dst: 0, imm: 7  },
      { op: 'ABS',   dst: 1, src: 0  },
      { op: 'HALT' },
    ]);
    expect(r.regs[1]).toBe(7);
  });

  test('abs of negative is positive', () => {
    const cpu = createCPU();
    const r = cpu.run([
      { op: 'LOADI', dst: 0, imm: -99 },
      { op: 'ABS',   dst: 1, src: 0   },
      { op: 'HALT' },
    ]);
    expect(r.regs[1]).toBe(99);
  });

  test('abs of zero is zero', () => {
    const cpu = createCPU();
    const r = cpu.run([
      { op: 'LOADI', dst: 0, imm: 0 },
      { op: 'ABS',   dst: 1, src: 0 },
      { op: 'HALT' },
    ]);
    expect(r.regs[1]).toBe(0);
  });
});

// ── INC opcode ────────────────────────────────────────────────────────────────
describe('INC opcode', () => {
  test('increments register by 1', () => {
    const cpu = createCPU();
    const r = cpu.run([
      { op: 'LOADI', dst: 0, imm: 41 },
      { op: 'INC',   dst: 0           },
      { op: 'HALT' },
    ]);
    expect(r.regs[0]).toBe(42);
  });

  test('increments from zero', () => {
    const cpu = createCPU();
    const r = cpu.run([
      { op: 'LOADI', dst: 2, imm: 0 },
      { op: 'INC',   dst: 2          },
      { op: 'HALT' },
    ]);
    expect(r.regs[2]).toBe(1);
  });

  test('increments negative value toward zero', () => {
    const cpu = createCPU();
    const r = cpu.run([
      { op: 'LOADI', dst: 1, imm: -1 },
      { op: 'INC',   dst: 1           },
      { op: 'HALT' },
    ]);
    expect(r.regs[1]).toBe(0);
  });
});

// ── DEC opcode ────────────────────────────────────────────────────────────────
describe('DEC opcode', () => {
  test('decrements register by 1', () => {
    const cpu = createCPU();
    const r = cpu.run([
      { op: 'LOADI', dst: 0, imm: 43 },
      { op: 'DEC',   dst: 0           },
      { op: 'HALT' },
    ]);
    expect(r.regs[0]).toBe(42);
  });

  test('decrements to zero', () => {
    const cpu = createCPU();
    const r = cpu.run([
      { op: 'LOADI', dst: 1, imm: 1 },
      { op: 'DEC',   dst: 1          },
      { op: 'HALT' },
    ]);
    expect(r.regs[1]).toBe(0);
  });

  test('decrements into negative', () => {
    const cpu = createCPU();
    const r = cpu.run([
      { op: 'LOADI', dst: 2, imm: 0 },
      { op: 'DEC',   dst: 2          },
      { op: 'HALT' },
    ]);
    expect(r.regs[2]).toBe(-1);
  });
});

// ── selfTest() ────────────────────────────────────────────────────────────────
describe('selfTest()', () => {
  test('returns an object with passed/failed/allPassed/results', () => {
    const cpu = createCPU();
    const r = cpu.selfTest();
    expect(typeof r.passed).toBe('number');
    expect(typeof r.failed).toBe('number');
    expect(typeof r.allPassed).toBe('boolean');
    expect(Array.isArray(r.results)).toBe(true);
  });

  test('all assertions pass', () => {
    const cpu = createCPU();
    const r = cpu.selfTest();
    expect(r.allPassed).toBe(true);
    expect(r.failed).toBe(0);
  });

  test('results contain 10 test assertions', () => {
    const cpu = createCPU();
    const r = cpu.selfTest();
    expect(r.results.length).toBe(10);
  });

  test('results have label, ok, actual, expected fields', () => {
    const cpu = createCPU();
    const r = cpu.selfTest();
    for (const entry of r.results) {
      expect(typeof entry.label).toBe('string');
      expect(typeof entry.ok).toBe('boolean');
      expect('actual' in entry).toBe(true);
      expect('expected' in entry).toBe(true);
    }
  });

  test('selfTest does not corrupt CPU state', () => {
    const cpu = createCPU();
    // Load a program
    cpu.run([
      { op: 'LOADI', dst: 5, imm: 123 },
      { op: 'HALT' },
    ]);
    const regsBefore = cpu.getRegs().slice();

    // Run self-test
    cpu.selfTest();

    // Registers should be restored
    expect(cpu.getRegs()).toEqual(regsBefore);
  });

  test('emits cpu:selftest event on kernel bus', () => {
    const kernel = makeKernel();
    const cpu = createCPU(kernel);
    cpu.selfTest();
    expect(kernel.bus.emit).toHaveBeenCalledWith(
      'cpu:selftest',
      expect.objectContaining({ allPassed: true })
    );
  });

  test('selfTest works without a kernel', () => {
    const cpu = createCPU();  // no kernel
    expect(() => cpu.selfTest()).not.toThrow();
  });
});

// ── OP table ─────────────────────────────────────────────────────────────────
describe('OP table v1.1', () => {
  test('includes NEG', () => {
    const { OP } = require('../core/cpu');
    expect(typeof OP.NEG).toBe('number');
  });
  test('includes ABS', () => {
    const { OP } = require('../core/cpu');
    expect(typeof OP.ABS).toBe('number');
  });
  test('includes INC', () => {
    const { OP } = require('../core/cpu');
    expect(typeof OP.INC).toBe('number');
  });
  test('includes DEC', () => {
    const { OP } = require('../core/cpu');
    expect(typeof OP.DEC).toBe('number');
  });
});
