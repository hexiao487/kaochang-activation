/* 烤肠店 · 激活码服务 —— 页面逻辑（仅「自助兑换」）
   本文件只做界面与输入输出，所有算法都来自 js/activation-core.js（与手环端同一份源码）；
   已发行兑换码清单来自 js/issued-codes.js（由 act-lab/gen_codes.js 从真源批量生成）。 */
(function () {
  'use strict'

  var $ = function (id) { return document.getElementById(id) }
  var digits = function (s) { return String(s == null ? '' : s).replace(/[^0-9]/g, '') }

  /* ---------------- 复制（含非安全上下文回退） ---------------- */
  function copy(text, msgEl, okText) {
    function fallback() {
      var ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', 'readonly')
      ta.style.position = 'fixed'
      ta.style.top = '-1000px'
      document.body.appendChild(ta)
      ta.select()
      var done = false
      try { done = document.execCommand('copy') } catch (e) { done = false }
      document.body.removeChild(ta)
      if (msgEl) {
        msgEl.textContent = done ? okText : '复制失败，请手动选中文本复制'
        msgEl.className = 'msg ' + (done ? 'good' : 'err')
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        if (msgEl) { msgEl.textContent = okText; msgEl.className = 'msg good' }
      }, fallback)
    } else { fallback() }
  }

  /* ---------------- 输入纠错与判定文案 ---------------- */
  function rcProblem(rc) {
    if (!rc) { return '请先输入兑换码。' }
    if (rc.length !== 12) { return '兑换码应为 12 位数字（显示为 4-4-4），当前 ' + rc.length + ' 位。' }
    if (!AC.rcOk(rc)) { return '兑换码末 2 位校验不对，多半是抄错了；请向商家核对后重输。' }
    return ''
  }

  function devProblem(dev) {
    if (!dev) { return '请先输入设备码。' }
    if (dev.length !== 10) { return '设备码应为 10 位数字（手环上显示为 5-5 两段），当前 ' + dev.length + ' 位。' }
    if (!AC.devOk(dev)) { return '设备码末位校验不通过，多半是抄错了；请对照手环激活页上的数字重新输入。' }
    return ''
  }

  /* 只允许数字：绑定到输入框，超长自动截断 */
  function numeric(id, max) {
    $(id).addEventListener('input', function () {
      var v = digits($(id).value).slice(0, max)
      if ($(id).value !== v) { $(id).value = v }
    })
  }
  numeric('rRc', 12); numeric('rDev', 10)

  /* ================= 自助兑换 ================= */
  var lastRedeemed = ''

  $('rBtn').addEventListener('click', function () {
    var rc = digits($('rRc').value)
    var dev = digits($('rDev').value)
    var msg = $('rMsg')
    function fail(text) {
      msg.textContent = text
      msg.className = 'msg err'
      $('rOut').hidden = true
      $('rCopy').disabled = true
      lastRedeemed = ''
    }
    var bad = rcProblem(rc) || devProblem(dev)
    if (bad) { fail(bad); return }
    if (!ISSUED.has(rc)) {
      fail('这个兑换码不在本站已发行批次（批次 ' + ISSUED.BATCH + '，共 ' + ISSUED.COUNT + ' 个）里。请确认是从商家私信里拿到的正规兑换码；若确认没抄错，请联系商家核对。')
      return
    }
    var ac = AC.acFor(rc, dev)
    var r = AC.verify(rc, dev, ac)
    lastRedeemed = ac
    $('rAc').textContent = AC.fmtAc(ac)
    $('rLine').textContent = '兑换码 ' + AC.fmtRc(rc) + ' · 设备码 ' + AC.fmtDev(dev) + ' · 本批次第 ' + ISSUED.posOf(rc) + ' 个'
    $('rVerdict').innerHTML = r.ok
      ? '<span class="badge ok">自校验通过</span> 这个激活码在这台设备上可用。'
      : '<span class="badge no">自校验异常</span> 请刷新页面重试。'
    $('rOut').hidden = false
    $('rCopy').disabled = false
    msg.textContent = '已兑换。复制激活码后到手环激活页输入，点「激活」即可。'
    msg.className = 'msg good'
  })

  $('rCopy').addEventListener('click', function () {
    if (!lastRedeemed) { return }
    copy(AC.fmtAc(lastRedeemed), $('rMsg'), '激活码已复制：' + AC.fmtAc(lastRedeemed))
  })

  $('rClear').addEventListener('click', function () {
    $('rRc').value = ''
    $('rDev').value = ''
    $('rOut').hidden = true
    $('rMsg').textContent = ''
    $('rCopy').disabled = true
    lastRedeemed = ''
    $('rRc').focus()
  })
})()