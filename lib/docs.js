// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 电子资料的文本抽取层（零依赖，只用 node 内置能力）。
 *
 * 目标：把现实中流传的试卷 / 课件 / 练习题文件变成纯文本，交给 paper.js 切题入库。
 *
 * 支持情况（按可靠程度排序）：
 *   docx  ✅ Word 试卷的主力格式。OOXML 是 ZIP，直接读 word/document.xml。
 *           还原了真实文档的几个坑：一句话被切成多个 w:r、w:tab/w:br、表格排版的选项。
 *   pptx  ✅ 课件主力格式。按 slideN.xml 的数字序读，每页留页码标记。
 *   txt/md/csv ✅ 纯文本。**中文 txt 常是 GBK**，这里做编码嗅探（UTF-8 严格解码失败就退 GBK）。
 *   html  ✅ 从网页复制/导出的题目。剥标签、解实体。
 *   pdf   ⚠️ 只识别、不解析：PDF 分两类——带文字层的（Word 导出）与纯扫描图片的。
 *           前者需要解析 xref/字体 CMap，后者只能 OCR。两者都不该悄悄给出半截乱码，
 *           所以这里明确报「需要另走一条路」，由调用方引导用户（详见 hint 字段）。
 *   图片  ⚠️ 同上，明确提示需要 OCR。
 *
 * @module dsh-highschool-tutor/docs
 */

import { isZip, openZip } from './zipfs.js'

/** 抽取出的文本长度上限（200 万字符，一份试卷 3 万字上下）。 */
const TEXT_CAP = 2_000_000

/** 各格式的中文名。 */
export const FORMAT_LABELS = {
  docx: 'Word 文档',
  pptx: 'PowerPoint 课件',
  xlsx: 'Excel 表格',
  pdf: 'PDF',
  html: '网页',
  md: 'Markdown',
  csv: 'CSV 表格',
  txt: '纯文本',
  image: '图片',
  unknown: '未知格式',
}

/**
 * 解 XML/HTML 实体。
 * @param {string} text 原文。
 * @returns {string} 结果。
 */
function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const code = parseInt(hex, 16)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    })
    .replace(/&amp;/g, '&')
}

/**
 * 文本编码嗅探：UTF-8 严格解码失败就按 GBK（中文 txt 的现实默认）处理。
 * @param {Buffer} buf 字节。
 * @returns {{text: string, encoding: string}} 文本与所用编码。
 */
export function decodeText(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf8'), encoding: 'utf-8 (BOM)' }
  }
  // UTF-16 BOM（Windows 记事本「Unicode」另存）
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'utf-16le' }
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'utf-16be' }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8' }
  } catch {
    try {
      return { text: new TextDecoder('gb18030').decode(buf), encoding: 'gb18030/gbk' }
    } catch {
      return { text: buf.toString('utf8'), encoding: 'utf-8 (兜底)' }
    }
  }
}

/**
 * 判定文件格式。字节特征优先于扩展名——现实里扩展名经常是错的。
 * @param {Buffer} buf 字节。
 * @param {string} [filename] 文件名（辅助判断）。
 * @returns {string} 格式标识。
 */
