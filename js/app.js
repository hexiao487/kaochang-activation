/* 烤肠店 · 激活码服务 —— 页面逻辑
   本文件只做界面与输入输出，所有算法都来自 js/activation-core.js（与手环端同一份源码）。 */
(function () {
  'use strict'

  /* ------------------------------------------------------------------
     商家口令：改成你自己的口令即可（改完把本文件提交到仓库就生效）。
     注意：静态站点无法真正保护口令，它只用于避免生成入口被随意使用。
     ------------------------------------------------------------------ */
  var MERCHANT_PIN = 'kaochang-2026'

  /* 与手环端逐位一致的 7 组标准向量（用于本站自检） */
  var VEC = [
    ['AC-01', '2136393151', '538747359444'],
    ['AC-02', '6737069295', '194273463922'],
    ['AC-03', '7038707127', '873182195262'],
    ['AC-04', '1233439612', '586609443448'],
    ['AC-05', '2287557528', '255233604433'],
    ['SAMPLE-A', '2632494864', '359027042953'],
    ['SAMPLE-B', '2798026028', '805658951651']
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

  /* ---------------- 商家口令 ---------------- */
  var unlocked = false
  try { unlocked = sessionStorage.getItem('kao_unlock') === '1' } catch (e) { unlocked = false }

  function setUnlocked(v) {
    unlocked = v
    $('genArea').hidden = !v
    $('pinMsg').textContent = v ? '口令正确，生成器已解锁。' : ''
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

  /* ---------------- 单个生成 ---------------- */
  var lastAc = ''

  function devProblem(dev) {
    if (!dev) { return '请先输入设备码。' }
    if (dev.length !== 10) { return '设备码应为 10 位数字（手环上显示为 5-5 两段），当前 ' + dev.length + ' 位。' }
    if (!AC.devOk(dev)) { return '设备码末位校验不通过，多半是抄错了；请对照手环激活页上的数字重新输入。' }
    return ''
  }

  $('dev').addEventListener('input', function () {
    var v = digits($('dev').value).slice(0, 10)
    if ($('dev').value !== v) { $('dev').value = v }
    $('dev').setAttribute('placeholder', '例如 2136393151')
  })

  $('genBtn').addEventListener('click', function () {
    var dev = digits($('dev').value)
    var bad = devProblem(dev)
    var msg = $('genMsg')
    if (bad) {
      msg.textContent = bad
      msg.className = 'msg err'
      $('genOut').hidden = true
      $('copyBtn').disabled = true
      lastAc = ''
      return
    }
    var ac = AC.acFor(dev)
    var r = AC.verify(dev, ac)
    lastAc = ac
    $('genAc').textContent = AC.fmtAc(ac)
    $('genDevLine').textContent = '设备码 ' + AC.fmtDev(dev) + ' · 激活码 ' + AC.fmtAc(ac)
    $('genVerdict').innerHTML = r.ok
      ? '<span class="badge ok">自校验通过</span> 该激活码在此设备上可用。'
      : '<span class="badge no">自校验异常</span> 请刷新页面重试。'
    $('genOut').hidden = false
    $('copyBtn').disabled = false
    msg.textContent = '已生成，复制后发给买家即可。'
    msg.className = 'msg good'
  })

  $('copyBtn').addEventListener('click', function () {
    if (!lastAc) { return }
    copy(AC.fmtAc(lastAc), $('genMsg'), '激活码已复制：' + AC.fmtAc(lastAc))
  })

  $('clearBtn').addEventListener('click', function () {
    $('dev').value = ''
    $('genOut').hidden = true
    $('genMsg').textContent = ''
    $('copyBtn').disabled = true
    lastAc = ''
    $('dev').focus()
  })

  /* ---------------- 批量生成 ---------------- */
  var batchText = ''

  $('batchBtn').addEventListener('click', function () {
    var lines = String($('batch').value).split(/[\r\n,;\s]+/).filter(function (x) { return x.trim() !== '' })
    var body = $('batchBody')
    var msg = $('batchMsg')
    body.innerHTML = ''
    batchText = ''
    if (!lines.length) {
      msg.textContent = '请先粘贴设备码，每行一个。'
      msg.className = 'msg err'
      $('batchOut').hidden = true
      $('batchCopy').disabled = true
      return
    }
    var okCount = 0
    var seen = {}
    lines.forEach(function (raw) {
      var dev = digits(raw)
      var problem = devProblem(dev)
      var tr = document.createElement('tr')
      var td1 = document.createElement('td')
      td1.className = 'mono'
      td1.textContent = AC.fmtDev(dev) || raw
      var td2 = document.createElement('td')
      td2.className = 'mono'
      var td3 = document.createElement('td')
      if (problem) {
        td2.textContent = '—'
        td3.innerHTML = '<span class="badge no">跳过</span> ' + problem
      } else {
        var ac = AC.acFor(dev)
        td2.textContent = AC.fmtAc(ac)
        if (seen[dev]) {
          td3.innerHTML = '<span class="badge ok">重复</span> 与上一行设备码相同'
        } else {
          td3.innerHTML = '<span class="badge ok">可用</span>'
        }
        seen[dev] = true
        batchText += AC.fmtDev(dev) + '\t' + AC.fmtAc(ac) + '\n'
        okCount++
      }
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3)
      body.appendChild(tr)
    })
    $('batchOut').hidden = false
    $('batchCopy').disabled = okCount === 0
    msg.textContent = '共 ' + lines.length + ' 行，成功 ' + okCount + ' 条。'
    msg.className = 'msg ' + (okCount ? 'good' : 'err')
  })

  $('batchCopy').addEventListener('click', function () {
    if (!batchText) { return }
    copy(batchText, $('batchMsg'), '已复制全部结果（设备码 ⇥ 激活码）')
  })

  /* ---------------- 回传模板 ---------------- */
  $('tplCopy').addEventListener('click', function () {
    copy($('tpl').textContent, null, '')
  })

  /* ---------------- 校验 ---------------- */
  var REASON = {
    ok: '匹配：这个激活码在该设备上可用。',
    format: '激活码应为 12 位数字（4-4-4 三段，共 12 位）。',
    checksum: '激活码末 2 位校验不对：可能是某一位输错了，也可能是这个激活码并不属于该设备码（核对一下是不是把别台的码给了这台设备）。',
    dev: '设备码异常：应为 10 位数字且末位校验正确。',
    mismatch: '激活码与这个设备码不匹配。'
  }

  $('checkBtn').addEventListener('click', function () {
    var dev = digits($('cDev').value)
    var ac = digits($('cAc').value)
    var r = AC.verify(dev, ac)
    var msg = $('checkMsg')
    msg.textContent = REASON[r.reason] || '无法判定。'
    msg.className = 'msg ' + (r.ok ? 'good' : 'err')
  })

  /* ---------------- 算法自检 ---------------- */
  $('selfBtn').addEventListener('click', function () {
    var body = $('selfBody')
    body.innerHTML = ''
    var pass = 0
    VEC.forEach(function (v) {
      var dev = AC.makeDev(v[0])
      var ac = AC.acFor(dev)
      var same = (dev === v[1] && ac === v[2])
      if (same) { pass++ }
      var tr = document.createElement('tr')
      var tds = [
        v[0],
        AC.fmtDev(dev),
        AC.fmtAc(v[2]),
        AC.fmtAc(ac),
        same ? '<span class="badge ok">一致</span>' : '<span class="badge no">不一致</span>'
      ]
      tds.forEach(function (t, i) {
        var td = document.createElement('td')
        if (i === 3) { td.innerHTML = t } else { td.textContent = t }
        if (i === 1 || i === 2) { td.className = 'mono' }
        tr.appendChild(td)
      })
      body.appendChild(tr)
    })
    $('selfOut').hidden = false
    var msg = $('selfMsg')
    msg.textContent = pass + ' / ' + VEC.length + ' 一致' + (pass === VEC.length ? '，本站算法与手环端一致。' : '，存在不一致，请勿使用本站生成结果。')
    msg.className = 'msg ' + (pass === VEC.length ? 'good' : 'err')
  })
})()