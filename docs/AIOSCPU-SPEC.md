# AIOSCPU v1.0 — Instruction Set Architecture Specification

**Document:** AIOSCPU-SPEC.md  
**Version:** 1.0.0  
**Status:** Final  
**Platform:** AIOS Lite — AIOSCPU Prototype One

---

## 1. Overview

The **AIOSCPU** is a software-emulated 32-bit virtual processor that runs inside
AIOS Lite. It is implemented in pure JavaScript (`core/cpu.js`) and requires zero
external dependencies. It can execute programs on any device that has Node.js ≥ 14 —
including Android via Termux.

The AIOSCPU drives the OS from within: programs running on the CPU can call back into
the OS kernel via the `SYSCALL` instruction, creating a self-hosting loop where the
CPU is both the execution engine and a first-class OS citizen.

---

## 2. Registers

| Name   | Index | Width   | Purpose                                |
|--------|-------|---------|----------------------------------------|
| R0     | 0     | 32-bit  | General purpose / return value         |
| R1     | 1     | 32-bit  | General purpose / arg 1                |
| R2     | 2     | 32-bit  | General purpose / arg 2                |
| R3     | 3     | 32-bit  | General purpose                        |
| R4     | 4     | 32-bit  | General purpose                        |
| R5     | 5     | 32-bit  | General purpose                        |
| R6     | 6     | 32-bit  | General purpose                        |
| R7     | 7     | 32-bit  | General purpose / frame pointer        |
| PC     | —     | 32-bit  | Program Counter (instruction index)    |
| SP     | —     | 16-bit  | Stack Pointer (byte address)           |
| FLAGS  | —     | 8-bit   | Condition flags (ZF, SF, CF, OF)       |

All general-purpose registers are **signed 32-bit integers** (`Int32Array`).

### FLAGS Bits

| Bit | Name | Meaning                        |
|-----|------|--------------------------------|
| 0   | ZF   | Zero — last result was zero    |
| 1   | SF   | Sign — last result was negative|
| 2   | CF   | Carry                          |
| 3   | OF   | Overflow                       |

---

## 3. Memory Map

The AIOSCPU has a **64 KB** flat address space backed by a `Uint8Array`.

| Range           | Region         | Description                              |
|-----------------|----------------|------------------------------------------|
| `0x0000–0x00FF` | Zero page      | Reserved / OS scratch                    |
| `0x0100–0x01FF` | Stack          | Grows **downward** from `0x01FF`         |
| `0x0200–0x3FFF` | Program        | Default program load address             |
| `0x4000–0x7FFF` | Data           | Static / global data                     |
| `0x8000–0xFFFF` | Heap           | Dynamic allocation                       |

Memory is **byte-addressed**. The stack pointer (`SP`) starts at `0x01FF` and
decrements on push, increments on pop.

---

## 4. Instruction Format

Programs are arrays of plain JavaScript objects. This keeps them human-readable,
portable, and easy to generate programmatically.

```js
{ op: 'ADD', dst: 2, src1: 0, src2: 1 }
```

Every instruction has at minimum an `op` string (case-insensitive). Additional
fields depend on the instruction class.

---

## 5. Instruction Set

### 5.1 Control Flow

| Mnemonic | Fields              | Description                          |
|----------|---------------------|--------------------------------------|
| `NOP`    | —                   | No operation                         |
| `HALT`   | —                   | Stop execution                       |
| `JMP`    | `addr`              | Unconditional jump to instruction index |
| `JMPR`   | `reg`               | Jump to address in `R[reg]`          |
| `JZ`     | `addr`              | Jump if ZF set                       |
| `JNZ`    | `addr`              | Jump if ZF clear                     |
| `JLT`    | `addr`              | Jump if less than (SF ≠ OF)          |
| `JGT`    | `addr`              | Jump if greater than                 |
| `JLE`    | `addr`              | Jump if less than or equal           |
| `JGE`    | `addr`              | Jump if greater than or equal        |
| `CALL`   | `addr`              | Push return address, jump to addr    |
| `RET`    | —                   | Pop return address, jump to it       |

### 5.2 Data Movement

| Mnemonic | Fields                     | Description                         |
|----------|----------------------------|-------------------------------------|
| `MOV`    | `dst`, `src`               | `R[dst] = R[src]`                   |
| `LOADI`  | `dst`, `imm`               | `R[dst] = imm` (signed 32-bit literal) |
| `LOAD`   | `dst`, `addr`              | `R[dst] = MEM[addr]`                |
| `STORE`  | `src`, `addr`              | `MEM[addr] = R[src]`                |
| `LOADR`  | `dst`, `base`, `offset`    | `R[dst] = MEM[R[base] + offset]`    |
| `STORER` | `src`, `base`, `offset`    | `MEM[R[base] + offset] = R[src]`    |
| `PUSH`   | `src`                      | Push `R[src]` onto stack            |
| `POP`    | `dst`                      | Pop top of stack into `R[dst]`      |

### 5.3 Arithmetic

| Mnemonic | Fields                 | Description                           |
|----------|------------------------|---------------------------------------|
| `ADD`    | `dst`, `src1`, `src2`  | `R[dst] = R[src1] + R[src2]`          |
| `ADDI`   | `dst`, `src`, `imm`    | `R[dst] = R[src] + imm`               |
| `SUB`    | `dst`, `src1`, `src2`  | `R[dst] = R[src1] - R[src2]`          |
| `MUL`    | `dst`, `src1`, `src2`  | `R[dst] = R[src1] * R[src2]`          |
| `DIV`    | `dst`, `src1`, `src2`  | `R[dst] = trunc(R[src1] / R[src2])`   |
| `MOD`    | `dst`, `src1`, `src2`  | `R[dst] = R[src1] % R[src2]`          |

