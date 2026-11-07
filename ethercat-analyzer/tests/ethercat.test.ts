import { describe, expect, it } from 'vitest';
import { parseEthercat } from '../src/ethercat/ethercat';
import { commandName } from '../src/ethercat/commands';
import { FRAME_NOP, FRAME_TWO_DATAGRAMS, FRAME_UNKNOWN_CMD } from './fixtures';

function payloadOf(frame: Uint8Array): { payload: Uint8Array; payloadOffset: number } {
  return { payload: frame.subarray(14), payloadOffset: 14 };
}

describe('EtherCAT 数据报解析', () => {
  it('单个 NOP 数据报，字段偏移正确', () => {
    const { payload, payloadOffset } = payloadOf(FRAME_NOP);
    const { ecat } = parseEthercat(payload, payloadOffset);

    expect(ecat.frameType).toBe(1);
    expect(ecat.isDatagram).toBe(true);
    expect(ecat.headerLength).toBe(12);
    expect(ecat.datagrams).toHaveLength(1);

    const d = ecat.datagrams[0]!;
    expect(d.cmdRaw).toBe(0x00);
    expect(d.cmdName).toBe('NOP');
    expect(d.wkc).toBe(0);
    expect(d.length).toBe(0);
    expect(d.more).toBe(false);

    // 偏移映射到真实字节范围：帧头在 14，数据报头在 16。
    expect(d.offset).toBe(16); // cmd
    expect(d.offset + 1).toBe(17); // idx
    expect(d.offset + 2).toBe(18); // addr
    expect(d.offset + 6).toBe(22); // lenword
    expect(d.offset + 8).toBe(24); // irq
    expect(d.wkcOffset).toBe(26);
  });

  it('多个数据报：逻辑寻址 + NOP，标志位正确', () => {
    const { payload, payloadOffset } = payloadOf(FRAME_TWO_DATAGRAMS);
    const { ecat } = parseEthercat(payload, payloadOffset);

    expect(ecat.datagrams).toHaveLength(2);

    const lrd = ecat.datagrams[0]!;
    expect(lrd.cmdName).toBe('LRD');
    expect(lrd.isLogical).toBe(true);
    expect(lrd.isPhysical).toBe(false);
    expect(lrd.logicalAddress).toBe(0x00001234);
    expect(lrd.length).toBe(2);
    expect(lrd.wkc).toBe(1);
    expect(lrd.more).toBe(true);
    expect(lrd.circulating).toBe(false);

    const nop = ecat.datagrams[1]!;
    expect(nop.cmdName).toBe('NOP');
    expect(nop.more).toBe(false);

    // 第二个数据报紧跟在第一个之后：第一个占 14 字节（10 头 + 2 数据 + 2 WKC）。
    expect(nop.offset).toBe(lrd.offset + 14);
  });

  it('物理寻址命令显示 ADP/ADO', () => {
    // APRD cmd=1，地址 0x12345678 → 前 2 字节为 ADP（低 16 位 0x5678），后 2 字节为 ADO（高 16 位 0x1234）。
    const payload = Uint8Array.from([
      0x0c, 0x10, // 帧头 len=12 type=1
      0x01, 0x00, // APRD idx=0
      0x78, 0x56, 0x34, 0x12, // 地址 LE 0x12345678
      0x00, 0x00, // lenword dlen=0
      0x00, 0x00, // irq
      0x02, 0x00, // wkc=2
    ]);
    const { ecat } = parseEthercat(payload, 0);
    const d = ecat.datagrams[0]!;
    expect(d.cmdName).toBe('APRD');
    expect(d.isPhysical).toBe(true);
    expect(d.adp).toBe(0x5678);
    expect(d.ado).toBe(0x1234);
    expect(d.wkc).toBe(2);
  });

  it('未知命令保留原始值', () => {
    const { payload, payloadOffset } = payloadOf(FRAME_UNKNOWN_CMD);
    const { ecat } = parseEthercat(payload, payloadOffset);
    expect(ecat.datagrams).toHaveLength(1);
    const d = ecat.datagrams[0]!;
    expect(d.cmdRaw).toBe(0x7f);
    expect(d.cmdName).toBe('未知(0x7F)');
  });

  it('数据报声明长度越界被标记异常', () => {
    // 帧头声明 len=12，但实际数据报声明 dlen=10，超出可用字节。
    const payload = Uint8Array.from([
      0x0c, 0x10,
      0x05, 0x00, // FPWR idx=0
      0x00, 0x00, 0x00, 0x00,
      0x0a, 0x00, // lenword dlen=10, M=0
      0x00, 0x00, // irq
      0x00, 0x00, // 仅 2 字节“数据”，缺少 WKC
    ]);
    const { ecat } = parseEthercat(payload, 0);
    expect(ecat.error).toContain('越界');
    expect(ecat.datagrams[0]!.error).toContain('越界');
  });

  it('M 标志指示后续数据报但数据不足，标记异常', () => {
    const payload = Uint8Array.from([
      0x0c, 0x10,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x80, // lenword：dlen=0, M=1（声称有后续）
      0x00, 0x00,
      0x00, 0x00, // WKC
    ]);
    const { ecat } = parseEthercat(payload, 0);
    expect(ecat.error).toContain('后续');
  });

  it('M 标志 + 以太网填充：在帧头声明长度处停止，不把填充当数据报', () => {
    // 帧头声明 len=12，末尾数据报 M=1，但之后有 12 字节填充。
    const payload = Uint8Array.from([
      0x0c, 0x10, // 帧头 len=12
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, // NOP, M=1
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 填充
    ]);
    const { ecat } = parseEthercat(payload, 0);
    expect(ecat.datagrams).toHaveLength(1);
    expect(ecat.error).toContain('声明长度已耗尽');
  });

  it('非数据报类型不强行按数据报解析', () => {
    const payload = Uint8Array.from([0x0c, 0x20]); // type=2 (ADS)
    const { ecat } = parseEthercat(payload, 0);
    expect(ecat.isDatagram).toBe(false);
    expect(ecat.frameType).toBe(2);
    expect(ecat.error).toContain('非数据报');
  });

  it('命令表覆盖 15 个标准命令（含 NOP）', () => {
    const names = ['NOP', 'APRD', 'APWR', 'APRW', 'FPRD', 'FPWR', 'FPRW', 'BRD', 'BWR', 'BRW', 'LRD', 'LWR', 'LRW', 'ARMW', 'FRMW'];
    names.forEach((n, i) => {
      expect(commandName(i)).toBe(n);
    });
    expect(commandName(15)).toBe('保留(0x0F)');
    expect(commandName(255)).toBe('EXT');
    expect(commandName(0x7f)).toBe('未知(0x7F)');
  });
});