export function sniff(buf, filename = '') {
  const ext = /\.([a-z0-9]+)$/i.exec(String(filename))?.[1]?.toLowerCase() ?? ''
  if (Buffer.isBuffer(buf) && buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'pdf'
  if (Buffer.isBuffer(buf) && buf.length >= 4) {
    const b = buf
    if (b[0] === 0x89 && b[1] === 0x50) return 'image' // PNG
    if (b[0] === 0xff && b[1] === 0xd8) return 'image' // JPEG
    if (b.toString('latin1', 0, 4) === 'GIF8') return 'image'
    if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image'
  }
  if (isZip(buf)) {
    // OOXML 都是 ZIP，靠内部条目区分
    try {
      const zip = openZip(buf)
      if (zip.has('word/document.xml')) return 'docx'
      if (zip.match(/^ppt\/slides\/slide\d+\.xml$/).length > 0) return 'pptx'
      if (zip.has('xl/workbook.xml')) return 'xlsx'
    } catch {
      /* ZIP 结构坏了，往下按扩展名兜底 */
    }
    if (ext === 'docx' || ext === 'pptx' || ext === 'xlsx') return ext
    return 'unknown'
  }
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'csv') return 'csv'
  if (ext === 'htm' || ext === 'html') return 'html'
  if (ext === 'txt' || ext === 'text') return 'txt'
  const head = decodeText(Buffer.isBuffer(buf) ? buf.subarray(0, 2048) : Buffer.alloc(0)).text
  if (/<\s*(html|body|div|p|table)\b/i.test(head)) return 'html'
  if (/^#{1,6}\s|^\s*[-*]\s|\|.*\|/m.test(head)) return 'md'
  return 'txt'
}

/**
 * 从 docx 抽取正文。
 *
 * 三个真实世界的坑都处理了：
 *   ① 一个段落常被 Word 切成多个 w:r，必须拼回去；
 *   ② w:tab / w:br 是排版信息，试卷里用来排 ABCD 选项，要保留成 \t 与换行；
 *   ③ 选项经常放在表格里——表格行内的多个单元格要用 \t 连成一行，
 *      否则「A．…B．…C．…D．…」会散成四行，切题时认不出是同一题的选项。
 * @param {Buffer} buf docx 字节。
 * @returns {{text: string, warnings: string[]}} 正文与提示。
 */
export function extractDocx(buf) {
  const warnings = []
  const zip = openZip(buf)
  const xml = zip.text('word/document.xml')
  if (xml === null) throw new Error('docx 里找不到 word/document.xml（文件可能损坏）')

  /**
   * 把一段 XML 里的段落抽成文本行。
   * @param {string} chunk XML 片段。
   * @param {string} joiner 段落之间的连接符。
   * @returns {string} 文本。
   */
  const paragraphs = (chunk, joiner) => {
    const out = []
    for (const raw of chunk.split(/<\/w:p>/)) {
      // 制表与换行先落地成字符，避免被下面的取文本步骤丢掉
      const prepared = raw
        .replace(/<w:tab\s*\/>/g, '\u0009')
        .replace(/<w:(?:br|cr)\s*\/>/g, '\u000a')
      let line = ''
      const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|(\u0009|\u000a)/g
      let m = re.exec(prepared)
      while (m !== null) {
        line += m[1] !== undefined ? decodeEntities(m[1]) : m[2]
        m = re.exec(prepared)
      }
      if (line.trim() !== '') out.push(line)
    }
    return out.join(joiner)
  }

  // 表格与正文分开处理：表格行内的单元格用 \t 连接
  const lines = []
  let rest = xml
  let tableCount = 0
  for (;;) {
    const start = rest.indexOf('<w:tbl>')
    if (start < 0) break
    const end = rest.indexOf('</w:tbl>', start)
    if (end < 0) break
    lines.push(paragraphs(rest.slice(0, start), '\n'))
    const table = rest.slice(start, end)
    tableCount += 1
    for (const row of table.split(/<\/w:tr>/)) {
      const cells = paragraphs(row, '\t')
      if (cells.trim() !== '') lines.push(cells)
    }
    rest = rest.slice(end + 8)
  }
  lines.push(paragraphs(rest, '\n'))

  if (tableCount > 0) warnings.push(`文档含 ${tableCount} 个表格，表格行已按「单元格用制表符连接」还原`)
  if (/<w:drawing>|<w:pict>/.test(xml)) warnings.push('文档含图片，纯文本无法保留（涉及图形的题目建议配合动态演示重画）')

  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text: text.slice(0, TEXT_CAP), warnings }
}

/**
 * 从 pptx 抽取每页文字。
 * @param {Buffer} buf pptx 字节。
 * @returns {{text: string, warnings: string[], slides: number}} 正文、提示与页数。
 */
