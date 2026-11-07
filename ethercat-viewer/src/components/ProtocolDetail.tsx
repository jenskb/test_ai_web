import { useMemo, useState } from "react";
import type { Datagram, EtherCATFrame, PacketRecord } from "../types";
import { frameTypeName } from "../ethercat/commands";
import { HexView } from "./HexView";

interface FieldNode {
  label: string;
  value: string;
  relOffset: number;
  length: number;
  warn?: boolean;
  children?: FieldNode[];
}

interface Props {
  buffer: ArrayBuffer;
  frame: EtherCATFrame;
  pkt: PacketRecord;
}

export function ProtocolDetail({ buffer, frame, pkt }: Props) {
  const [highlight, setHighlight] = useState<{ offset: number; length: number } | null>(
    null,
  );

  const tree = useMemo(() => buildTree(frame), [frame]);

  const onHighlight = (node: FieldNode) => {
    setHighlight({
      offset: pkt.dataOffset + node.relOffset,
      length: node.length,
    });
  };

  return (
    <section className="section">
      <div className="section-title">
        协议详情
        <span className="muted">
          帧 #{pkt.frameIndex}（{frame.datagrams.length} 个数据报）
        </span>
        <span className="spacer" />
        <button
          className="btn"
          onClick={() => {
            const bytes = new Uint8Array(
              buffer,
              pkt.dataOffset,
              pkt.dataLength,
            );
            let hex = "";
            for (let i = 0; i < bytes.length; i++) {
              hex += (bytes[i] ?? 0).toString(16).padStart(2, "0") + " ";
            }
            void navigator.clipboard?.writeText(hex.trim());
          }}
        >
          复制原始数据（HEX）
        </button>
      </div>
      <div className="detail-layout">
        <div className="tree">
          {tree.map((node, i) => (
            <TreeNode key={i} node={node} depth={0} onHighlight={onHighlight} />
          ))}
        </div>
        <HexView
          buffer={buffer}
          base={pkt.dataOffset}
          length={pkt.dataLength}
          highlight={highlight}
        />
      </div>
    </section>
  );
}

function buildTree(frame: EtherCATFrame): FieldNode[] {
  const nodes: FieldNode[] = [
    {
      label: "目的 MAC",
      value: frame.dstMac,
      relOffset: 0,
      length: 6,
    },
    {
      label: "源 MAC",
      value: frame.srcMac,
      relOffset: 6,
      length: 6,
    },
  ];

  let ethOffset = 12;
  frame.vlanTags.forEach((v, i) => {
    nodes.push({
      label: `VLAN 标签 ${i + 1}`,
      value: `TPID 0x${v.tpid.toString(16)} · TCI 0x${v.tci.toString(16)} · VID ${v.vid}`,
      relOffset: ethOffset,
      length: 4,
    });
    ethOffset += 4;
  });

  nodes.push({
    label: "EtherType",
    value: `0x${frame.etherType.toString(16).padStart(4, "0")} (EtherCAT)`,
    relOffset: ethOffset,
    length: 2,
  });

  const h = frame.ecatHeaderOffsetInPacket;
  nodes.push({
    label: "EtherCAT 帧头",
    value: `Length ${frame.frameLength} · Type ${frame.frameType}`,
    relOffset: h,
    length: 2,
    children: [
      { label: "Length", value: String(frame.frameLength), relOffset: h, length: 2 },
      {
        label: "Reserved",
        value: String(frame.frameReserved),
        relOffset: h,
        length: 2,
        warn: frame.frameReserved !== 0,
      },
      {
        label: "Type",
        value: `${frame.frameType} (${frameTypeName(frame.frameType)})`,
        relOffset: h,
        length: 2,
        warn: frame.frameType !== 1,
      },
    ],
  });

  if (frame.isDatagram) {
    frame.datagrams.forEach((dg, i) => {
      nodes.push(buildDatagramNode(dg, `数据报 ${i + 1}`));
    });
    if (frame.paddingLength > 0) {
      const padOffset =
        frame.ecatHeaderOffsetInPacket +
        2 +
        frame.frameLength;
      nodes.push({
        label: "以太网填充",
        value: `${frame.paddingLength} 字节`,
        relOffset: padOffset,
        length: frame.paddingLength,
      });
    }
  }

  frame.anomalies.forEach((a) => {
    nodes.push({
      label: "异常",
      value: a.message,
      relOffset: frame.ecatHeaderOffsetInPacket,
      length: 2,
      warn: true,
    });
  });

  return nodes;
}

