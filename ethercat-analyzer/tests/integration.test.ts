import { describe, expect, it } from 'vitest';
import { parsePcapngBuffer } from '../src/parseBuffer';
import { FRAME_NOP, FRAME_TWO_DATAGRAMS, concat, epb, idb, shb, spb } from './fixtures';

describe('集成：统计与帧间隔', () => {
  it('同接口相邻 EtherCAT 帧间隔统计', () => {
    const buf = concat(
      shb(true),
      idb(true, { tsResol: 9 }), // 纳秒
      epb(true, { tsLow: 1000, data: FRAME_NOP }),
      epb(true, { tsLow: 2000, data: FRAME_NOP }),
      epb(true, { tsLow: 3000, data: FRAME_NOP }),
    );
    const r = parsePcapngBuffer(buf);
    expect(r.frames).toHaveLength(3);
    // 第一条无间隔，其余间隔均为 1000ns。
    expect(r.frames[0]!.intervalSec).toBeNull();
    expect(r.frames[1]!.intervalSec).toBeCloseTo(1e-6, 12);
    expect(r.frames[2]!.intervalSec).toBeCloseTo(1e-6, 12);

    const s = r.intervalStats[0]!;
    expect(s.count).toBe(2);
    expect(s.minSec).toBeCloseTo(1e-6, 12);
    expect(s.maxSec).toBeCloseTo(1e-6, 12);
    expect(s.meanSec).toBeCloseTo(1e-6, 12);
    expect(s.stddevSec).toBeCloseTo(0, 12);
    expect(s.regressions).toBe(0);
  });

  it('命令分布与数据报总数', () => {
    const buf = concat(
      shb(true),
      idb(true, { tsResol: 9 }),
      epb(true, { tsLow: 1000, data: FRAME_TWO_DATAGRAMS }),
    );
    const r = parsePcapngBuffer(buf);
    expect(r.stats.totalDatagrams).toBe(2);
    expect(r.stats.commandDistribution).toHaveLength(2); // LRD + NOP
    const lrd = r.stats.commandDistribution.find((c) => c.cmdName === 'LRD');
    const nop = r.stats.commandDistribution.find((c) => c.cmdName === 'NOP');
    expect(lrd?.count).toBe(1);
    expect(nop?.count).toBe(1);
  });

  it('时间戳倒退被标记', () => {
    const buf = concat(
      shb(true),
      idb(true, { tsResol: 9 }),
      epb(true, { tsLow: 3000, data: FRAME_NOP }),
      epb(true, { tsLow: 2000, data: FRAME_NOP }),
      epb(true, { tsLow: 1000, data: FRAME_NOP }),
    );
    const r = parsePcapngBuffer(buf);
    expect(r.frames[1]!.intervalSec).toBeLessThan(0);
    expect(r.intervalStats[0]!.regressions).toBe(2);
  });

  it('相同时间戳被标记', () => {
    const buf = concat(
      shb(true),
      idb(true, { tsResol: 9 }),
      epb(true, { tsLow: 1000, data: FRAME_NOP }),
      epb(true, { tsLow: 1000, data: FRAME_NOP }),
      epb(true, { tsLow: 2000, data: FRAME_NOP }),
    );
    const r = parsePcapngBuffer(buf);
    expect(r.frames[1]!.intervalSec).toBe(0);
    expect(r.intervalStats[0]!.equalTimestamps).toBe(1);
  });

  it('无时间戳帧不参与间隔统计', () => {
    // 混入 SPB（无时间戳）不应影响 EtherCAT 帧间隔。
    const buf = concat(
      shb(true),
      idb(true, { tsResol: 9 }),
      epb(true, { tsLow: 1000, data: FRAME_NOP }),
      spb(true, 28, FRAME_NOP), // 无时间戳
      epb(true, { tsLow: 2000, data: FRAME_NOP }),
    );
    const r = parsePcapngBuffer(buf);
    expect(r.frames).toHaveLength(3);
    expect(r.frames[1]!.timestampRaw).toBeNull();
    // 第二条 EtherCAT 帧（第 3 帧）的间隔仍以第 1 帧为基准 = 1000ns。
    expect(r.frames[2]!.intervalSec).toBeCloseTo(1e-6, 12);
  });

  it('解析异常数量统计', () => {
    const buf = concat(
      shb(true),
      idb(true, { linkType: 113 }), // 非以太网
      epb(true, { tsLow: 1, data: FRAME_NOP }),
    );
    const r = parsePcapngBuffer(buf);
    expect(r.frames[0]!.notEthernet).toBeDefined();
    expect(r.stats.anomalyCount).toBe(0); // notEthernet 不算解析异常
  });
});
