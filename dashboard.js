// dashboard.js — отрисовка дашборда. Данных здесь нет: их передает
// dashboard.html (локально, из data.js) или index.html (после расшифровки data.enc.js).
window.renderDashboard = function (D, root) {
  root.innerHTML = `
<div class="wrap">
  <header>
    <div>
      <div class="cap" id="title"></div>
      <div class="bal num" id="bal">—</div>
      <div class="pnl num" id="pnl"></div>
    </div>
    <div class="kpis" id="kpis"></div>
  </header>
  <div class="controls">
    <div class="seg" id="period" role="group" aria-label="Период">
      <button data-p="7">Неделя</button><button data-p="30">Месяц</button><button data-p="all" class="on">Все</button>
    </div>
    <div class="seg" id="pairs" role="group" aria-label="Пара"></div>
  </div>
  <div class="head2">
    <div class="cap">Equity · <span id="sel">Все пары</span><span id="net" class="num"></span></div>
    <div class="meta num" id="upd"></div>
  </div>
  <div id="chart"></div>
  <details>
    <summary class="cap">Сделки</summary>
    <div class="tbl"><table>
      <thead><tr><th class="cap">Закрыта</th><th class="cap">Пара</th><th class="cap">Сторона</th><th class="cap r">PnL</th><th class="cap r">Баланс</th></tr></thead>
      <tbody id="rows"></tbody>
    </table></div>
  </details>
</div>`;

  const C = { text: '#D3DDD9', muted: '#6E7C77', faint: '#46524D', line: '#19211E', base: '#2A3531',
              up: '#2FBF8C', down: '#C8524F', bg: '#0B0F0E', tip: '#0F1513', tipLine: '#232D29' };
  const MONO = 'Consolas, "JetBrains Mono", monospace';
  const SANS = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
  const T = 260;                                    // длительность анимаций, мс
  const NAMES = { EURUSD: 'EUR/USD', XAUUSD: 'XAU/USD', GBPUSD: 'GBP/USD', GER40: 'GER40' };
  const $ = id => document.getElementById(id);
  if (!D || !D.events) {
    $('chart').innerHTML = '<div class="empty">Нет данных. Запусти journal.py, он создаст web\\data.js</div>';
    return;
  }

  // ---------- форматирование ----------
  const nf = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const money = (v, sign) => (v < 0 ? '−' : sign && v > 0 ? '+' : '') + nf.format(Math.abs(v));
  const pad = n => String(n).padStart(2, '0');
  const dDate = ms => { const d = new Date(ms); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
  const dTime = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const name = p => NAMES[p] || p;
  const tone = v => v >= 0 ? 'up' : 'down';

  // ---------- исходные данные ----------
  const START = D.start, TARGET = D.target, MAXL = D.maxLoss, BE = START * 0.001;
  const trades = D.events.filter(e => e.kind === 'trade');
  const lastT = Math.max(D.updated, ...D.events.map(e => e.t));
  const firstT = D.events.length ? Math.min(...D.events.map(e => e.open || e.t)) - 3600e3 : lastT - 86400e3;
  const low = Math.min(START, ...D.events.map(e => e.bal));
  let pair = 'ALL', period = 'all';

  // ---------- шапка ----------
  $('title').textContent = D.title;
  $('bal').textContent = money(D.balance);
  const net = D.balance - START;
  $('pnl').innerHTML = `<span class="${tone(net)}">${money(net, true)} · ${net < 0 ? '−' : '+'}${Math.abs(net / START * 100).toFixed(2)}%</span>`;
  const u = new Date(D.updated);
  $('upd').textContent = `MT5 · ${pad(u.getDate())}.${pad(u.getMonth() + 1)} ${dTime(D.updated)}`;

  function header(list) {
    const w = list.filter(e => e.pnl >= BE).length, l = list.filter(e => e.pnl <= -BE).length;
    const toLoss = D.balance - MAXL;
    const k = [
      ['To max loss', money(toLoss), toLoss < 1500 ? 'down' : ''],
      ['To target', money(Math.max(0, TARGET - D.balance)), ''],
      ['Max DD', (low < START ? '−' : '') + Math.abs((low - START) / START * 100).toFixed(2) + '%', ''],
      ['Trades · WR', `${list.length} · ${w + l ? Math.round(w / (w + l) * 100) + '%' : '—'}`, ''],
    ];
    $('kpis').innerHTML = k.map(([l, v, c]) => `<div class="kpi"><div class="cap">${l}</div><div class="v num ${c}">${v}</div></div>`).join('');
    const sum = list.reduce((a, e) => a + e.pnl, 0);
    $('sel').textContent = pair === 'ALL' ? 'Все пары' : name(pair);
    $('net').textContent = pair === 'ALL' ? '' : money(sum, true);
    $('net').className = 'num ' + (pair === 'ALL' ? '' : tone(sum));
  }

  // ---------- кнопки ----------
  $('pairs').innerHTML = ['ALL', ...D.pairs].map(p =>
    `<button data-k="${p}" class="${p === 'ALL' ? 'on' : ''}">${p === 'ALL' ? 'Все пары' : name(p)}</button>`).join('');
  const activate = (box, b) => [...box.children].forEach(x => x.classList.toggle('on', x === b));
  $('pairs').onclick = e => { const b = e.target.closest('button'); if (!b || b.dataset.k === pair) return;
    pair = b.dataset.k; activate($('pairs'), b); update(); };
  $('period').onclick = e => { const b = e.target.closest('button'); if (!b) return;
    period = b.dataset.p; activate($('period'), b); zoomToPeriod(true); };

  // ---------- данные под фильтр ----------
  function build() {
    const list = pair === 'ALL' ? trades : trades.filter(e => e.pair === pair);
    const src = pair === 'ALL' ? D.events : list;
    const pts = [{ value: [firstT, START], ev: { kind: 'start' }, symbolSize: 0 }];
    let run = START;
    for (const e of src) {
      run = pair === 'ALL' ? e.bal : run + e.pnl;
      pts.push({ value: [e.t, +run.toFixed(2)], ev: e,
                 itemStyle: { color: e.kind === 'trade' && e.pnl < 0 ? C.down : C.up } });
    }
    const last = pts.length > 1 ? pts[pts.length - 1] : null;
    pts.push({ value: [lastT, +run.toFixed(2)], ev: { kind: 'now' }, symbolSize: 0 });

    const byDay = new Map();
    for (const e of list) {
      const d = new Date(e.t), k = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
      const o = byDay.get(k) || { pnl: 0, n: 0 }; o.pnl += e.pnl; o.n++; byDay.set(k, o);
    }
    const bars = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([k, o]) => ({
      value: [k, +o.pnl.toFixed(2)], n: o.n,
      itemStyle: { color: o.pnl >= 0 ? C.up : C.down, borderRadius: o.pnl >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2] } }));
    return { list, pts, last, bars };
  }

  // ---------- подсказка ----------
  const row = (l, v, color) => `<div style="display:flex;justify-content:space-between;gap:32px;margin-top:6px">
      <span style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:${C.muted}">${l}</span>
      <span style="font-family:${MONO};font-variant-numeric:tabular-nums;color:${color || C.text}">${v}</span></div>`;
  const when = ms => `<div style="font-family:${MONO};font-size:11px;color:${C.muted}">${dDate(ms)}${ms ? ' · ' + dTime(ms) : ''}</div>`;

  function tip(params) {
    const p = Array.isArray(params) ? params.find(x => x.seriesId === 'curve' || x.seriesId === 'daily') || params[0] : params;
    if (!p || !p.data) return '';
    if (p.seriesId === 'daily') {
      const v = p.data.value[1];
      return `<div style="font-family:${MONO};font-size:11px;color:${C.muted}">${dDate(p.data.value[0])}</div>` +
        row('PnL за день', money(v, true), v >= 0 ? C.up : C.down) + row('Сделок', p.data.n);
    }
    const e = p.data.ev, y = p.data.value[1];
    if (!e || e.kind === 'start') return row('Старт', money(START));
    if (e.kind === 'now') return `<div style="font-size:10px;letter-spacing:.12em;color:${C.muted}">СЕЙЧАС</div>` +
      row(pair === 'ALL' ? 'Баланс' : name(pair) + ' от 50 000', money(y));
    if (e.kind === 'balance') return when(e.t) + row('Балансовая операция', money(e.pnl, true)) + row('Баланс после', money(e.bal));
    return when(e.t) +
      `<div style="display:flex;gap:10px;align-items:baseline;margin:8px 0 4px">
         <span style="font-weight:600;color:${C.text}">${name(e.pair)}</span>
         <span style="font-size:10px;letter-spacing:.12em;color:${C.muted}">${e.side}</span></div>` +
      row('PnL сделки', money(e.pnl, true), e.pnl >= 0 ? C.up : C.down) +
      row('Баланс после', money(e.bal)) +
      (pair === 'ALL' ? '' : row(name(pair) + ' от 50 000', money(y)));
  }

  // ---------- график ----------
  const el = $('chart');
  const chart = echarts.init(el, null, { renderer: 'canvas' });
  const narrow = () => el.clientWidth < 640;

  function layout() {
    const H = el.clientHeight, n = narrow();
    const daily = Math.max(96, Math.round(H * 0.2));
    const gL = n ? 52 : 64, gR = n ? 56 : 104;
    const g1Bottom = 64, g0Bottom = g1Bottom + daily + 72;
    return {
      grid: [{ left: gL, right: gR, top: 12, bottom: g0Bottom },
             { left: gL, right: gR, bottom: g1Bottom, height: daily }],
      graphic: [{ id: 'cap2', type: 'text', left: 0, top: H - g1Bottom - daily - 36,
                  style: { text: 'DAILY P&L', fill: C.muted, font: `500 11px ${SANS}` } }],
    };
  }

  const levelLabel = (val, label) => ({
    show: true, position: 'end', distance: 10, color: C.muted, lineHeight: 14,
    formatter: () => narrow() ? `{v|${nf0.format(val / 1000)}k}` : `{v|${nf0.format(val)}}\n{n|${label}}`,
    rich: { v: { fontFamily: MONO, fontSize: 11, color: C.text }, n: { fontSize: 9, color: C.muted, fontFamily: SANS } } });
  const level = (y, color, label, type) => ({ yAxis: y, lineStyle: { color, type, width: 1, opacity: .7 }, label: levelLabel(y, label) });
  const levels = () => [level(TARGET, C.up, 'TARGET', [4, 4]), level(START, C.muted, 'START', [2, 3]), level(MAXL, C.down, 'MAX LOSS', [4, 4])];

  function yRange(pts) {
    const ys = pts.map(p => p.value[1]);
    return { min: Math.floor((Math.min(MAXL, ...ys) - 300) / 1000) * 1000,
             max: Math.ceil((Math.max(TARGET, ...ys) + 300) / 1000) * 1000 };
  }
  const barRange = bars => Math.ceil(Math.max(100, ...bars.map(b => Math.abs(b.value[1]))) * 1.2 / 250) * 250;

  function init() {
    const b = build(); const yr = yRange(b.pts), m = barRange(b.bars);
    const ax = { color: C.muted, fontFamily: MONO, fontSize: 11 };
    chart.setOption({
      backgroundColor: 'transparent',
      animationDuration: 400, animationEasing: 'cubicOut',
      animationDurationUpdate: T, animationEasingUpdate: 'cubicOut',
      textStyle: { fontFamily: SANS },
      ...layout(),
      tooltip: {
        trigger: 'axis', backgroundColor: C.tip, borderColor: C.tipLine, borderWidth: 1, padding: [12, 14],
        textStyle: { color: C.text, fontSize: 12, fontFamily: SANS }, extraCssText: 'box-shadow:none;border-radius:6px;min-width:220px',
        transitionDuration: 0.15, confine: true,
        axisPointer: { type: 'line', lineStyle: { color: C.faint, width: 1, type: 'solid' } }, formatter: tip,
      },
      xAxis: [0, 1].map(i => ({
        type: 'time', gridIndex: i, min: firstT, max: lastT,
        axisLine: { show: i === 1, lineStyle: { color: C.base, width: 1 } }, axisTick: { show: false },
        axisLabel: i === 0 ? { show: false } : { ...ax, formatter: '{dd}.{MM}', hideOverlap: true, margin: 12 },
        splitLine: { show: false },
      })),
      yAxis: [
        { type: 'value', gridIndex: 0, ...yr, splitNumber: 6,
          axisLabel: { ...ax, formatter: v => nf0.format(v) }, splitLine: { lineStyle: { color: C.line, width: 1 } } },
        { type: 'value', gridIndex: 1, min: -m, max: m, interval: m,
          axisLabel: { ...ax, formatter: v => v === 0 ? '0' : (v > 0 ? '+' : '−') + nf0.format(Math.abs(v)) },
          splitLine: { lineStyle: { color: C.line, width: 1 } } },
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], filterMode: 'none', minValueSpan: 6 * 3600e3 },
        { type: 'slider', xAxisIndex: [0, 1], filterMode: 'none', height: 14, bottom: 12, showDetail: false,
          borderColor: C.line, backgroundColor: 'transparent', fillerColor: 'rgba(47,191,140,.06)',
          dataBackground: { lineStyle: { color: C.base, width: 1 }, areaStyle: { color: 'transparent' } },
          selectedDataBackground: { lineStyle: { color: C.up, width: 1, opacity: .6 }, areaStyle: { color: 'transparent' } },
          handleSize: '100%', handleStyle: { color: '#141B18', borderColor: C.base },
          moveHandleSize: 0, emphasis: { handleStyle: { borderColor: C.muted } }, brushSelect: false },
      ],
      series: [
        { id: 'curve', type: 'line', step: 'end', xAxisIndex: 0, yAxisIndex: 0, data: b.pts,
          symbol: 'circle', symbolSize: 5, showSymbol: true, z: 3,
          lineStyle: { color: C.up, width: 1.5 }, itemStyle: { borderWidth: 0 },
          emphasis: { scale: 1.8, focus: 'none', lineStyle: { width: 1.5 } },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1,
            [{ offset: 0, color: 'rgba(47,191,140,.12)' }, { offset: 1, color: 'rgba(47,191,140,0)' }]) },
          markLine: { silent: true, symbol: 'none', data: levels() } },
        { id: 'last', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0, z: 4, silent: true,
          symbolSize: 9, itemStyle: { color: C.up, borderColor: C.bg, borderWidth: 2 },
          data: b.last ? [{ value: b.last.value, ev: b.last.ev }] : [] },
        { id: 'ring', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0, z: 2, silent: true, symbolSize: 20,
          itemStyle: { color: 'rgba(47,191,140,.14)' }, data: b.last ? [{ value: b.last.value }] : [] },
        { id: 'daily', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: b.bars, barMaxWidth: 12, barMinWidth: 2, clip: true,
          emphasis: { itemStyle: { opacity: 1 } }, itemStyle: { opacity: .9 } },
      ],
    });
    header(b.list); rows(b.list);
  }

  // смена пары: только данные и шкала, зум сохраняется, переход анимируется
  function update() {
    const b = build(); const yr = yRange(b.pts), m = barRange(b.bars);
    const lastPt = b.last ? [{ value: b.last.value, ev: b.last.ev }] : [];
    chart.setOption({
      yAxis: [yr, { min: -m, max: m, interval: m }],
      series: [{ id: 'curve', data: b.pts }, { id: 'last', data: lastPt },
               { id: 'ring', data: lastPt.map(p => ({ value: p.value })) }, { id: 'daily', data: b.bars }],
    });
    header(b.list); rows(b.list);
  }

  // ---------- период: плавный переход зума ----------
  let raf = 0, programmatic = false;
  function currentRange() {
    const z = chart.getOption().dataZoom[0], span = lastT - firstT;
    return [firstT + span * (z.start || 0) / 100, firstT + span * (z.end == null ? 100 : z.end) / 100];
  }
  function zoomToPeriod(animate) {
    const to = [period === 'all' ? firstT : Math.max(firstT, lastT - (+period) * 86400e3), lastT];
    const from = currentRange();
    cancelAnimationFrame(raf);
    const t0 = performance.now();
    const step = now => {
      const k = animate ? Math.min(1, (now - t0) / T) : 1, q = 1 - Math.pow(1 - k, 3);
      programmatic = true;
      chart.dispatchAction({ type: 'dataZoom', startValue: from[0] + (to[0] - from[0]) * q, endValue: from[1] + (to[1] - from[1]) * q });
      programmatic = false;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  // ручное приближение колесом или ползунком снимает выбор периода
  chart.on('datazoom', () => { if (!programmatic) [...$('period').children].forEach(x => x.classList.remove('on')); });

  // ---------- таблица ----------
  function rows(list) {
    $('rows').innerHTML = list.slice().reverse().map(e => `<tr>
      <td class="num">${dDate(e.t)} ${dTime(e.t)}</td><td>${name(e.pair)}</td><td class="cap">${e.side}</td>
      <td class="num r ${tone(e.pnl)}">${money(e.pnl, true)}</td><td class="num r">${money(e.bal)}</td></tr>`).join('');
  }

  // ---------- размер окна ----------
  let wasNarrow = narrow();
  new ResizeObserver(() => {
    chart.resize();
    chart.setOption(layout());
    if (narrow() !== wasNarrow) { wasNarrow = narrow(); chart.setOption({ series: [{ id: 'curve', markLine: { data: levels() } }] }); }
  }).observe(el);

  // состояние из адреса: #XAUUSD/7
  const [hp, hd] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (D.pairs.includes(hp)) { pair = hp; activate($('pairs'), $('pairs').querySelector(`[data-k="${hp}"]`)); }
  if (['7', '30'].includes(hd)) { period = hd; activate($('period'), $('period').querySelector(`[data-p="${hd}"]`)); }

  init();
  if (period !== 'all') zoomToPeriod(false);
};
