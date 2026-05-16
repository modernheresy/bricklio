import './style.css'
import { S24 } from './section24.js'

const $ = id => document.getElementById(id)
const AUTH = ''

let currentUser    = null
let lastCalc       = null
let userTaxProfile = null
let s24Active      = false

const fmt = n => {
  const abs = '£' + Math.abs(Math.round(n)).toLocaleString('en-GB')
  return n < 0 ? '−' + abs : abs
}

// ─── Pending deal persistence ─────────────────────────────────────────────────
function savePendingDeal(label) {
  if (!lastCalc) return
  localStorage.setItem('yk_pending', JSON.stringify({
    calc: lastCalc,
    label: label || buildDealLabel(),
    fields: {
      price:   $('price').value,
      deposit: $('deposit').value,
      rate:    $('rate').value,
      rent:    $('rent').value,
      agent:   $('agent').value,
      void:    $('void').value,
      costs:   $('costs').value,
      mtype:   document.querySelector('input[name="mtype"]:checked').value,
      addSDLT: $('sdltCheck').checked,
    }
  }))
}

function restorePendingDeal() {
  try {
    const raw = localStorage.getItem('yk_pending')
    if (!raw) return null
    const { calc: savedCalc, label: pendingLabel, fields } = JSON.parse(raw)

    $('price').value   = fields.price
    $('deposit').value = fields.deposit
    $('rate').value    = fields.rate
    $('rent').value    = fields.rent
    $('agent').value   = fields.agent
    $('void').value    = fields.void
    $('costs').value   = fields.costs

    const radio = document.querySelector(`input[name="mtype"][value="${fields.mtype}"]`)
    if (radio) radio.checked = true

    $('sdltCheck').checked       = fields.addSDLT
    $('ckBox').style.background  = fields.addSDLT ? '#1A3828' : '#fff'
    $('ckBox').style.borderColor = fields.addSDLT ? '#1A3828' : '#C4BEB4'
    $('ckTick').style.display    = fields.addSDLT ? 'block'   : 'none'

    lastCalc = savedCalc
    calc()
    return pendingLabel || buildDealLabel()
  } catch (e) {
    return null
  }
}

function clearPendingDeal() {
  localStorage.removeItem('yk_pending')
}

// ─── Auth init ────────────────────────────────────────────────────────────────
async function initAuth() {
  const params       = new URLSearchParams(window.location.search)
  const justLoggedIn = params.get('login') === 'success'

  if (params.has('login') || params.has('error')) {
    history.replaceState({}, '', '/')
  }
  if (params.get('error')) {
    showLoginError(friendlyTokenError(params.get('error')))
  }

  let pendingLabel = null
  if (justLoggedIn) pendingLabel = restorePendingDeal()

  try {
    const res = await fetch(`${AUTH}/api/auth/me`, { credentials: 'include' })
    if (res.ok) {
      const { user } = await res.json()
      setUser(user)
      const s24Pending = localStorage.getItem('bk_s24_pending')
      if (justLoggedIn && lastCalc && !s24Pending) {
        await saveDeal(pendingLabel || buildDealLabel())
        clearPendingDeal()
      }
      await fetchTaxProfile()
      checkS24Pending()
      checkS24Return()
    }
  } catch (e) {
    // Guest mode
  }
}

function setUser(user) {
  currentUser = user
  if (user) {
    $('authGuest').classList.add('hidden')
    $('authUser').classList.remove('hidden')
    $('authEmail').textContent = user.email
  } else {
    $('authGuest').classList.remove('hidden')
    $('authUser').classList.add('hidden')
    currentUser    = null
    userTaxProfile = null
    deactivateS24()
    $('s24EditLink').classList.add('hidden')
  }
}

// ─── Save flow ────────────────────────────────────────────────────────────────
async function initSave() {
  if (!lastCalc) { $('price').focus(); return }
  $('dealName').value = buildDealLabel()
  showPanel('panelName')
  openModal()
  setTimeout(() => { $('dealName').select() }, 350)
}

async function confirmSaveName() {
  const label = $('dealName').value.trim() || buildDealLabel()
  if (currentUser) {
    await saveDeal(label)
  } else {
    savePendingDeal(label)
    showPanel('panelLogin')
  }
}

