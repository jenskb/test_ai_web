// EtherCAT 命令码与寻址类型。
//
// 参考：Wireshark EtherCAT dissector（Beckhoff，packet-ethercat-datagram.c）
//      与 EtherCAT 规范 ETG.1000.4。命令码 0..14 为标准命令，255 为扩展命令。

/** 标准命令码 → 简称。 */
export const COMMAND_NAMES: Readonly<Record<number, string>> = {
  0: "NOP",
  1: "APRD",
  2: "APWR",
  3: "APRW",
  4: "FPRD",
  5: "FPWR",
  6: "FPRW",
  7: "BRD",
  8: "BWR",
  9: "BRW",
  10: "LRD",
  11: "LWR",
  12: "LRW",
  13: "ARMW",
  14: "FRMW",
};

/** 标准命令码 → 全称（用于详情展示）。 */
export const COMMAND_LONG_NAMES: Readonly<Record<number, string>> = {
  0: "No operation",
  1: "Auto Increment Physical Read",
  2: "Auto Increment Physical Write",
  3: "Auto Increment Physical ReadWrite",
  4: "Configured address Physical Read",
  5: "Configured address Physical Write",
  6: "Configured address Physical ReadWrite",
  7: "Broadcast Read",
  8: "Broadcast Write",
  9: "Broadcast ReadWrite",
  10: "Logical Read",
  11: "Logical Write",
  12: "Logical ReadWrite",
  13: "Auto Increment Physical Read Multiple Write",
  14: "Configured Address Physical Read Multiple Write",
};

/** 使用逻辑寻址的命令码。 */
const LOGICAL_COMMANDS = new Set<number>([10, 11, 12]);

/** 是否为逻辑寻址命令。 */
export function isLogicalCommand(cmd: number): boolean {
  return LOGICAL_COMMANDS.has(cmd);
}

/** 获取命令名（未知命令返回 "UNKNOWN"）。 */
export function commandName(cmd: number): string {
  return COMMAND_NAMES[cmd] ?? "UNKNOWN";
}

/** EtherCAT 帧头类型字段取值。 */
export const FRAME_TYPE_NAMES: Readonly<Record<number, string>> = {
  1: "EtherCAT 数据报",
  2: "ADS",
  3: "RAW-IO",
  4: "NV",
  5: "Mailbox",
};

export function frameTypeName(t: number): string {
  return FRAME_TYPE_NAMES[t] ?? `未知类型 (${t})`;
}
