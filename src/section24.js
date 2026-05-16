// ─── Bricklio Section 24 Calculation Engine ──────────────────────────────────
//
// Calculates after-tax cashflow for individual BTL landlords under Section 24
// (Finance Act 2015), which restricts mortgage interest relief to a flat 20%
// tax credit rather than full deduction at the marginal rate.
// ─────────────────────────────────────────────────────────────────────────────

const PERSONAL_ALLOWANCE = 12570

const TAX_RATES = {
  basic:      0.20,
  higher:     0.40,
  additional: 0.45,
}

const BAND_BOUNDARIES = {
  25000:  { min: 0,       max: 50000  },
  75000:  { min: 50000,   max: 100000 },
  150000: { min: 100000,  max: 200000 },
}

function calcSingle({ rent, monthlyCosts, monthlyInterest, preTaxMonthly, taxBand, otherAnnualIncome }) {
  const rate = TAX_RATES[taxBand] || TAX_RATES.basic

  const annualRent            = rent * 12
  const annualAllowableCosts  = monthlyCosts * 12
  const annualFinanceCosts    = monthlyInterest * 12
  const annualPropertyProfit  = annualRent - annualAllowableCosts

  const adjustedTotalIncome    = otherAnnualIncome + annualPropertyProfit
  const abovePersonalAllowance = Math.max(0, adjustedTotalIncome - PERSONAL_ALLOWANCE)

  const creditableAmount = Math.max(0, Math.min(
    annualFinanceCosts,
    Math.max(0, annualPropertyProfit),
    abovePersonalAllowance
  ))

  const taxOnProfit  = Math.max(0, annualPropertyProfit) * rate
  const taxCredit    = creditableAmount * 0.20
  const annualTax    = Math.max(0, taxOnProfit - taxCredit)
  const monthlyTax   = annualTax / 12

  const afterTaxMonthly = preTaxMonthly - monthlyTax
  const afterTaxAnnual  = afterTaxMonthly * 12

  const preS24Profit  = Math.max(0, annualPropertyProfit - annualFinanceCosts)
  const preS24Tax     = preS24Profit * rate
  const s24ExtraTax   = annualTax - preS24Tax

  return {
    isRange:              false,
    taxBand,
    rate,
    isNeutral:            taxBand === 'basic',
    annualRent,
    annualAllowableCosts,
    annualFinanceCosts,
    annualPropertyProfit,
    adjustedTotalIncome,
    creditableAmount,
    taxOnProfit,
    taxCredit,
    annualTax,
    monthlyTax,
    afterTaxMonthly,
    afterTaxAnnual,
    preS24Tax,
    s24ExtraTax,
    s24ExtraMonthly: s24ExtraTax / 12,
  }
}

function calcRange({ rent, monthlyCosts, monthlyInterest, preTaxMonthly, taxBand, otherAnnualIncome }) {
  const bounds = BAND_BOUNDARIES[otherAnnualIncome]

  if (!bounds) {
    const result = calcSingle({ rent, monthlyCosts, monthlyInterest, preTaxMonthly, taxBand, otherAnnualIncome })
    return { ...result, isRange: false }
  }

  const worstCase = calcSingle({ rent, monthlyCosts, monthlyInterest, preTaxMonthly, taxBand, otherAnnualIncome: bounds.min })
  const bestCase  = calcSingle({ rent, monthlyCosts, monthlyInterest, preTaxMonthly, taxBand, otherAnnualIncome: bounds.max })

  return {
    isRange:              true,
    taxBand,
    rate:                 worstCase.rate,
    isNeutral:            taxBand === 'basic',
    worstCase,
    bestCase,
    afterTaxMonthlyLow:   worstCase.afterTaxMonthly,
    afterTaxMonthlyHigh:  bestCase.afterTaxMonthly,
    afterTaxAnnualLow:    worstCase.afterTaxAnnual,
    afterTaxAnnualHigh:   bestCase.afterTaxAnnual,
    annualTaxLow:         bestCase.annualTax,
    annualTaxHigh:        worstCase.annualTax,
    s24ExtraTaxLow:       bestCase.s24ExtraTax,
    s24ExtraTaxHigh:      worstCase.s24ExtraTax,
  }
}

function calculate(profile, calc) {
  if (!profile || !calc) return null

  if (profile.ownership_structure === 'ltd') {
    return { notApplicable: true, reason: 'ltd' }
  }

  const params = {
    rent:               calc.rent,
    monthlyCosts:       calc.monthlyCosts,
    monthlyInterest:    calc.monthlyInterest,
    preTaxMonthly:      calc.monthly,
    taxBand:            profile.tax_band,
    otherAnnualIncome:  profile.other_annual_income ?? 0,
  }

  return profile.income_is_band
    ? calcRange(params)
    : calcSingle(params)
}

function bandLabel(midpoint) {
  if (midpoint === 25000)  return 'Under £50,000'
  if (midpoint === 75000)  return '£50,000 – £100,000'
  if (midpoint === 150000) return 'Over £100,000'
  return '£' + Math.round(midpoint).toLocaleString('en-GB')
}

function taxBandLabel(band) {
  if (band === 'basic')      return 'Basic rate (20%)'
  if (band === 'higher')     return 'Higher rate (40%)'
  if (band === 'additional') return 'Additional rate (45%)'
  return band
}

export const S24 = { calculate, calcSingle, calcRange, bandLabel, taxBandLabel, BAND_BOUNDARIES, TAX_RATES }
