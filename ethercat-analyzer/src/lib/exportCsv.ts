// CSV 导出：帧摘要或数据报详情。包含帧序号与数据报序号，转义正确，兼容 Windows Excel。

import type { FrameIndex } from '../types';
import { toCsv, downloadText } from './csv';

function cmdSummary(f: FrameIndex): string {
  if (!f.ecat) return '';
  return f.ecat.datagrams.map((d) => d.cmdName).join(' ');
}

function wkcSummary(f: FrameIndex): string {
  if (!f.ecat) return '';
  return f.ecat.datagrams.map((d) => String(d.wkc)).join(' ');
}

function anomalyText(f: FrameIndex): string {
  return f.anomalies.join('；');
}

export function exportFramesCsv(frames: FrameIndex[], baseName: string): void {
  const header = [
    '帧序号',
    '接口',
    '相对时间(s)',
    '间隔(s)',
    '源MAC',
    '目的MAC',
    '帧长度',
    '原始长度',
    '数据报数',
    '命令摘要',
    'WKC摘要',
    '异常',
  ];
  const rows = frames.map((f) => [
    f.seq,
    f.interfaceId,
    f.relativeSec === null ? '' : f.relativeSec,
    f.intervalSec === null ? '' : f.intervalSec,
    f.eth?.srcMac ?? '',
    f.eth?.dstMac ?? '',
    f.capturedLen,
    f.origLen,
    f.ecat?.datagrams.length ?? 0,
    cmdSummary(f),
    wkcSummary(f),
    anomalyText(f),
  ]);
  downloadText(`${baseName}.frames.csv`, toCsv([header, ...rows]), 'text/csv;charset=utf-8');
}

export function exportDatagramsCsv(frames: FrameIndex[], baseName: string): void {
  const header = [
    '帧序号',
    '数据报序号',
    '接口',
    '相对时间(s)',
    '命令',
    '命令码',
    'Index',
    '地址(32位)',
    'ADP',
    'ADO',
    '逻辑地址',
    '数据长度',
    'IRQ',
    'WKC',
    '循环帧(C)',
    '后续数据报(M)',
    '异常',
  ];
  const rows: (string | number)[][] = [];
  for (const f of frames) {
    if (!f.ecat) continue;
    f.ecat.datagrams.forEach((d, i) => {
      rows.push([
        f.seq,
        i + 1,
        f.interfaceId,
        f.relativeSec === null ? '' : f.relativeSec,
        d.cmdName,
        d.cmdRaw,
        d.idx,
        `0x${d.address.toString(16).padStart(8, '0')}`,
        `0x${d.adp.toString(16).padStart(4, '0')}`,
        `0x${d.ado.toString(16).padStart(4, '0')}`,
        `0x${d.logicalAddress.toString(16).padStart(8, '0')}`,
        d.length,
        d.irq,
        d.wkc,
        d.circulating ? 1 : 0,
        d.more ? 1 : 0,
        d.error ?? '',
      ]);
    });
  }
  downloadText(`${baseName}.datagrams.csv`, toCsv([header, ...rows]), 'text/csv;charset=utf-8');
}
