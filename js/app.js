/* 烤肠店 · 激活码服务 —— 页面逻辑（v2 · 兑换码 + 设备码 双因子）
   本文件只做界面与输入输出，所有算法都来自 js/activation-core.js（与手环端同一份源码）；
   已发行兑换码清单来自 js/issued-codes.js（由 act-lab/gen_codes.js 从真源批量生成）。 */
(function () {
  'use strict'

  /* ------------------------------------------------------------------
     商家口令：改成你自己的口令即可（改完把本文件提交到仓库就生效）。
     注意：静态站点无法真正保护口令，它只用于避免生成入口被随意使用。
     注意：已发行清单本身也在 js/issued-codes.js 里，任何人都能看到；
     这里的口令只挡住"操作界面"，不构成对清单的保护。
     ------------------------------------------------------------------ */
  var MERCHANT_PIN = 'kaochang-2026'

  /* 与手环端逐位一致的 7 组标准向量 [seed, 设备码, 兑换码, 激活码]（用于本站自检） */
  var VEC = [
    ['AC-01', '2136393151', '010000000136', '209031985408'],
    ['AC-02', '6737069295', '010000000203', '691600186937'],
    ['AC-03', '7038707127', '020000010169', '241761630482'],
    ['AC-04', '1233439612', '070100000016', '715548925626'],
    ['AC-05', '2287557528', '999999999915', '770403373496'],
    ['SAMPLE-A', '2632494864', '000000000045', '190413063144'],
    ['SAMPLE-B', '2798026028', '120345678928', '109631774140']
  ]

  var $ = function (id) { return document.getElementById(id) }
  var digits = function (s) { return String(s == null ? '' : s).replace(/[^0-9]/g, '') }

  /* ---------------- 选项卡 ---------------- */
  var TAB = [['tab-buy', 'pane-buy'], ['tab-gen', 'pane-gen'], ['tab-check', 'pane-check']]
  TAB.forEach(function (pair, i) {
    $(pair[0]).addEventListener('click', function () {
      TAB.forEach(function (p, j) {
        $(p[0]).classList.toggle('on', i === j)
        $(p[0]).setAttribute('aria-selected', i === j ? 'true' : 'false')
        $(p[1]).classList.toggle('on', i === j)
      })
    })
  })

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
      if (msgEl) { msgEl.textContent = done ? okText : '复制失败，请手动选中文本复制' }
      if (msgEl) { msgEl.className = 'msg ' + (done ? 'good' : 'err') }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        if (msgEl) { msgEl.textContent = okText; msgEl.className = 'msg good' }
      }, fallback)
    } else { fallback() }
  }

  /* ---------------- 下载（纯前端 Blob，不联网） ---------------- */
  function download(name, text, type) {
    try {
      var blob = new Blob([text], { type: type })
      var a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      document.body.appendChild(a)
      a.click()
      setTimeout(function () {
        try { URL.revokeObjectURL(a.href) } catch (e) {}
        if (a.parentNode) { a.parentNode.removeChild(a) }
      }, 0)
      return true
    } catch (e) { return false }
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
  numeric('issQ', 12)
  numeric('rcBatch', 2); numeric('rcStart', 8); numeric('rcCount', 3)
  numeric('aRc', 12); numeric('aDev', 10)
  numeric('cRc', 12); numeric('cDev', 10); numeric('cAc', 12)

  /* ================= 一、买家自助兑换 ================= */
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
    msg.textContent = '已兑换，复制激活码后到「第 4 步」输入即可。'
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

  /* ================= 二、商家口令 ================= */
  var unlocked = false
  try { unlocked = sessionStorage.getItem('kao_unlock') === '1' } catch (e) { unlocked = false }

  function setUnlocked(v) {
    unlocked = v
    $('genArea').hidden = !v
    $('pinMsg').textContent = v ? '口令正确，商家工具已解锁。' : ''
    $('pinMsg').className = 'msg ' + (v ? 'good' : '')
  }
  if (unlocked) { $('pin').value = '（已解锁）'; setUnlocked(true) }

  $('pin').addEventListener('input', function () {
    var v = $('pin').value
    if (v === MERCHANT_PIN) {
      try { sessionStorage.setItem('kao_unlock', '1') } catch (e) {}
      setUnlocked(true)
    } else {
      if (unlocked) { try { sessionStorage.removeItem('kao_unlock') } catch (e) {} }
      $('genArea').hidden = true
      $('pinMsg').textContent = v ? '口令不正确。' : ''
      $('pinMsg').className = 'msg ' + (v ? 'err' : '')
    }
  })

  /* ================= 三、站点已发行批次清单 ================= */
  var issText = ''

  function issRender() {
    var n = ISSUED.LIST.length
    $('issMsg').textContent = '批次 ' + ISSUED.BATCH + ' · 起序号 ' + ISSUED.START + ' · 共 ' + n + ' 个 · 生成日期 ' + ISSUED.GEN + '。站点「自助兑换」只放行这些兑换码。'
    $('issMsg').className = 'msg good'
    $('issCopy').disabled = n === 0
    $('issCsv').disabled = n === 0
    $('issTxt').disabled = n === 0
  }
  issRender()

  $('issFill').addEventListener('click', function () {
    var body = $('issBody')
    body.innerHTML = ''
    ISSUED.LIST.forEach(function (rc, i) {
      var info = AC.rcInfo(rc) || { seq: '' }
      var tr = document.createElement('tr')
      var c1 = document.createElement('td'); c1.textContent = String(i + 1)
      var c2 = document.createElement('td'); c2.className = 'mono'; c2.textContent = AC.fmtRc(rc)
      var c3 = document.createElement('td'); c3.className = 'mono'; c3.textContent = info.seq
      tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3)
      body.appendChild(tr)
    })
    $('issOut').hidden = false
    $('issMsg').textContent = '已列出 ' + ISSUED.LIST.length + ' 个兑换码（批次 ' + ISSUED.BATCH + '）。'
    $('issMsg').className = 'msg good'
  })

  $('issCopy').addEventListener('click', function () {
    if (!ISSUED.LIST.length) { return }
    issText = ISSUED.LIST.map(function (rc) { return AC.fmtRc(rc) }).join('\n')
    copy(issText, $('issMsg'), '已复制 ' + ISSUED.LIST.length + ' 个兑换码')
  })

  $('issCsv').addEventListener('click', function () {
    var lines = ['序号,兑换码,兑换码数字,批次,批内序号,发放状态,买家,发放日期,订单号']
    ISSUED.LIST.forEach(function (rc, i) {
      var info = AC.rcInfo(rc) || { batch: ISSUED.BATCH, seq: '' }
      lines.push([i + 1, AC.fmtRc(rc), rc, info.batch, info.seq, '未发放', '', '', ''].join(','))
    })
    var ok = download('兑换码-批次' + ISSUED.BATCH + '-' + ISSUED.LIST.length + '个.csv',
      '\ufeff' + lines.join('\r\n') + '\r\n', 'text/csv;charset=utf-8')
    $('issMsg').textContent = ok ? '已下载 CSV（可直接用表格软件记买家与订单）。' : '当前浏览器不支持自动下载，请改用「复制全部」。'
    $('issMsg').className = 'msg ' + (ok ? 'good' : 'err')
  })

  $('issTxt').addEventListener('click', function () {
    var t = ISSUED.LIST.map(function (rc) { return AC.fmtRc(rc) }).join('\r\n') + '\r\n'
    var ok = download('兑换码-批次' + ISSUED.BATCH + '-' + ISSUED.LIST.length + '个.txt', t, 'text/plain;charset=utf-8')
    $('issMsg').textContent = ok ? '已下载 TXT（一行一个码，方便逐条私信发送）。' : '当前浏览器不支持自动下载，请改用「复制全部」。'
    $('issMsg').className = 'msg ' + (ok ? 'good' : 'err')
  })

  $('issQBtn').addEventListener('click', function () {
    var rc = digits($('issQ').value)
    var msg = $('issQMsg')
    if (!rc) { msg.textContent = '请输入兑换码。'; msg.className = 'msg err'; return }
    if (rc.length !== 12) { msg.textContent = '兑换码应为 12 位数字，当前 ' + rc.length + ' 位。'; msg.className = 'msg err'; return }
    if (!AC.rcOk(rc)) { msg.textContent = '兑换码末 2 位校验不对，多半是抄错了。'; msg.className = 'msg err'; return }
    if (ISSUED.has(rc)) {
      var info = AC.rcInfo(rc)
      msg.textContent = '属于本批次：' + AC.fmtRc(rc) + '（第 ' + ISSUED.posOf(rc) + ' 个，批内序号 ' + info.seq + '）。请核对该码是否已经发给过买家，避免重发。'
      msg.className = 'msg good'
    } else {
      msg.textContent = '校验位合法，但不在站点已发行批次内：它可能来自尚未发布的批次，或并非本站发行。'
      msg.className = 'msg'
    }
  })

  /* ================= 四、商家批量生成兑换码 ================= */
  var rcText = ''

  $('rcBtn').addEventListener('click', function () {
    var batch = digits($('rcBatch').value)
    var start = digits($('rcStart').value)
    var count = parseInt(digits($('rcCount').value), 10)
    var msg = $('rcMsg')
    var body = $('rcBody')
    body.innerHTML = ''
    rcText = ''
    if (batch === '') { batch = '0' }
    if (start === '') { start = '0' }
    if (!(count >= 1 && count <= 500)) {
      msg.textContent = '数量请填 1 到 500 之间的整数。'
      msg.className = 'msg err'
      $('rcOut').hidden = true
      $('rcCopy').disabled = true
      return
    }
    var b = parseInt(batch, 10)
    var s0 = parseInt(start, 10)
    var issuedCount = 0
    for (var i = 0; i < count; i++) {
      var seq = s0 + i
      var rc = AC.rcFor(b, seq)
      var tr = document.createElement('tr')
      var td1 = document.createElement('td')
      td1.textContent = AC.rcInfo(rc).seq
      var td2 = document.createElement('td')
      td2.className = 'mono'
      td2.textContent = AC.fmtRc(rc)
      var td3 = document.createElement('td')
      if (!AC.rcOk(rc)) {
        td3.innerHTML = '<span class="badge no">校验异常</span>'
      } else if (ISSUED.has(rc)) {
        td3.innerHTML = '<span class="badge ok">已发行</span>'
        issuedCount++
      } else {
        td3.innerHTML = '<span class="badge info">未发行</span>'
      }
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3)
      body.appendChild(tr)
      rcText += AC.fmtRc(rc) + '\n'
    }
    $('rcOut').hidden = false
    $('rcCopy').disabled = false
    msg.textContent = '批次 ' + String(b) + '，序号 ' + String(s0) + ' 起共 ' + count + ' 个兑换码，其中 ' + issuedCount +
      ' 个已在站点发行、可自助兑换。发出一个就登记一个，避免重发；新批次要在站点自助兑换，需要重新生成发行清单并重新发布。'
    msg.className = 'msg good'
  })

  $('rcCopy').addEventListener('click', function () {
    if (!rcText) { return }
    copy(rcText, $('rcMsg'), '已复制 ' + rcText.trim().split('\n').length + ' 个兑换码')
  })

  /* ================= 五、商家核发激活码 ================= */
  var lastAc = ''

  $('aBtn').addEventListener('click', function () {
    var rc = digits($('aRc').value)
    var dev = digits($('aDev').value)
    var msg = $('aMsg')
    var bad = rcProblem(rc) || devProblem(dev)
    if (bad) {
      msg.textContent = bad
      msg.className = 'msg err'
      $('aOut').hidden = true
      $('aCopy').disabled = true
      lastAc = ''
      return
    }
    var ac = AC.acFor(rc, dev)
    var r = AC.verify(rc, dev, ac)
    lastAc = ac
    $('aAc').textContent = AC.fmtAc(ac)
    $('aLine').textContent = '兑换码 ' + AC.fmtRc(rc) + (ISSUED.has(rc) ? '（已发行）' : '（未在站点发行批次内）') + ' · 设备码 ' + AC.fmtDev(dev)
    $('aVerdict').innerHTML = r.ok
      ? '<span class="badge ok">自校验通过</span> 该激活码在这台设备上可用。'
      : '<span class="badge no">自校验异常</span> 请刷新页面重试。'
    $('aOut').hidden = false
    $('aCopy').disabled = false
    msg.textContent = '已核发，复制后发给买家即可。台账里把该兑换码标记为已用。'
    msg.className = 'msg good'
  })

  $('aCopy').addEventListener('click', function () {
    if (!lastAc) { return }
    copy(AC.fmtAc(lastAc), $('aMsg'), '激活码已复制：' + AC.fmtAc(lastAc))
  })

  $('aClear').addEventListener('click', function () {
    $('aRc').value = ''
    $('aDev').value = ''
    $('aOut').hidden = true
    $('aMsg').textContent = ''
    $('aCopy').disabled = true
    lastAc = ''
    $('aRc').focus()
  })

  /* ================= 六、商家批量核发 ================= */
  var aBatchText = ''

  $('aBatchBtn').addEventListener('click', function () {
    var lines = String($('aBatch').value).split(/[\r\n]+/)
    var body = $('aBatchBody')
    var msg = $('aBatchMsg')
    body.innerHTML = ''
    aBatchText = ''
    var rows = []
    lines.forEach(function (raw) {
      var parts = raw.trim().split(/[\s,;\t]+/).filter(function (x) { return x !== '' })
      if (parts.length >= 2) { rows.push([parts[0], parts[1]]) }
    })
    if (!rows.length) {
      msg.textContent = '请先粘贴数据，每行一条：兑换码 空格 设备码。'
      msg.className = 'msg err'
      $('aBatchOut').hidden = true
      $('aBatchCopy').disabled = true
      return
    }
    var okCount = 0
    var notIssued = 0
    var seen = {}
    rows.forEach(function (pair) {
      var rc = digits(pair[0])
      var dev = digits(pair[1])
      var problem = rcProblem(rc) || devProblem(dev)
      var tr = document.createElement('tr')
      var td1 = document.createElement('td'); td1.className = 'mono'; td1.textContent = AC.fmtRc(rc) || pair[0]
      var td2 = document.createElement('td'); td2.className = 'mono'; td2.textContent = AC.fmtDev(dev) || pair[1]
      var td3 = document.createElement('td'); td3.className = 'mono'
      var td4 = document.createElement('td')
      if (problem) {
        td3.textContent = '—'
        td4.innerHTML = '<span class="badge no">跳过</span> ' + problem
      } else {
        var ac = AC.acFor(rc, dev)
        td3.textContent = AC.fmtAc(ac)
        var tag = seen[rc + dev] ? '<span class="badge no">重复</span>' : (ISSUED.has(rc) ? '<span class="badge ok">可用</span>' : '<span class="badge info">可用·未发行</span>')
        if (!ISSUED.has(rc)) { notIssued++ }
        td4.innerHTML = tag
        seen[rc + dev] = true
        aBatchText += AC.fmtRc(rc) + '\t' + AC.fmtDev(dev) + '\t' + AC.fmtAc(ac) + '\n'
        okCount++
      }
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4)
      body.appendChild(tr)
    })
    $('aBatchOut').hidden = false
    $('aBatchCopy').disabled = okCount === 0
    msg.textContent = '共 ' + rows.length + ' 条，成功 ' + okCount + ' 条' + (notIssued ? '（其中 ' + notIssued + ' 条兑换码不在站点发行批次内）' : '') + '。'
    msg.className = 'msg ' + (okCount ? 'good' : 'err')
  })

  $('aBatchCopy').addEventListener('click', function () {
    if (!aBatchText) { return }
    copy(aBatchText, $('aBatchMsg'), '已复制全部结果（兑换码 ⇥ 设备码 ⇥ 激活码）')
  })

  /* ================= 七、回传模板 ================= */
  $('tplCopy').addEventListener('click', function () {
    copy($('tpl').textContent, null, '')
  })

  /* ================= 八、三因子校验 ================= */
  var REASON = {
    ok: '匹配：兑换码、设备码、激活码三者配套，这个激活码在该设备上可用。',
    dev: '设备码异常：应为 10 位数字且末位校验正确。',
    rc: '兑换码应为 12 位数字（4-4-4 三段，共 12 位）。',
    rcsum: '兑换码末 2 位校验不对：多半是某一位抄错了，请向商家核对。',
    format: '激活码应为 12 位数字（4-4-4 三段，共 12 位）。',
    acsum: '激活码末 2 位校验不对：可能是某一位输错了，也可能是这个激活码并不属于这组「兑换码 + 设备码」。',
    mismatch: '激活码与这组「兑换码 + 设备码」不匹配：核对一下是不是把别台的激活码给了这台设备。'
  }

  $('checkBtn').addEventListener('click', function () {
    var rc = digits($('cRc').value)
    var dev = digits($('cDev').value)
    var ac = digits($('cAc').value)
    var r = AC.verify(rc, dev, ac)
    var msg = $('checkMsg')
    msg.textContent = REASON[r.reason] || '无法判定。'
    msg.className = 'msg ' + (r.ok ? 'good' : 'err')
    var ins = $('checkIssued')
    if (rc.length !== 12) {
      ins.textContent = ''
      ins.className = 'msg'
    } else if (ISSUED.has(rc)) {
      ins.textContent = '发行清单：属于本批次（批次 ' + ISSUED.BATCH + ' 第 ' + ISSUED.posOf(rc) + ' 个）。'
      ins.className = 'msg good'
    } else {
      ins.textContent = '发行清单：不在站点已发行批次内（校验位本身是否合法见上一行提示）。'
      ins.className = 'msg'
    }
  })

  /* ================= 九、算法自检 ================= */
  $('selfBtn').addEventListener('click', function () {
    var body = $('selfBody')
    body.innerHTML = ''
    var pass = 0
    VEC.forEach(function (v) {
      var dev = AC.makeDev(v[0])
      var ac = AC.acFor(v[2], dev)
      var same = (dev === v[1] && ac === v[3])
      if (same) { pass++ }
      var cells = [
        v[0],
        AC.fmtDev(dev),
        AC.fmtRc(v[2]),
        AC.fmtAc(v[3]),
        AC.fmtAc(ac),
        same ? '<span class="badge ok">一致</span>' : '<span class="badge no">不一致</span>'
      ]
      var tr = document.createElement('tr')
      cells.forEach(function (t, i) {
        var td = document.createElement('td')
        if (i === 1 || i === 2 || i === 3 || i === 4) { td.className = 'mono' }
        if (i === 5) { td.innerHTML = t } else { td.textContent = t }
        tr.appendChild(td)
      })
      body.appendChild(tr)
    })
    /* 发行清单自检：清单长度、每码与算法真源一致、批内序号连续、无重码 */
    var manifest = {
      len: ISSUED.LIST.length === ISSUED.COUNT && ISSUED.COUNT > 0,
      fresh: true,
      uniq: true,
      seq: true
    }
    var seen = {}
    ISSUED.LIST.forEach(function (rc, i) {
      if (!AC.rcOk(rc)) { manifest.fresh = false }
      if (AC.rcFor(ISSUED.BATCH, ISSUED.START + i) !== rc) { manifest.fresh = false }
      if (seen[rc]) { manifest.uniq = false }
      seen[rc] = true
      var info = AC.rcInfo(rc)
      if (!info || info.batch !== ISSUED.BATCH || Number(info.seq) !== ISSUED.START + i) { manifest.seq = false }
    })
    var manifestOk = manifest.len && manifest.fresh && manifest.uniq && manifest.seq
    $('selfOut').hidden = false
    var msg = $('selfMsg')
    var parts = []
    parts.push(pass + ' / ' + VEC.length + ' 一致')
    parts.push('发行清单 ' + ISSUED.LIST.length + ' 个' + (manifestOk ? '（与算法真源逐位一致、无重码、序号连续）' : '（校验不通过）'))
    msg.textContent = parts.join(' · ') + (pass === VEC.length && manifestOk ? '，本站可正常兑换。' : '，存在问题，请勿使用本站生成结果。')
    msg.className = 'msg ' + (pass === VEC.length && manifestOk ? 'good' : 'err')
  })
})()