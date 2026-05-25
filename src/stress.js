import './style.css'
import { S24 } from './section24.js'
import { calcFromInputs, calcSDLT } from './calc.js'
import Chart from 'chart.js/auto'

const $ = id => document.getElementById(id)

const fmt  = n => { const abs = '£' + Math.abs(Math.round(n)).toLocaleString('en-GB'); return n < 0 ? '−' + abs : abs }
const fmtN = n => Math.abs(Math.round(n)).toLocaleString('en-GB')

// ─── State ────────────────────────────────────────────────────────────────────
let baseInputs  = null   // raw deal inputs from sessionStorage
let taxProfile  = null   // S24 profile if present
let chart       = null

// Current slider-adjusted inputs
let currentRate  = 5
let currentRent  = 0
let currentCosts = 0

// Rent slider range: ±40% of original rent
let rentMin, rentMax, costsMin, costsMax

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  try {
    const raw = sessionStorage.getItem('bk_stress')
    if (!raw) { $('noDealNotice').classList.remove('hidden'); return }
    baseInputs = JSON.parse(raw)
  } catch (e) {
    $('noDealNotice').classList.remove('hidden')
    return
  }

  try {
    const rawProfile = sessionStorage.getItem('bk_stress_profile')
    if (rawProfile) taxProfile = JSON.parse(rawProfile)
  } catch (e) {}

  // Set up slider ranges based on original deal values
  currentRate  = baseInputs.rate
  currentRent  = baseInputs.rent
  currentCosts = baseInputs.costs

  rentMin  = Math.max(0, Math.round(baseInputs.rent  * 0.6))
  rentMax  = Math.round(baseInputs.rent  * 1.4)
  costsMin = 0
  costsMax = Math.round(baseInputs.costs * 3)

  // Configure sliders
  $('rateSlider').value = currentRate
  $('rateSlider').min   = 1
  $('rateSlider').max   = 12
  $('rateSlider').step  = 0.1

  $('rentSlider').min   = rentMin
  $('rentSlider').max   = rentMax
  $('rentSlider').step  = Math.max(1, Math.round((rentMax - rentMin) / 100))
  $('rentSlider').value = currentRent
  $('rentMin').textContent  = '£' + fmtN(rentMin)
  $('rentMax').textContent  = '£' + fmtN(rentMax)

  $('costsSlider').min   = costsMin
  $('costsSlider').max   = costsMax
  $('costsSlider').step  = Math.max(1, Math.round(costsMax / 100))
  $('costsSlider').value = currentCosts
  $('costsMin').textContent  = '£0'
  $('costsMax').textContent  = '£' + fmtN(costsMax)

  // Show all cards
  $('resultCard').classList.remove('hidden')
  $('chartCard').classList.remove('hidden')
  $('slidersCard').classList.remove('hidden')
  $('tableCard').classList.remove('hidden')

  if (taxProfile) {
    $('chartLegend').classList.remove('hidden')
    $('tableS24Header').textContent = 'After S24/mo'
  }

  // Wire sliders
  $('rateSlider').addEventListener('input', () => {
    currentRate = parseFloat($('rateSlider').value)
    $('rateVal').textContent = currentRate.toFixed(1)
    update()
  })
  $('rentSlider').addEventListener('input', () => {
    currentRent = parseInt($('rentSlider').value)
    $('rentVal').textContent = fmtN(currentRent)
    update()
  })
  $('costsSlider').addEventListener('input', () => {
    currentCosts = parseInt($('costsSlider').value)
    $('costsVal').textContent = fmtN(currentCosts)
    update()
  })

  // Initial render
  update()
  buildChart()
}

