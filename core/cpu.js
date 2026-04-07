'use strict';
/**
 * cpu.js — AIOSCPU v1.1 Virtual Processor
 *
 * A software-emulated CPU that runs AIOSCPU bytecode inside AIOS Lite.
 * Integrated from: Cbetts1/Digtail-Web-CPU (ISA design reference)
 *
 * v1.1 additions:
 *   - Memory bounds checking (throws E_CPU_BOUNDS on out-of-range access)
 *   - CPU self-test routine (selfTest())
 *   - Additional arithmetic ops: NEG, ABS, INC, DEC
 *
 * ISA Summary (32-bit word-addressed, object-encoded instructions):
 *   Registers : R0–R7 (general purpose), PC, SP, FLAGS
 *   Memory    : 64 KB (Uint8Array), word = 1 byte cell
 *   Stack     : 0x0100–0x01FF (grows down from 0x01FF)
 *   Program   : 0x0200–0x3FFF
 *   Data      : 0x4000–0x7FFF
 *   Heap      : 0x8000–0xFFFF
 *
 * Instructions use a plain-object format for readability & portability:
 *   { op: 'ADD', dst: 0, src1: 1, src2: 2 }
 *
 * Syscall convention: SYSCALL num [r0, r1, ...] dispatches to kernel.
 *
 * Pure Node.js CommonJS. Zero external dependencies.
 */

// ---------------------------------------------------------------------------
// OPCODE TABLE
// ---------------------------------------------------------------------------
const OP = Object.freeze({
  NOP:     0x00,
  HALT:    0xFF,
  // Data movement
  MOV:     0x01,   // R[dst] = R[src]
  LOADI:   0x02,   // R[dst] = imm  (signed 32-bit)
  LOAD:    0x03,   // R[dst] = MEM[addr]
  STORE:   0x04,   // MEM[addr] = R[src]
  LOADR:   0x05,   // R[dst] = MEM[R[base] + offset]
  STORER:  0x06,   // MEM[R[base] + offset] = R[src]
  // Arithmetic
  ADD:     0x10,   // R[dst] = R[src1] + R[src2]
  ADDI:    0x11,   // R[dst] = R[src]  + imm
  SUB:     0x12,   // R[dst] = R[src1] - R[src2]
  MUL:     0x13,   // R[dst] = R[src1] * R[src2]
  DIV:     0x14,   // R[dst] = R[src1] / R[src2]  (integer)
  MOD:     0x15,   // R[dst] = R[src1] % R[src2]
  NEG:     0x16,   // R[dst] = -R[src]
  ABS:     0x17,   // R[dst] = |R[src]|
  INC:     0x18,   // R[dst] = R[dst] + 1
  DEC:     0x19,   // R[dst] = R[dst] - 1
  // Bitwise
  AND:     0x20,
  OR:      0x21,
  XOR:     0x22,
  NOT:     0x23,   // R[dst] = ~R[src]
  SHL:     0x24,   // R[dst] = R[src1] << R[src2]
  SHR:     0x25,   // R[dst] = R[src1] >> R[src2]
  // Comparison
  CMP:     0x30,   // FLAGS = compare(R[src1], R[src2])
  CMPI:    0x31,   // FLAGS = compare(R[src],  imm)
  // Jumps
  JMP:     0x40,   // PC = addr
  JMPR:    0x41,   // PC = R[reg]
  JZ:      0x42,   // if ZF: PC = addr
  JNZ:     0x43,
  JLT:     0x44,
  JGT:     0x45,
  JLE:     0x46,
  JGE:     0x47,
  // Subroutines
  CALL:    0x50,   // push PC+1, PC = addr
  RET:     0x51,   // PC = pop()
  PUSH:    0x52,   // MEM[--SP] = R[src]
  POP:     0x53,   // R[dst] = MEM[SP++]
  // I/O / OS
  SYSCALL: 0x60,   // syscall(num, [args from registers])
  IN:      0x61,   // R[dst] = readByte(port)
  OUT:     0x62,   // writeByte(port, R[src])
});

