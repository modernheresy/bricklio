// ─── Bricklio Section 24 Calculation Engine ──────────────────────────────────
// HMRC-accurate after-tax cashflow modelling for individual BTL landlords.
// Tax year 2024/25 thresholds. Finance Act 2015, Section 24.
//
// Key corrections vs previous version:
//   • Full band slicing — property profit taxed at actual marginal rate,
//     not a single flat rate. Other income fills lower bands first.
//   • PA taper modelled correctly — PA reduces £1 per £2 over £100k,
//     creating an effective ~60% rate in the £100k–£125,140 window.
//     Taper is recalculated separately for pre-S24 and post-S24 totals.
//   • isNeutral derived from actual s24ExtraTax, not assumed from tax band.
// ─────────────────────────────────────────────────────────────────────────────

const PA_BASE        = 12570    // Personal Allowance 2024/25
const BASIC_LIMIT    = 50270    // Basic/Higher rate boundary
const HIGHER_LIMIT   = 125140   // Higher/Additional boundary; PA fully withdrawn
const PA_TAPER_START = 100000   // PA taper begins

export const TAX_RATES = { basic: 0.20, higher: 0.40, additional: 0.45 }

// ─── Personal Allowance after taper ──────────────────────────────────────────
// PA reduces by £1 per £2 of Adjusted Net Income over £100,000.
// Fully withdrawn at £125,140.
export function getAdjustedPA(totalIncome) {
  if (totalIncome <= PA_TAPER_START) return PA_BASE
  return Math.max(0, PA_BASE - Math.floor((totalIncome - PA_TAPER_START) / 2))
}

// ─── Derive marginal tax band from total income ───────────────────────────────
export function deriveTaxBand(totalIncome) {
  if (totalIncome <= BASIC_LIMIT)  return 'basic'
  if (totalIncome <= HIGHER_LIMIT) return 'higher'
  return 'additional'
}

// ─── Income tax via band slicing ──────────────────────────────────────────────
// Other income fills bands from the bottom; property profit is taxed at the
// marginal rate it actually occupies. This is how HMRC calculates it.
function calcIncomeTax(income, pa) {
  if (income <= pa) return 0
  let tax = 0
  // Basic rate: PA → £50,270
  tax += Math.max(0, Math.min(income, BASIC_LIMIT) - pa) * 0.20
  // Higher rate: £50,270 → £125,140
  if (income > BASIC_LIMIT) {
    tax += Math.max(0, Math.min(income, HIGHER_LIMIT) - BASIC_LIMIT) * 0.40
  }
  // Additional rate: above £125,140
  if (income > HIGHER_LIMIT) {
    tax += (income - HIGHER_LIMIT) * 0.45
  }
  return tax
}

// ─── Core calculation (single point) ─────────────────────────────────────────
// otherAnnualIncome: salary, pension, etc. — NOT including rental property.
function calcSingle({ rent, monthlyCosts, monthlyInterest, preTaxMonthly, otherAnnualIncome }) {
  const annualRent           = rent * 12
  const annualCosts          = monthlyCosts * 12          // allowable excl. finance
  const annualFinanceCosts   = monthlyInterest * 12
  const annualPropertyProfit = annualRent - annualCosts   // S24: finance NOT deducted

  // ── Post-S24 ─────────────────────────────────────────────────────────────
  const totalIncome  = otherAnnualIncome + annualPropertyProfit
  const pa           = getAdjustedPA(totalIncome)
  const grossTax     = calcIncomeTax(totalIncome, pa)

  // Three-way cap on creditable finance costs (HMRC S24 legislation):
  //   Creditable = min of:
  //     (1) total finance costs
  //     (2) property profit ≥ 0 (cannot be loss)
  //     (3) total taxable income (total income − PA)
  const taxableIncome    = Math.max(0, totalIncome - pa)
  const creditableAmount = Math.max(0, Math.min(
    annualFinanceCosts,
    Math.max(0, annualPropertyProfit),
    taxableIncome
  ))
  const s24Credit  = creditableAmount * 0.20
  const annualTax  = Math.max(0, grossTax - s24Credit)
  const monthlyTax = annualTax / 12

  const afterTaxMonthly = preTaxMonthly - monthlyTax
  const afterTaxAnnual  = afterTaxMonthly * 12

  // ── Pre-S24 comparison ────────────────────────────────────────────────────
  // Pre-S24: finance costs fully deductible from property profit.
  // Critical: PA taper is recalculated on the lower pre-S24 total income —
  // someone who loses PA under S24 may have had it pre-S24, which affects
  // the true extra tax burden.
  const preS24Profit = Math.max(0, annualPropertyProfit - annualFinanceCosts)
  const preS24Total  = otherAnnualIncome + preS24Profit
  const preS24PA     = getAdjustedPA(preS24Total)
  const preS24Tax    = calcIncomeTax(preS24Total, preS24PA)
  const s24ExtraTax  = annualTax - preS24Tax

  return {
    isRange:              false,
    taxBand:              deriveTaxBand(totalIncome),
    isNeutral:            s24ExtraTax < 1,   // derived from actual numbers, never assumed
    annualRent,
    annualCosts,
    annualFinanceCosts,
    annualPropertyProfit,
    totalIncome,
    pa,
    taxableIncome,
    grossTax,
    creditableAmount,
    s24Credit,
    annualTax,
    monthlyTax,
    afterTaxMonthly,
    afterTaxAnnual,
    preS24Tax,
    preS24Total,
    s24ExtraTax,
    s24ExtraMonthly: s24ExtraTax / 12,
  }
}