// ─── Update result card from current slider state ─────────────────────────────
function update() {
  const inputs = { ...baseInputs, rate: currentRate, rent: currentRent, costs: currentCosts }
  const result = calcFromInputs(inputs)
  if (!result) return

  const { monthly, annual, net, mtg } = result
  const pos = monthly >= 0

  $('rateVal').textContent  = currentRate.toFixed(1)
  $('rentVal').textContent  = fmtN(currentRent)
  $('costsVal').textContent = fmtN(currentCosts)

  $('cfNum').textContent    = fmt(monthly) + '/mo'
  $('cfNum').style.color    = pos ? '#86efac' : '#fca5a5'

  const atOrigRate = currentRate === baseInputs.rate
  $('resultVerdict').textContent = atOrigRate ? 'AT CURRENT RATE' : `AT ${currentRate.toFixed(1)}%`

  if (taxProfile) {
    const s24 = S24.calculate(taxProfile, result)
    const annualPropertyProfit = result.rent * 12 - result.monthlyCosts * 12
    if (s24 && !s24.notApplicable && annualPropertyProfit > 0) {
      const afterMonthly = s24.isRange ? s24.afterTaxMonthlyLow : s24.afterTaxMonthly
      const afterPos     = afterMonthly >= 0
      const afterCol     = afterPos ? '#86efac' : '#fca5a5'

      // After-tax is hero
      $('cfNum').textContent = fmt(afterMonthly) + '/mo'
      $('cfNum').style.color = afterCol
      $('cfLabel').textContent = 'after-tax monthly cashflow'

      // Pre-tax as secondary
      $('preTaxNum').textContent = fmt(monthly) + '/mo'
      const monthlyCost = s24.isRange ? s24.worstCase.s24ExtraMonthly : s24.s24ExtraMonthly
      $('s24CostNum').textContent = '−£' + Math.abs(Math.round(monthlyCost)).toLocaleString('en-GB') + '/mo'
      $('s24Secondary').classList.remove('hidden')
    } else {
      $('cfLabel').textContent = 'pre-tax monthly cashflow'
      $('s24Secondary').classList.add('hidden')
    }
  } else {
    $('cfLabel').textContent = 'pre-tax monthly cashflow'
    $('s24Secondary').classList.add('hidden')
  }

  $('statMtg').textContent    = fmt(mtg) + '/mo'
  $('statNet').textContent    = net.toFixed(2) + '%'
  $('statAnnual').textContent = fmt(annual)

  // Break-even rate — binary search for rate where monthly ≈ 0
  const be = findBreakEven(inputs)
  if (be !== null) {
    $('breakEvenRow').classList.remove('hidden')
    $('breakEvenRate').textContent = be.toFixed(2) + '%'
    $('breakEvenNote').textContent = monthly >= 0
      ? 'goes cashflow negative above this rate'
      : 'was cashflow positive below this rate'
  } else {
    $('breakEvenRow').classList.add('hidden')
  }

  // Update chart if built
  if (chart) updateChart()

  // Update table
  buildTable(inputs)
}

// ─── Break-even via binary search ────────────────────────────────────────────
function findBreakEven(inputs) {
  // Check if range 1–15% contains a zero crossing
  const low  = calcFromInputs({ ...inputs, rate: 1  })
  const high = calcFromInputs({ ...inputs, rate: 15 })
  if (!low || !high) return null
  if ((low.monthly >= 0) === (high.monthly >= 0)) return null  // no crossing

  let lo = 1, hi = 15
  for (let i = 0; i < 40; i++) {
    const mid    = (lo + hi) / 2
    const result = calcFromInputs({ ...inputs, rate: mid })
    if (!result) break
    if (Math.abs(result.monthly) < 0.01) return mid
    if (result.monthly >= 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// ─── Chart ────────────────────────────────────────────────────────────────────
function buildChart() {
  const ctx    = $('stressChart').getContext('2d')
  const labels = []
  const preTax = []
  const afterS24 = []

  for (let r = 1; r <= 12; r += 0.25) {
    const inputs = { ...baseInputs, rate: r, rent: currentRent, costs: currentCosts }
    const result = calcFromInputs(inputs)
    if (!result) continue
    labels.push(r.toFixed(2))
    preTax.push(result.monthly)

    if (taxProfile) {
      const s24 = S24.calculate(taxProfile, result)
      afterS24.push(s24 && !s24.notApplicable
        ? (s24.isRange ? s24.afterTaxMonthlyLow : s24.afterTaxMonthly)
        : result.monthly)
    }
  }

  const datasets = [{
    label: 'Pre-tax',
    data: preTax,
    borderColor: '#86efac',
    borderWidth: 2,
    pointRadius: 0,
    tension: 0.3,
    fill: false,
  }]

  if (taxProfile && afterS24.length) {
    datasets.push({
      label: 'After S24',
      data: afterS24,
      borderColor: '#fca5a5',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
      fill: false,
    })
  }

  chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => items[0].label + '%',
            label: item => ` ${item.dataset.label}: ${fmt(item.raw)}/mo`,
          },
          backgroundColor: '#1A3828',
          titleColor: 'rgba(255,255,255,.5)',
          bodyColor: '#fff',
          padding: 10,
          cornerRadius: 8,
        },
      },
      scales: {
        x: {
          ticks: {
            color: '#a8a29e',
            font: { size: 10, family: 'Plus Jakarta Sans' },
            maxTicksLimit: 7,
            callback: (_, i, ticks) => {
              // Only show whole-number rate labels
              const val = parseFloat(labels[i])
              return Number.isInteger(val) ? val + '%' : ''
            },
          },
          grid: { color: 'rgba(0,0,0,.04)' },
          border: { display: false },
        },
        y: {
          ticks: {
            color: '#a8a29e',
            font: { size: 10, family: 'Plus Jakarta Sans' },
            callback: v => fmt(v),
            maxTicksLimit: 6,
          },
          grid: { color: 'rgba(0,0,0,.04)' },
          border: { display: false },
        },
      },
    },
    plugins: [{
      // Draw zero line and current-rate marker
      id: 'overlays',
      afterDraw(chart) {
        const { ctx, chartArea: { left, right, top, bottom }, scales: { x, y } } = chart

        // Zero line
        const yZero = y.getPixelForValue(0)
        if (yZero >= top && yZero <= bottom) {
          ctx.save()
          ctx.strokeStyle = 'rgba(0,0,0,.15)'
          ctx.lineWidth   = 1
          ctx.setLineDash([4, 4])
          ctx.beginPath()
          ctx.moveTo(left, yZero)
          ctx.lineTo(right, yZero)
          ctx.stroke()
          ctx.restore()
        }

        // Current rate marker
        const rateIndex = Math.round((currentRate - 1) / 0.25)
        if (rateIndex >= 0 && rateIndex < chart.data.labels.length) {
          const xPos = x.getPixelForValue(rateIndex)
          ctx.save()
          ctx.strokeStyle = 'rgba(255,255,255,.6)'
          ctx.lineWidth   = 1.5
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(xPos, top)
          ctx.lineTo(xPos, bottom)
          ctx.stroke()
          ctx.restore()
        }
      },
    }],
  })
}

