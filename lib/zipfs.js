// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 极简 ZIP 读取器（只用 node 内置 zlib，零依赖）。
 *
 * 为什么要它：docx / pptx / xlsx 都是 ZIP 包（OOXML），要把试卷和课件里的文字取出来
 * 就得先解开 ZIP。引入 jszip 之类会破坏本插件「零依赖、零构建」的前提，而读取 ZIP
 * 所需的部分其实很小——中央目录 + 两种压缩方式（STORED 与 DEFLATE），后者正好对应
 * `zlib.inflateRawSync`。
 *
 * 只做「读」，且只支持 OOXML 实际会用到的特性：
 *   · 从文件尾部找 EOCD（End Of Central Directory），必要时跳过 ZIP64 定位记录
 *   · 遍历中央目录取出每个条目的名字、压缩方式、压缩/原始大小、本地头偏移
 *   · 解压 method 0（STORED）与 method 8（DEFLATE）
 *
 * 不支持（OOXML 不会用到，遇到就明确报错而不是悄悄给出坏数据）：
 *   加密、分卷、ZIP64 大文件（>4 GB）、其它压缩算法。
 *
 * @module dsh-highschool-tutor/zipfs
 */

import { inflateRawSync } from 'node:zlib'

/** 中央目录条目签名。 */
const SIG_CENTRAL = 0x02014b50
/** 本地文件头签名。 */
const SIG_LOCAL = 0x04034b50
/** EOCD 签名。 */
const SIG_EOCD = 0x06054b50

/** 单个条目解压后的体积上限（16 MB，一份试卷的 document.xml 远小于此）。 */
const ENTRY_CAP = 16 * 1024 * 1024

/**
 * 在文件尾部定位 EOCD。
 * @param {Buffer} buf ZIP 字节。
 * @returns {number} EOCD 偏移；找不到返回 -1。
 */
function findEocd(buf) {
  // EOCD 固定 22 字节，注释最长 65535，所以从尾部往前最多找 65557 字节
  const start = Math.max(0, buf.length - 65_557)
  for (let i = buf.length - 22; i >= start; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i
  }
  return -1
}

/**
 * 判断字节流是否像 ZIP（docx/pptx 检测用）。
 * @param {Buffer} buf 字节。
 * @returns {boolean} 是否 ZIP。
 */
export function isZip(buf) {
  return Buffer.isBuffer(buf) && buf.length > 4 && buf.readUInt32LE(0) === SIG_LOCAL
}

/**
 * 读取 ZIP 的条目表。
 * @param {Buffer} buf ZIP 字节。
 * @returns {Array<{name: string, method: number, size: number, packed: number, offset: number}>} 条目表。
 * @throws {Error} 结构损坏或用了不支持的特性时。
 */
export function listEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('不是有效的 ZIP：文件太小')
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('不是有效的 ZIP：找不到中央目录（文件可能被截断）')
  const count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  if (offset === 0xffffffff) throw new Error('不支持 ZIP64 格式的大文件')

  const entries = []
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buf.length) throw new Error('ZIP 中央目录越界')
    if (buf.readUInt32LE(offset) !== SIG_CENTRAL) throw new Error('ZIP 中央目录签名不符')
    const flags = buf.readUInt16LE(offset + 8)
    if ((flags & 0x1) !== 0) throw new Error('不支持加密的 ZIP')
    const method = buf.readUInt16LE(offset + 10)
    const packed = buf.readUInt32LE(offset + 20)
    const size = buf.readUInt32LE(offset + 24)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const local = buf.readUInt32LE(offset + 42)
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen)
    entries.push({ name, method, size, packed, offset: local })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/**
 * 取出一个条目的原始字节。
 * @param {Buffer} buf ZIP 字节。
 * @param {object} entry listEntries 给出的条目。
 * @returns {Buffer} 解压后的字节。
 * @throws {Error} 压缩方式不支持或数据损坏时。
 */
export function readEntry(buf, entry) {
  const head = entry.offset
  if (head + 30 > buf.length) throw new Error(`条目 ${entry.name} 的本地头越界`)
  if (buf.readUInt32LE(head) !== SIG_LOCAL) throw new Error(`条目 ${entry.name} 的本地头签名不符`)
  const nameLen = buf.readUInt16LE(head + 26)
  const extraLen = buf.readUInt16LE(head + 28)
  const start = head + 30 + nameLen + extraLen
  const end = start + entry.packed
  if (end > buf.length) throw new Error(`条目 ${entry.name} 的数据越界`)
  if (entry.size > ENTRY_CAP) throw new Error(`条目 ${entry.name} 解压后超过 ${ENTRY_CAP / 1024 / 1024} MB`)
  const raw = buf.subarray(start, end)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) return inflateRawSync(raw, { maxOutputLength: ENTRY_CAP })
  throw new Error(`条目 ${entry.name} 使用了不支持的压缩方式 ${entry.method}`)
}

/**
 * 打开一个 ZIP，返回按名字取内容的便捷接口。
 * @param {Buffer} buf ZIP 字节。
 * @returns {{names: string[], has: (name: string) => boolean, text: (name: string) => string|null, match: (re: RegExp) => string[]}} 接口。
 */
export function openZip(buf) {
  const entries = listEntries(buf)
  const byName = new Map(entries.map((e) => [e.name, e]))
  return {
    names: entries.map((e) => e.name),
    /** 是否存在该条目。 */
    has: (name) => byName.has(name),
    /**
     * 以 UTF-8 文本读出某条目（不存在返回 null）。
     * @param {string} name 条目名。
     * @returns {string|null} 文本。
     */
    text(name) {
      const entry = byName.get(name)
      if (entry === undefined) return null
      return readEntry(buf, entry).toString('utf8')
    },
    /**
     * 按正则筛出条目名（用于 ppt/slides/slide*.xml 这类批量条目）。
     * @param {RegExp} re 正则。
     * @returns {string[]} 命中的条目名。
     */
    match(re) {
      return entries.map((e) => e.name).filter((n) => re.test(n))
    },
  }
}