async function saveDeal(label) {
  if (!currentUser || !lastCalc) return
  if (!label) label = buildDealLabel()

  $('saveBtn').classList.add('loading')
  $('saveBtn').textContent = 'Saving…'

  try {
    const res = await fetch(`${AUTH}/api/deals`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, data: lastCalc }),
    })

    if (res.ok) {
      $('savedMsg').textContent = `"${label}" has been saved to your account.`
      showPanel('panelSaved')
      openModal()
    } else {
      alert('Could not save deal. Please try again.')
    }
  } catch (e) {
    alert('Could not save deal. Please try again.')
  } finally {
    $('saveBtn').classList.remove('loading')
    $('saveBtn').textContent = 'Save Deal'
  }
}

// ─── Magic link ───────────────────────────────────────────────────────────────
async function sendMagicLink() {
  const email = $('loginEmail').value.trim()
  if (!email) { showLoginError('Please enter your email.'); return }

  $('loginBtn').textContent         = 'Sending…'
  $('loginBtn').style.opacity       = '.6'
  $('loginBtn').style.pointerEvents = 'none'
  $('loginError').classList.add('hidden')

  try {
    const res  = await fetch(`${AUTH}/api/auth/request`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const data = await res.json()

    if (res.ok) {
      $('sentEmail').textContent = email
      showPanel('panelSent')
    } else {
      showLoginError(data.error || 'Something went wrong.')
    }
  } catch (e) {
    showLoginError('Could not connect. Please try again.')
  } finally {
    $('loginBtn').textContent         = 'Send login link'
    $('loginBtn').style.opacity       = '1'
    $('loginBtn').style.pointerEvents = 'auto'
  }
}

// ─── Logout ───────────────────────────────────────────────────────────────────
async function logout() {
  await fetch(`${AUTH}/api/auth/logout`, { method: 'POST', credentials: 'include' })
  setUser(null)
}

// ─── Modal helpers ────────────────────────────────────────────────────────────
function openModal()  { $('modal').classList.add('open') }
function closeModal() {
  $('modal').classList.remove('open')
  setTimeout(() => {
    showPanel('panelLogin')
    $('loginEmail').value = ''
    $('loginError').classList.add('hidden')
  }, 350)
}
function closeModalOnBackdrop(e) { if (e.target === $('modal')) closeModal() }
function showPanel(id) {
  document.querySelectorAll('.modal-panel').forEach(p => p.classList.remove('active'))
  $(id).classList.add('active')
}
function showLoginError(msg) {
  $('loginError').textContent = msg
  $('loginError').classList.remove('hidden')
}
function friendlyTokenError(code) {
  if (code === 'token_expired') return 'Your login link expired — please request a new one.'
  if (code === 'token_used')    return 'This link has already been used — please request a new one.'
  return 'Invalid login link — please try again.'
}

function buildDealLabel() {
  const price = +$('price').value || 0
  const net   = lastCalc ? lastCalc.net : 0
  const p     = price >= 1000000
    ? '£' + (price/1000000).toFixed(1) + 'm'
    : '£' + Math.round(price/1000) + 'k'
  return `${p} · ${net.toFixed(1)}% yield`
}

// ─── Calculator ───────────────────────────────────────────────────────────────
function calcSDLT(price) {
  if (!price) return 0
  let sdlt = 0
  if (price <= 250000)        sdlt = price * 0.05
  else if (price <= 925000)   sdlt = 250000*0.05 + (price-250000)*0.10
  else if (price <= 1500000)  sdlt = 250000*0.05 + 675000*0.10 + (price-925000)*0.15
  else                        sdlt = 250000*0.05 + 675000*0.10 + 575000*0.15 + (price-1500000)*0.17
  return sdlt
}

$('sdltCheck').addEventListener('change', function() {
  $('ckBox').style.background  = this.checked ? '#1A3828' : '#fff'
  $('ckBox').style.borderColor = this.checked ? '#1A3828' : '#C4BEB4'
  $('ckTick').style.display    = this.checked ? 'block'   : 'none'
})

function yieldMeta(y) {
  if (y < 4)  return { label:'Weak deal',       pct: Math.max(y/4*20, 2),       col:'#ef4444' }
  if (y < 6)  return { label:'Below average',   pct: 20 + (y-4)/2*20,           col:'#f97316' }
  if (y < 8)  return { label:'Average yield',   pct: 40 + (y-6)/2*20,           col:'#eab308' }
  if (y < 10) return { label:'Good yield',       pct: 60 + (y-8)/2*20,           col:'#22c55e' }
  return              { label:'Excellent yield', pct: Math.min(80+(y-10)*4,100), col:'#10b981' }
}

function pill(lbl, val) {
  return `<span style="background:rgba(255,255,255,.08);border-radius:20px;padding:3px 11px;font-size:11px;color:rgba(255,255,255,.5)">
    ${lbl} <b style="color:rgba(255,255,255,.82);font-weight:600">${val}</b>
  </span>`
}

function calc() {
  const price   = +$('price').value   || 0
  const deposit = +$('deposit').value || 25
  const rate    = +$('rate').value    || 5
  const rent    = +$('rent').value    || 0
  const agent   = +$('agent').value   || 0
  const voidWks = +$('void').value    || 0
  const costs   = +$('costs').value   || 0
  const type    = document.querySelector('input[name="mtype"]:checked').value
  const addSDLT = $('sdltCheck').checked

  const sdlt = calcSDLT(price)
  $('sdltAmt').textContent = price ? fmt(sdlt) + ' due on completion' : 'Enter price above'
  if (!price || !rent) return

  const depositAmt = price * deposit / 100
  const baseLoan   = price - depositAmt
  const loan       = addSDLT ? baseLoan + sdlt : baseLoan
  const mr         = rate / 100 / 12
  const mtg        = type === 'interest'
    ? loan * mr
    : (() => { const n=300; return loan*(mr*Math.pow(1+mr,n))/(Math.pow(1+mr,n)-1) })()

  const agentAmt  = rent * agent / 100
  const voidAmt   = rent * voidWks / 52
  const monthly   = rent - (mtg + agentAmt + voidAmt + costs)
  const annual    = monthly * 12
  const gross     = rent * 12 / price * 100
  const net       = (rent*12 - (agentAmt+voidAmt+costs)*12) / price * 100
  const cashIn    = depositAmt + (addSDLT ? 0 : sdlt)
  const pos       = monthly >= 0

  const monthlyInterest = loan * mr
  const monthlyCosts    = agentAmt + voidAmt + costs

  lastCalc = {
    price, deposit, rate, rent, agent, voidWks, costs, type, addSDLT,
    mtg, monthly, annual, gross, net, cashIn, sdlt, loan,
    monthlyInterest, monthlyCosts,
  }

  // Persist for S24 page
  localStorage.setItem('bk_calc', JSON.stringify(lastCalc))

  const vEl = $('verdict')
  vEl.textContent = pos ? '✓ POSITIVE CASHFLOW' : '✗ NEGATIVE CASHFLOW'
  vEl.style.color = pos ? '#86efac' : '#fca5a5'

  const cfEl = $('cfNum')
  cfEl.classList.remove('num-pop')
  void cfEl.offsetWidth
  cfEl.classList.add('num-pop')
  cfEl.textContent = fmt(monthly) + '/mo'
  cfEl.style.color = pos ? '#86efac' : '#fca5a5'

  $('mAnnual').textContent = fmt(annual)
  $('mGross').textContent  = gross.toFixed(1) + '%'
  $('mNet').textContent    = net.toFixed(1) + '%'

  $('pills').innerHTML =
    pill('Mortgage', fmt(mtg)+'/mo') +
    pill('Cash in', fmt(cashIn)) +
    pill('SDLT', fmt(sdlt)) +
    pill('LTV', (loan/price*100).toFixed(0)+'%')

  const ym = yieldMeta(net)
  $('ybarWrap').classList.remove('hidden')
  $('ybar').style.width      = ym.pct + '%'
  $('ybar').style.background = ym.col
  $('yRating').style.color   = ym.col
  $('yRating').textContent   = ym.label + ' · ' + net.toFixed(2) + '% net yield'

  if (s24Active && userTaxProfile) {
    $('s24Warning').classList.add('hidden')
    updateS24Display()
  } else {
    $('s24Result').classList.add('hidden')
    $('s24Warning').classList.remove('hidden')
  }
}

document.querySelectorAll('input').forEach(el => el.addEventListener('input', calc))
$('price').addEventListener('input', () => {
  const p = +$('price').value || 0
  $('sdltAmt').textContent = p ? fmt(calcSDLT(p)) + ' due on completion' : 'Enter price above'
})

// ─── My Deals ─────────────────────────────────────────────────────────────────
async function openMyDeals() {
  showPanel('panelMyDeals')
  openModal()
  $('dealsLoading').classList.remove('hidden')
  $('dealsEmpty').classList.add('hidden')
  $('dealsList').classList.add('hidden')

  try {
    const res = await fetch(`${AUTH}/api/deals/list`, { credentials: 'include' })
    if (!res.ok) throw new Error()
    const { deals } = await res.json()

    $('dealsLoading').classList.add('hidden')

    if (!deals || deals.length === 0) {
      $('dealsEmpty').classList.remove('hidden')
      $('dealsCountLabel').textContent = ''
      return
    }

    $('dealsCountLabel').textContent = `${deals.length} deal${deals.length !== 1 ? 's' : ''}`
    $('dealsList').classList.remove('hidden')
    $('dealsList').innerHTML = deals.map((d, i) => buildDealCard(d, i)).join('')

  } catch (e) {
    $('dealsLoading').classList.add('hidden')
    $('dealsList').classList.remove('hidden')
    $('dealsList').innerHTML = `<div class="text-[12px] text-red-400 text-center py-4">Could not load deals. Please try again.</div>`
  }
}

function buildDealCard(deal, idx) {
  const d    = deal.data || {}
  const pos  = (d.monthly || 0) >= 0
  const cf   = d.monthly != null ? fmt(d.monthly) + '/mo' : '—'
  const net  = d.net  != null ? d.net.toFixed(1)  + '% net'   : '—'
  const grs  = d.gross != null ? d.gross.toFixed(1) + '% gross' : '—'
  const date = new Date(deal.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
  const cfClass   = pos ? 'deal-cf-pos' : 'deal-cf-neg'
  const safeLabel = deal.label.replace(/"/g, '&quot;')

  return `
    <div class="deal-card" id="deal-${deal.id}" style="animation-delay:${idx * 40}ms">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 group" id="label-row-${deal.id}">
            <div class="text-[14px] font-semibold text-ink leading-tight truncate" id="label-text-${deal.id}">${deal.label}</div>
            <button onclick="startRename('${deal.id}')"
              class="opacity-0 group-hover:opacity-100 shrink-0 text-stone-300 hover:text-brand transition-all"
              title="Rename">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M8.5 1.5a1.414 1.414 0 0 1 2 2L4 10H2v-2L8.5 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
          <div class="hidden items-center gap-1.5" id="label-edit-${deal.id}">
            <input type="text" value="${safeLabel}"
              class="field-input flex-1"
              style="height:32px;font-size:13px;padding:0 8px"
              id="label-input-${deal.id}"
              onkeydown="if(event.key==='Enter') confirmRename('${deal.id}'); if(event.key==='Escape') cancelRename('${deal.id}')">
            <button onclick="confirmRename('${deal.id}')" class="shrink-0 w-7 h-7 rounded-lg bg-brand text-white flex items-center justify-center hover:bg-brand-mid transition-colors">
              <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button onclick="cancelRename('${deal.id}')" class="shrink-0 w-7 h-7 rounded-lg border border-stone-200 text-stone-400 flex items-center justify-center hover:border-stone-300 transition-colors">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="text-[11px] text-stone-400 mt-0.5">${date}</div>
        </div>
        <div class="text-[15px] font-semibold shrink-0 ${cfClass}">${cf}</div>
      </div>
      <div class="flex items-center justify-between mt-3">
        <div class="flex gap-3 text-[11px] text-stone-400">
          <span>${net}</span>
          <span>${grs}</span>
        </div>
        <div class="flex gap-2">
          <button onclick="loadDeal('${deal.id}')"
            class="h-7 px-3 rounded-lg bg-brand text-white text-[11px] font-semibold hover:bg-brand-mid transition-colors">
            Load
          </button>
          <button onclick="deleteDeal('${deal.id}')"
            class="h-7 px-3 rounded-lg border border-stone-200 text-stone-400 text-[11px] font-medium hover:border-red-200 hover:text-red-400 transition-colors">
            Delete
          </button>
        </div>
      </div>
    </div>`
}

function startRename(id) {
  $(`label-row-${id}`).classList.add('hidden')
  const editRow = $(`label-edit-${id}`)
  editRow.classList.remove('hidden')
  editRow.classList.add('flex')
  $(`label-input-${id}`).focus()
  $(`label-input-${id}`).select()
}

function cancelRename(id) {
  $(`label-edit-${id}`).classList.remove('flex')
  $(`label-edit-${id}`).classList.add('hidden')
  $(`label-row-${id}`).classList.remove('hidden')
}

async function confirmRename(id) {
  const input    = $(`label-input-${id}`)
  const newLabel = input.value.trim()
  if (!newLabel) { cancelRename(id); return }

  input.disabled = true
  try {
    const res = await fetch(`${AUTH}/api/deals/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newLabel }),
    })
    if (!res.ok) throw new Error()
    $(`label-text-${id}`).textContent = newLabel
    cancelRename(id)
  } catch (e) {
    alert('Could not rename deal. Please try again.')
  } finally {
    input.disabled = false
  }
}

async function loadDeal(id) {
  try {
    const res = await fetch(`${AUTH}/api/deals/list`, { credentials: 'include' })
    if (!res.ok) throw new Error()
    const { deals } = await res.json()
    const deal = deals.find(d => String(d.id) === String(id))
    if (!deal || !deal.data) return

    const d = deal.data
    $('price').value   = d.price   || ''
    $('deposit').value = d.deposit || 25
    $('rate').value    = d.rate    || 5
    $('rent').value    = d.rent    || ''
    $('agent').value   = d.agent   || 10
    $('void').value    = d.voidWks || 2
    $('costs').value   = d.costs   || 150

    const radio = document.querySelector(`input[name="mtype"][value="${d.type || 'interest'}"]`)
    if (radio) radio.checked = true

    $('sdltCheck').checked       = !!d.addSDLT
    $('ckBox').style.background  = d.addSDLT ? '#1A3828' : '#fff'
    $('ckBox').style.borderColor = d.addSDLT ? '#1A3828' : '#C4BEB4'
    $('ckTick').style.display    = d.addSDLT ? 'block'   : 'none'

    closeModal()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    calc()
  } catch (e) {
    alert('Could not load deal. Please try again.')
  }
}

async function deleteDeal(id) {
  if (!confirm('Delete this deal? This cannot be undone.')) return

  try {
    const res = await fetch(`${AUTH}/api/deals/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) throw new Error()

    const card = $(`deal-${id}`)
    if (card) {
      card.classList.add('removing')
      setTimeout(() => {
        card.remove()
        const remaining = $('dealsList').querySelectorAll('.deal-card').length
        if (remaining === 0) {
          $('dealsList').classList.add('hidden')
          $('dealsEmpty').classList.remove('hidden')
          $('dealsCountLabel').textContent = ''
        } else {
          $('dealsCountLabel').textContent = `${remaining} deal${remaining !== 1 ? 's' : ''}`
        }
      }, 300)
    }
  } catch (e) {
    alert('Could not delete deal. Please try again.')
  }
}

// ─── Section 24 ───────────────────────────────────────────────────────────────
async function fetchTaxProfile() {
  try {
    const res = await fetch(`${AUTH}/api/user/profile`, { credentials: 'include' })
    if (res.ok) {
      const { profile } = await res.json()
      userTaxProfile = profile
      if (profile) {
        $('s24EditLink').classList.remove('hidden')
      }
      if (profile && localStorage.getItem('bk_s24_active') === '1') {
        activateS24(true)
      }
    }
  } catch (e) {}
}

function checkS24Return() {
  const returning = localStorage.getItem('bk_s24_return')
  if (!returning) return
  localStorage.removeItem('bk_s24_return')
  if (userTaxProfile && lastCalc) {
    activateS24()
  }
}

function checkS24Pending() {
  const pending = localStorage.getItem('bk_s24_pending')
  if (!pending) return
  localStorage.removeItem('bk_s24_pending')
  clearPendingDeal()
  if (!userTaxProfile) {
    // Logged in but no profile yet → go set one up
    navigateToS24()
  } else if (lastCalc) {
    // Has profile → activate immediately
    activateS24()
  }
}

// ─── S24 checkbox click ───────────────────────────────────────────────────────
function s24CheckClick() {
  if (!currentUser) {
    // Not logged in → preserve form state and set pending flag, then open login modal
    savePendingDeal(buildDealLabel())
    localStorage.setItem('bk_s24_pending', '1')
    openModal()
    showPanel('panelLogin')
    return
  }
  if (!userTaxProfile) {
    // Logged in but no profile → go to S24 page to set up
    navigateToS24()
    return
  }
  // Has profile → toggle on/off
  if (s24Active) {
    deactivateS24()
  } else {
    activateS24()
  }
}

function navigateToS24() {
  if (lastCalc) localStorage.setItem('bk_calc', JSON.stringify(lastCalc))
  window.location.href = '/section24.html'
}

function activateS24(silent = false) {
  s24Active = true
  $('s24CkBox').style.background  = '#1A3828'
  $('s24CkBox').style.borderColor = '#1A3828'
  $('s24CkTick').style.display    = 'block'
  localStorage.setItem('bk_s24_active', '1')
  $('s24Warning').classList.add('hidden')
  if (lastCalc) updateS24Display()
}

function deactivateS24() {
  s24Active = false
  $('s24CkBox').style.background  = '#fff'
  $('s24CkBox').style.borderColor = '#C4BEB4'
  $('s24CkTick').style.display    = 'none'
  localStorage.removeItem('bk_s24_active')
  $('s24Result').classList.add('hidden')
  if (lastCalc) $('s24Warning').classList.remove('hidden')
}

function updateS24Display() {
  if (!s24Active || !lastCalc || !userTaxProfile) return

  const result = S24.calculate(userTaxProfile, lastCalc)
  if (!result || result.notApplicable) {
    $('s24Result').classList.add('hidden')
    return
  }

  $('s24Result').classList.remove('hidden')

  const isRange = result.isRange
  const fmt3 = n => {
    const abs = '£' + Math.abs(Math.round(n)).toLocaleString('en-GB')
    return n < 0 ? '−' + abs : abs
  }

  const afterMonthly = isRange ? result.afterTaxMonthlyLow : result.afterTaxMonthly
  const pos          = afterMonthly >= 0
  const col          = pos ? '#86efac' : '#fca5a5'

  const afterEl = $('s24AfterNum')
  afterEl.classList.remove('num-pop')
  void afterEl.offsetWidth
  afterEl.classList.add('num-pop')
  afterEl.textContent = fmt3(afterMonthly) + '/mo'
  afterEl.style.color = col

  const monthlyCost = isRange ? result.worstCase.monthlyTax : result.monthlyTax
  $('s24CostAmt').textContent = '−£' + Math.round(monthlyCost).toLocaleString('en-GB') + '/mo'

  if (isRange) {
    $('s24RangeNote').classList.remove('hidden')
  } else {
    $('s24RangeNote').classList.add('hidden')
  }
}

// ─── Expose globals for inline onclick handlers ───────────────────────────────
window.initSave             = initSave
window.confirmSaveName      = confirmSaveName
window.sendMagicLink        = sendMagicLink
window.logout               = logout
window.closeModal           = closeModal
window.closeModalOnBackdrop = closeModalOnBackdrop
window.openMyDeals          = openMyDeals
window.startRename          = startRename
window.cancelRename         = cancelRename
window.confirmRename        = confirmRename
window.loadDeal             = loadDeal
window.deleteDeal           = deleteDeal
window.calc                 = calc
window.s24CheckClick        = s24CheckClick
window.navigateToS24        = navigateToS24

initAuth()
