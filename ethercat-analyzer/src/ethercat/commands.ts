// EtherCAT 数据报命令表。
// 依据：ETG.1000.4 与 Wireshark plugins/epan/ethercat/packet-ethercat-datagram.c（EcCmdShort/EcCmdLong）。
// 标准命令码 0x00-0x0E 共 15 个（含 NOP），0x0F 为保留值，0xFF 为 EXT 扩展，其余为未知。

export type Addressing = 'physical' | 'logical' | 'none';

export interface CommandInfo {
  short: string;
  long: string;
  addressing: Addressing;
}

export const ECAT_COMMANDS: Record<number, CommandInfo> = {
  0x00: { short: 'NOP', long: 'No operation（空操作）', addressing: 'none' },
  0x01: { short: 'APRD', long: 'Auto Increment Physical Read', addressing: 'physical' },
  0x02: { short: 'APWR', long: 'Auto Increment Physical Write', addressing: 'physical' },
  0x03: { short: 'APRW', long: 'Auto Increment Physical Read/Write', addressing: 'physical' },
  0x04: { short: 'FPRD', long: 'Configured Address Physical Read', addressing: 'physical' },
  0x05: { short: 'FPWR', long: 'Configured Address Physical Write', addressing: 'physical' },
  0x06: { short: 'FPRW', long: 'Configured Address Physical Read/Write', addressing: 'physical' },
  0x07: { short: 'BRD', long: 'Broadcast Read', addressing: 'physical' },
  0x08: { short: 'BWR', long: 'Broadcast Write', addressing: 'physical' },
  0x09: { short: 'BRW', long: 'Broadcast Read/Write', addressing: 'physical' },
  0x0a: { short: 'LRD', long: 'Logical Read', addressing: 'logical' },
  0x0b: { short: 'LWR', long: 'Logical Write', addressing: 'logical' },
  0x0c: { short: 'LRW', long: 'Logical Read/Write', addressing: 'logical' },
  0x0d: { short: 'ARMW', long: 'Auto Increment Physical Read Multiple Write', addressing: 'physical' },
  0x0e: { short: 'FRMW', long: 'Configured Address Physical Read Multiple Write', addressing: 'physical' },
  0xff: { short: 'EXT', long: 'Extension command（扩展命令）', addressing: 'none' },
};

export const ECAT_FRAME_TYPES: Record<number, string> = {
  1: 'EtherCAT 数据报（命令）',
  2: 'ADS',
  3: 'RAW-IO',
  4: 'NV',
  5: '邮箱（Mailbox）',
};

export function commandName(cmd: number): string {
  const c = ECAT_COMMANDS[cmd];
  if (c) return c.short;
  if (cmd === 0x0f) return '保留(0x0F)';
  return `未知(0x${cmd.toString(16).padStart(2, '0').toUpperCase()})`;
}

export function commandAddressing(cmd: number): Addressing {
  return ECAT_COMMANDS[cmd]?.addressing ?? 'none';
}

export function frameTypeName(t: number): string {
  return ECAT_FRAME_TYPES[t] ?? `未知(0x${t.toString(16).toUpperCase()})`;
}