Arithmetic sets FLAGS. Division by zero sets OF and returns 0.

### 5.4 Bitwise

| Mnemonic | Fields                 | Description                        |
|----------|------------------------|------------------------------------|
| `AND`    | `dst`, `src1`, `src2`  | Bitwise AND                        |
| `OR`     | `dst`, `src1`, `src2`  | Bitwise OR                         |
| `XOR`    | `dst`, `src1`, `src2`  | Bitwise XOR                        |
| `NOT`    | `dst`, `src`           | Bitwise NOT                        |
| `SHL`    | `dst`, `src1`, `src2`  | Left shift                         |
| `SHR`    | `dst`, `src1`, `src2`  | Arithmetic right shift             |

### 5.5 Comparison

| Mnemonic | Fields          | Description                              |
|----------|-----------------|------------------------------------------|
| `CMP`    | `src1`, `src2`  | Set FLAGS based on `R[src1] - R[src2]`   |
| `CMPI`   | `src`, `imm`    | Set FLAGS based on `R[src] - imm`        |

Comparison does **not** write to any register — only updates FLAGS.

### 5.6 I/O and OS Interface

| Mnemonic   | Fields                       | Description                              |
|------------|------------------------------|------------------------------------------|
| `SYSCALL`  | `num`, `args?`, `strArgs?`   | Dispatch OS syscall, result → R0         |
| `IN`       | `dst`, `port`                | Read byte from port → `R[dst]`           |
| `OUT`      | `src`, `port`                | Write `R[src]` byte to port              |

---

## 6. Syscall Interface

The `SYSCALL` instruction dispatches to the OS kernel's syscall table.
Result is stored in `R0` after execution.

| Num | Name           | Args[0]       | Args[1]   | Returns                      |
|-----|----------------|---------------|-----------|------------------------------|
| 0   | SYS_WRITE      | string        | —         | 0                            |
| 1   | SYS_WRITELN    | string        | —         | 0                            |
| 2   | SYS_FS_READ    | path          | —         | file content string or null  |
| 3   | SYS_FS_WRITE   | path          | content   | bytes written or -1          |
| 4   | SYS_FS_MKDIR   | path          | —         | 0 or -1                      |
| 5   | SYS_FS_CD      | path          | —         | new cwd or null              |
| 6   | SYS_EXIT       | exit code     | —         | exit code                    |
| 7   | SYS_GETPID     | —             | —         | host process PID             |
| 8   | SYS_UPTIME     | —             | —         | OS uptime in seconds         |
| 9   | SYS_CPU_PRINT  | string        | —         | 0                            |
| 10  | SYS_CPU_INFO   | —             | —         | CPU state object             |

### SYSCALL Example (Hello World)

```js
const program = [
  { op: 'SYSCALL', num: 9, strArgs: ['Hello from AIOSCPU!'] },
  { op: 'HALT' },
];
cpu.run(program);
```

### SYSCALL Example (File Write)

```js
const program = [
  { op: 'SYSCALL', num: 3, strArgs: ['/tmp/hello.txt', 'Hello, filesystem!'] },
  { op: 'HALT' },
];
cpu.run(program);
```

---

## 7. CPU–Kernel Handshake

On creation, `createCPU(kernel)` registers the CPU module with the kernel and
wires up the syscall bridge:

```
CPU.run(program)
  └─ SYSCALL instruction
       └─ kernel.syscall(num, args)
            └─ _syscalls[num](args)
                 └─ OS action (write, fs, exit…)
                      └─ kernel.bus.emit('kernel:syscall', ...)
```

The kernel fires `cpu:ready` on its event bus when the CPU is initialised, allowing
other modules to know the CPU is available.

---

## 8. Execution Limits

| Parameter    | Value         |
|--------------|---------------|
| Max cycles   | 10,000,000    |
| Memory size  | 65,536 bytes  |
| Stack depth  | 255 frames    |
| Registers    | 8 (R0–R7)    |

If the cycle limit is reached, the CPU halts and emits `cpu:cycle-limit` on the
kernel event bus.

---

## 9. Sample Programs

### Fibonacci (first 10 terms printed)

```js
const fib = [
  { op: 'LOADI', dst: 0, imm: 0  },  // R0 = a = 0
  { op: 'LOADI', dst: 1, imm: 1  },  // R1 = b = 1
  { op: 'LOADI', dst: 3, imm: 10 },  // R3 = counter = 10
  // loop (PC=3):
  { op: 'SYSCALL', num: 9, strArgs: undefined, args: [0] }, // print R0
  { op: 'ADD',     dst: 2, src1: 0, src2: 1 },              // R2 = a + b
  { op: 'MOV',     dst: 0, src: 1  },                       // a = b
  { op: 'MOV',     dst: 1, src: 2  },                       // b = R2
  { op: 'ADDI',    dst: 3, src: 3, imm: -1 },               // counter--
  { op: 'CMPI',    src: 3, imm: 0 },
  { op: 'JNZ',     addr: 3 },                                // loop
  { op: 'HALT' },
];
```

### Counter with conditional jump

```js
const counter = [
  { op: 'LOADI', dst: 0, imm: 0  },  // R0 = 0
  { op: 'LOADI', dst: 1, imm: 5  },  // R1 = limit
  // loop (PC=2):
  { op: 'ADDI',  dst: 0, src: 0, imm: 1 },
  { op: 'CMP',   src1: 0, src2: 1 },
  { op: 'JLT',   addr: 2 },          // while R0 < 5, loop
  { op: 'HALT' },
];
```

---

*AIOSCPU Prototype One — AIOS Lite v1.0.0*
