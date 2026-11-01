/* 烤肠店 · 激活码核心算法（单源实现 / v1）
 * 同一份逻辑同时驱动两端，保证同一设备码在两端得到逐位一致的激活码：
 *   1) 小米手环 Vela 快应用 —— 由 index.ux 内嵌同一份函数体（离线校验，不需要联网）
 *   2) 激活码生成网站       —— 逐字引用本文件（js/activation-core.js）
 * 仅使用 32 位整数运算（自实现 mul32，不依赖 Math.imul），不依赖任何平台 API。
 * 约定：所有中间值均为"无符号 32 位"，凡参与取模（%10 / %97）之前不带符号位。
 */
var AC = (function () {
  'use strict'

  var SALT = 'Kaochang#2026$Vela@0.5-ACT'
  var DSALT = 'Kaochang#2026$Vela@0.5-DEV'
  var ROUND_K = []

  /* 32 位乘法（低 32 位无符号）：避免依赖 Math.imul，且保证两端一致 */
  function mul32(a, b) {
    a = a >>> 0
    b = b >>> 0
    var al = a & 0xffff
    var ah = (a >>> 16) & 0xffff
    var bl = b & 0xffff
    var bh = (b >>> 16) & 0xffff
    var lo = al * bl
    var mid = ah * bl + al * bh
    return (lo + (mid & 0xffff) * 65536) >>> 0
  }

  function rotl(x, n) {
    n = n & 31
    if (n === 0) { return x >>> 0 }
    return ((x << n) | (x >>> (32 - n))) >>> 0
  }

  /* FNV-1a 变体：每字节异或后再乘质数，并按位置循环左移 */
  function hash32(s, seed) {
    var h = seed >>> 0
    for (var i = 0; i < s.length; i++) {
      h = (h ^ s.charCodeAt(i)) >>> 0
      h = mul32(h, 0x01000193)
      h = rotl(h, (i % 7) + 1)
    }
    return h >>> 0
  }

  /* 一轮非线性混合：常量注入 + 三次乘法 + 两次塌缩异或 + 两次变位循环左移 */
  function block(h, i) {
    h = (h ^ ((ROUND_K[i % 6] ^ (i * 0x9E3779B1)) >>> 0)) >>> 0
    h = mul32(h, 0x85EBCA6B)
    h = (h ^ (h >>> 15)) >>> 0
    h = mul32(h, 0xC2B2AE35)
    h = (h ^ (h >>> 13)) >>> 0
    h = rotl(h, (i % 13) + 5)
    h = mul32(h, 0x27D4EB2F)
    h = (h ^ (h >>> 16)) >>> 0
    return rotl(h, (i % 7) + 3)
  }

  for (var r = 0; r < 6; r++) {
    ROUND_K.push(hash32(SALT + '#' + r, mul32(0x9E3779B1 ^ (r * 0x27D4EB2F), 0x85EBCA6B)))
  }

  function normDev(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[^0-9]/g, '')
  }

  function normAc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[^0-9]/g, '')
  }

  function fmtDev(d) { return d.length === 10 ? d.slice(0, 5) + '-' + d.slice(5) : d }
  function fmtAc(a) { return a.length === 12 ? a.slice(0, 4) + '-' + a.slice(4, 8) + '-' + a.slice(8) : a }

  /* 激活码前 10 位：设备码经 6 轮混合后逐位产出 */
  function bodyOf(d) {
    var h = hash32(d, 0x811C9DC5)
    for (var i = 0; i < 6; i++) { h = block(h, i) }
    var g = hash32(SALT + '|' + d, h)
    h = mul32((h ^ g) >>> 0, 0x9E3779B1)
    h = block(h, 21)
    var out = ''
    var x = h
    for (var j = 0; j < 10; j++) {
      x = block(x, 30 + j * 3)
      out += String(x % 10)
    }
    return out
  }

  /* 激活码后 2 位：对设备码与前 10 位联合求校验，模 97（可区分"抄错"与"设备码不匹配"） */
  function checkOf(d, body) {
    var h = hash32(DSALT + '|' + d + '|' + body + '|' + SALT, 0x2545F491)
    h = block(h, 77)
    var m = h % 97
    return m < 10 ? '0' + m : String(m)
  }

  function acFor(dev) {
    var d = normDev(dev)
    if (d.length !== 10) { return '' }
    var body = bodyOf(d)
    return body + checkOf(d, body)
  }

  function verify(dev, ac) {
    var d = normDev(dev)
    var a = normAc(ac)
    if (d.length !== 10) { return { ok: false, reason: 'dev' } }
    if (a.length !== 12) { return { ok: false, reason: 'format' } }
    if (acFor(d) === a) { return { ok: true, reason: 'ok' } }
    if (checkOf(d, a.slice(0, 10)) !== a.slice(10)) { return { ok: false, reason: 'checksum' } }
    return { ok: false, reason: 'mismatch' }
  }

  /* 设备码第 10 位校验位：9 位随机串 + 1 位校验，防手抄错 */
  function devCheck(d9) {
    var s = 0
    for (var i = 0; i < d9.length; i++) {
      s = (s * 7 + (d9.charCodeAt(i) - 48) * (i + 3)) % 101
    }
    return String((s * 3 + 11) % 10)
  }

  function makeDev(seedStr) {
    var h = hash32(DSALT + '|' + seedStr, 0x1F123BB5)
    var out = ''
    for (var i = 0; i < 9; i++) {
      h = block(h, 100 + i)
      out += String(h % 10)
    }
    return out + devCheck(out)
  }

  var seq = 0

  /* 首次启动在设备上生成设备码：随机源 + 时间 + 序号，随后持久化到本地存储 */
  function genDev() {
    var a = 0
    var b = 0
    try { a = Math.floor(Math.random() * 4294967296) >>> 0 } catch (e) { a = 0 }
    try { b = (Date.now() % 4294967296) >>> 0 } catch (e) { b = 0 }
    seq = (seq + 1) % 100000
    var s = String(a) + '|' + String(b) + '|' + String(seq)
    return makeDev(s)
  }

  function devOk(d) {
    var t = normDev(d)
    if (t.length !== 10) { return false }
    return devCheck(t.slice(0, 9)) === t.slice(9)
  }

  return {
    mul32: mul32,
    hash32: hash32,
    acFor: acFor,
    verify: verify,
    genDev: genDev,
    makeDev: makeDev,
    devOk: devOk,
    fmtDev: fmtDev,
    fmtAc: fmtAc,
    normDev: normDev,
    normAc: normAc,
    SALT: SALT
  }
})()

if (typeof module !== 'undefined' && module.exports) { module.exports = AC }