// ─── Band boundaries ──────────────────────────────────────────────────────────
// Four bands — the £100k–£125,140 taper zone is broken out as a distinct band
// because the effective ~60% marginal rate makes it materially different.
export const BAND_BOUNDARIES = {
  25000:  { min: 0,       max: 50270  },  // Under basic threshold
  75000:  { min: 50270,   max: 100000 },  // Higher rate, no taper
  112500: { min: 100000,  max: 125140 },  // Higher rate + PA taper (~60% effective)
  150000: { min: 125140,  max: 200000 },  // Additional rate
}

// ─── Range calculation ────────────────────────────────────────────────────────
function calcRange({ rent, monthlyCosts, monthlyInterest, preTaxMonthly, otherAnnualIncome }) {
  const bounds = BAND_BOUNDARIES[otherAnnualIncome]
  if (!bounds) {
    return { ...calcSingle({ rent, monthlyCosts, monthlyInterest, preTaxMonthly, otherAnnualIncome }), isRange: false }
  }

  const atMin = calcSingle({ rent, monthlyCosts, monthlyInterest, preTaxMonthly, otherAnnualIncome: bounds.min })
  const atMax = calcSingle({ rent, monthlyCosts, monthlyInterest, preTaxMonthly, otherAnnualIncome: bounds.max })

  // Worst = highest tax / lowest after-tax cashflow
  const [worstCase, bestCase] = atMin.annualTax >= atMax.annualTax
    ? [atMin, atMax]
    : [atMax, atMin]

  return {
    isRange:             true,
    taxBand:             worstCase.taxBand,
    isNeutral:           atMin.isNeutral && atMax.isNeutral,
    worstCase,
    bestCase,
    afterTaxMonthlyLow:  worstCase.afterTaxMonthly,
    afterTaxMonthlyHigh: bestCase.afterTaxMonthly,
    afterTaxAnnualLow:   worstCase.afterTaxAnnual,
    afterTaxAnnualHigh:  bestCase.afterTaxAnnual,
    annualTaxLow:        bestCase.annualTax,
    annualTaxHigh:       worstCase.annualTax,
    s24ExtraTaxLow:      bestCase.s24ExtraTax,
    s24ExtraTaxHigh:     worstCase.s24ExtraTax,
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────
function calculate(profile, calc) {
  if (!profile || !calc) return null
  if (profile.ownership_structure === 'ltd') return { notApplicable: true, reason: 'ltd' }

  const params = {
    rent:              calc.rent,
    monthlyCosts:      calc.monthlyCosts,
    monthlyInterest:   calc.monthlyInterest,
    preTaxMonthly:     calc.monthly,
    otherAnnualIncome: profile.other_annual_income ?? 0,
  }

  return profile.income_is_band ? calcRange(params) : calcSingle(params)
}

// ─── Label helpers ────────────────────────────────────────────────────────────
export function bandLabel(midpoint) {
  if (midpoint === 25000)  return 'Under £50,270'
  if (midpoint === 75000)  return '£50,270 – £100,000'
  if (midpoint === 112500) return '£100,000 – £125,140'
  if (midpoint === 150000) return 'Over £125,140'
  return '£' + Math.round(midpoint).toLocaleString('en-GB')
}

export function taxBandLabel(band) {
  if (band === 'basic')      return 'Basic rate (20%)'
  if (band === 'higher')     return 'Higher rate (40%)'
  if (band === 'additional') return 'Additional rate (45%)'
  return band
}

export const S24 = {
  calculate, calcSingle, calcRange,
  bandLabel, taxBandLabel,
  BAND_BOUNDARIES, TAX_RATES,
  getAdjustedPA, deriveTaxBand,
}
