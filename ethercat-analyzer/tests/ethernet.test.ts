import { describe, expect, it } from 'vitest';
import { parseEthernet, ETHERTYPE_ETHERCAT } from '../src/ethernet/ethernet';

function frame(...etherTypes: number[]): Uint8Array {
  const bytes = new Uint8Array(14 + etherTypes.length * 4);
  bytes.set([0x01, 0x01, 0x05, 0x01, 0x00, 0x00], 0); // dst
  bytes.set([0x00, 0x00, 0x00, 0x00, 0x00, 0x01], 6); // src
  let off = 12;
  etherTypes.forEach((et, i) => {
    bytes[off] = (et >> 8) & 0xff;
    bytes[off + 1] = et & 0xff;
    if (i < etherTypes.length - 1) {
      // TCI
      bytes[off + 2] = 0x00;
      bytes[off + 3] = 0x20; // VID 0x20
    }
    off += i < etherTypes.length - 1 ? 4 : 2;
  });
  return bytes.subarray(0, off);
}

describe('以太网解析', () => {
  it('普通以太网帧，EtherType 0x88A4', () => {
    const r = parseEthernet(frame(0x88a4));
    expect('eth' in r).toBe(true);
    if ('eth' in r) {
      expect(r.eth.etherType).toBe(ETHERTYPE_ETHERCAT);
      expect(r.eth.isEtherCAT).toBe(true);
      expect(r.eth.vlanTags).toHaveLength(0);
      expect(r.eth.payloadOffset).toBe(14);
      expect(r.eth.srcMac).toBe('00:00:00:00:00:01');
      expect(r.eth.dstMac).toBe('01:01:05:01:00:00');
    }
  });

  it('单个 VLAN 标签', () => {
    const r = parseEthernet(frame(0x8100, 0x88a4));
    if ('eth' in r) {
      expect(r.eth.vlanTags).toHaveLength(1);
      expect(r.eth.vlanTags[0]!.vid).toBe(0x20);
      expect(r.eth.etherType).toBe(0x88a4);
      expect(r.eth.isEtherCAT).toBe(true);
      expect(r.eth.payloadOffset).toBe(18);
    }
  });

  it('叠加 VLAN（VLAN + QinQ）', () => {
    const r = parseEthernet(frame(0x8100, 0x88a8, 0x88a4));
    if ('eth' in r) {
      expect(r.eth.vlanTags).toHaveLength(2);
      expect(r.eth.vlanTags[0]!.vid).toBe(0x20);
      expect(r.eth.vlanTags[1]!.vid).toBe(0x20);
      expect(r.eth.etherType).toBe(0x88a4);
      expect(r.eth.payloadOffset).toBe(22);
    }
  });

  it('非 EtherCAT EtherType', () => {
    const r = parseEthernet(frame(0x0800)); // IPv4
    if ('eth' in r) {
      expect(r.eth.isEtherCAT).toBe(false);
      expect(r.eth.etherType).toBe(0x0800);
    }
  });

  it('过短帧报错', () => {
    const r = parseEthernet(new Uint8Array(10));
    expect('error' in r).toBe(true);
  });
});