export function extractPptx(buf) {
  const warnings = []
  const zip = openZip(buf)
  const names = zip.match(/^ppt\/slides\/slide\d+\.xml$/)
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]))
  if (names.length === 0) throw new Error('pptx 里找不到任何幻灯片')
  const out = []
  for (let i = 0; i < names.length; i += 1) {
    const xml = zip.text(names[i]) ?? ''
    const lines = []
    for (const para of xml.split(/<\/a:p>/)) {
      let line = ''
      const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g
      let m = re.exec(para)
      while (m !== null) {
        line += decodeEntities(m[1])
        m = re.exec(para)
      }
      if (line.trim() !== '') lines.push(line.trim())
    }
    // 页码标记：课件转知识卡时，页边界就是天然的卡片边界
    out.push(`【第${i + 1}页】${lines.length > 0 ? `\n${lines.join('\n')}` : ''}`)
  }
  warnings.push(`共 ${names.length} 页；课件里的图表与公式图片无法转成文字`)
  const text = out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text: text.slice(0, TEXT_CAP), warnings, slides: names.length }
}

/**
 * 从 HTML 抽取正文。
 * @param {string} html 源码。
 * @returns {string} 正文。
 */
export function extractHtml(html) {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|tr|h[1-6]|section)>/gi, '\n')
      .replace(/<td[^>]*>/gi, '\t')
      .replace(/<[^>]+>/g, ''),
  ).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 统一入口：把任意支持的资料字节抽成纯文本。
 * @param {Buffer} buf 文件字节。
 * @param {string} [filename] 文件名。
 * @returns {{ok: boolean, format: string, label: string, text: string, warnings: string[], hint?: string, encoding?: string, slides?: number}} 抽取结果。
 */
export function extractText(buf, filename = '') {
  const format = sniff(buf, filename)
  const label = FORMAT_LABELS[format] ?? format
  try {
    if (format === 'docx') {
      const r = extractDocx(buf)
      return { ok: true, format, label, text: r.text, warnings: r.warnings }
    }
    if (format === 'pptx') {
      const r = extractPptx(buf)
      return { ok: true, format, label, text: r.text, warnings: r.warnings, slides: r.slides }
    }
    if (format === 'html') {
      const { text, encoding } = decodeText(buf)
      return { ok: true, format, label, text: extractHtml(text).slice(0, TEXT_CAP), warnings: [], encoding }
    }
    if (format === 'md' || format === 'txt' || format === 'csv') {
      const { text, encoding } = decodeText(buf)
      return {
        ok: true,
        format,
        label,
        text: text.replace(/\r\n/g, '\n').slice(0, TEXT_CAP),
        warnings: encoding.startsWith('gb') ? [`按 ${encoding} 解码（文件不是 UTF-8）`] : [],
        encoding,
      }
    }
    if (format === 'pdf') {
      return {
        ok: false,
        format,
        label,
        text: '',
        warnings: [],
        hint: 'PDF 暂不能直接解析：带文字层的 PDF 需要解析字体映射，扫描版 PDF 只能靠 OCR。'
          + '两条现成的路——① 用 Word/WPS 打开 PDF 另存为 .docx 再导入（对文字版 PDF 效果最好）；'
          + '② 直接把 PDF 或题目截图发在对话里，我用视觉/OCR 工具读出来后再写进题库。',
      }
    }
    if (format === 'image') {
      return {
        ok: false,
        format,
        label,
        text: '',
        warnings: [],
        hint: '图片需要 OCR：把图片直接发在对话里，我读出题目后写进题库（比先转文字再导入更准，因为我能同时看懂图和公式）。',
      }
    }
    if (format === 'xlsx') {
      return {
        ok: false,
        format,
        label,
        text: '',
        warnings: [],
        hint: 'Excel 暂不支持。若表格里是「题干/答案」两列，另存为 CSV 后导入即可（CSV 走已有的导入通道）。',
      }
    }
    return {
      ok: false,
      format,
      label,
      text: '',
      warnings: [],
      hint: '认不出这个文件格式。可支持：docx、pptx、txt、md、csv、html（PDF 请先转 docx，图片请直接发在对话里）。',
    }
  } catch (error) {
    return {
      ok: false,
      format,
      label,
      text: '',
      warnings: [],
      hint: `解析失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