// ---------------------------------------------------------------------------
// FLAGS bits
// ---------------------------------------------------------------------------
const FLAG_ZF = 1 << 0;  // Zero
const FLAG_SF = 1 << 1;  // Sign (negative)
const FLAG_CF = 1 << 2;  // Carry
const FLAG_OF = 1 << 3;  // Overflow

// ---------------------------------------------------------------------------
// AIOSCPU factory
// ---------------------------------------------------------------------------
function createCPU(kernel) {
  const CPU_VERSION = '4.0.0';
  const MEM_SIZE    = 65536;      // 64 KB
  const NUM_REGS    = 8;
  const STACK_BASE  = 0x01FF;
  const MAX_CYCLES  = 10_000_000; // safety cap per execution

  // State
  const regs = new Int32Array(NUM_REGS); // R0–R7
  const mem  = new Uint8Array(MEM_SIZE);
  let PC   = 0x0200;
  let SP   = STACK_BASE;
  let FLAGS = 0;
  let _running = false;
  let _halted  = false;
  let _cycles  = 0;

  // ---------------------------------------------------------------------------
  // Memory helpers (byte-level store for data; program is object array)
  // ---------------------------------------------------------------------------
  function memRead(addr) {
    if (addr < 0 || addr >= MEM_SIZE) {
      const err = new RangeError(`AIOSCPU: Memory read out of bounds: 0x${addr.toString(16)} (size=0x${MEM_SIZE.toString(16)})`);
      err.cpuCode = 'E_CPU_BOUNDS';
      if (kernel && kernel.bus) kernel.bus.emit('cpu:fault', { type: 'bounds', op: 'read', addr });
      throw err;
    }
    return mem[addr];
  }
  function memWrite(addr, value) {
    if (addr < 0 || addr >= MEM_SIZE) {
      const err = new RangeError(`AIOSCPU: Memory write out of bounds: 0x${addr.toString(16)} (size=0x${MEM_SIZE.toString(16)})`);
      err.cpuCode = 'E_CPU_BOUNDS';
      if (kernel && kernel.bus) kernel.bus.emit('cpu:fault', { type: 'bounds', op: 'write', addr });
      throw err;
    }
    mem[addr] = value & 0xFF;
  }

  // ---------------------------------------------------------------------------
  // Stack helpers
  // ---------------------------------------------------------------------------
  function stackPush(value) {
    if (SP < 0x0100) throw new Error('AIOSCPU: Stack overflow');
    memWrite(SP, value & 0xFF);
    SP--;
  }
  function stackPop() {
    if (SP >= STACK_BASE) throw new Error('AIOSCPU: Stack underflow');
    SP++;
    return memRead(SP);
  }

  // ---------------------------------------------------------------------------
  // Flags helpers
  // ---------------------------------------------------------------------------
  function setFlags(result, a, b, op) {
    FLAGS = 0;
    if (result === 0)          FLAGS |= FLAG_ZF;
    if (result < 0)            FLAGS |= FLAG_SF;
    if (op === 'ADD' && ((a > 0 && b > 0 && result < 0) || (a < 0 && b < 0 && result >= 0))) FLAGS |= FLAG_OF;
    if (op === 'SUB' && ((a < 0 && b > 0 && result >= 0) || (a > 0 && b < 0 && result < 0))) FLAGS |= FLAG_OF;
  }

  function isZF() { return (FLAGS & FLAG_ZF) !== 0; }
  function isSF() { return (FLAGS & FLAG_SF) !== 0; }
  function isOF() { return (FLAGS & FLAG_OF) !== 0; }

  // ---------------------------------------------------------------------------
  // Program storage: an array of instruction objects, indexed by PC
  // ---------------------------------------------------------------------------
  let _program = [];

  function loadProgram(instructions) {
    if (!Array.isArray(instructions)) throw new TypeError('Program must be an array of instructions');
    _program = instructions.slice();
    PC = 0;
    SP = STACK_BASE;
    FLAGS = 0;
    _halted = false;
    regs.fill(0);
  }

  // ---------------------------------------------------------------------------
  // Single instruction execute
  // ---------------------------------------------------------------------------
  function step() {
    if (_halted || PC >= _program.length) {
      _halted = true;
      _running = false;
      return false;
    }

    const instr = _program[PC];
    if (!instr || typeof instr.op !== 'string') {
      _halted = true;
      _running = false;
      return false;
    }

    const op = instr.op.toUpperCase();
    PC++; // advance before execution (CALL/JMP will override)

    switch (op) {
      case 'NOP': break;

      case 'HALT':
        _halted = true;
        _running = false;
        break;

      case 'MOV':
        regs[instr.dst] = regs[instr.src];
        break;

      case 'LOADI':
        regs[instr.dst] = instr.imm | 0;
        break;

      case 'LOAD':
        regs[instr.dst] = memRead(instr.addr);
        break;

      case 'STORE':
        memWrite(instr.addr, regs[instr.src]);
        break;

      case 'LOADR':
        regs[instr.dst] = memRead(regs[instr.base] + (instr.offset | 0));
        break;

      case 'STORER':
        memWrite(regs[instr.base] + (instr.offset | 0), regs[instr.src]);
        break;

      case 'ADD': {
        const a = regs[instr.src1], b = regs[instr.src2];
        const r = (a + b) | 0;
        regs[instr.dst] = r;
        setFlags(r, a, b, 'ADD');
        break;
      }
      case 'ADDI': {
        const a = regs[instr.src], b = instr.imm | 0;
        const r = (a + b) | 0;
        regs[instr.dst] = r;
        setFlags(r, a, b, 'ADD');
        break;
      }
      case 'SUB': {
        const a = regs[instr.src1], b = regs[instr.src2];
        const r = (a - b) | 0;
        regs[instr.dst] = r;
        setFlags(r, a, b, 'SUB');
        break;
      }
      case 'MUL':
        regs[instr.dst] = Math.imul(regs[instr.src1], regs[instr.src2]);
        break;

      case 'DIV': {
        const b = regs[instr.src2];
        if (b === 0) { regs[instr.dst] = 0; FLAGS |= FLAG_OF; break; }
        regs[instr.dst] = Math.trunc(regs[instr.src1] / b);
        break;
      }
      case 'MOD': {
        const b = regs[instr.src2];
        if (b === 0) { regs[instr.dst] = 0; FLAGS |= FLAG_OF; break; }
        regs[instr.dst] = regs[instr.src1] % b;
        break;
      }
      case 'NEG': {
        const r = (-regs[instr.src]) | 0;
        regs[instr.dst] = r;
        setFlags(r, regs[instr.src], 0, 'SUB');
        break;
      }
      case 'ABS': {
        const v = regs[instr.src];
        regs[instr.dst] = (v < 0 ? -v : v) | 0;
        FLAGS = regs[instr.dst] === 0 ? FLAG_ZF : 0;
        break;
      }
      case 'INC': {
        const r = (regs[instr.dst] + 1) | 0;
        regs[instr.dst] = r;
        setFlags(r, r - 1, 1, 'ADD');
        break;
      }
      case 'DEC': {
        const r = (regs[instr.dst] - 1) | 0;
        regs[instr.dst] = r;
        setFlags(r, r + 1, 1, 'SUB');
        break;
      }
      case 'AND':
        regs[instr.dst] = regs[instr.src1] & regs[instr.src2];
        break;
      case 'OR':
        regs[instr.dst] = regs[instr.src1] | regs[instr.src2];
        break;
      case 'XOR':
        regs[instr.dst] = regs[instr.src1] ^ regs[instr.src2];
        break;
      case 'NOT':
        regs[instr.dst] = ~regs[instr.src];
        break;
      case 'SHL':
        regs[instr.dst] = regs[instr.src1] << regs[instr.src2];
        break;
      case 'SHR':
        regs[instr.dst] = regs[instr.src1] >> regs[instr.src2];
        break;

      case 'CMP': {
        const r = (regs[instr.src1] - regs[instr.src2]) | 0;
        setFlags(r, regs[instr.src1], regs[instr.src2], 'SUB');
        break;
      }
      case 'CMPI': {
        const r = (regs[instr.src] - (instr.imm | 0)) | 0;
        setFlags(r, regs[instr.src], instr.imm | 0, 'SUB');
        break;
      }

      case 'JMP':  PC = instr.addr; break;
      case 'JMPR': PC = regs[instr.reg]; break;
      case 'JZ':   if (isZF())  PC = instr.addr; break;
      case 'JNZ':  if (!isZF()) PC = instr.addr; break;
      case 'JLT':  if (isSF() !== isOF()) PC = instr.addr; break;
      case 'JGT':  if (!isZF() && isSF() === isOF()) PC = instr.addr; break;
      case 'JLE':  if (isZF() || isSF() !== isOF()) PC = instr.addr; break;
      case 'JGE':  if (isSF() === isOF()) PC = instr.addr; break;

      case 'CALL':
        stackPush(PC); // return address already advanced
        PC = instr.addr;
        break;

      case 'RET':
        PC = stackPop();
        break;

      case 'PUSH':
        stackPush(regs[instr.src]);
        break;

      case 'POP':
        regs[instr.dst] = stackPop();
        break;

      case 'SYSCALL': {
        const num  = instr.num;
        const argRegs = Array.isArray(instr.args) ? instr.args : [];
        const argVals = argRegs.map(r => (typeof r === 'number' && r < NUM_REGS) ? regs[r] : r);
        // For string syscalls (PRINT), allow a literal string in args[0]
        const finalArgs = instr.strArgs ? instr.strArgs : argVals;
        const res = kernel.syscall(num, finalArgs);
        // Return value goes into R0
        regs[0] = (res && res.result !== undefined) ? (res.result | 0) : 0;
        break;
      }

      default:
        throw new Error(`AIOSCPU: Unknown opcode "${op}" at PC ${PC - 1}`);
    }

    _cycles++;
    return !_halted;
  }

  // ---------------------------------------------------------------------------
  // Run full program synchronously (up to MAX_CYCLES)
  // ---------------------------------------------------------------------------
  function run(program) {
    if (program) loadProgram(program);
    _running = true;
    _halted  = false;
    _cycles  = 0;

    while (_running && !_halted && _cycles < MAX_CYCLES) {
      step();
    }

    if (_cycles >= MAX_CYCLES) {
      _halted  = true;
      _running = false;
      if (kernel && kernel.bus) {
        kernel.bus.emit('cpu:cycle-limit', { cycles: _cycles });
      }
    }

    return { halted: _halted, cycles: _cycles, regs: Array.from(regs), flags: FLAGS };
  }

  // ---------------------------------------------------------------------------
  // CPU self-test — runs on boot, verifies core instructions work correctly
  // ---------------------------------------------------------------------------
  function selfTest() {
    const results = [];
    let passed = 0;
    let failed = 0;

    function check(label, actual, expected) {
      const ok = actual === expected;
      results.push({ label, ok, actual, expected });
      if (ok) passed++; else failed++;
    }

    // Save and restore CPU state around the self-test
    const savedRegs    = Array.from(regs);
    const savedPC      = PC;
    const savedSP      = SP;
    const savedFlags   = FLAGS;
    const savedHalted  = _halted;
    const savedRunning = _running;
    const savedCycles  = _cycles;
    const savedProgram = _program.slice();

    try {
      // Test 1: LOADI + ADD
      const t1 = run([
        { op: 'LOADI', dst: 0, imm: 10 },
        { op: 'LOADI', dst: 1, imm: 32 },
        { op: 'ADD',   dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      check('LOADI+ADD: R2=42', t1.regs[2], 42);

      // Test 2: SUB
      const t2 = run([
        { op: 'LOADI', dst: 0, imm: 100 },
        { op: 'LOADI', dst: 1, imm: 58  },
        { op: 'SUB',   dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      check('SUB: R2=42', t2.regs[2], 42);

      // Test 3: MUL
      const t3 = run([
        { op: 'LOADI', dst: 0, imm: 6  },
        { op: 'LOADI', dst: 1, imm: 7  },
        { op: 'MUL',   dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      check('MUL: R2=42', t3.regs[2], 42);

      // Test 4: DIV
      const t4 = run([
        { op: 'LOADI', dst: 0, imm: 126 },
        { op: 'LOADI', dst: 1, imm: 3   },
        { op: 'DIV',   dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ]);
      check('DIV: R2=42', t4.regs[2], 42);

      // Test 5: NEG
      const t5 = run([
        { op: 'LOADI', dst: 0, imm: -42 },
        { op: 'NEG',   dst: 1, src: 0   },
        { op: 'HALT' },
      ]);
      check('NEG: R1=42', t5.regs[1], 42);

      // Test 6: ABS
      const t6 = run([
        { op: 'LOADI', dst: 0, imm: -42 },
        { op: 'ABS',   dst: 1, src: 0   },
        { op: 'HALT' },
      ]);
      check('ABS: R1=42', t6.regs[1], 42);

      // Test 7: INC
      const t7 = run([
        { op: 'LOADI', dst: 0, imm: 41 },
        { op: 'INC',   dst: 0           },
        { op: 'HALT' },
      ]);
      check('INC: R0=42', t7.regs[0], 42);

      // Test 8: DEC
      const t8 = run([
        { op: 'LOADI', dst: 0, imm: 43 },
        { op: 'DEC',   dst: 0           },
        { op: 'HALT' },
      ]);
      check('DEC: R0=42', t8.regs[0], 42);

      // Test 9: JZ branch
      const t9 = run([
        { op: 'LOADI', dst: 0, imm: 0  },
        { op: 'CMPI',  src: 0, imm: 0  },
        { op: 'JZ',    addr: 4          },
        { op: 'LOADI', dst: 1, imm: 99 },  // should be skipped
        { op: 'LOADI', dst: 1, imm: 42 },
        { op: 'HALT' },
      ]);
      check('JZ: R1=42', t9.regs[1], 42);

      // Test 10: CALL / RET
      const t10 = run([
        { op: 'CALL',  addr: 2          },  // call sub at index 2
        { op: 'HALT'                    },
        { op: 'LOADI', dst: 0, imm: 42  },  // sub body
        { op: 'RET'                     },
      ]);
      check('CALL+RET: R0=42', t10.regs[0], 42);

    } finally {
      // Restore CPU state
      regs.fill(0);
      for (let i = 0; i < savedRegs.length; i++) regs[i] = savedRegs[i];
      PC       = savedPC;
      SP       = savedSP;
      FLAGS    = savedFlags;
      _halted  = savedHalted;
      _running = savedRunning;
      _cycles  = savedCycles;
      _program = savedProgram;
    }

    const allPassed = failed === 0;
    if (kernel && kernel.bus) {
      kernel.bus.emit('cpu:selftest', { passed, failed, allPassed, results });
    }
    return { passed, failed, allPassed, results };
  }

  // ---------------------------------------------------------------------------
  // CPU Module interface (for kernel module registry)
  // ---------------------------------------------------------------------------
  const cpuModule = {
    name:    'AIOSCPU',
    version: CPU_VERSION,
    OP,

    loadProgram,
    step,
    run,
    selfTest,

    // Register accessors
    getRegs:  () => Array.from(regs),
    getReg:   (n) => regs[n],
    setReg:   (n, v) => { regs[n] = v | 0; },
    getPC:    () => PC,
    getSP:    () => SP,
    getFlags: () => FLAGS,
    getMem:   (addr) => memRead(addr),
    setMem:   (addr, val) => memWrite(addr, val),

    isHalted:  () => _halted,
    isRunning: () => _running,
    getCycles: () => _cycles,
    reset() {
      regs.fill(0);
      mem.fill(0);
      PC    = 0x0200;
      SP    = STACK_BASE;
      FLAGS = 0;
      _halted  = false;
      _running = false;
      _cycles  = 0;
      _program = [];
    },
  };

  // Register extra syscalls that the CPU module provides
  if (kernel) {
    // SYS_CPU_INFO (10): dump CPU state
    kernel.registerSyscall(10, (_args) => {
      return {
        pc: PC, sp: SP, flags: FLAGS,
        regs: Array.from(regs),
        cycles: _cycles,
        halted: _halted,
      };
    });

    kernel.bus.emit('cpu:ready', { version: CPU_VERSION });
  }

  return cpuModule;
}

module.exports = { createCPU, OP };
