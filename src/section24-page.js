import './style.css'
import { S24 } from './section24.js'

const $ = id => document.getElementById(id)
const AUTH = ''

let currentUser = null
let calcState   = null
let incomeMode  = 'exact'

const fmtCf  = n => { const abs = '£' + Math.abs(Math.round(n)).toLocaleString('en-GB'); return n < 0 ? '−' + abs : abs }
const fmtAbs = n => '£' + Math.abs(Math.round(n)).toLocaleString('en-GB')

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch(`${AUTH}/api/auth/me`, { credentials: 'include' })
    if (!res.ok) { window.location.href = '/'; return }
    const { user } = await res.json()
    currentUser = user
  } catch (e) {
    window.location.href = '/'
    return
  }

  try {
    const raw = localStorage.getItem('bk_calc')
    if (raw) calcState = JSON.parse(raw)
  } catch (e) {}

  if (!calcState) {
    $('noCalcNotice').classList.remove('hidden')
  } else {
    $('resultCard').classList.remove('hidden')
  }

  try {
    const res = await fetch(`${AUTH}/api/user/profile`, { credentials: 'include' })
    if (res.ok) {
      const { profile } = await res.json()
      if (profile) prefillForm(profile)
    }
  } catch (e) {}

  document.querySelectorAll('input[name="taxband"], input[name="incomeband"]')
    .forEach(el => el.addEventListener('change', recalc))
  $('incomeExact').addEventListener('input', recalc)

  recalc()
}

// ─── Prefill form ─────────────────────────────────────────────────────────────
function prefillForm(profile) {
  if (profile.tax_band) {
    const el = document.querySelector(`input[name="taxband"][value="${profile.tax_band}"]`)
    if (el) el.checked = true
  }

  if (profile.income_is_band && profile.other_annual_income != null) {
    setIncomeMode('band')
    const el = document.querySelector(`input[name="incomeband"][value="${Math.round(profile.other_annual_income)}"]`)
    if (el) el.checked = true
  } else if (profile.other_annual_income != null) {
    setIncomeMode('exact')
    $('incomeExact').value = Math.round(profile.other_annual_income)
  }
}

// ─── Income mode toggle ───────────────────────────────────────────────────────
function setIncomeMode(mode) {
  incomeMode = mode
  $('modeExact').classList.toggle('active', mode === 'exact')
  $('modeBand').classList.toggle('active',  mode === 'band')
  $('incomeExactWrap').classList.toggle('hidden', mode !== 'exact')
  $('incomeBandWrap').classList.toggle('hidden',  mode !== 'band')
  recalc()
}

// ─── Read form values ─────────────────────────────────────────────────────────
function getProfile() {
  const taxBandEl = document.querySelector('input[name="taxband"]:checked')
  if (!taxBandEl) return null

  const taxBand = taxBandEl.value

  if (incomeMode === 'exact') {
    const val = parseFloat($('incomeExact').value)
    if (isNaN(val) || val < 0) return null
    return { tax_band: taxBand, other_annual_income: val, income_is_band: false, ownership_structure: 'individual' }
  } else {
    const bandEl = document.querySelector('input[name="incomeband"]:checked')
    if (!bandEl) return null
    return { tax_band: taxBand, other_annual_income: parseFloat(bandEl.value), income_is_band: true, ownership_structure: 'individual' }
  }
}

// ─── Live recalculation ───────────────────────────────────────────────────────
function recalc() {
  hideBanners()

  if (!calcState) return

  const profile = getProfile()

  if (!profile) {
    $('resultIncomplete').classList.remove('hidden')
    $('resultComplete').classList.add('hidden')
    return
  }

  const result = S24.calculate(profile, calcState)
  if (!result) return

  $('resultIncomplete').classList.add('hidden')
  $('resultComplete').classList.remove('hidden')

  renderResult(result, profile)
}