function updateChart() {
  if (!chart) return
  const labels   = []
  const preTax   = []
  const afterS24 = []

  for (let r = 1; r <= 12; r += 0.25) {
    const inputs = { ...baseInputs, rate: r, rent: currentRent, costs: currentCosts }
    const result = calcFromInputs(inputs)
    if (!result) continue
    labels.push(r.toFixed(2))
    preTax.push(result.monthly)

    if (taxProfile) {
      const s24 = S24.calculate(taxProfile, result)
      afterS24.push(s24 && !s24.notApplicable
        ? (s24.isRange ? s24.afterTaxMonthlyLow : s24.afterTaxMonthly)
        : result.monthly)
    }
  }

  chart.data.labels           = labels
  chart.data.datasets[0].data = preTax
  if (taxProfile && chart.data.datasets[1]) {
    chart.data.datasets[1].data = afterS24
  }
  chart.update('none')  // 'none' = no animation on slider drag, keeps it snappy
}

// ─── Scenario table ───────────────────────────────────────────────────────────
const TABLE_RATES = [2, 3, 4, 5, 6, 7, 8, 9, 10]

function buildTable(currentInputs) {
  const body = $('scenarioBody')
  const rows = TABLE_RATES.map(r => {
    const inputs  = { ...baseInputs, rate: r, rent: currentRent, costs: currentCosts }
    const result  = calcFromInputs(inputs)
    if (!result) return ''

    const isCurrent = Math.abs(r - currentRate) < 0.05
    const pos       = result.monthly >= 0
    const cfCol     = pos ? '#22c55e' : '#ef4444'
    const rowBg     = isCurrent ? 'background:rgba(26,56,40,.06)' : ''

    let s24Cell = ''
    if (taxProfile) {
      const s24 = S24.calculate(taxProfile, result)
      if (s24 && !s24.notApplicable) {
        const after    = s24.isRange ? s24.afterTaxMonthlyLow : s24.afterTaxMonthly
        const s24Pos   = after >= 0
        const s24Col   = s24Pos ? '#22c55e' : '#ef4444'
        s24Cell = `<td class="text-right pr-1 py-2.5 font-medium" style="color:${s24Col}">${fmt(after)}</td>`
      } else {
        s24Cell = `<td class="text-right pr-1 py-2.5 text-stone-300">—</td>`
      }
    }

    return `<tr style="${rowBg}" class="border-b border-cream-dark/60 ${isCurrent ? 'font-semibold' : ''}">
      <td class="pl-1 py-2.5 text-stone-500">${r}%${isCurrent ? ' ◀' : ''}</td>
      <td class="text-right py-2.5 font-medium" style="color:${cfCol}">${fmt(result.monthly)}</td>
      ${s24Cell || (taxProfile ? '' : '')}
    </tr>`
  })
  body.innerHTML = rows.join('')
}

// ─── Reset sliders ────────────────────────────────────────────────────────────
function resetSliders() {
  currentRate  = baseInputs.rate
  currentRent  = baseInputs.rent
  currentCosts = baseInputs.costs

  $('rateSlider').value  = currentRate
  $('rentSlider').value  = currentRent
  $('costsSlider').value = currentCosts

  $('rateVal').textContent  = currentRate.toFixed(1)
  $('rentVal').textContent  = fmtN(currentRent)
  $('costsVal').textContent = fmtN(currentCosts)

  update()
}

window.resetSliders = resetSliders

// ─── Back navigation — persist deal state so main.js can restore the form ─────
function goBack() {
  if (baseInputs) {
    localStorage.setItem('yk_pending', JSON.stringify({
      calc: baseInputs,
      label: null,
      fields: {
        price:   baseInputs.price   ?? '',
        deposit: baseInputs.deposit ?? 25,
        rate:    baseInputs.rate    ?? 5,
        rent:    baseInputs.rent    ?? '',
        agent:   baseInputs.agent   ?? 10,
        void:    baseInputs.voidWks ?? 2,
        costs:   baseInputs.costs   ?? 150,
        mtype:   baseInputs.type    ?? 'interest',
        term:    baseInputs.term    ?? 25,
        addSDLT: baseInputs.addSDLT ?? false,
      }
    }))
    localStorage.setItem('bk_stress_return', '1')
  }
  window.location.href = '/yield.html'
}

window.goBack = goBack

init()