function buildDatagramNode(dg: Datagram, title: string): FieldNode {
  const o = dg.offsetInPacket;
  const children: FieldNode[] = [
    {
      label: "Cmd",
      value: `${dg.cmdName} (${dg.cmd})`,
      relOffset: o,
      length: 1,
      warn: dg.cmdName === "UNKNOWN",
    },
    { label: "Idx", value: `0x${dg.idx.toString(16).padStart(2, "0")}`, relOffset: o + 1, length: 1 },
    ...(dg.logicalAddr !== undefined
      ? [
          {
            label: "逻辑地址",
            value: `0x${dg.logicalAddr.toString(16).padStart(8, "0")}`,
            relOffset: o + 2,
            length: 4,
          },
        ]
      : [
          {
            label: "ADP",
            value: `0x${(dg.adp ?? 0).toString(16).padStart(4, "0")}`,
            relOffset: o + 2,
            length: 2,
          },
          {
            label: "ADO",
            value: `0x${(dg.ado ?? 0).toString(16).padStart(4, "0")}`,
            relOffset: o + 4,
            length: 2,
          },
        ]),
    {
      label: "Length",
      value: `${dg.length} 字节`,
      relOffset: o + 6,
      length: 2,
    },
    {
      label: "标志位",
      value: `保留 ${dg.reservedBits} · 环回 ${dg.circulating ? "是" : "否"} · 后续 ${dg.more ? "有" : "无"}`,
      relOffset: o + 6,
      length: 2,
    },
    { label: "IRQ", value: `0x${dg.irq.toString(16).padStart(4, "0")}`, relOffset: o + 8, length: 2 },
  ];

  if (dg.length > 0) {
    children.push({
      label: "数据",
      value: `${dg.length} 字节`,
      relOffset: dg.dataOffsetInPacket,
      length: dg.length,
    });
  }

  children.push({
    label: "WKC",
    value: String(dg.wkc),
    relOffset: dg.wkcOffsetInPacket,
    length: 2,
    warn: dg.wkc === 0,
  });

  dg.anomalies.forEach((a) => {
    children.push({
      label: "异常",
      value: a.message,
      relOffset: o,
      length: 10,
      warn: true,
    });
  });

  return {
    label: title,
    value: `${dg.cmdName} · WKC ${dg.wkc}`,
    relOffset: o,
    length: 10 + dg.length + 2,
    warn: dg.anomalies.length > 0,
    children,
  };
}

function TreeNode({
  node,
  depth,
  onHighlight,
}: {
  node: FieldNode;
  depth: number;
  onHighlight: (n: FieldNode) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = node.children && node.children.length > 0;
  const pad = { paddingLeft: depth * 16 + 4 };

  return (
    <div className="tree-node">
      <div
        className={`tree-row ${hasChildren || node.length > 0 ? "clickable" : ""}`}
        style={pad}
        onClick={() => {
          if (hasChildren) setOpen((v) => !v);
          else if (node.length > 0) onHighlight(node);
        }}
        title={node.relOffset >= 0 ? `偏移 +${node.relOffset} 长度 ${node.length}` : undefined}
      >
        {hasChildren ? (
          <span className="toggle">{open ? "▾" : "▸"}</span>
        ) : (
          <span className="toggle" />
        )}
        <span className="key">{node.label}</span>
        <span className="val">: </span>
        <span className={`val ${node.warn ? "warn" : ""}`}>{node.value}</span>
        {node.relOffset >= 0 && (
          <span className="val offset">
            {"  "}(+{node.relOffset}, {node.length}B)
          </span>
        )}
      </div>
      {hasChildren && open && (
        <div>
          {node.children!.map((c, i) => (
            <TreeNode key={i} node={c} depth={depth + 1} onHighlight={onHighlight} />
          ))}
        </div>
      )}
    </div>
  );
}