// ─── Render result card ───────────────────────────────────────────────────────
function renderResult(result, profile) {
  const isRange = result.isRange

  if (isRange) {
    $('statAnnualTax').textContent   = fmtAbs(result.annualTaxLow)  + '–' + fmtAbs(result.annualTaxHigh)
    $('statExtraTax').textContent    = fmtAbs(result.s24ExtraTaxLow) + '–' + fmtAbs(result.s24ExtraTaxHigh)
    $('statAnnualAfter').textContent = fmtCf(result.afterTaxAnnualLow) + ' – ' + fmtCf(result.afterTaxAnnualHigh)
    $('rangeCaveat').classList.remove('hidden')
  } else {
    $('statAnnualTax').textContent   = fmtAbs(result.annualTax)
    $('statExtraTax').textContent    = fmtAbs(result.s24ExtraTax)
    $('statAnnualAfter').textContent = fmtCf(result.afterTaxAnnual)
    $('rangeCaveat').classList.add('hidden')
  }

  if (result.isNeutral) {
    $('resultNeutral').classList.remove('hidden')
    $('resultImpacted').classList.add('hidden')

    const val = isRange ? result.afterTaxMonthlyHigh : result.afterTaxMonthly
    animateCf($('cfAfterTax'), val)

    showBanner($('bannerNeutral'))
    if (isRange) showBanner($('bannerBandNote'))

  } else {
    $('resultNeutral').classList.add('hidden')
    $('resultImpacted').classList.remove('hidden')

    $('cfPreTax').textContent = fmtCf(calcState.monthly) + '/mo'

    const afterLow    = isRange ? result.afterTaxMonthlyLow  : result.afterTaxMonthly
    const afterHigh   = isRange ? result.afterTaxMonthlyHigh : result.afterTaxMonthly
    const afterDisplay = afterLow === afterHigh ? afterLow : afterLow

    animateCf($('cfAfterTaxImpacted'), afterDisplay)

    const pos = afterDisplay >= 0
    const col = pos ? '#86efac' : '#fca5a5'
    $('cfAfterTaxImpacted').style.color = col
    $('resultVerdict').style.color      = pos ? '#86efac' : '#fca5a5'
    $('resultVerdict').textContent      = pos ? '✓ POSITIVE AFTER TAX' : '✗ NEGATIVE AFTER TAX'

    const monthlyCost = isRange ? result.worstCase.monthlyTax : result.monthlyTax
    $('s24MonthlyCost').textContent = '−' + fmtAbs(monthlyCost) + '/mo'
    $('s24MonthlyCost').style.color = col

    const preTax = Math.abs(calcState.monthly) || 1
    const pct = Math.min(100, (monthlyCost / (preTax + monthlyCost)) * 100)
    $('s24Bar').style.width      = pct + '%'
    $('s24Bar').style.background = '#fca5a5'

    if (isRange) showBanner($('bannerBandNote'))

    const extraMonthly = isRange ? result.worstCase.s24ExtraMonthly : result.s24ExtraMonthly
    if (extraMonthly > 200) {
      $('bannerHighImpact').innerHTML =
        `<strong>High S24 impact.</strong> Section 24 is costing you an estimated <strong>${fmtAbs(extraMonthly * 12)}/year</strong> in additional tax compared to pre-S24 rules. A deal that looks profitable before tax may not be viable after it.`
      showBanner($('bannerHighImpact'))
    } else if (extraMonthly > 50) {
      $('bannerModImpact').innerHTML =
        `<strong>S24 is reducing your returns.</strong> You're paying an estimated <strong>${fmtAbs(extraMonthly * 12)}/year</strong> more in tax than pre-S24 rules would have applied.`
      showBanner($('bannerModImpact'))
    }
  }
}

function animateCf(el, val) {
  el.classList.remove('num-pop')
  void el.offsetWidth
  el.classList.add('num-pop')
  el.textContent = fmtCf(val) + '/mo'
}

function hideBanners() {
  [$('bannerHighImpact'), $('bannerModImpact'), $('bannerNeutral'), $('bannerBandNote')]
    .forEach(b => b.classList.remove('visible'))
}

function showBanner(el) { el.classList.add('visible') }

// ─── Save profile ─────────────────────────────────────────────────────────────
async function saveProfile() {
  const profile = getProfile()

  if (!profile) {
    if (!document.querySelector('input[name="taxband"]:checked')) {
      document.querySelectorAll('label[for^="band-"]').forEach(l => {
        l.style.borderColor = '#fca5a5'
        setTimeout(() => l.style.borderColor = '', 1500)
      })
    }
    return
  }

  $('saveBtn').classList.add('loading')
  $('saveBtn').textContent = 'Saving…'

  try {
    const res = await fetch(`${AUTH}/api/user/profile`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    })

    if (res.ok) {
      localStorage.setItem('bk_s24_return', '1')
      window.location.href = '/'
    } else {
      alert('Could not save profile. Please try again.')
    }
  } catch (e) {
    alert('Could not save profile. Please try again.')
  } finally {
    $('saveBtn').classList.remove('loading')
    $('saveBtn').textContent = 'Save & Return to Calculator'
  }
}

// ─── Expose globals for inline onclick handlers ───────────────────────────────
window.setIncomeMode = setIncomeMode
window.recalc        = recalc
window.saveProfile   = saveProfile

init()
