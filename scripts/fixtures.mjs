// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 HokkaidoCOLA
//
// dsh-highschool-tutor —— 高中三年学习与巩固助手（DSH 插件）。
// 本程序是自由软件：你可以依据自由软件基金会发布的 GNU 通用公共许可证
// （第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。
// 本程序按“无任何担保”发布，详见随包的 LICENSE 全文。

/**
 * dsh-highschool-tutor — 测试夹具：合成真实的 docx / pptx 样本。
 *
 * 机器上没有现成的试卷文件可用，而「解析 docx」这种能力**必须拿真实结构验证**，
 * 否则测试只是在测我自己的想象。所以这里写一个最小 ZIP 写入器（含正确的 CRC32，
 * 产物用系统解压工具也能打开），再按 OOXML 的真实骨架拼出 docx / pptx。
 *
 * 只在测试里使用，不随插件发布。
 *
 * @module dsh-highschool-tutor/scripts/fixtures
 */

import { deflateRawSync } from 'node:zlib'

/** CRC32 查表。 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

/**
 * 计算 CRC32。
 * @param {Buffer} buf 字节。
 * @returns {number} 无符号 CRC32。
 */
export function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/**
 * 打包成 ZIP。
 * @param {Array<{name: string, data: string|Buffer, store?: boolean}>} files 条目（store=true 用 STORED 不压缩）。
 * @returns {Buffer} ZIP 字节。
 */
export function makeZip(files) {
  const locals = []
  const central = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8')
    const store = file.store === true
    const body = store ? raw : deflateRawSync(raw)
    const crc = crc32(raw)
    const method = store ? 0 : 8

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0, 12) // date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, body)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4) // version made by
    dir.writeUInt16LE(20, 6) // version needed
    dir.writeUInt16LE(0, 8) // flags
    dir.writeUInt16LE(method, 10)
    dir.writeUInt16LE(0, 12)
    dir.writeUInt16LE(0, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(body.length, 20)
    dir.writeUInt32LE(raw.length, 24)
    dir.writeUInt16LE(name.length, 28)
    dir.writeUInt16LE(0, 30) // extra
    dir.writeUInt16LE(0, 32) // comment
    dir.writeUInt16LE(0, 34) // disk
    dir.writeUInt16LE(0, 36) // internal attrs
    dir.writeUInt32LE(0, 38) // external attrs
    dir.writeUInt32LE(offset, 42)
    central.push(dir, name)

    offset += local.length + name.length + body.length
  }

  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralBuf, eocd])
}

/** OOXML 的 [Content_Types].xml 骨架。 */
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
</Types>`

/**
 * XML 文本转义。
 * @param {string} text 原文。
 * @returns {string} 转义后。
 */
function esc(text) {
  return String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

/**
 * 合成一个 docx（Word 试卷的真实骨架：w:p 段落 / w:r 文本运行 / w:t 文本）。
 *
 * 特意还原真实文档的两个特征：
 *   · 一个段落被拆成多个 w:r（Word 会因为字体/样式变化把一句话切碎）；
 *   · 段落内出现 w:tab 与 w:br（试卷里排选项常用）。
 * @param {string[]} paragraphs 段落文本（'\t' 转成 w:tab）。
 * @returns {Buffer} docx 字节。
 */
export function makeDocx(paragraphs) {
  const body = paragraphs.map((text) => {
    // 把每段按 3 字切成多个 run，模拟 Word 把句子切碎的真实情况
    const parts = []
    const src = String(text)
    for (let i = 0; i < src.length; i += 3) parts.push(src.slice(i, i + 3))
    const runs = parts.map((p) => {
      if (p.includes('\t')) {
        return p.split('\t').map((seg, i) => (i === 0 ? `<w:r><w:t xml:space="preserve">${esc(seg)}</w:t></w:r>` : `<w:r><w:tab/><w:t xml:space="preserve">${esc(seg)}</w:t></w:r>`)).join('')
      }
      return `<w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r>`
    }).join('')
    return `<w:p>${runs}</w:p>`
  }).join('')
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr/></w:body></w:document>`
  return makeZip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES, store: true },
    { name: '_rels/.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>' },
    { name: 'word/document.xml', data: document },
  ])
}

/**
 * 合成一个 pptx（每页一个 slideN.xml，a:p 段落 / a:t 文本）。
 * @param {string[][]} slides 每页的文本行。
 * @returns {Buffer} pptx 字节。
 */
export function makePptx(slides) {
  const files = [
    { name: '[Content_Types].xml', data: CONTENT_TYPES, store: true },
    { name: '_rels/.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>' },
  ]
  slides.forEach((lines, i) => {
    const paras = lines.map((line) => `<a:p><a:r><a:t>${esc(line)}</a:t></a:r></a:p>`).join('')
    files.push({
      name: `ppt/slides/slide${i + 1}.xml`,
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:sp><p:txBody>${paras}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    })
  })
  return files.length > 2 ? makeZip(files) : makeZip(files)
}

/** 一份足够真实的数学试卷文本（用于切题器测试；同时也是 docx 样本的内容源）。 */
export const SAMPLE_PAPER = [
  '2024—2025学年第一学期期中考试',
  '高二数学试卷',
  '（考试时间120分钟，满分150分）',
  '一、单项选择题：本题共8小题，每小题5分，共40分。',
  '1．设集合A={1,2,3}，B={2,3,4}，则A∩B=（　　）',
  'A．{1,2}\tB．{2,3}\tC．{3,4}\tD．{1,4}',
  '2．已知函数f(x)=x²−2x，则f(x)的最小值为（　　）',
  'A．−1\tB．0\tC．1\tD．2',
  '3．若sinα=3/5，且α为第二象限角，则cosα=（　　）',
  'A．4/5\tB．−4/5\tC．3/4\tD．−3/4',
  '二、填空题：本题共4小题，每小题5分，共20分。',
  '9．函数y=√(x−1)的定义域为　　　　．',
  '10．等差数列{aₙ}中，a₁=1，d=2，则a₁₀=　　　　．',
  '三、解答题：本题共3小题，共50分。',
  '15．（12分）已知数列{aₙ}满足a₁=2，aₙ₊₁=2aₙ．',
  '（1）求证：{aₙ}是等比数列；',
  '（2）求{aₙ}的前n项和Sₙ．',
  '16．（14分）在△ABC中，角A、B、C的对边分别为a、b、c，且acosB+bcosA=2ccosC．',
  '（1）求角C的大小；',
  '（2）若c=2，求△ABC面积的最大值．',
  '参考答案',
  '1．B\t2．A\t3．B',
  '9．[1,+∞)\t10．19',
  '15．（1）因为aₙ₊₁/aₙ=2为常数，故{aₙ}是首项为2、公比为2的等比数列；（2）Sₙ=2ⁿ⁺¹−2．',
  '16．（1）由正弦定理得cosC=1/2，故C=π/3；（2）当a=b时面积最大，为√3．',
]
