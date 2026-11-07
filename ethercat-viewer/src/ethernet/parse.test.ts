import { describe, it, expect } from "vitest";
import { parseEthernet, ETHERTYPE_ECAT } from "./parse";
import { ByteWriter } from "../test/helpers";

describe("parseEthernet", () => {
  it("解析普通以太网帧头与 EtherType", () => {
    const w = new ByteWriter();
    w.raw(1, 1, 5, 1, 0, 0); // dst
    w.raw(0, 0, 0, 0, 0, 1); // src
    w.u16be(0x88a4); // EtherCAT
    const r = parseEthernet(w.toUint8Array(), 0, w.length);
    expect(r.dstMac).toBe("01:01:05:01:00:00");
    expect(r.srcMac).toBe("00:00:00:00:00:01");
    expect(r.etherType).toBe(0x88a4);
    expect(r.isEtherCAT).toBe(true);
    expect(r.vlanTags).toHaveLength(0);
    expect(r.payloadOffset).toBe(14);
  });

  it("解析单个 VLAN 标签", () => {
    const w = new ByteWriter();
    w.raw(1, 1, 5, 1, 0, 0);
    w.raw(0, 0, 0, 0, 0, 1);
    w.u16be(0x8100); // TPID
    w.u16be(0x0005); // TCI (VLAN ID 5)
    w.u16be(0x88a4);
    const r = parseEthernet(w.toUint8Array(), 0, w.length);
    expect(r.vlanTags).toHaveLength(1);
    expect(r.vlanTags[0]!.tpid).toBe(0x8100);
    expect(r.vlanTags[0]!.vid).toBe(5);
    expect(r.etherType).toBe(ETHERTYPE_ECAT);
    expect(r.isEtherCAT).toBe(true);
    expect(r.payloadOffset).toBe(18);
  });

  it("解析叠加（双层）VLAN", () => {
    const w = new ByteWriter();
    w.raw(1, 1, 5, 1, 0, 0);
    w.raw(0, 0, 0, 0, 0, 1);
    w.u16be(0x88a8); // S-TAG
    w.u16be(0x000a);
    w.u16be(0x8100); // C-TAG
    w.u16be(0x000b);
    w.u16be(0x88a4);
    const r = parseEthernet(w.toUint8Array(), 0, w.length);
    expect(r.vlanTags).toHaveLength(2);
    expect(r.vlanTags[0]!.vid).toBe(0x0a);
    expect(r.vlanTags[1]!.vid).toBe(0x0b);
    expect(r.etherType).toBe(ETHERTYPE_ECAT);
    expect(r.payloadOffset).toBe(22);
  });

  it("非 EtherCAT EtherType 不被识别为 EtherCAT", () => {
    const w = new ByteWriter();
    w.raw(1, 1, 5, 1, 0, 0);
    w.raw(0, 0, 0, 0, 0, 1);
    w.u16be(0x0800); // IPv4
    const r = parseEthernet(w.toUint8Array(), 0, w.length);
    expect(r.isEtherCAT).toBe(false);
    expect(r.etherType).toBe(0x0800);
  });
});
