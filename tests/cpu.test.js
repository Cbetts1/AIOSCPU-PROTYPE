'use strict';

const { createKernel } = require('../core/kernel');
const { createCPU, OP } = require('../core/cpu');

describe('AIOSCPU Virtual Processor', () => {
  let kernel, cpu;

  beforeEach(() => {
    kernel = createKernel();
    kernel.boot();
    cpu = createCPU(kernel);
  });

  afterEach(() => {
    kernel.shutdown();
  });

  describe('createCPU', () => {
    test('returns cpu module with expected properties', () => {
      expect(cpu.name).toBe('AIOSCPU');
      expect(cpu.version).toBe('4.0.0');
      expect(cpu.OP).toBeDefined();
      expect(typeof cpu.loadProgram).toBe('function');
      expect(typeof cpu.step).toBe('function');
      expect(typeof cpu.run).toBe('function');
      expect(typeof cpu.reset).toBe('function');
    });

    test('initial state is correct', () => {
      expect(cpu.isHalted()).toBe(false);
      expect(cpu.isRunning()).toBe(false);
      expect(cpu.getCycles()).toBe(0);
      expect(cpu.getPC()).toBe(0x0200);
      expect(cpu.getSP()).toBe(0x01FF);
      expect(cpu.getFlags()).toBe(0);
    });

    test('registers are initialized to zero', () => {
      const regs = cpu.getRegs();
      expect(regs).toHaveLength(8);
      regs.forEach(r => expect(r).toBe(0));
    });
  });

  describe('OP table', () => {
    test('OP constants are frozen', () => {
      expect(Object.isFrozen(OP)).toBe(true);
    });

    test('contains expected opcodes', () => {
      expect(OP.NOP).toBe(0x00);
      expect(OP.HALT).toBe(0xFF);
      expect(OP.ADD).toBe(0x10);
      expect(OP.SUB).toBe(0x12);
      expect(OP.JMP).toBe(0x40);
      expect(OP.SYSCALL).toBe(0x60);
    });
  });

  describe('NOP and HALT', () => {
    test('NOP does nothing', () => {
      const result = cpu.run([
        { op: 'NOP' },
        { op: 'HALT' },
      ]);
      expect(result.halted).toBe(true);
      expect(result.cycles).toBe(2);
    });

    test('HALT stops execution', () => {
      const result = cpu.run([
        { op: 'HALT' },
        { op: 'NOP' },
      ]);
      expect(result.halted).toBe(true);
      expect(result.cycles).toBe(1);
    });
  });

  describe('Data movement', () => {
    test('LOADI loads immediate value into register', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 42 },
        { op: 'HALT' },
      ]);
      expect(result.regs[0]).toBe(42);
    });

    test('MOV copies register to register', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 99 },
        { op: 'MOV', dst: 1, src: 0 },
        { op: 'HALT' },
      ]);
      expect(result.regs[1]).toBe(99);
    });

    test('STORE and LOAD work with memory', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 123 },
        { op: 'STORE', src: 0, addr: 0x4000 },
        { op: 'LOAD', dst: 1, addr: 0x4000 },
        { op: 'HALT' },
      ]);
      expect(result.regs[1]).toBe(123 & 0xFF);
    });

    test('LOADR and STORER work with register-offset addressing', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 0x40 },
        { op: 'LOADI', dst: 1, imm: 77 },
        { op: 'STORER', base: 0, offset: 5, src: 1 },
        { op: 'LOADR', dst: 2, base: 0, offset: 5 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(77);
    });
  });

  describe('Arithmetic', () => {
    test('ADD adds two registers', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 10 },
        { op: 'LOADI', dst: 1, imm: 20 },
        { op: 'ADD', dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(30);
    });

    test('ADDI adds immediate to register', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 5 },
        { op: 'ADDI', dst: 1, src: 0, imm: 7 },
        { op: 'HALT' },
      ]);
      expect(result.regs[1]).toBe(12);
    });

    test('SUB subtracts registers', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 50 },
        { op: 'LOADI', dst: 1, imm: 20 },
        { op: 'SUB', dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(30);
    });

    test('MUL multiplies registers', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 6 },
        { op: 'LOADI', dst: 1, imm: 7 },
        { op: 'MUL', dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(42);
    });

    test('DIV divides registers', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 100 },
        { op: 'LOADI', dst: 1, imm: 3 },
        { op: 'DIV', dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(33);
    });

    test('DIV by zero sets overflow flag and result to 0', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 100 },
        { op: 'LOADI', dst: 1, imm: 0 },
        { op: 'DIV', dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(0);
      expect(result.flags & 0x08).not.toBe(0); // FLAG_OF
    });

    test('MOD computes modulo', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 17 },
        { op: 'LOADI', dst: 1, imm: 5 },
        { op: 'MOD', dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(2);
    });

    test('MOD by zero sets overflow flag', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 17 },
        { op: 'LOADI', dst: 1, imm: 0 },
        { op: 'MOD', dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(0);
      expect(result.flags & 0x08).not.toBe(0);
    });

    test('ADD sets zero flag for zero result', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 5 },
        { op: 'LOADI', dst: 1, imm: -5 },
        { op: 'ADD', dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(0);
      expect(result.flags & 0x01).not.toBe(0); // FLAG_ZF
    });

    test('SUB sets sign flag for negative result', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 5 },
        { op: 'LOADI', dst: 1, imm: 10 },
        { op: 'SUB', dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(-5);
      expect(result.flags & 0x02).not.toBe(0); // FLAG_SF
    });
  });

  describe('Bitwise operations', () => {
    test('AND performs bitwise AND', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 0b1100 },
        { op: 'LOADI', dst: 1, imm: 0b1010 },
        { op: 'AND', dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(0b1000);
    });

    test('OR performs bitwise OR', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 0b1100 },
        { op: 'LOADI', dst: 1, imm: 0b1010 },
        { op: 'OR', dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(0b1110);
    });

    test('XOR performs bitwise XOR', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 0b1100 },
        { op: 'LOADI', dst: 1, imm: 0b1010 },
        { op: 'XOR', dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(0b0110);
    });

    test('NOT performs bitwise NOT', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 0 },
        { op: 'NOT', dst: 1, src: 0 },
        { op: 'HALT' },
      ]);
      expect(result.regs[1]).toBe(~0);
    });

    test('SHL shifts left', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 1 },
        { op: 'LOADI', dst: 1, imm: 4 },
        { op: 'SHL', dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(16);
    });

    test('SHR shifts right', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 32 },
        { op: 'LOADI', dst: 1, imm: 3 },
        { op: 'SHR', dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(4);
    });
  });

  describe('Comparison and jumps', () => {
    test('CMP sets zero flag on equal values', () => {
      cpu.run([
        { op: 'LOADI', dst: 0, imm: 42 },
        { op: 'LOADI', dst: 1, imm: 42 },
        { op: 'CMP', src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      expect(cpu.getFlags() & 0x01).not.toBe(0); // ZF
    });

    test('CMPI compares register with immediate', () => {
      cpu.run([
        { op: 'LOADI', dst: 0, imm: 10 },
        { op: 'CMPI', src: 0, imm: 10 },
        { op: 'HALT' },
      ]);
      expect(cpu.getFlags() & 0x01).not.toBe(0); // ZF
    });

    test('JMP jumps unconditionally', () => {
      const result = cpu.run([
        { op: 'JMP', addr: 2 },
        { op: 'LOADI', dst: 0, imm: 99 }, // skipped
        { op: 'LOADI', dst: 0, imm: 42 },
        { op: 'HALT' },
      ]);
      expect(result.regs[0]).toBe(42);
    });

    test('JMPR jumps to register address', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 7, imm: 3 },
        { op: 'JMPR', reg: 7 },
        { op: 'LOADI', dst: 0, imm: 99 }, // skipped
        { op: 'LOADI', dst: 0, imm: 42 },
        { op: 'HALT' },
      ]);
      expect(result.regs[0]).toBe(42);
    });

    test('JZ jumps when zero flag is set', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 5 },
        { op: 'LOADI', dst: 1, imm: 5 },
        { op: 'CMP', src1: 0, src2: 1 }, // sets ZF
        { op: 'JZ', addr: 5 },
        { op: 'LOADI', dst: 2, imm: 99 }, // skipped
        { op: 'LOADI', dst: 2, imm: 42 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(42);
    });

    test('JNZ jumps when zero flag is not set', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 5 },
        { op: 'LOADI', dst: 1, imm: 3 },
        { op: 'CMP', src1: 0, src2: 1 }, // not ZF
        { op: 'JNZ', addr: 5 },
        { op: 'LOADI', dst: 2, imm: 99 }, // skipped
        { op: 'LOADI', dst: 2, imm: 42 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(42);
    });

    test('JLT jumps when less than', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 3 },
        { op: 'LOADI', dst: 1, imm: 5 },
        { op: 'CMP', src1: 0, src2: 1 },
        { op: 'JLT', addr: 5 },
        { op: 'LOADI', dst: 2, imm: 99 },
        { op: 'LOADI', dst: 2, imm: 42 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(42);
    });

    test('JGT jumps when greater than', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 10 },
        { op: 'LOADI', dst: 1, imm: 3 },
        { op: 'CMP', src1: 0, src2: 1 },
        { op: 'JGT', addr: 5 },
        { op: 'LOADI', dst: 2, imm: 99 },
        { op: 'LOADI', dst: 2, imm: 42 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(42);
    });

    test('JLE jumps when less than or equal', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 5 },
        { op: 'LOADI', dst: 1, imm: 5 },
        { op: 'CMP', src1: 0, src2: 1 },
        { op: 'JLE', addr: 5 },
        { op: 'LOADI', dst: 2, imm: 99 },
        { op: 'LOADI', dst: 2, imm: 42 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(42);
    });

    test('JGE jumps when greater than or equal', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 5 },
        { op: 'LOADI', dst: 1, imm: 5 },
        { op: 'CMP', src1: 0, src2: 1 },
        { op: 'JGE', addr: 5 },
        { op: 'LOADI', dst: 2, imm: 99 },
        { op: 'LOADI', dst: 2, imm: 42 },
        { op: 'HALT' },
      ]);
      expect(result.regs[2]).toBe(42);
    });
  });

  describe('Subroutine instructions', () => {
    test('CALL and RET handle subroutine flow', () => {
      const result = cpu.run([
        { op: 'CALL', addr: 3 },        // 0: call subroutine at 3
        { op: 'LOADI', dst: 1, imm: 42 }, // 1: return point
        { op: 'HALT' },                   // 2: halt
        { op: 'LOADI', dst: 0, imm: 10 }, // 3: subroutine body
        { op: 'RET' },                    // 4: return to 1
      ]);
      expect(result.regs[0]).toBe(10);
      expect(result.regs[1]).toBe(42);
    });

    test('PUSH and POP work with the stack', () => {
      const result = cpu.run([
        { op: 'LOADI', dst: 0, imm: 77 },
        { op: 'PUSH', src: 0 },
        { op: 'LOADI', dst: 0, imm: 0 },
        { op: 'POP', dst: 1 },
        { op: 'HALT' },
      ]);
      expect(result.regs[1]).toBe(77 & 0xFF);
    });
  });

  describe('SYSCALL', () => {
    test('SYSCALL dispatches to kernel and stores result in R0', () => {
      kernel.registerSyscall(100, (args) => args[0] + args[1]);
      const result = cpu.run([
        { op: 'LOADI', dst: 1, imm: 10 },
        { op: 'LOADI', dst: 2, imm: 20 },
        { op: 'SYSCALL', num: 100, args: [1, 2] },
        { op: 'HALT' },
      ]);
      // R0 gets the syscall result
      expect(result.regs[0]).toBeDefined();
    });

    test('SYSCALL with strArgs passes literal strings', () => {
      const captured = [];
      kernel.registerSyscall(200, (args) => { captured.push(...args); return 0; });
      cpu.run([
        { op: 'SYSCALL', num: 200, strArgs: ['hello', 'world'] },
        { op: 'HALT' },
      ]);
      expect(captured).toEqual(['hello', 'world']);
    });
  });

  describe('Unknown opcode', () => {
    test('throws on unknown opcode', () => {
      expect(() => {
        cpu.run([{ op: 'INVALID' }]);
      }).toThrow(/Unknown opcode/);
    });
  });

  describe('loadProgram', () => {
    test('throws for non-array input', () => {
      expect(() => cpu.loadProgram('not-an-array')).toThrow(TypeError);
    });

    test('resets state on loadProgram', () => {
      cpu.run([
        { op: 'LOADI', dst: 0, imm: 42 },
        { op: 'HALT' },
      ]);
      cpu.loadProgram([{ op: 'HALT' }]);
      expect(cpu.getRegs()[0]).toBe(0);
      expect(cpu.isHalted()).toBe(false);
    });
  });

  describe('reset', () => {
    test('resets all CPU state', () => {
      cpu.run([
        { op: 'LOADI', dst: 0, imm: 42 },
        { op: 'HALT' },
      ]);
      cpu.reset();
      expect(cpu.getRegs().every(r => r === 0)).toBe(true);
      expect(cpu.getPC()).toBe(0x0200);
      expect(cpu.getSP()).toBe(0x01FF);
      expect(cpu.getFlags()).toBe(0);
      expect(cpu.isHalted()).toBe(false);
      expect(cpu.isRunning()).toBe(false);
      expect(cpu.getCycles()).toBe(0);
    });
  });

  describe('Register accessors', () => {
    test('setReg and getReg work', () => {
      cpu.setReg(3, 123);
      expect(cpu.getReg(3)).toBe(123);
    });

    test('setMem and getMem work', () => {
      cpu.setMem(0x5000, 0xAB);
      expect(cpu.getMem(0x5000)).toBe(0xAB);
    });
  });

  describe('CPU SYS_CPU_INFO syscall', () => {
    test('syscall 10 returns CPU state', () => {
      cpu.run([
        { op: 'LOADI', dst: 0, imm: 42 },
        { op: 'HALT' },
      ]);
      const result = kernel.syscall(10, []);
      expect(result.status).toBe('ok');
      expect(result.result.halted).toBe(true);
      expect(result.result.regs[0]).toBe(42);
    });
  });

  describe('step()', () => {
    test('step returns false when halted', () => {
      cpu.loadProgram([{ op: 'HALT' }]);
      cpu.step(); // execute HALT
      expect(cpu.step()).toBe(false);
    });

    test('step returns false at end of program', () => {
      cpu.loadProgram([{ op: 'NOP' }]);
      cpu.step(); // NOP
      expect(cpu.step()).toBe(false);
    });

    test('step returns true when more instructions', () => {
      cpu.loadProgram([
        { op: 'NOP' },
        { op: 'NOP' },
        { op: 'HALT' },
      ]);
      expect(cpu.step()).toBe(true);
    });
  });

  describe('Case insensitivity', () => {
    test('opcodes are case-insensitive', () => {
      const result = cpu.run([
        { op: 'loadi', dst: 0, imm: 42 },
        { op: 'halt' },
      ]);
      expect(result.regs[0]).toBe(42);
    });
  });

  describe('cpu:ready event', () => {
    test('emits cpu:ready event on creation', () => {
      const handler = jest.fn();
      kernel.bus.on('cpu:ready', handler);
      createCPU(kernel);
      expect(handler).toHaveBeenCalledWith({ version: '4.0.0' });
    });
  });
});
