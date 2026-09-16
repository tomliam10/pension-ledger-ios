import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Shield, ChevronDown, ChevronRight, TriangleAlert, BookOpen, Upload, FileText, CheckCircle2, Lock, Loader2 } from 'lucide-react';
import { usePurchases } from './purchases.js';
import Paywall from './Paywall.jsx';

/* ---------------------------------------------------------------
   Reference data — NYC Police Pension Fund, Summary Plan
   Descriptions, Tier 2 & Tier 3, published October 2024.
--------------------------------------------------------------- */
const TIER2_RATE_TABLE = [
  { age: 20, required: 8.05, member: 3.05 },
  { age: 21, required: 7.85, member: 2.85 },
  { age: 22, required: 7.65, member: 2.65 },
  { age: 23, required: 7.50, member: 2.50 },
  { age: 24, required: 7.30, member: 2.30 },
  { age: 25, required: 7.15, member: 2.15 },
  { age: 26, required: 6.95, member: 1.95 },
  { age: 27, required: 6.80, member: 1.80 },
  { age: 28, required: 6.65, member: 1.65 },
  { age: 29, required: 6.45, member: 1.45 },
  { age: 30, required: 6.30, member: 1.30 },
  { age: 31, required: 6.15, member: 1.15 },
  { age: 32, required: 6.00, member: 1.00 },
  { age: 33, required: 5.85, member: 0.85 },
  { age: 34, required: 5.65, member: 0.65 },
  { age: 35, required: 5.50, member: 0.50 },
  { age: 36, required: 5.35, member: 0.35 },
  { age: 37, required: 5.20, member: 0.20 },
  { age: 38, required: 5.05, member: 0.05 },
  { age: 39, required: 4.90, member: 0.00 },
];

/* ---------------------------------------------------------------
   Helpers
--------------------------------------------------------------- */
function fmt(n) {
  if (!isFinite(n)) n = 0;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function num(v) {
  const n = parseFloat(v);
  if (!isFinite(n)) return 0;
  return n < 0 ? 0 : n; // nothing in this calculator is legitimately negative
}

// 2026 federal income tax brackets, per IRS Revenue Procedure 2025-32.
// [threshold where this rate starts, rate]. NYPD pensions are exempt from NY State
// and NYC income tax, so only federal tax applies here.
const FEDERAL_BRACKETS_2026 = {
  single: [[0, 0.10], [12400, 0.12], [50400, 0.22], [105700, 0.24], [201775, 0.32], [256225, 0.35], [640600, 0.37]],
  mfj: [[0, 0.10], [24800, 0.12], [100800, 0.22], [211400, 0.24], [403550, 0.32], [512450, 0.35], [768700, 0.37]],
  hoh: [[0, 0.10], [17700, 0.12], [67450, 0.22], [105700, 0.24], [201775, 0.32], [256200, 0.35], [640600, 0.37]],
};
const STANDARD_DEDUCTION_2026 = { single: 16100, mfj: 32200, hoh: 24150 };

function federalTaxOnTaxableIncome(taxableIncome, filingStatus) {
  const brackets = FEDERAL_BRACKETS_2026[filingStatus] || FEDERAL_BRACKETS_2026.single;
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const [threshold, rate] = brackets[i];
    if (taxableIncome <= threshold) break;
    const nextThreshold = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
    tax += (Math.min(taxableIncome, nextThreshold) - threshold) * rate;
  }
  return tax;
}

// 2026 Child Tax Credit, per IRS Revenue Procedure 2025-32 / OBBBA. This simplified
// model applies the full credit regardless of income — the real credit phases out at
// higher incomes ($200k single/HOH, $400k MFJ modified AGI), not modeled here.
const CHILD_TAX_CREDIT_2026 = 2200;

// Estimates federal tax attributable specifically to the pension, by comparing tax
// with-and-without it — this correctly reflects that the pension is taxed at
// whatever marginal rate it lands on once stacked on top of other income, rather
// than assuming it's taxed in isolation from $0. The Child Tax Credit is applied
// once, directly against the pension's isolated share.
function estimatePensionFederalTax(pensionAnnual, otherAnnual, filingStatus, numDependents = 0) {
  const stdDeduction = STANDARD_DEDUCTION_2026[filingStatus] || STANDARD_DEDUCTION_2026.single;
  const taxableWithPension = Math.max(0, pensionAnnual + otherAnnual - stdDeduction);
  const taxableOtherOnly = Math.max(0, otherAnnual - stdDeduction);
  const taxWithPension = federalTaxOnTaxableIncome(taxableWithPension, filingStatus);
  const taxOtherOnly = federalTaxOnTaxableIncome(taxableOtherOnly, filingStatus);
  const grossPensionTax = Math.max(0, taxWithPension - taxOtherOnly);
  const ctc = Math.max(0, numDependents) * CHILD_TAX_CREDIT_2026;
  return Math.max(0, grossPensionTax - ctc);
}

/* ---------------------------------------------------------------
   Statement scanning — best-effort text matching over text the
   member pastes from their own PDF statement. Browsers can't
   decode compressed PDF streams without a dedicated library, so
   this works on pasted/copied text rather than the raw file.
--------------------------------------------------------------- */
function findFigure(text, labelAlternatives) {
  for (const label of labelAlternatives) {
    const re = new RegExp(label + '[\\s:\\u2013\\-]{0,10}\\$?\\s{0,5}([\\d,]+(?:\\.\\d+)?)', 'i');
    const m = text.match(re);
    if (m) {
      const start = Math.max(0, m.index - 5);
      const end = Math.min(text.length, m.index + m[0].length + 15);
      return { value: m[1].replace(/,/g, ''), snippet: text.slice(start, end).replace(/\s+/g, ' ').trim() };
    }
  }
  return null;
}

function findYears(text) {
  const patterns = [
    // "Years of Allowable Police Service: 23.0" — label then number (safer: label text is specific)
    /(?:years[ \t]{0,2}of[ \t]{0,2}(?:allowable police|credited|uniformed)[ \t]{0,2}service|total[ \t]{0,2}service|service[ \t]{0,2}to[ \t]{0,2}date)[ \t:\u2013\-]{0,8}(\d+(?:\.\d+)?)/i,
    // "23.0 years of Allowable Police Service" — number then label, adjacent words only
    // (space/tab separators only — never spans a newline, which prevents accidentally
    // matching an unrelated number like a date fragment sitting on the line above)
    /(\d+(?:\.\d+)?)[ \t]{1,2}years?[ \t]{1,2}of[ \t]{1,2}(?:allowable police|credited|uniformed)[ \t]{1,2}service/i,
    /(?:years?[ \t]{0,2}of[ \t]{0,2}service)[ \t:\u2013\-]{0,8}(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)[ \t]{1,2}years?[ \t]{1,2}of[ \t]{1,2}service/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const start = Math.max(0, m.index - 5);
      const end = Math.min(text.length, m.index + m[0].length + 10);
      return { value: m[1], snippet: text.slice(start, end).replace(/\s+/g, ' ').trim() };
    }
  }
  return null;
}

function extractFigures(text) {
  const clean = (text || '').replace(/\r/g, '');
  const result = {
    // "Final Year Salary" is a real field on PPF's standard Annual Pension Statement —
    // for members appointed on/after 7/1/2000, FAS legally IS the final 12 months of
    // pensionable earnings, so this is a close, honest stand-in when the statement
    // doesn't spell out "Final Average Salary" or "FAS" directly. The quoted snippet
    // always shows exactly which label matched, so the person can judge for themselves.
    fas: findFigure(clean, ['final average salary', 'FAS', 'final year salary']),
    years: findYears(clean),
    required: findFigure(clean, ['required amount', 'accumulated contributions', 'total member contributions', 'total contributions', 'contribution account balance']),
    annual: findFigure(clean, [
      'estimated annual (?:pension|benefit|retirement allowance)',
      'annual (?:pension|retirement allowance)',
      'maximum retirement allowance',
      'annual benefit',
      'pension amount',
    ]),
    monthly: findFigure(clean, ['monthly (?:pension|benefit|retirement allowance)', 'per month']),
    longevity: findFigure(clean, [
      'pension longevity enhancement',
      'longevity enhancement',
      'longevity increase',
      'rank[- ]based enhancement',
    ]),
  };

  // PPF's standard Annual Pension Statement lists Monthly and Annual Benefit as two
  // numbers on one line ("Vested Retirement Without Final Withdrawal: $X $Y") rather
  // than either figure sitting right next to its own label — the generic patterns
  // above can't reliably parse a two-column table, so this catches that specific,
  // very common real-world layout as a fallback when they come up empty.
  if (!result.monthly || !result.annual) {
    const m = clean.match(/vested retirement without final withdrawal[\s:]{0,10}\$?\s{0,3}([\d,]+(?:\.\d+)?)\s+\$?\s{0,3}([\d,]+(?:\.\d+)?)/i);
    if (m) {
      const snippetStart = Math.max(0, m.index - 5);
      const snippetEnd = Math.min(clean.length, m.index + m[0].length + 5);
      const snippet = clean.slice(snippetStart, snippetEnd).replace(/\s+/g, ' ').trim();
      if (!result.monthly) result.monthly = { value: m[1].replace(/,/g, ''), snippet };
      if (!result.annual) result.annual = { value: m[2].replace(/,/g, ''), snippet };
    }
  }

  return result;
}

/* ---------------------------------------------------------------
   Small building blocks
--------------------------------------------------------------- */
function NumField({ label, value, onChange, prefix = '$', hint, suffix }) {
  const raw = String(value ?? '').trim();
  const parsed = parseFloat(raw);
  const isInvalid = raw !== '' && (!isFinite(parsed) || parsed < 0);
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-slate-300 mb-1">{label}</span>
      <div
        className={`flex items-center bg-slate-950 border rounded-sm px-3 py-2 ${
          isInvalid ? 'border-red-500' : 'border-slate-700 focus-within:border-amber-500'
        }`}
      >
        {prefix && <span className="text-slate-400 font-mono mr-1 text-sm">{prefix}</span>}
        <input
          type="number"
          inputMode="decimal"
          min="0"
          aria-invalid={isInvalid}
          className="bg-transparent outline-none w-full font-mono text-slate-100 text-base"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix && <span className="text-slate-400 font-mono ml-1 text-sm">{suffix}</span>}
      </div>
      {isInvalid ? (
        <span className="block text-xs text-red-400 mt-1">
          {parsed < 0 ? "Negative values aren't used here — treated as 0 below." : 'Not a valid number — treated as 0 below.'}
        </span>
      ) : (
        hint && <span className="block text-xs text-slate-400 mt-1 leading-snug">{hint}</span>
      )}
    </label>
  );
}

function SegGroup({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3.5 py-2 text-[13px] rounded-sm border font-medium transition-colors ${
            value === opt.value
              ? 'bg-amber-500 border-amber-500 text-slate-950'
              : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function LedgerRow({ label, annual, monthly, bold, sub, negative }) {
  const amt = negative ? -Math.abs(annual) : annual;
  const amtM = negative ? -Math.abs(monthly) : monthly;
  return (
    <div className={`flex items-start justify-between py-2.5 ${bold ? 'border-t border-slate-700 mt-1 pt-3' : 'border-b border-dotted border-slate-800'}`}>
      <div className="pr-3">
        <div className={`${bold ? 'font-semibold text-slate-100' : 'text-slate-300'} text-sm`}>{label}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5 leading-snug max-w-md">{sub}</div>}
      </div>
      <div className="text-right shrink-0 min-w-0">
        <div className={`font-mono break-all ${bold ? 'text-lg font-bold text-amber-400' : 'text-slate-200 text-sm'}`}>
          {negative && amt < 0 ? '−' : ''}{fmt(Math.abs(amt))}
          <span className="text-[11px] text-slate-400 font-sans ml-1">/yr</span>
        </div>
        <div className="text-xs text-slate-400 font-mono">
          {negative && amtM < 0 ? '−' : ''}{fmt(Math.abs(amtM))}/mo
        </div>
      </div>
    </div>
  );
}

function SliderField({ label, value, max, onChange, hint }) {
  const safeMax = Math.max(0, Math.floor(max || 0));
  const current = Math.min(Math.max(0, num(value)), safeMax);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] font-medium text-slate-300">{label}</span>
        <button
          type="button"
          onClick={() => onChange(String(safeMax))}
          className="text-[11px] text-amber-500 underline decoration-dotted"
        >
          Use max
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={safeMax || 1}
        step={100}
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="w-full accent-amber-500 h-6"
        disabled={safeMax <= 0}
      />
      <div className="flex flex-wrap items-center justify-between mt-2 gap-2">
        <div className="flex items-center bg-slate-950 border border-slate-700 focus-within:border-amber-500 rounded-sm px-3 py-2">
          <span className="text-slate-400 font-mono mr-1 text-sm">$</span>
          <input
            type="number"
            inputMode="decimal"
            className="bg-transparent outline-none w-28 sm:w-32 font-mono text-slate-100 text-base"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
        <span className="text-xs text-slate-400 whitespace-nowrap">of {fmt(safeMax)} max</span>
      </div>
      {hint && <span className="block text-xs text-slate-400 mt-1 leading-snug">{hint}</span>}
    </div>
  );
}

function LumpSumRow({ label, value, sub, bold, negative }) {
  const v = Math.abs(value);
  return (
    <div className={`flex items-start justify-between py-2.5 ${bold ? 'border-t border-slate-700 mt-1 pt-3' : 'border-b border-dotted border-slate-800'}`}>
      <div className="pr-3">
        <div className={`${bold ? 'font-semibold text-slate-100' : 'text-slate-300'} text-sm`}>{label}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5 leading-snug max-w-md">{sub}</div>}
      </div>
      <div className="text-right shrink-0 min-w-0">
        <div className={`font-mono break-all ${bold ? 'text-lg font-bold text-amber-400' : 'text-slate-200 text-sm'}`}>
          {negative ? '−' : ''}{fmt(v)}
        </div>
        <div className="text-[11px] text-slate-400">one-time</div>
      </div>
    </div>
  );
}

function ExtractedRow({ label, match, onUse }) {
  if (!match) {
    return (
      <div className="flex items-center justify-between py-2 border-b border-dotted border-slate-800">
        <span className="text-sm text-slate-400">{label}</span>
        <span className="text-xs text-slate-400">not found</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-dotted border-slate-800">
      <div className="min-w-0">
        <div className="text-sm text-slate-200">
          {label}: <span className="font-mono text-amber-400">{match.value}</span>
        </div>
        <div className="text-xs text-slate-400 truncate">"…{match.snippet}…"</div>
      </div>
      <button
        type="button"
        onClick={onUse}
        className="shrink-0 text-xs bg-amber-500 text-slate-950 font-medium rounded-sm px-3 py-2"
      >
        Use
      </button>
    </div>
  );
}

function LoadingSection({ title, badge }) {
  return (
    <div className="border border-slate-800 bg-slate-900/60 rounded-sm mb-4">
      <div className="px-4 py-3 flex items-center justify-between">
        <span className="font-serif text-[17px] text-slate-100 flex items-center gap-2">
          {badge && (
            <span className="text-[10px] font-mono tracking-wide text-amber-500 border border-amber-700/70 rounded-sm px-1.5 py-0.5">
              {badge}
            </span>
          )}
          {title}
        </span>
        <Loader2 size={16} className="text-slate-400 shrink-0 animate-spin" />
      </div>
      <div className="px-4 pb-4">
        <p className="text-sm text-slate-400">Checking your purchase status…</p>
      </div>
    </div>
  );
}

function LockedSection({ title, badge, teaser, onUnlock }) {
  return (
    <div className="border border-amber-800/40 bg-slate-900/60 rounded-sm mb-4">
      <div className="px-4 py-3 flex items-center justify-between">
        <span className="font-serif text-[17px] text-slate-100 flex items-center gap-2">
          {badge && (
            <span className="text-[10px] font-mono tracking-wide text-amber-500 border border-amber-700/70 rounded-sm px-1.5 py-0.5">
              {badge}
            </span>
          )}
          {title}
        </span>
        <Lock size={16} className="text-amber-500 shrink-0" />
      </div>
      <div className="px-4 pb-4">
        <p className="text-sm text-slate-400 leading-relaxed mb-3">{teaser}</p>
        <button
          type="button"
          onClick={onUnlock}
          className="text-xs bg-amber-500 text-slate-950 font-medium rounded-sm px-4 py-2.5"
        >
          Unlock Full Access
        </button>
      </div>
    </div>
  );
}

function PendingLawPreview({ currentMonthly, pendingMonthly, currentFAS, pendingFAS }) {
  const diff = pendingMonthly - currentMonthly;
  return (
    <div className="mt-4 border border-sky-700/50 bg-sky-950/20 rounded-sm p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-mono tracking-wide text-sky-400 border border-sky-700/70 rounded-sm px-1.5 py-0.5">
          PENDING — NOT YET LAW
        </span>
        <span className="font-serif text-base text-slate-100">If S7808A is signed</span>
      </div>
      <p className="text-xs text-slate-400 leading-relaxed mb-3">
        NY Senate Bill S7808A ("NYPD Tier 2A") passed the Senate 59-1 on 6/1/2026 and the Assembly on 6/4/2026. As of
        this writing it awaits the Governor's signature — <strong className="text-slate-300">nothing changes unless
        and until it's signed.</strong> If enacted, it would let Tier 2 members hired on or after 7/1/2000 use the
        greater of their final 12 months or their best 3 consecutive years — the same option pre-2000 Tier 2
        members already have.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-950/60 border border-slate-700 rounded-sm px-3 py-3">
          <div className="text-xs text-slate-400 mb-1">Current law (final 12 months)</div>
          <div className="font-mono text-lg text-slate-100">{fmt(currentMonthly)}/mo</div>
          <div className="text-xs text-slate-400">FAS: {fmt(currentFAS)}</div>
        </div>
        <div className="bg-slate-950/60 border border-sky-700/60 rounded-sm px-3 py-3">
          <div className="text-xs text-slate-400 mb-1">If signed (best of 3 years)</div>
          <div className="font-mono text-lg text-sky-400">{fmt(pendingMonthly)}/mo</div>
          <div className="text-xs text-slate-400">FAS: {fmt(pendingFAS)}</div>
        </div>
      </div>
      {diff > 0 ? (
        <p className="text-sm text-slate-200 leading-relaxed mt-3">
          Your best 3 years beat your final 12 months — if signed, this could add{' '}
          <span className="font-mono text-sky-400">{fmt(diff)}/mo</span> to your pension.
        </p>
      ) : (
        <p className="text-xs text-slate-400 leading-relaxed mt-3">
          Your final 12 months already matches or beats your best 3 years, so this bill wouldn't change your figure
          even if signed — it only ever helps, never hurts, since it's a "greater of" test.
        </p>
      )}
    </div>
  );
}

function HeadlineNumber({ monthly, yearly, label = 'Your Estimated Pension', note }) {
  return (
    <div className="text-center py-4 mb-4 border-b border-slate-800">
      <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="font-mono text-4xl font-bold text-amber-400">
        {fmt(monthly)}<span className="text-lg text-slate-400 font-normal">/mo</span>
      </div>
      <div className="text-sm text-slate-400 mt-1">{fmt(yearly)}/yr</div>
      {note && (
        <p className="text-xs text-sky-400 bg-sky-950/20 border border-sky-800/50 rounded-sm px-3 py-2 mt-3 text-left leading-relaxed">
          {note}
        </p>
      )}
    </div>
  );
}

function HeadlineSplit({ beforeMonthly, afterMonthly, note }) {
  return (
    <div className="py-4 mb-4 border-b border-slate-800">
      <div className="grid grid-cols-2 gap-3 text-center">
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Before Age 62</div>
          <div className="font-mono text-2xl sm:text-3xl font-bold text-amber-400">
            {fmt(beforeMonthly)}<span className="text-sm text-slate-400 font-normal">/mo</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Age 62 and After</div>
          <div className="font-mono text-2xl sm:text-3xl font-bold text-amber-400">
            {fmt(afterMonthly)}<span className="text-sm text-slate-400 font-normal">/mo</span>
          </div>
        </div>
      </div>
      {note && (
        <p className="text-xs text-sky-400 bg-sky-950/20 border border-sky-800/50 rounded-sm px-3 py-2 mt-3 text-left leading-relaxed">
          {note}
        </p>
      )}
    </div>
  );
}

function NetPayEstimate({ label, grossAnnual, filingStatus, otherIncomeAnnual, numDependents, isExempt }) {
  const tax = isExempt ? 0 : estimatePensionFederalTax(grossAnnual, otherIncomeAnnual, filingStatus, numDependents);
  const net = Math.max(0, grossAnnual - tax);
  return (
    <div className="border border-slate-700 bg-slate-950/60 rounded-sm px-3 py-3">
      {label && <div className="text-xs text-slate-400 mb-2">{label}</div>}
      {isExempt && (
        <p className="text-xs text-sky-400 leading-relaxed mb-2">
          Per PPF's SPD, Accident Disability Retirement pensions are generally not subject to federal tax — this
          shows your full gross amount as net.
        </p>
      )}
      <LedgerRow label="Gross pension" annual={grossAnnual} monthly={grossAnnual / 12} />
      <LedgerRow label="Estimated federal tax" annual={tax} monthly={tax / 12} negative />
      <LedgerRow label="Estimated net (take-home)" annual={net} monthly={net / 12} bold />
    </div>
  );
}

function PreFinalizationEstimate({ fullMonthly, fullAnnual, withholdPct }) {
  const pct = Math.min(100, Math.max(0, withholdPct));
  const preMonthly = fullMonthly * (1 - pct / 100);
  const preAnnual = fullAnnual * (1 - pct / 100);
  return (
    <div className="mt-4 border border-slate-700 bg-slate-950/60 rounded-sm px-3 py-3">
      <div className="text-xs text-slate-400 mb-2">
        Per PPF's SPD: while your case is being finalized, you're paid your Maximum Retirement Allowance minus a
        default 5% holdback — not your final amount yet.
      </div>
      <div className="grid grid-cols-2 gap-3 mb-2">
        <div>
          <div className="text-xs text-slate-400 mb-1">Before finalization</div>
          <div className="font-mono text-lg text-sky-400">{fmt(preMonthly)}<span className="text-xs text-slate-400">/mo</span></div>
          <div className="text-xs text-slate-400">{fmt(preAnnual)}/yr</div>
        </div>
        <div>
          <div className="text-xs text-slate-400 mb-1">After finalization</div>
          <div className="font-mono text-lg text-amber-400">{fmt(fullMonthly)}<span className="text-xs text-slate-400">/mo</span></div>
          <div className="text-xs text-slate-400">{fmt(fullAnnual)}/yr</div>
        </div>
      </div>
      <p className="text-xs text-amber-400 leading-relaxed">
        Choosing a survivor payment option? PPF's SPD specifically recommends withholding <strong>more than
        5%</strong> in that case, since an option reduces your final pension below the Maximum Retirement
        Allowance shown here — this calculator doesn't model options, so raise the percentage below yourself if
        that applies to you, or you may end up owing money back once finalized.
      </p>
      <p className="text-xs text-slate-400 leading-relaxed mt-2">
        Once finalized, you move to full monthly payments, and any gap between the two periods is caught up in
        your first full payment — not lost.
      </p>
    </div>
  );
}

function TradeoffSummary({ beforeMonthly, afterMonthly, netCash, periodLabel }) {
  const diff = beforeMonthly - afterMonthly;
  return (
    <div className="mt-4 border border-amber-700/50 bg-amber-950/20 rounded-sm p-4">
      <div className="font-serif text-base text-slate-100 mb-3">
        What you're trading{periodLabel ? ` (${periodLabel})` : ''}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-slate-950/60 border border-slate-700 rounded-sm px-3 py-3">
          <div className="text-xs text-slate-400 mb-1">If you DON'T withdraw</div>
          <div className="font-mono text-lg text-slate-100">{fmt(beforeMonthly)}</div>
          <div className="text-xs text-slate-400">per month, for life</div>
        </div>
        <div className="bg-slate-950/60 border border-slate-700 rounded-sm px-3 py-3">
          <div className="text-xs text-slate-400 mb-1">If you DO withdraw</div>
          <div className="font-mono text-lg text-amber-400">{fmt(afterMonthly)}</div>
          <div className="text-xs text-slate-400">per month, for life</div>
        </div>
      </div>
      <p className="text-sm text-slate-200 leading-relaxed">
        You give up <span className="font-mono text-amber-400">{fmt(diff)}/mo</span> for the rest of your life, in
        exchange for <span className="font-mono text-amber-400">{fmt(netCash)}</span> in hand now.
      </p>
      {diff > 0 && netCash > 0 && (
        <p className="text-xs text-slate-400 leading-relaxed mt-2">
          Rough break-even: about {Math.round(netCash / diff)} months ({(netCash / diff / 12).toFixed(1)} years) of
          collecting the smaller pension before the cash you took is used up. Living longer than that favors keeping
          the bigger pension; this ignores any growth if you invest the cash.
        </p>
      )}
    </div>
  );
}

function Section({ title, badge, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-800 bg-slate-900/60 rounded-sm mb-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-serif text-[17px] text-slate-100 flex items-center gap-2">
          {badge && (
            <span className="text-[10px] font-mono tracking-wide text-amber-500 border border-amber-700/70 rounded-sm px-1.5 py-0.5">
              {badge}
            </span>
          )}
          {title}
        </span>
        {open ? <ChevronDown size={18} className="text-slate-400 shrink-0" /> : <ChevronRight size={18} className="text-slate-400 shrink-0" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function CompositionBar({ segments }) {
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0) || 1;
  return (
    <div>
      <div className="flex h-3 w-full rounded-sm overflow-hidden border border-slate-700 bg-slate-950">
        {segments.map((seg, i) => (
          <div
            key={i}
            style={{ width: `${(Math.max(0, seg.value) / total) * 100}%`, backgroundColor: seg.color }}
            title={seg.label}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="w-2.5 h-2.5 inline-block rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
            {seg.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/* =================================================================
   Error boundary — catches any unexpected calculation/render error
   and shows a real message instead of a blank white screen.
================================================================= */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, message: error && error.message ? error.message : 'Unknown error' };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-200 font-sans flex items-center justify-center p-6">
          <div className="max-w-sm text-center">
            <TriangleAlert className="text-amber-500 mx-auto mb-3" size={32} />
            <h1 className="font-serif text-xl text-slate-100 mb-2">Something went wrong</h1>
            <p className="text-sm text-slate-400 leading-relaxed mb-4">
              The calculator hit an unexpected error and couldn't continue. Your entered figures are safe — this
              usually clears up on a fresh start.
            </p>
            <p className="text-xs text-slate-400 font-mono mb-4 break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="bg-amber-500 text-slate-950 font-medium text-sm rounded-sm px-4 py-2.5"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* =================================================================
   MAIN APP
================================================================= */
export default function PensionCalculatorWithBoundary() {
  return (
    <ErrorBoundary>
      <PensionCalculator />
    </ErrorBoundary>
  );
}

function PensionCalculator() {
  const [tier, setTier] = useState('tier2');
  const { isPremium, offerings, loading: purchasesLoading, error: purchasesError, isNative, purchasePackage, restorePurchases } = usePurchases();
  const [showPaywall, setShowPaywall] = useState(false);

  /* ---------------- Tier 2 state ---------------- */
  const [t2AppointDate, setT2AppointDate] = useState('after2000');
  const [t2Best3Year1, setT2Best3Year1] = useState('0');
  const [t2Best3Year2, setT2Best3Year2] = useState('0');
  const [t2Best3Year3, setT2Best3Year3] = useState('0');
  const [t2RetType, setT2RetType] = useState('service');
  const [t2Years, setT2Years] = useState('20');
  const [t2FAS, setT2FAS] = useState('125000');
  const [t2EarningsAfter20, setT2EarningsAfter20] = useState('0');
  const [t2AppointAge, setT2AppointAge] = useState('25');
  const [t2LongevityEnhancement, setT2LongevityEnhancement] = useState('0');

  const [t2ShowNonUni, setT2ShowNonUni] = useState(false);
  const [t2NonUniYears, setT2NonUniYears] = useState('0');
  const [t2NonUniAvg, setT2NonUniAvg] = useState('0');

  const [t2WaivedITHP, setT2WaivedITHP] = useState(false);
  const [t2Uses5050, setT2Uses5050] = useState(false);
  const [t2EnhancedMode, setT2EnhancedMode] = useState('lumpsum'); // 'lumpsum' | 'annual'
  const [t2EnhancedAnnual, setT2EnhancedAnnual] = useState('0');
  const [t2ASFBalance, setT2ASFBalance] = useState('0');
  const [t2ASFRequired, setT2ASFRequired] = useState('0');
  const [t2Factor, setT2Factor] = useState('82');
  const [t2ITHPAnnuity, setT2ITHPAnnuity] = useState('0');

  const [t2ShowWithdrawal, setT2ShowWithdrawal] = useState(false);
  const [t2WithdrawalMode, setT2WithdrawalMode] = useState('amount'); // 'amount' | 'target'
  const [t2RequiredAmount, setT2RequiredAmount] = useState('150000');
  const [t2WithdrawalAmount, setT2WithdrawalAmount] = useState('0');
  const [t2TargetMonthly, setT2TargetMonthly] = useState('7000');
  const [t2Rollover, setT2Rollover] = useState(false);
  const [t2PenaltyExempt, setT2PenaltyExempt] = useState(false);

  /* ---------------- Tier 3 state ---------------- */
  const [t3Plan, setT3Plan] = useState('revised');
  const [t3RetType, setT3RetType] = useState('normal');
  const [t3Years, setT3Years] = useState('20');
  const [t3Year1, setT3Year1] = useState('125000');
  const [t3Year2, setT3Year2] = useState('125000');
  const [t3Year3, setT3Year3] = useState('125000');
  const [t3SS62, setT3SS62] = useState('0');
  const [t3SSDI, setT3SSDI] = useState('0');
  const [t3ADRHasSSDI, setT3ADRHasSSDI] = useState(false);
  const [t3ShowEarlyVest, setT3ShowEarlyVest] = useState(false);
  const [t3YearsEarly, setT3YearsEarly] = useState('0');
  const [t3LongevityEnhancement, setT3LongevityEnhancement] = useState('0');

  const [t3ShowWithdrawal, setT3ShowWithdrawal] = useState(false);
  const [t3WithdrawalMode, setT3WithdrawalMode] = useState('amount'); // 'amount' | 'target'
  const [t3LoanBucket, setT3LoanBucket] = useState('onafter2018');
  const [t3RequiredAmount, setT3RequiredAmount] = useState('60000');
  const [t3OutstandingLoan, setT3OutstandingLoan] = useState('0');
  const [t3WithdrawalAmount, setT3WithdrawalAmount] = useState('0');
  const [t3TargetMonthly, setT3TargetMonthly] = useState('7000');
  const [t3TargetBasis, setT3TargetBasis] = useState('before'); // 'before' | 'after'
  const [t3Factor, setT3Factor] = useState('82');
  const [t3Rollover, setT3Rollover] = useState(false);
  const [t3PenaltyExempt, setT3PenaltyExempt] = useState(false);

  /* ---------------- Deferred Comp (shared) ---------------- */
  const [showDefComp, setShowDefComp] = useState(false);
  const [showNetPay, setShowNetPay] = useState(false);
  const [taxFilingStatus, setTaxFilingStatus] = useState('single');
  const [otherTaxableIncome, setOtherTaxableIncome] = useState('0');
  const [spouseTaxableIncome, setSpouseTaxableIncome] = useState('0');
  const [numDependents, setNumDependents] = useState('0');
  const [showPreFinalization, setShowPreFinalization] = useState(false);
  const [preFinalizationPct, setPreFinalizationPct] = useState('5');
  const [showBuyback, setShowBuyback] = useState(false);
  const [buybackYears, setBuybackYears] = useState('0');
  const [buybackComp, setBuybackComp] = useState('0');
  const [defCompBalance, setDefCompBalance] = useState('0');
  const [defCompMode, setDefCompMode] = useState('rate');
  const [defCompRate, setDefCompRate] = useState('4');
  const [defCompFixedMonthly, setDefCompFixedMonthly] = useState('0');

  /* ---------------- Accuracy check against real statement ---------------- */
  const [statementText, setStatementText] = useState('');
  const [extracted, setExtracted] = useState(null);
  const [appliedCount, setAppliedCount] = useState(0);
  const [officialAnnual, setOfficialAnnual] = useState('0');
  const [officialMonthly, setOfficialMonthly] = useState('0');
  const [fileError, setFileError] = useState('');
  const [fileName, setFileName] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);

  /* ---------------- Persistence: remember inputs across app launches ---------------- */
  const PERSIST_KEY = 'pension-ledger-v1';
  const hasRestored = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PERSIST_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
      if (saved.tier !== undefined) setTier(saved.tier);
      if (saved.t2AppointDate !== undefined) setT2AppointDate(saved.t2AppointDate);
      if (saved.t2RetType !== undefined) setT2RetType(saved.t2RetType);
      if (saved.t2Years !== undefined) setT2Years(saved.t2Years);
      if (saved.t2FAS !== undefined) setT2FAS(saved.t2FAS);
      if (saved.t2EarningsAfter20 !== undefined) setT2EarningsAfter20(saved.t2EarningsAfter20);
      if (saved.t2AppointAge !== undefined) setT2AppointAge(saved.t2AppointAge);
      if (saved.t2LongevityEnhancement !== undefined) setT2LongevityEnhancement(saved.t2LongevityEnhancement);
      if (saved.t2ShowNonUni !== undefined) setT2ShowNonUni(saved.t2ShowNonUni);
      if (saved.t2NonUniYears !== undefined) setT2NonUniYears(saved.t2NonUniYears);
      if (saved.t2NonUniAvg !== undefined) setT2NonUniAvg(saved.t2NonUniAvg);
      if (saved.t2WaivedITHP !== undefined) setT2WaivedITHP(saved.t2WaivedITHP);
      if (saved.t2Uses5050 !== undefined) setT2Uses5050(saved.t2Uses5050);
      if (saved.t2EnhancedMode !== undefined) setT2EnhancedMode(saved.t2EnhancedMode);
      if (saved.t2EnhancedAnnual !== undefined) setT2EnhancedAnnual(saved.t2EnhancedAnnual);
      if (saved.t2ASFBalance !== undefined) setT2ASFBalance(saved.t2ASFBalance);
      if (saved.t2ASFRequired !== undefined) setT2ASFRequired(saved.t2ASFRequired);
      if (saved.t2Factor !== undefined) setT2Factor(saved.t2Factor);
      if (saved.t2ITHPAnnuity !== undefined) setT2ITHPAnnuity(saved.t2ITHPAnnuity);
      if (saved.t2Best3Year1 !== undefined) setT2Best3Year1(saved.t2Best3Year1);
      if (saved.t2Best3Year2 !== undefined) setT2Best3Year2(saved.t2Best3Year2);
      if (saved.t2Best3Year3 !== undefined) setT2Best3Year3(saved.t2Best3Year3);
      if (saved.t2ShowWithdrawal !== undefined) setT2ShowWithdrawal(saved.t2ShowWithdrawal);
      if (saved.t2WithdrawalMode !== undefined) setT2WithdrawalMode(saved.t2WithdrawalMode);
      if (saved.t2RequiredAmount !== undefined) setT2RequiredAmount(saved.t2RequiredAmount);
      if (saved.t2WithdrawalAmount !== undefined) setT2WithdrawalAmount(saved.t2WithdrawalAmount);
      if (saved.t2TargetMonthly !== undefined) setT2TargetMonthly(saved.t2TargetMonthly);
      if (saved.t2Rollover !== undefined) setT2Rollover(saved.t2Rollover);
      if (saved.t2PenaltyExempt !== undefined) setT2PenaltyExempt(saved.t2PenaltyExempt);
      if (saved.t3Plan !== undefined) setT3Plan(saved.t3Plan);
      if (saved.t3RetType !== undefined) setT3RetType(saved.t3RetType);
      if (saved.t3Years !== undefined) setT3Years(saved.t3Years);
      if (saved.t3Year1 !== undefined) setT3Year1(saved.t3Year1);
      if (saved.t3Year2 !== undefined) setT3Year2(saved.t3Year2);
      if (saved.t3Year3 !== undefined) setT3Year3(saved.t3Year3);
      if (saved.t3SS62 !== undefined) setT3SS62(saved.t3SS62);
      if (saved.t3SSDI !== undefined) setT3SSDI(saved.t3SSDI);
      if (saved.t3ADRHasSSDI !== undefined) setT3ADRHasSSDI(saved.t3ADRHasSSDI);
      if (saved.t3ShowEarlyVest !== undefined) setT3ShowEarlyVest(saved.t3ShowEarlyVest);
      if (saved.t3YearsEarly !== undefined) setT3YearsEarly(saved.t3YearsEarly);
      if (saved.t3LongevityEnhancement !== undefined) setT3LongevityEnhancement(saved.t3LongevityEnhancement);
      if (saved.t3ShowWithdrawal !== undefined) setT3ShowWithdrawal(saved.t3ShowWithdrawal);
      if (saved.t3WithdrawalMode !== undefined) setT3WithdrawalMode(saved.t3WithdrawalMode);
      if (saved.t3LoanBucket !== undefined) setT3LoanBucket(saved.t3LoanBucket);
      if (saved.t3RequiredAmount !== undefined) setT3RequiredAmount(saved.t3RequiredAmount);
      if (saved.t3OutstandingLoan !== undefined) setT3OutstandingLoan(saved.t3OutstandingLoan);
      if (saved.t3WithdrawalAmount !== undefined) setT3WithdrawalAmount(saved.t3WithdrawalAmount);
      if (saved.t3TargetMonthly !== undefined) setT3TargetMonthly(saved.t3TargetMonthly);
      if (saved.t3TargetBasis !== undefined) setT3TargetBasis(saved.t3TargetBasis);
      if (saved.t3Factor !== undefined) setT3Factor(saved.t3Factor);
      if (saved.t3Rollover !== undefined) setT3Rollover(saved.t3Rollover);
      if (saved.t3PenaltyExempt !== undefined) setT3PenaltyExempt(saved.t3PenaltyExempt);
      if (saved.showDefComp !== undefined) setShowDefComp(saved.showDefComp);
      if (saved.showNetPay !== undefined) setShowNetPay(saved.showNetPay);
      if (saved.taxFilingStatus !== undefined) setTaxFilingStatus(saved.taxFilingStatus);
      if (saved.otherTaxableIncome !== undefined) setOtherTaxableIncome(saved.otherTaxableIncome);
      if (saved.spouseTaxableIncome !== undefined) setSpouseTaxableIncome(saved.spouseTaxableIncome);
      if (saved.numDependents !== undefined) setNumDependents(saved.numDependents);
      if (saved.showPreFinalization !== undefined) setShowPreFinalization(saved.showPreFinalization);
      if (saved.preFinalizationPct !== undefined) setPreFinalizationPct(saved.preFinalizationPct);
      if (saved.showBuyback !== undefined) setShowBuyback(saved.showBuyback);
      if (saved.buybackYears !== undefined) setBuybackYears(saved.buybackYears);
      if (saved.buybackComp !== undefined) setBuybackComp(saved.buybackComp);
      if (saved.defCompBalance !== undefined) setDefCompBalance(saved.defCompBalance);
      if (saved.defCompMode !== undefined) setDefCompMode(saved.defCompMode);
      if (saved.defCompRate !== undefined) setDefCompRate(saved.defCompRate);
      if (saved.defCompFixedMonthly !== undefined) setDefCompFixedMonthly(saved.defCompFixedMonthly);
      if (saved.statementText !== undefined) setStatementText(saved.statementText);
      if (saved.officialAnnual !== undefined) setOfficialAnnual(saved.officialAnnual);
      if (saved.officialMonthly !== undefined) setOfficialMonthly(saved.officialMonthly);
      }
    } catch (e) {
      // Corrupt or inaccessible storage — just start fresh rather than crash.
    } finally {
      hasRestored.current = true;
    }
    // Restore once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasRestored.current) return; // don't overwrite saved data with defaults before restore runs
    try {
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify({ tier, t2AppointDate, t2RetType, t2Years, t2FAS, t2EarningsAfter20, t2AppointAge, t2LongevityEnhancement, t2ShowNonUni, t2NonUniYears, t2NonUniAvg, t2WaivedITHP, t2Uses5050, t2EnhancedMode, t2EnhancedAnnual, t2ASFBalance, t2ASFRequired, t2Factor, t2ITHPAnnuity, t2Best3Year1, t2Best3Year2, t2Best3Year3, t2ShowWithdrawal, t2WithdrawalMode, t2RequiredAmount, t2WithdrawalAmount, t2TargetMonthly, t2Rollover, t2PenaltyExempt, t3Plan, t3RetType, t3Years, t3Year1, t3Year2, t3Year3, t3SS62, t3SSDI, t3ADRHasSSDI, t3ShowEarlyVest, t3YearsEarly, t3LongevityEnhancement, t3ShowWithdrawal, t3WithdrawalMode, t3LoanBucket, t3RequiredAmount, t3OutstandingLoan, t3WithdrawalAmount, t3TargetMonthly, t3TargetBasis, t3Factor, t3Rollover, t3PenaltyExempt, showDefComp, defCompBalance, defCompMode, defCompRate, defCompFixedMonthly, showNetPay, taxFilingStatus, otherTaxableIncome, spouseTaxableIncome, numDependents, showPreFinalization, preFinalizationPct, showBuyback, buybackYears, buybackComp, statementText, officialAnnual, officialMonthly }));
    } catch (e) {
      // Storage full or unavailable — inputs just won't persist this session.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier, t2AppointDate, t2RetType, t2Years, t2FAS, t2EarningsAfter20, t2AppointAge, t2LongevityEnhancement, t2ShowNonUni, t2NonUniYears, t2NonUniAvg, t2WaivedITHP, t2Uses5050, t2EnhancedMode, t2EnhancedAnnual, t2ASFBalance, t2ASFRequired, t2Factor, t2ITHPAnnuity, t2Best3Year1, t2Best3Year2, t2Best3Year3, t2ShowWithdrawal, t2WithdrawalMode, t2RequiredAmount, t2WithdrawalAmount, t2TargetMonthly, t2Rollover, t2PenaltyExempt, t3Plan, t3RetType, t3Years, t3Year1, t3Year2, t3Year3, t3SS62, t3SSDI, t3ADRHasSSDI, t3ShowEarlyVest, t3YearsEarly, t3LongevityEnhancement, t3ShowWithdrawal, t3WithdrawalMode, t3LoanBucket, t3RequiredAmount, t3OutstandingLoan, t3WithdrawalAmount, t3TargetMonthly, t3TargetBasis, t3Factor, t3Rollover, t3PenaltyExempt, showDefComp, defCompBalance, defCompMode, defCompRate, defCompFixedMonthly, showNetPay, taxFilingStatus, otherTaxableIncome, spouseTaxableIncome, numDependents, showPreFinalization, preFinalizationPct, showBuyback, buybackYears, buybackComp, statementText, officialAnnual, officialMonthly]);

  function resetAll() {
    setTier('tier2');
    setT2AppointDate('after2000');
    setT2RetType('service');
    setT2Years('20');
    setT2FAS('125000');
    setT2EarningsAfter20('0');
    setT2AppointAge('25');
    setT2LongevityEnhancement('0');
    setT2ShowNonUni(false);
    setT2NonUniYears('0');
    setT2NonUniAvg('0');
    setT2WaivedITHP(false);
    setT2Uses5050(false);
    setT2EnhancedMode('lumpsum');
    setT2EnhancedAnnual('0');
    setT2ASFBalance('0');
    setT2ASFRequired('0');
    setT2Factor('82');
    setT2ITHPAnnuity('0');
    setT2Best3Year1('0');
    setT2Best3Year2('0');
    setT2Best3Year3('0');
    setT2ShowWithdrawal(false);
    setT2WithdrawalMode('amount');
    setT2RequiredAmount('150000');
    setT2WithdrawalAmount('0');
    setT2TargetMonthly('7000');
    setT2Rollover(false);
    setT2PenaltyExempt(false);
    setT3Plan('revised');
    setT3RetType('normal');
    setT3Years('20');
    setT3Year1('125000');
    setT3Year2('125000');
    setT3Year3('125000');
    setT3SS62('0');
    setT3SSDI('0');
    setT3ADRHasSSDI(false);
    setT3ShowEarlyVest(false);
    setT3YearsEarly('0');
    setT3LongevityEnhancement('0');
    setT3ShowWithdrawal(false);
    setT3WithdrawalMode('amount');
    setT3LoanBucket('onafter2018');
    setT3RequiredAmount('60000');
    setT3OutstandingLoan('0');
    setT3WithdrawalAmount('0');
    setT3TargetMonthly('7000');
    setT3TargetBasis('before');
    setT3Factor('82');
    setT3Rollover(false);
    setT3PenaltyExempt(false);
    setShowDefComp(false);
    setShowNetPay(false);
    setTaxFilingStatus('single');
    setOtherTaxableIncome('0');
    setSpouseTaxableIncome('0');
    setNumDependents('0');
    setShowPreFinalization(false);
    setPreFinalizationPct('5');
    setShowBuyback(false);
    setBuybackYears('0');
    setBuybackComp('0');
    setDefCompBalance('0');
    setDefCompMode('rate');
    setDefCompRate('4');
    setDefCompFixedMonthly('0');
    setStatementText('');
    setOfficialAnnual('0');
    setOfficialMonthly('0');
    setExtracted(null);
    setFileError('');
    setFileName('');
    try { window.localStorage.removeItem(PERSIST_KEY); } catch (e) {}
    setConfirmingReset(false);
  }

  const [confirmingReset, setConfirmingReset] = useState(false);


  /* ---------------- Tier 2 computation ---------------- */
  const t2 = useMemo(() => {
    const years = num(t2Years);
    const fas = num(t2FAS);
    const earningsAfter20 = num(t2EarningsAfter20);
    const nuYears = t2ShowNonUni ? num(t2NonUniYears) : 0;
    const nuAvg = t2ShowNonUni ? num(t2NonUniAvg) : 0;
    const nonUniformBenefit = 0.75 * (1 / 60) * nuAvg * nuYears;

    const isService = t2RetType === 'service';
    const isVested = t2RetType === 'vested';
    const isODR = t2RetType === 'odr';
    const isADR = t2RetType === 'adr';
    const usesEarningsAfter20 = isService || isADR;
    const under20Warning = isService && years < 20;
    const unrealisticYears = years > 45;

    // Factored out so the exact same formula can be re-run under the pending S7808A
    // "best of 3 years" scenario below, without duplicating this branching logic.
    function baseFor(fasValue) {
      if (isService) return 0.5 * fasValue + (1 / 60) * earningsAfter20;
      if (isVested) return (1 / 40) * fasValue * years;
      if (isODR) {
        // Ordinary Disability Retirement — tiered by years of credited service.
        if (years < 10) return fasValue / 3;
        if (years < 20) return 0.5 * fasValue;
        return (years / 40) * fasValue;
      }
      if (isADR) {
        // Accident Disability Retirement — flat 75%, plus the same post-20th-anniversary
        // earnings credit Service Retirement gets.
        return 0.75 * fasValue + (1 / 60) * earningsAfter20;
      }
      return 0;
    }

    const base = baseFor(fas);
    // Prior non-uniformed service credit only applies to Service and Vested per the SPD.
    const coreAnnual = base + (isService || isVested ? nonUniformBenefit : 0);

    // ASF excess less shortage — a mandatory component of the SPD's Service Retirement
    // formula, not an optional add-on. Always counted. Computed automatically from the
    // two raw numbers printed on a real statement (Ending Balance and Required Amount),
    // rather than asking the person to subtract them by hand.
    let enhancedAnnual = 0;
    let asfDiff = 0;
    if (t2EnhancedMode === 'annual') {
      enhancedAnnual = num(t2EnhancedAnnual);
    } else {
      asfDiff = num(t2ASFBalance) - num(t2ASFRequired);
      const factor = num(t2Factor);
      enhancedAnnual = (asfDiff / 1000) * factor;
    }

    // Annuity value of City ITHP contributions after the 20th anniversary — listed
    // separately from ASF excess/shortage in the SPD.
    const ithpAnnual = num(t2ITHPAnnuity);

    const vsfEligible = isService && years >= 20;
    const vsfAnnual = vsfEligible ? 12000 : 0;
    const longevityAnnual = num(t2LongevityEnhancement);

    const pensionAnnual = Math.max(0, coreAnnual + enhancedAnnual + ithpAnnual + longevityAnnual);
    const totalAnnual = pensionAnnual + vsfAnnual;

    // --- Pending legislation preview: NY Senate Bill S7808A ("NYPD Tier 2A") ---
    // Passed the Senate 59-1 on 6/1/2026 and the Assembly on 6/4/2026 — sitting with
    // the Governor as of this writing, NOT yet signed into law. If signed, it would
    // give Tier 2 members appointed on/after 7/1/2000 the same "greater of final 12
    // months or best 3 consecutive years" FAS test that pre-2000 Tier 2 members
    // already have today. Only relevant to that post-2000 group. This is a planning
    // preview only — never substituted into the pensionAnnual/totalAnnual above.
    const showPendingLaw = t2AppointDate === 'after2000';
    const best3Year1 = num(t2Best3Year1);
    const best3Year2 = num(t2Best3Year2);
    const best3Year3 = num(t2Best3Year3);
    const best3YearAvg = (best3Year1 + best3Year2 + best3Year3) / 3;
    const pendingFAS = Math.max(fas, best3YearAvg);
    const pendingBase = baseFor(pendingFAS);
    const pendingCoreAnnual = pendingBase + (isService || isVested ? nonUniformBenefit : 0);
    const pendingPensionAnnual = Math.max(0, pendingCoreAnnual + enhancedAnnual + ithpAnnual + longevityAnnual);
    const pendingTotalAnnual = pendingPensionAnnual + vsfAnnual;
    const pendingMakesADifference = showPendingLaw && best3YearAvg > fas;

    return {
      years, fas, base, nonUniformBenefit, coreAnnual, enhancedAnnual, ithpAnnual, longevityAnnual,
      vsfEligible, vsfAnnual, pensionAnnual, totalAnnual, under20Warning, unrealisticYears,
      isService, isVested, isODR, isADR, usesEarningsAfter20,
      showPendingLaw, pendingFAS, pendingTotalAnnual, pendingMakesADifference, best3YearAvg, asfDiff,
    };
  }, [
    t2Years, t2FAS, t2EarningsAfter20, t2RetType, t2ShowNonUni, t2NonUniYears, t2NonUniAvg,
    t2EnhancedMode, t2EnhancedAnnual, t2ASFBalance, t2ASFRequired, t2Factor, t2ITHPAnnuity,
    t2LongevityEnhancement, t2AppointDate, t2Best3Year1, t2Best3Year2, t2Best3Year3,
  ]);

  const t2Rate = TIER2_RATE_TABLE.find((r) => r.age === Math.round(num(t2AppointAge))) || TIER2_RATE_TABLE[5];

  /* ---------------- Tier 3 computation ---------------- */
  const t3 = useMemo(() => {
    const years = num(t3Years);
    const fas = (num(t3Year1) + num(t3Year2) + num(t3Year3)) / 3;
    const ss62Annual = num(t3SS62) * 12 * 0.5;
    const ssdiAnnual = num(t3SSDI) * 12 * 0.5;

    let beforeOffset = 0;
    let vsfEligible = false;
    let offsetKind = 'none'; // 'age62' | 'immediate' | 'none'
    let underMinWarning = false;

    if (t3RetType === 'vested') {
      beforeOffset = 0.021 * fas * years;
      if (t3ShowEarlyVest) {
        const reduction = Math.min(1, (1 / 30) * num(t3YearsEarly));
        beforeOffset = beforeOffset * (1 - reduction);
      }
      offsetKind = 'age62';
    } else if (t3RetType === 'normal') {
      // Chapter 55 of the Laws of 2025 restored unreduced Service Retirement at 20
      // years for Tier 3 (previously 22) — confirmed current in PPF's June 2026 SPD.
      underMinWarning = years < 20;
      beforeOffset = 0.5 * fas;
      offsetKind = 'age62';
      vsfEligible = years >= 20;
    } else if (t3RetType === 'odr') {
      beforeOffset = Math.max(fas / 3, 0.02 * fas * years);
      offsetKind = 'immediate';
    } else if (t3RetType === 'adr') {
      if (t3Plan === 'enhanced') {
        beforeOffset = 0.75 * fas;
        offsetKind = 'none';
      } else {
        beforeOffset = 0.5 * fas;
        offsetKind = t3ADRHasSSDI ? 'immediate' : 'none';
      }
    }

    const longevityAnnual = num(t3LongevityEnhancement);
    beforeOffset += longevityAnnual;

    let afterOffsetAnnual = beforeOffset;
    if (offsetKind === 'age62') {
      afterOffsetAnnual = Math.max(0, beforeOffset - ss62Annual);
    } else if (offsetKind === 'immediate') {
      afterOffsetAnnual = Math.max(0, beforeOffset - ssdiAnnual);
      beforeOffset = afterOffsetAnnual;
    }

    const vsfAnnual = vsfEligible ? 12000 : 0;
    const hasAgeSplit = offsetKind === 'age62';

    return {
      years, fas, beforeOffset, afterOffsetAnnual, vsfEligible, vsfAnnual, longevityAnnual,
      offsetKind, hasAgeSplit, underMinWarning,
      totalBeforeAnnual: beforeOffset + vsfAnnual,
      totalAfterAnnual: afterOffsetAnnual + vsfAnnual,
    };
  }, [t3Years, t3Year1, t3Year2, t3Year3, t3SS62, t3SSDI, t3RetType, t3Plan, t3ADRHasSSDI, t3ShowEarlyVest, t3YearsEarly, t3LongevityEnhancement]);

  /* ---------------- Deferred comp (shared) ---------------- */
  const defCompAnnual = useMemo(() => {
    if (!showDefComp) return 0;
    if (defCompMode === 'rate') return num(defCompBalance) * (num(defCompRate) / 100);
    return num(defCompFixedMonthly) * 12;
  }, [showDefComp, defCompBalance, defCompMode, defCompRate, defCompFixedMonthly]);

  /* ---------------- Tier 2 final withdrawal ---------------- */
  const t2Withdrawal = useMemo(() => {
    if (!t2ShowWithdrawal) return null;
    const required = num(t2RequiredAmount);
    const max = Math.max(0, 0.9 * required);
    const requested = Math.max(0, num(t2WithdrawalAmount));
    const overMax = requested > max && max > 0;
    const grossLumpSum = Math.min(requested, max);
    const factor = num(t2Factor);
    const reductionAnnual = (grossLumpSum / 1000) * factor;
    const pensionAfterAnnual = Math.max(0, t2.totalAnnual - reductionAnnual);
    const withholding = t2Rollover ? 0 : grossLumpSum * 0.2;
    const penalty = (t2Rollover || t2PenaltyExempt) ? 0 : grossLumpSum * 0.1;
    const netLumpSum = grossLumpSum - withholding - penalty;
    return { required, max, grossLumpSum, overMax, reductionAnnual, pensionAfterAnnual, withholding, penalty, netLumpSum };
  }, [t2ShowWithdrawal, t2RequiredAmount, t2WithdrawalAmount, t2Factor, t2Rollover, t2PenaltyExempt, t2.totalAnnual]);

  /* ---------------- Tier 3 final withdrawal ---------------- */
  const t3Withdrawal = useMemo(() => {
    if (!t3ShowWithdrawal) return null;
    const required = num(t3RequiredAmount);
    const outstandingLoan = num(t3OutstandingLoan);
    const rawMax = t3LoanBucket === 'onafter2018' ? Math.min(50000, 0.5 * required) : 0.75 * required;
    const max = Math.max(0, rawMax - outstandingLoan);
    const requested = Math.max(0, num(t3WithdrawalAmount));
    const overMax = requested > max && max > 0;
    const grossLumpSum = Math.min(requested, max);
    const factor = num(t3Factor);
    const reductionAnnual = (grossLumpSum / 1000) * factor;
    const pensionAfterBeforeAnnual = Math.max(0, t3.totalBeforeAnnual - reductionAnnual);
    const pensionAfterAfterAnnual = Math.max(0, t3.totalAfterAnnual - reductionAnnual);
    const withholding = t3Rollover ? 0 : grossLumpSum * 0.2;
    const penalty = (t3Rollover || t3PenaltyExempt) ? 0 : grossLumpSum * 0.1;
    const netLumpSum = grossLumpSum - withholding - penalty;
    return { required, max, grossLumpSum, overMax, reductionAnnual, pensionAfterBeforeAnnual, pensionAfterAfterAnnual, withholding, penalty, netLumpSum };
  }, [t3ShowWithdrawal, t3RequiredAmount, t3OutstandingLoan, t3LoanBucket, t3WithdrawalAmount, t3Factor, t3Rollover, t3PenaltyExempt, t3.totalBeforeAnnual, t3.totalAfterAnnual]);

  /* ---------------- Reverse solve: target pension → required withdrawal ---------------- */
  useEffect(() => {
    if (!t2ShowWithdrawal || t2WithdrawalMode !== 'target') return;
    const max = Math.max(0, 0.9 * num(t2RequiredAmount));
    const factor = num(t2Factor);
    const targetAnnual = num(t2TargetMonthly) * 12;
    const requiredReduction = t2.totalAnnual - targetAnnual;
    let needed = 0;
    if (requiredReduction > 0 && factor > 0) needed = (requiredReduction / factor) * 1000;
    needed = Math.min(Math.max(0, needed), max);
    setT2WithdrawalAmount(String(Math.round(needed)));
  }, [t2ShowWithdrawal, t2WithdrawalMode, t2TargetMonthly, t2RequiredAmount, t2Factor, t2.totalAnnual]);

  useEffect(() => {
    if (!t3ShowWithdrawal || t3WithdrawalMode !== 'target') return;
    const required = num(t3RequiredAmount);
    const outstandingLoan = num(t3OutstandingLoan);
    const rawMax = t3LoanBucket === 'onafter2018' ? Math.min(50000, 0.5 * required) : 0.75 * required;
    const max = Math.max(0, rawMax - outstandingLoan);
    const baseAnnual = t3.hasAgeSplit ? (t3TargetBasis === 'before' ? t3.totalBeforeAnnual : t3.totalAfterAnnual) : t3.totalAfterAnnual;
    const factor = num(t3Factor);
    const targetAnnual = num(t3TargetMonthly) * 12;
    const requiredReduction = baseAnnual - targetAnnual;
    let needed = 0;
    if (requiredReduction > 0 && factor > 0) needed = (requiredReduction / factor) * 1000;
    needed = Math.min(Math.max(0, needed), max);
    setT3WithdrawalAmount(String(Math.round(needed)));
  }, [
    t3ShowWithdrawal, t3WithdrawalMode, t3TargetMonthly, t3TargetBasis, t3RequiredAmount,
    t3OutstandingLoan, t3LoanBucket, t3Factor, t3.hasAgeSplit, t3.totalBeforeAnnual, t3.totalAfterAnnual,
  ]);

  /* ---------------- Grand totals for display ---------------- */
  const t2PensionAfterAnnual = t2Withdrawal ? t2Withdrawal.pensionAfterAnnual : t2.totalAnnual;
  const t3PensionAfterBeforeAnnual = t3Withdrawal ? t3Withdrawal.pensionAfterBeforeAnnual : t3.totalBeforeAnnual;
  const t3PensionAfterAfterAnnual = t3Withdrawal ? t3Withdrawal.pensionAfterAfterAnnual : t3.totalAfterAnnual;

  const grand = tier === 'tier2'
    ? { annual: t2PensionAfterAnnual + defCompAnnual, split: false }
    : {
        beforeAnnual: t3PensionAfterBeforeAnnual + defCompAnnual,
        afterAnnual: t3PensionAfterAfterAnnual + defCompAnnual,
        split: t3.hasAgeSplit,
      };

  /* ---------------- Target-mode feasibility feedback ---------------- */
  const t2TargetAnnual = num(t2TargetMonthly) * 12;
  const t2TargetNoWithdrawalNeeded = t2WithdrawalMode === 'target' && t2.totalAnnual <= t2TargetAnnual;
  const t2TargetCapped =
    t2WithdrawalMode === 'target' && !t2TargetNoWithdrawalNeeded && t2Withdrawal && t2Withdrawal.pensionAfterAnnual > t2TargetAnnual + 25;

  const t3TargetBaseAnnual = t3.hasAgeSplit ? (t3TargetBasis === 'before' ? t3.totalBeforeAnnual : t3.totalAfterAnnual) : t3.totalAfterAnnual;
  const t3TargetAnnual = num(t3TargetMonthly) * 12;
  const t3TargetNoWithdrawalNeeded = t3WithdrawalMode === 'target' && t3TargetBaseAnnual <= t3TargetAnnual;
  const t3TargetResultAnnual = t3.hasAgeSplit
    ? (t3TargetBasis === 'before' ? t3PensionAfterBeforeAnnual : t3PensionAfterAfterAnnual)
    : t3PensionAfterAfterAnnual;
  const t3TargetCapped =
    t3WithdrawalMode === 'target' && !t3TargetNoWithdrawalNeeded && t3Withdrawal && t3TargetResultAnnual > t3TargetAnnual + 25;

  /* ---------------- Accuracy check handlers ---------------- */
  async function ocrImage(file) {
    setOcrLoading(true);
    setOcrProgress(0);
    setFileError('');
    try {
      const Tesseract = await import('tesseract.js');
      const { data } = await Tesseract.recognize(file, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            setOcrProgress(Math.round(m.progress * 100));
          }
        },
      });
      const text = data && data.text ? data.text : '';
      setStatementText(text);
      if (!text.trim()) {
        setFileError('Could not find any readable text in that image — try a clearer, well-lit photo, or paste the text manually below instead.');
      }
    } catch (err) {
      setFileError('Could not process that image. Try a clearer photo, or paste the text manually below instead.');
    } finally {
      setOcrLoading(false);
    }
  }

  function handleFileUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setFileError('');
    setFileName(file.name);
    const isTxt = file.type === 'text/plain' || /\.txt$/i.test(file.name);
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|gif|webp|bmp)$/i.test(file.name);
    if (isImage) {
      ocrImage(file);
      return;
    }
    if (!isTxt) {
      setFileError(
        "Browsers can't decode a PDF's compressed text on their own here — open your statement, select all the text, copy it, and paste it into the box below, or upload a photo/screenshot of it instead."
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => setStatementText(String(evt.target.result || ''));
    reader.onerror = () => setFileError('Could not read that file — try pasting the text instead.');
    reader.readAsText(file);
  }

  function handleScan() {
    if (!statementText.trim()) return;
    setAppliedCount(0);
    setExtracted(extractFigures(statementText));
  }

  function applyAllExtracted() {
    if (!extracted) return;
    const keys = ['fas', 'years', 'required', 'annual', 'monthly', 'longevity'];
    let count = 0;
    keys.forEach((k) => {
      if (extracted[k]) {
        applyExtracted(k);
        count += 1;
      }
    });
    setAppliedCount(count);
  }

  function applyExtracted(key) {
    if (!extracted || !extracted[key]) return;
    const val = extracted[key].value;
    if (key === 'fas') { if (tier === 'tier2') setT2FAS(val); else { setT3Year1(val); setT3Year2(val); setT3Year3(val); } }
    if (key === 'years') tier === 'tier2' ? setT2Years(val) : setT3Years(val);
    if (key === 'required') tier === 'tier2' ? setT2RequiredAmount(val) : setT3RequiredAmount(val);
    if (key === 'annual') setOfficialAnnual(val);
    if (key === 'monthly') setOfficialMonthly(val);
    if (key === 'longevity') tier === 'tier2' ? setT2LongevityEnhancement(val) : setT3LongevityEnhancement(val);
  }

  const accuracy = useMemo(() => {
    const officialA = num(officialAnnual);
    const officialM = num(officialMonthly);
    const resolvedOfficialAnnual = officialA > 0 ? officialA : officialM * 12;
    if (resolvedOfficialAnnual <= 0) return null;

    if (tier === 'tier2') {
      const calc = t2.totalAnnual;
      const diff = resolvedOfficialAnnual - calc;
      const pct = calc > 0 ? (diff / calc) * 100 : 0;
      return { hasSplit: false, officialAnnual: resolvedOfficialAnnual, calc, diff, accuracyPct: Math.max(0, 100 - Math.abs(pct)) };
    }
    const calcBefore = t3.totalBeforeAnnual;
    const calcAfter = t3.totalAfterAnnual;
    const diffBefore = resolvedOfficialAnnual - calcBefore;
    const diffAfter = resolvedOfficialAnnual - calcAfter;
    const pctBefore = calcBefore > 0 ? (diffBefore / calcBefore) * 100 : 0;
    const pctAfter = calcAfter > 0 ? (diffAfter / calcAfter) * 100 : 0;
    return {
      hasSplit: t3.hasAgeSplit,
      officialAnnual: resolvedOfficialAnnual,
      calcBefore, diffBefore, accuracyPctBefore: Math.max(0, 100 - Math.abs(pctBefore)),
      calcAfter, diffAfter, accuracyPctAfter: Math.max(0, 100 - Math.abs(pctAfter)),
    };
  }, [officialAnnual, officialMonthly, tier, t2.totalAnnual, t3.totalBeforeAnnual, t3.totalAfterAnnual, t3.hasAgeSplit]);

  const retTypeLabelsT3 = {
    vested: 'Vested Retirement',
    normal: 'Service Retirement',
    odr: 'Ordinary Disability Retirement',
    adr: 'Accident Disability Retirement',
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans overflow-x-hidden">
      {/* Letterhead */}
      <header className="bg-slate-900 border-b border-amber-700/40">
        <div className="max-w-4xl mx-auto px-5 py-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Shield className="text-amber-500 shrink-0" size={30} strokeWidth={1.5} />
              <div className="min-w-0">
                <h1 className="font-serif text-2xl sm:text-3xl text-slate-50 tracking-tight">Pension Ledger</h1>
                <p className="text-xs sm:text-sm text-slate-400 tracking-wide">NY Police Tier 2 &amp; Tier 3 Estimator</p>
              </div>
            </div>
            {!confirmingReset ? (
              <button
                type="button"
                onClick={() => setConfirmingReset(true)}
                className="shrink-0 text-xs text-slate-200 border border-slate-500 hover:border-amber-500 hover:text-amber-400 rounded-sm px-3 py-2"
              >
                Reset all
              </button>
            ) : (
              <div className="shrink-0 flex items-center gap-2">
                <span className="text-xs text-amber-400 hidden sm:inline">Clear everything?</span>
                <button
                  type="button"
                  onClick={resetAll}
                  className="text-xs text-slate-950 bg-amber-500 font-medium rounded-sm px-3 py-2"
                >
                  Yes, reset
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingReset(false)}
                  className="text-xs text-slate-300 border border-slate-600 rounded-sm px-3 py-2"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="h-[3px] bg-gradient-to-r from-amber-700 via-amber-500 to-amber-700" />
      </header>

      <div className="max-w-4xl mx-auto px-5 py-6">
        {/* Disclaimer */}
        <div className="flex gap-3 bg-amber-950/30 border border-amber-800/50 rounded-sm px-4 py-3 mb-6">
          <TriangleAlert className="text-amber-500 shrink-0 mt-0.5" size={18} />
          <p className="text-xs text-amber-200/90 leading-relaxed">
            This is an independent, unofficial estimator built from the Police Pension Fund's June 2026 Summary Plan
            Descriptions, which reflect Chapter 55 of the Laws of 2025 restoring 20-year Service Retirement for
            Tier 3. It is not affiliated with the City of New York or NYCPPF, cannot replicate the Office of the
            Actuary's exact factors for excess, shortage, and ITHP annuity conversions, and does not model the
            rank-based Pension Longevity Enhancements available at 25/30/35 years (these can raise your real
            benefit above what's shown here). Treat every figure here as a planning estimate — regardless of what
            this app shows, always confirm with an official benefit estimate from PPF's pension section
            (212-693-5100 / webCOPS) before making retirement decisions.
            <br />
            <br />
            This app does not provide financial, legal, or tax advice, and using it creates no advisory
            relationship. See{' '}
            <a href="https://example.com/terms" className="underline">Terms of Use</a> and{' '}
            <a href="https://example.com/privacy" className="underline">Privacy Policy</a>.
          </p>
        </div>

        {/* Tier toggle */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {[
            { v: 'tier2', label: 'Tier 2', sub: 'Appointed 7/1/1973 – 6/30/2009' },
            { v: 'tier3', label: 'Tier 3', sub: 'Appointed on or after 7/1/2009' },
          ].map((t) => (
            <button
              key={t.v}
              onClick={() => setTier(t.v)}
              className={`text-left px-4 py-3 rounded-sm border transition-colors ${
                tier === t.v ? 'bg-slate-900 border-amber-500' : 'bg-slate-900/40 border-slate-800 hover:border-slate-600'
              }`}
            >
              <div className={`font-serif text-lg ${tier === t.v ? 'text-amber-400' : 'text-slate-300'}`}>{t.label}</div>
              <div className="text-xs text-slate-400 mt-0.5">{t.sub}</div>
            </button>
          ))}
        </div>

        {/* ============ TIER 2 FORM ============ */}
        {tier === 'tier2' && (
          <>
            <Section title="Service &amp; Salary" badge="01">
              <div className="grid sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <span className="block text-[13px] font-medium text-slate-300 mb-1">Appointment date</span>
                  <SegGroup
                    value={t2AppointDate}
                    onChange={setT2AppointDate}
                    options={[
                      { value: 'before2000', label: 'Before 7/1/2000' },
                      { value: 'after2000', label: 'On/after 7/1/2000' },
                    ]}
                  />
                  <p className="text-xs text-slate-400 mt-1 leading-snug">
                    {t2AppointDate === 'before2000'
                      ? 'Your FAS is the greatest of: final 12 months, average of final 36 months, or average of your best 3 consecutive calendar years.'
                      : 'Your FAS is your pensionable earnings in the final 12 months before retirement — see the pending-legislation preview below.'}
                  </p>
                </div>
                <div>
                  <span className="block text-[13px] font-medium text-slate-300 mb-1">Retirement type</span>
                  <SegGroup
                    value={t2RetType}
                    onChange={setT2RetType}
                    options={[
                      { value: 'service', label: 'Service (20+ yrs)' },
                      { value: 'vested', label: 'Vested (5–19 yrs)' },
                      { value: 'odr', label: 'Ordinary Disability' },
                      { value: 'adr', label: 'Accident Disability' },
                    ]}
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <NumField
                  label="Years of allowable (uniformed) police service"
                  prefix=""
                  value={t2Years}
                  onChange={setT2Years}
                  hint={
                    t2.isODR || t2.isADR
                      ? 'ODR and ADR are available at any age or years of service — this just affects the ODR formula tier.'
                      : 'Twenty years of allowable police service are required for Service Retirement.'
                  }
                />
                <NumField
                  label="Final Average Salary (FAS)"
                  value={t2FAS}
                  onChange={setT2FAS}
                  hint={
                    t2.showPendingLaw
                      ? "Base salary, overtime, night differential, holiday pay, worked vacation, and allowable longevity. Only checking the pending-law preview below? This can stay at 0 — it won't stop that box from working."
                      : "Base salary, overtime, night differential, holiday pay, worked vacation, and allowable longevity."
                  }
                />
                {t2.usesEarningsAfter20 && t2.years > 20 && (
                  <NumField
                    label="Pensionable earnings after your 20th anniversary"
                    value={t2EarningsAfter20}
                    onChange={setT2EarningsAfter20}
                    hint="Total earnings from your 20th anniversary through your retirement date — credited at 1/60th."
                  />
                )}
              </div>

              {t2.showPendingLaw && (
                <div className="border-t border-slate-800 pt-3 mt-3">
                  <p className="text-xs text-sky-400 bg-sky-950/20 border border-sky-800/50 rounded-sm px-3 py-2 mb-3 leading-relaxed">
                    Optional — only matters if NY Senate Bill S7808A is signed (see the pending-legislation preview
                    in your results below). Enter your 3 highest consecutive years of pensionable earnings; leave
                    at $0 to skip. <strong className="text-sky-300">This doesn't replace FAS above</strong> — they're
                    independent: FAS drives your real current-law pension, these three fields only drive the
                    separate "if signed" preview. Fill in either one, both, or neither.
                  </p>
                  <span className="block text-[13px] font-medium text-slate-300 mb-2">
                    Your best 3 consecutive years of pensionable earnings
                  </span>
                  <div className="grid sm:grid-cols-3 gap-4">
                    <NumField label="Year 1" value={t2Best3Year1} onChange={setT2Best3Year1} />
                    <NumField label="Year 2" value={t2Best3Year2} onChange={setT2Best3Year2} />
                    <NumField label="Year 3" value={t2Best3Year3} onChange={setT2Best3Year3} />
                  </div>
                  {t2.best3YearAvg > 0 && (
                    <p className="text-xs text-slate-400 mt-2">
                      Average: <span className="font-mono text-slate-200">{fmt(t2.best3YearAvg)}</span>/yr
                    </p>
                  )}
                </div>
              )}

              {t2.isODR && (
                <p className="text-xs text-slate-400 mt-3 leading-snug">
                  ODR pays the greater of 33⅓% of FAS (under 10 years), 50% of FAS (10–19 years), or years÷40 × FAS
                  (20+ years) — requires approval for primary Social Security Disability Insurance (SSDI), with
                  active receipt of SSDI required annually until age 65.
                </p>
              )}
              {t2.isADR && (
                <p className="text-xs text-slate-400 mt-3 leading-snug">
                  ADR pays a flat 75% of FAS regardless of years of service, plus the same post-20th-anniversary
                  earnings credit as Service Retirement — not conditioned on Social Security eligibility.
                </p>
              )}

              {t2.isService && t2.years > 20 && num(t2EarningsAfter20) === 0 && (
                <p className="text-xs text-amber-400 mt-3 flex items-start gap-1.5 bg-amber-950/30 border border-amber-800/50 rounded-sm px-3 py-2">
                  <TriangleAlert size={14} className="shrink-0 mt-0.5" />
                  Heads up: past 20 years, this formula only grows through the "Pensionable earnings after your 20th
                  anniversary" field above — the years number by itself won't move your total. Fill that field in to
                  see it reflected.
                </p>
              )}

              {t2.under20Warning && (
                <p className="text-xs text-amber-400 mt-3 flex items-center gap-1.5">
                  <TriangleAlert size={14} /> Service Retirement needs 20+ years — with fewer years this reflects a Vested-style calculation instead.
                </p>
              )}

              {t2.unrealisticYears && (
                <p className="text-xs text-amber-400 mt-3 flex items-center gap-1.5">
                  <TriangleAlert size={14} /> {t2Years} years of service is unusually high for a NY Police career — double-check this wasn't a typo.
                </p>
              )}

              <div className="mt-4 pt-3 border-t border-slate-800">
                <NumField
                  label="Pension Longevity Enhancement (optional)"
                  value={t2LongevityEnhancement}
                  onChange={setT2LongevityEnhancement}
                  suffix="/yr"
                  hint="Rank-based boost at 25/30/35 years — depends on your rank and time in rank, so this calculator can't compute it. If you know your figure from a PPF statement or your union rep, enter it here; otherwise leave at 0."
                />
              </div>

              {(t2.isService || t2.isVested) && (
                <>
                  <button
                    type="button"
                    onClick={() => setT2ShowNonUni(!t2ShowNonUni)}
                    className="text-xs text-amber-500 mt-4 underline decoration-dotted"
                  >
                    {t2ShowNonUni ? 'Hide' : 'Add'} prior non-uniformed (Other Credited) service
                  </button>
                  {t2ShowNonUni && (
                    <div className="grid sm:grid-cols-2 gap-4 mt-3 border-t border-slate-800 pt-3">
                      <NumField label="Years of non-uniformed credited service" prefix="" value={t2NonUniYears} onChange={setT2NonUniYears} />
                      <NumField label="Average earnings, last 5 years of that service" value={t2NonUniAvg} onChange={setT2NonUniAvg} />
                    </div>
                  )}
                </>
              )}
            </Section>

            <Section title="ITHP, 50/50 &amp; Excess Contributions" badge="02" defaultOpen={false}>
              <p className="text-sm text-slate-400 leading-relaxed mb-3">
                These are voluntary elections that build up your Additional/Annuity Savings Fund (ASF) account beyond
                its required amount. At retirement, PPF's Actuary converts any excess — including your ITHP reserve
                after your 20th anniversary — into a lifetime annuity added to your pension. A shortage does the
                opposite: it reduces your pension for life.
              </p>
              <div className="grid sm:grid-cols-2 gap-4 text-xs text-slate-400 mb-4">
                <div className="border border-slate-800 rounded-sm p-3">
                  <div className="text-slate-200 font-medium mb-1">Waive ITHP</div>
                  The City normally covers 5% of your contribution rate as "increased take-home pay." Waiving it means
                  you contribute your full required rate yourself — pre-tax, and it earns 8.25% guaranteed interest.
                </div>
                <div className="border border-slate-800 rounded-sm p-3">
                  <div className="text-slate-200 font-medium mb-1">50% Additional</div>
                  You may also contribute an extra 50% of your required rate. It's after-tax money, but the interest
                  it earns is tax-deferred, and it can be withdrawn tax-free at retirement.
                </div>
              </div>

              <div className="flex flex-wrap gap-4 mb-4">
                <label className="flex items-center gap-2 text-sm text-slate-300 py-1.5">
                  <input type="checkbox" checked={t2WaivedITHP} onChange={(e) => setT2WaivedITHP(e.target.checked)} className="accent-amber-500" />
                  I waived ITHP
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300 py-1.5">
                  <input type="checkbox" checked={t2Uses5050} onChange={(e) => setT2Uses5050(e.target.checked)} className="accent-amber-500" />
                  I contribute 50% Additional
                </label>
              </div>

              <div className="border-t border-slate-800 pt-3">
                <p className="text-xs text-amber-400 bg-amber-950/30 border border-amber-800/50 rounded-sm px-3 py-2 mb-3 leading-relaxed">
                  These are part of the official Service Retirement formula, not optional extras — but this
                  calculator has no way to know your personal contribution history, so it can't calculate this for
                  you automatically. Leaving them at $0 understates your pension. Enter your figures below from your
                  PPF benefit estimate or webCOPS statement to include them.
                </p>

                <span className="block text-[13px] font-medium text-slate-300 mb-2">ASF excess less shortage</span>
                <SegGroup
                  value={t2EnhancedMode}
                  onChange={setT2EnhancedMode}
                  options={[
                    { value: 'lumpsum', label: 'Estimate from ASF balance' },
                    { value: 'annual', label: 'I know my annual annuity figure' },
                  ]}
                />

                {t2EnhancedMode === 'lumpsum' && (
                  <>
                    <div className="grid sm:grid-cols-3 gap-4 mt-3">
                      <NumField
                        label="Your ASF account balance"
                        value={t2ASFBalance}
                        onChange={setT2ASFBalance}
                        hint={'Your statement\'s "Ending Balance."'}
                      />
                      <NumField
                        label="Required amount"
                        value={t2ASFRequired}
                        onChange={setT2ASFRequired}
                        hint={'Your statement\'s "Required Amount" line — a different, smaller figure than your balance.'}
                      />
                      <NumField
                        label="Actuarial factor ($ per $1,000)"
                        prefix=""
                        value={t2Factor}
                        onChange={setT2Factor}
                        hint={'Look for "Cost Per Thousand" on your PPF statement — that\'s this exact figure. PPF\'s published example is $81.78/yr per $1,000 for a 45-year-old retiree, but yours will differ; one real member statement showed $89.11.'}
                      />
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                      {t2.asfDiff >= 0 ? (
                        <>Excess: <span className="font-mono text-slate-200">{fmt(t2.asfDiff)}</span> — this calculator did the subtraction for you (balance minus required amount).</>
                      ) : (
                        <>Shortage: <span className="font-mono text-slate-200">{fmt(Math.abs(t2.asfDiff))}</span> — your balance is below the required amount, which reduces your pension.</>
                      )}
                    </p>
                  </>
                )}
                {t2EnhancedMode === 'annual' && (
                  <div className="mt-3 max-w-xs">
                    <NumField label="Annual annuity value of ASF excess less shortage" value={t2EnhancedAnnual} onChange={setT2EnhancedAnnual} hint="From your PPF benefit estimate letter or webCOPS statement." />
                  </div>
                )}

                <div className="mt-4 pt-3 border-t border-slate-800 max-w-md">
                  <NumField
                    label="Annuity value of City ITHP contributions after your 20th anniversary"
                    value={t2ITHPAnnuity}
                    onChange={setT2ITHPAnnuity}
                    suffix="/yr"
                    hint="A separate line in the official formula from ASF excess/shortage above. Ask PPF for this figure — it isn't something this calculator can derive."
                  />
                </div>
              </div>

              <details className="mt-4">
                <summary className="text-xs text-slate-400 cursor-pointer select-none">Contribution rate by age at appointment (reference)</summary>
                <div className="mt-2 max-h-40 overflow-y-auto border border-slate-800 rounded-sm">
                  <table className="w-full text-xs font-mono">
                    <thead className="text-slate-400 sticky top-0 bg-slate-900">
                      <tr><th className="text-left px-2 py-1">Age</th><th className="text-right px-2 py-1">Required</th><th className="text-right px-2 py-1">Member</th></tr>
                    </thead>
                    <tbody>
                      {TIER2_RATE_TABLE.map((r) => (
                        <tr key={r.age} className="odd:bg-slate-900/50">
                          <td className="px-2 py-1">{r.age}</td>
                          <td className="px-2 py-1 text-right">{r.required.toFixed(2)}%</td>
                          <td className="px-2 py-1 text-right">{r.member.toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </Section>

            {purchasesLoading ? (
              <LoadingSection title="Final Withdrawal at Retirement" badge="03" />
            ) : isPremium ? (
            <Section title="Final Withdrawal at Retirement" badge="03" defaultOpen={false}>
              <p className="text-sm text-slate-400 leading-relaxed mb-3">
                At retirement you may take a lump sum "final withdrawal" (final loan) of up to 90% of your ASF
                account's required amount, plus any excess you elect not to leave in. PPF treats it the same way as
                a shortage — it converts the amount into a permanent, lifetime reduction of your pension.
              </p>
              <label className="flex items-center gap-2 text-sm text-slate-300 py-1.5 mb-4">
                <input type="checkbox" checked={t2ShowWithdrawal} onChange={(e) => setT2ShowWithdrawal(e.target.checked)} className="accent-amber-500" />
                I want to take a final withdrawal
              </label>

              {t2ShowWithdrawal && (
                <>
                  <div className="grid sm:grid-cols-2 gap-4 mb-4">
                    <NumField
                      label="Your ASF account balance"
                      value={t2RequiredAmount}
                      onChange={setT2RequiredAmount}
                      hint={'Use your statement\'s "Ending Balance" — NOT the smaller "Required Amount" line. Those are two different figures; using "Required Amount" here would show a maximum withdrawal far smaller than what\'s actually available to you.'}
                    />
                    <div>
                      <span className="block text-[13px] font-medium text-slate-300 mb-1">Maximum you can withdraw</span>
                      <div className="font-mono text-amber-400 text-lg">{fmt(t2Withdrawal ? t2Withdrawal.max : 0)}</div>
                      <span className="text-xs text-slate-400">90% of your account balance</span>
                    </div>
                  </div>

                  <span className="block text-[13px] font-medium text-slate-300 mb-2">How do you want to plan this?</span>
                  <SegGroup
                    value={t2WithdrawalMode}
                    onChange={setT2WithdrawalMode}
                    options={[
                      { value: 'amount', label: "I'll pick the amount" },
                      { value: 'target', label: 'I have a target take-home pension' },
                    ]}
                  />

                  {t2WithdrawalMode === 'amount' ? (
                    <div className="mt-4">
                      <SliderField
                        label="Amount you want to withdraw"
                        value={t2WithdrawalAmount}
                        max={t2Withdrawal ? t2Withdrawal.max : 0}
                        onChange={setT2WithdrawalAmount}
                      />
                      {t2Withdrawal && t2Withdrawal.overMax && (
                        <p className="text-xs text-amber-400 mt-2 flex items-center gap-1.5">
                          <TriangleAlert size={14} /> Capped at your maximum of {fmt(t2Withdrawal.max)}.
                        </p>
                      )}
                      {num(t2WithdrawalAmount) === 0 && (
                        <p className="text-xs text-amber-400 mt-2 flex items-start gap-1.5 bg-amber-950/30 border border-amber-800/50 rounded-sm px-3 py-2">
                          <TriangleAlert size={14} className="shrink-0 mt-0.5" />
                          Still set to $0 — nothing below will change until you drag the slider or type an amount
                          here. A $0 withdrawal has no effect, by design.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4">
                      <div className="mb-3 flex items-baseline justify-between bg-slate-950/60 border border-slate-800 rounded-sm px-3 py-2">
                        <span className="text-xs text-slate-400">Your pension right now, with VSF, before any withdrawal</span>
                        <span className="font-mono text-sm text-slate-200">{fmt(t2.totalAnnual / 12)}/mo</span>
                      </div>
                      <NumField
                        label="Target pension after withdrawal"
                        value={t2TargetMonthly}
                        onChange={setT2TargetMonthly}
                        suffix="/mo"
                        hint="This calculator works backward from this figure to the withdrawal that would produce it."
                      />
                      <div className="mt-3 bg-slate-950 border border-slate-700 rounded-sm px-4 py-3">
                        <div className="flex items-baseline justify-between">
                          <span className="text-sm text-slate-300">Withdrawal needed</span>
                          <span className="font-mono text-lg font-bold text-amber-400">{fmt(t2Withdrawal ? t2Withdrawal.grossLumpSum : 0)}</span>
                        </div>
                        {t2TargetNoWithdrawalNeeded && (
                          <p className="text-xs text-amber-400 mt-2 flex items-start gap-1.5">
                            <TriangleAlert size={14} className="shrink-0 mt-0.5" />
                            You don't need to withdraw anything — your pension is already {fmt(t2.totalAnnual / 12)}/mo without one, at or above your target.
                          </p>
                        )}
                        {t2TargetCapped && (
                          <p className="text-xs text-amber-400 mt-2 flex items-start gap-1.5">
                            <TriangleAlert size={14} className="shrink-0 mt-0.5" />
                            Even your full {fmt(t2Withdrawal ? t2Withdrawal.max : 0)} maximum only brings you down to{' '}
                            {fmt(t2Withdrawal ? t2Withdrawal.pensionAfterAnnual / 12 : 0)}/mo — this target isn't reachable through a
                            withdrawal alone.
                          </p>
                        )}
                        {!t2TargetNoWithdrawalNeeded && !t2TargetCapped && t2Withdrawal && t2Withdrawal.grossLumpSum > 0 && (
                          <p className="text-xs text-slate-400 mt-2">
                            Withdrawing this amount brings your pension to {fmt(t2Withdrawal.pensionAfterAnnual / 12)}/mo.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 max-w-xs">
                    <NumField
                      label="Actuarial factor ($ per $1,000)"
                      prefix=""
                      value={t2Factor}
                      onChange={setT2Factor}
                      hint={'Shared with the excess/shortage factor above — look for "Cost Per Thousand" on your PPF statement for your real figure.'}
                    />
                  </div>

                  <div className="flex flex-wrap gap-4 mt-4">
                    <label className="flex items-center gap-2 text-sm text-slate-300 py-1.5">
                      <input type="checkbox" checked={t2Rollover} onChange={(e) => setT2Rollover(e.target.checked)} className="accent-amber-500" />
                      Direct rollover to an IRA
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-300 py-1.5">
                      <input type="checkbox" checked={t2PenaltyExempt} onChange={(e) => setT2PenaltyExempt(e.target.checked)} className="accent-amber-500" />
                      I'm 50+ or have 25+ years of service
                    </label>
                  </div>
                  <p className="text-xs text-slate-400 mt-2 leading-snug">
                    Cash withdrawals are subject to 20% federal withholding, plus a 10% early-withdrawal penalty
                    unless you're over 50 or have 25+ years of uniformed service. A direct IRA rollover avoids both,
                    though the funds stay taxable whenever you eventually withdraw them from the IRA.
                  </p>
                </>
              )}
            </Section>
            ) : (
              <LockedSection
                title="Final Withdrawal at Retirement"
                badge="03"
                teaser="Model taking a lump sum at retirement — including working backward from a target take-home pension — and see exactly how much it reduces your monthly benefit."
                onUnlock={() => setShowPaywall(true)}
              />
            )}
          </>
        )}

        {/* ============ TIER 3 FORM ============ */}
        {tier === 'tier3' && (
          <>
          <Section title="Service &amp; Salary" badge="01">
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <div>
                <span className="block text-[13px] font-medium text-slate-300 mb-1">Plan</span>
                <SegGroup
                  value={t3Plan}
                  onChange={setT3Plan}
                  options={[
                    { value: 'original', label: 'Original' },
                    { value: 'revised', label: 'Revised' },
                    { value: 'enhanced', label: 'Enhanced' },
                  ]}
                />
                <p className="text-xs text-slate-400 mt-1 leading-snug">
                  Original: appointed 7/1/09–3/31/12 · Revised: 4/1/12–3/31/17 · Enhanced: on/after 4/1/17 (or opted in).
                </p>
              </div>
              <div>
                <span className="block text-[13px] font-medium text-slate-300 mb-1">Retirement type</span>
                <SegGroup
                  value={t3RetType}
                  onChange={setT3RetType}
                  options={[
                    { value: 'vested', label: 'Vested' },
                    { value: 'normal', label: 'Service Retirement' },
                    { value: 'odr', label: 'Ordinary Disability' },
                    { value: 'adr', label: 'Accident Disability' },
                  ]}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <NumField
                label="Years of credited service"
                prefix=""
                value={t3Years}
                onChange={setT3Years}
                hint="Service Retirement needs 20+ years, unreduced, under Chapter 55 of the Laws of 2025."
              />
              {(t3RetType === 'vested' || t3RetType === 'normal') && (
                <NumField
                  label="Estimated Social Security benefit at 62 (monthly)"
                  value={t3SS62}
                  onChange={setT3SS62}
                  hint="Tier 3 pensions are reduced by 50% of your primary Social Security benefit starting at age 62, whether or not you've filed. Check ssa.gov/myaccount for an estimate."
                />
              )}
              {t3RetType === 'odr' && (
                <NumField label="Monthly SSDI benefit" value={t3SSDI} onChange={setT3SSDI} hint="ODR requires approval for primary Social Security Disability Insurance; the pension is reduced by 50% of it." />
              )}
              {t3RetType === 'adr' && t3Plan !== 'enhanced' && (
                <NumField label="Monthly SSDI benefit (if applicable)" value={t3SSDI} onChange={setT3SSDI} hint="Only reduces the benefit if you receive SSDI for the same disability." />
              )}
            </div>

            <div className="border-t border-slate-800 pt-3 mt-3">
              <span className="block text-[13px] font-medium text-slate-300 mb-1">
                Final Average Salary (FAS) — your highest 3 consecutive years
              </span>
              <p className="text-xs text-slate-400 mb-2 leading-snug">
                Enter each year's pensionable earnings and this calculator averages them for you. A 10%
                year-over-year cap applies to any single year under the official rule, which isn't modeled here —
                use figures already capped if you know one year jumped sharply.
              </p>
              <div className="grid sm:grid-cols-3 gap-4">
                <NumField label="Year 1" value={t3Year1} onChange={setT3Year1} />
                <NumField label="Year 2" value={t3Year2} onChange={setT3Year2} />
                <NumField label="Year 3" value={t3Year3} onChange={setT3Year3} />
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Average (your FAS): <span className="font-mono text-slate-200">{fmt(t3.fas)}</span>/yr
              </p>
            </div>

            {t3RetType === 'adr' && t3Plan !== 'enhanced' && (
              <label className="flex items-center gap-2 text-sm text-slate-300 py-1.5 mt-3">
                <input type="checkbox" checked={t3ADRHasSSDI} onChange={(e) => setT3ADRHasSSDI(e.target.checked)} className="accent-amber-500" />
                I receive SSDI for this same disability
              </label>
            )}

            {t3RetType === 'vested' && (
              <>
                <button type="button" onClick={() => setT3ShowEarlyVest(!t3ShowEarlyVest)} className="text-xs text-amber-500 mt-4 underline decoration-dotted">
                  {t3ShowEarlyVest ? 'Hide' : 'Add'} early commencement (before 20th anniversary, age 55+)
                </button>
                {t3ShowEarlyVest && (
                  <div className="mt-3 max-w-xs">
                    <NumField label="Years before your 20th anniversary" prefix="" value={t3YearsEarly} onChange={setT3YearsEarly} hint="Reduces the vested benefit by 1/30th per year early." />
                  </div>
                )}
              </>
            )}

            {t3.underMinWarning && (
              <p className="text-xs text-amber-400 mt-3 flex items-center gap-1.5">
                <TriangleAlert size={14} /> {retTypeLabelsT3[t3RetType]} typically requires more years of service than entered — figures below are illustrative only.
              </p>
            )}

            {t3RetType === 'normal' && num(t3Years) >= 20 && (
              <p className="text-xs text-amber-400 mt-3 flex items-start gap-1.5 bg-amber-950/30 border border-amber-800/50 rounded-sm px-3 py-2">
                <TriangleAlert size={14} className="shrink-0 mt-0.5" />
                Heads up: Service Retirement is a flat 50% of FAS once you're past 20 years — adding more years
                beyond that won't change your core pension total. That's correct, not a bug (Chapter 55 of the Laws
                of 2025 removed the old 22-year requirement — this now matches Tier 2's 20-year mark, just without
                Tier 2's 1/60-per-year bonus for staying longer).
              </p>
            )}

            {num(t3Years) > 45 && (
              <p className="text-xs text-amber-400 mt-3 flex items-center gap-1.5">
                <TriangleAlert size={14} /> {t3Years} years of service is unusually high for a NY Police career — double-check this wasn't a typo.
              </p>
            )}

            <div className="mt-4 pt-3 border-t border-slate-800">
              <NumField
                label="Pension Longevity Enhancement (optional)"
                value={t3LongevityEnhancement}
                onChange={setT3LongevityEnhancement}
                suffix="/yr"
                hint="Rank-based boost at 25/30/35 years — depends on your rank and time in rank, so this calculator can't compute it. If you know your figure from a PPF statement or your union rep, enter it here; otherwise leave at 0."
              />
            </div>
          </Section>

          {purchasesLoading ? (
            <LoadingSection title="Final Withdrawal at Retirement" badge="02" />
          ) : isPremium ? (
          <Section title="Final Withdrawal at Retirement" badge="02" defaultOpen={false}>
            <p className="text-sm text-slate-400 leading-relaxed mb-3">
              At retirement you may take a lump sum final withdrawal (final loan). Members who joined on or after
              January 1, 2018 can take the lesser of $50,000 or 50% of total contributions; earlier members can take
              up to 75% of total contributions. Either way, any outstanding loan balance reduces what's available,
              and the withdrawal permanently lowers your pension by its actuarial equivalent.
            </p>
            <label className="flex items-center gap-2 text-sm text-slate-300 py-1.5 mb-4">
              <input type="checkbox" checked={t3ShowWithdrawal} onChange={(e) => setT3ShowWithdrawal(e.target.checked)} className="accent-amber-500" />
              I want to take a final withdrawal
            </label>

            {t3ShowWithdrawal && (
              <>
                <div className="mb-4">
                  <span className="block text-[13px] font-medium text-slate-300 mb-1">Membership date</span>
                  <SegGroup
                    value={t3LoanBucket}
                    onChange={setT3LoanBucket}
                    options={[
                      { value: 'before2018', label: 'Joined 7/1/09 – 12/31/17' },
                      { value: 'onafter2018', label: 'Joined on/after 1/1/18' },
                    ]}
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-4 mb-4">
                  <NumField
                    label="Total member contributions"
                    value={t3RequiredAmount}
                    onChange={setT3RequiredAmount}
                    hint="Your accumulated contributions balance — from webCOPS or your PPF statement."
                  />
                  <NumField label="Outstanding loan balance (if any)" value={t3OutstandingLoan} onChange={setT3OutstandingLoan} />
                </div>

                <div className="mb-4">
                  <span className="block text-[13px] font-medium text-slate-300 mb-1">Maximum you can withdraw</span>
                  <div className="font-mono text-amber-400 text-lg">{fmt(t3Withdrawal ? t3Withdrawal.max : 0)}</div>
                </div>

                <span className="block text-[13px] font-medium text-slate-300 mb-2">How do you want to plan this?</span>
                <SegGroup
                  value={t3WithdrawalMode}
                  onChange={setT3WithdrawalMode}
                  options={[
                    { value: 'amount', label: "I'll pick the amount" },
                    { value: 'target', label: 'I have a target take-home pension' },
                  ]}
                />

                {t3WithdrawalMode === 'amount' ? (
                  <div className="mt-4">
                    <SliderField
                      label="Amount you want to withdraw"
                      value={t3WithdrawalAmount}
                      max={t3Withdrawal ? t3Withdrawal.max : 0}
                      onChange={setT3WithdrawalAmount}
                    />
                    {t3Withdrawal && t3Withdrawal.overMax && (
                      <p className="text-xs text-amber-400 mt-2 flex items-center gap-1.5">
                        <TriangleAlert size={14} /> Capped at your maximum of {fmt(t3Withdrawal.max)}.
                      </p>
                    )}
                    {num(t3WithdrawalAmount) === 0 && (
                      <p className="text-xs text-amber-400 mt-2 flex items-start gap-1.5 bg-amber-950/30 border border-amber-800/50 rounded-sm px-3 py-2">
                        <TriangleAlert size={14} className="shrink-0 mt-0.5" />
                        Still set to $0 — nothing below will change until you drag the slider or type an amount
                        here. A $0 withdrawal has no effect, by design.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="mt-4">
                    {t3.hasAgeSplit && (
                      <div className="mb-3">
                        <span className="block text-[13px] font-medium text-slate-300 mb-1">Target applies to</span>
                        <SegGroup
                          value={t3TargetBasis}
                          onChange={setT3TargetBasis}
                          options={[
                            { value: 'before', label: 'Before age 62' },
                            { value: 'after', label: 'Age 62 and after' },
                          ]}
                        />
                      </div>
                    )}
                    <div className="mb-3 flex items-baseline justify-between bg-slate-950/60 border border-slate-800 rounded-sm px-3 py-2">
                      <span className="text-xs text-slate-400">
                        Your pension right now{t3.hasAgeSplit ? ` (${t3TargetBasis === 'before' ? 'before 62' : 'age 62+'})` : ''}, with VSF, before any withdrawal
                      </span>
                      <span className="font-mono text-sm text-slate-200">{fmt(t3TargetBaseAnnual / 12)}/mo</span>
                    </div>
                    <NumField
                      label="Target pension after withdrawal"
                      value={t3TargetMonthly}
                      onChange={setT3TargetMonthly}
                      suffix="/mo"
                      hint="This calculator works backward from this figure to the withdrawal that would produce it."
                    />
                    <div className="mt-3 bg-slate-950 border border-slate-700 rounded-sm px-4 py-3">
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm text-slate-300">Withdrawal needed</span>
                        <span className="font-mono text-lg font-bold text-amber-400">{fmt(t3Withdrawal ? t3Withdrawal.grossLumpSum : 0)}</span>
                      </div>
                      {t3TargetNoWithdrawalNeeded && (
                        <p className="text-xs text-amber-400 mt-2 flex items-start gap-1.5">
                          <TriangleAlert size={14} className="shrink-0 mt-0.5" />
                          You don't need to withdraw anything — that period's pension is already {fmt(t3TargetBaseAnnual / 12)}/mo without one, at or above your target.
                        </p>
                      )}
                      {t3TargetCapped && (
                        <p className="text-xs text-amber-400 mt-2 flex items-start gap-1.5">
                          <TriangleAlert size={14} className="shrink-0 mt-0.5" />
                          Even your full {fmt(t3Withdrawal ? t3Withdrawal.max : 0)} maximum only brings that period down to{' '}
                          {fmt(t3TargetResultAnnual / 12)}/mo — this target isn't reachable through a withdrawal alone.
                        </p>
                      )}
                      {!t3TargetNoWithdrawalNeeded && !t3TargetCapped && t3Withdrawal && t3Withdrawal.grossLumpSum > 0 && (
                        <p className="text-xs text-slate-400 mt-2">
                          This same withdrawal applies to both periods — before 62 it leaves you with{' '}
                          {fmt(t3Withdrawal.pensionAfterBeforeAnnual / 12)}/mo, and at 62+ it leaves{' '}
                          {fmt(t3Withdrawal.pensionAfterAfterAnnual / 12)}/mo.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-4 max-w-xs">
                  <NumField
                    label="Actuarial factor ($ per $1,000)"
                    prefix=""
                    value={t3Factor}
                    onChange={setT3Factor}
                    hint={'Look for "Cost Per Thousand" on your PPF statement — set by PPF\'s Office of the Actuary using mortality tables and 30-year Treasury rates at your retirement.'}
                  />
                </div>

                <div className="flex flex-wrap gap-4 mt-4">
                  <label className="flex items-center gap-2 text-sm text-slate-300 py-1.5">
                    <input type="checkbox" checked={t3Rollover} onChange={(e) => setT3Rollover(e.target.checked)} className="accent-amber-500" />
                    Direct rollover to an IRA
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300 py-1.5">
                    <input type="checkbox" checked={t3PenaltyExempt} onChange={(e) => setT3PenaltyExempt(e.target.checked)} className="accent-amber-500" />
                    I'm 50+ or have 25+ years of service
                  </label>
                </div>
                <p className="text-xs text-slate-400 mt-2 leading-snug">
                  Cash withdrawals are subject to 20% federal withholding, plus a 10% early-withdrawal penalty unless
                  you're over 50 or have 25+ years of uniformed service. A direct IRA rollover avoids both.
                </p>
              </>
            )}
          </Section>
          ) : (
            <LockedSection
              title="Final Withdrawal at Retirement"
              badge="02"
              teaser="Model taking a lump sum at retirement — including working backward from a target take-home pension — and see exactly how much it reduces your monthly benefit."
              onUnlock={() => setShowPaywall(true)}
            />
          )}
          </>
        )}

        {/* ============ DEFERRED COMP (shared, visually separated) ============ */}
        {purchasesLoading ? (
          <LoadingSection title="Deferred Compensation (457 Plan)" badge={tier === 'tier2' ? '04' : '03'} />
        ) : isPremium ? (
        <Section title="Deferred Compensation (457 Plan)" badge={tier === 'tier2' ? '04' : '03'} defaultOpen={false}>
          <p className="text-sm text-slate-400 leading-relaxed mb-3">
            The NYC Deferred Compensation Plan is a separate, voluntary defined-contribution account — it is not part
            of your NY Police pension formula and isn't guaranteed for life the way your pension is. It's shown separately
            below so it never gets mixed into your pension figures.
          </p>
          <label className="flex items-center gap-2 text-sm text-slate-300 py-1.5 mb-3">
            <input type="checkbox" checked={showDefComp} onChange={(e) => setShowDefComp(e.target.checked)} className="accent-amber-500" />
            Include an estimate of supplemental Deferred Comp income
          </label>
          {showDefComp && (
            <>
              <SegGroup
                value={defCompMode}
                onChange={setDefCompMode}
                options={[
                  { value: 'rate', label: 'Balance × withdrawal rate' },
                  { value: 'fixed', label: 'Fixed monthly amount' },
                ]}
              />
              {defCompMode === 'rate' ? (
                <div className="grid sm:grid-cols-2 gap-4 mt-3">
                  <NumField label="Estimated balance at retirement" value={defCompBalance} onChange={setDefCompBalance} />
                  <NumField label="Annual withdrawal rate" prefix="" suffix="%" value={defCompRate} onChange={setDefCompRate} hint="4% is a commonly used conservative starting point — not a guarantee." />
                </div>
              ) : (
                <div className="mt-3 max-w-xs">
                  <NumField label="Fixed monthly withdrawal" value={defCompFixedMonthly} onChange={setDefCompFixedMonthly} />
                </div>
              )}
            </>
          )}
        </Section>
        ) : (
          <LockedSection
            title="Deferred Compensation (457 Plan)"
            badge={tier === 'tier2' ? '04' : '03'}
            teaser="Add your NYC Deferred Comp balance and see it alongside your pension as a combined retirement income estimate, kept clearly separate from your guaranteed pension."
            onUnlock={() => setShowPaywall(true)}
          />
        )}

        <Section title="Net Pay Estimate (After Federal Tax)" badge={tier === 'tier2' ? '05' : '04'} defaultOpen={false}>
          <p className="text-sm text-slate-400 leading-relaxed mb-3">
            <strong className="text-slate-300">Your NYPD pension is exempt from New York State and NYC income
            tax</strong> — that's real, settled state tax law, not a loophole. Federal income tax applies to most
            retirement types, estimated below using current IRS brackets — <strong className="text-slate-300">except
            Accident Disability Retirement (ADR)</strong>, which PPF's own SPD states is generally exempt from
            federal tax too.
          </p>
          <label className="flex items-center gap-2 text-sm text-slate-300 py-1.5 mb-3">
            <input type="checkbox" checked={showNetPay} onChange={(e) => setShowNetPay(e.target.checked)} className="accent-amber-500" />
            Show a net pay estimate
          </label>
          {showNetPay && (
            <>
              <div className="grid sm:grid-cols-2 gap-4 mb-3">
                <div>
                  <span className="block text-[13px] font-medium text-slate-300 mb-1">Filing status</span>
                  <SegGroup
                    value={taxFilingStatus}
                    onChange={setTaxFilingStatus}
                    options={[
                      { value: 'single', label: 'Single' },
                      { value: 'mfj', label: 'Married filing jointly' },
                      { value: 'hoh', label: 'Head of household' },
                    ]}
                  />
                </div>
                <NumField
                  label="Number of dependent children"
                  prefix=""
                  value={numDependents}
                  onChange={setNumDependents}
                  hint={`Applies the 2026 Child Tax Credit ($${CHILD_TAX_CREDIT_2026.toLocaleString()}/child) directly against the tax below. Available regardless of filing status. Real-world phase-outs at higher income aren't modeled.`}
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-4 mb-3">
                {taxFilingStatus === 'mfj' && (
                  <NumField
                    label="Spouse's annual taxable income"
                    value={spouseTaxableIncome}
                    onChange={setSpouseTaxableIncome}
                    hint="Combined with your pension under joint filing — this is what actually changes the outcome under Married Filing Jointly, since your two incomes stack together onto one return."
                  />
                )}
                <NumField
                  label="Other annual taxable income (optional)"
                  value={otherTaxableIncome}
                  onChange={setOtherTaxableIncome}
                  hint="Your own Deferred Comp withdrawals, a second job, Social Security's taxable portion, etc. — separate from your spouse's income above."
                />
              </div>

              {tier === 'tier2' ? (
                <NetPayEstimate
                  grossAnnual={t2.totalAnnual}
                  filingStatus={taxFilingStatus}
                  otherIncomeAnnual={num(otherTaxableIncome) + (taxFilingStatus === 'mfj' ? num(spouseTaxableIncome) : 0)}
                  numDependents={num(numDependents)}
                  isExempt={t2.isADR}
                />
              ) : t3.hasAgeSplit ? (
                <div className="grid sm:grid-cols-2 gap-3">
                  <NetPayEstimate
                    label="Before age 62"
                    grossAnnual={t3.totalBeforeAnnual}
                    filingStatus={taxFilingStatus}
                    otherIncomeAnnual={num(otherTaxableIncome) + (taxFilingStatus === 'mfj' ? num(spouseTaxableIncome) : 0)}
                    numDependents={num(numDependents)}
                    isExempt={t3RetType === 'adr'}
                  />
                  <NetPayEstimate
                    label="Age 62 and after"
                    grossAnnual={t3.totalAfterAnnual}
                    filingStatus={taxFilingStatus}
                    otherIncomeAnnual={num(otherTaxableIncome) + (taxFilingStatus === 'mfj' ? num(spouseTaxableIncome) : 0)}
                    numDependents={num(numDependents)}
                    isExempt={t3RetType === 'adr'}
                  />
                </div>
              ) : (
                <NetPayEstimate
                  grossAnnual={t3.totalAfterAnnual}
                  filingStatus={taxFilingStatus}
                  otherIncomeAnnual={num(otherTaxableIncome) + (taxFilingStatus === 'mfj' ? num(spouseTaxableIncome) : 0)}
                  numDependents={num(numDependents)}
                  isExempt={t3RetType === 'adr'}
                />
              )}

              <p className="text-xs text-slate-400 mt-3 leading-relaxed">
                Uses 2026 federal brackets and the standard deduction only — it doesn't model itemized deductions,
                the Child Tax Credit's income phase-out, the senior deduction, or how withholding elections affect
                your paycheck-to-paycheck amount versus what you actually owe at filing. Brackets and deductions
                change most years. This is a planning estimate, not tax advice — a tax professional can give you a
                figure to actually rely on.
              </p>
            </>
          )}
        </Section>

        <Section title="Pre-Finalization Pension" badge={tier === 'tier2' ? '06' : '05'} defaultOpen={false}>
          <p className="text-sm text-slate-400 leading-relaxed mb-3">
            Per PPF's own Summary Plan Description: when you first retire, your pension isn't "finalized" right
            away — PPF pays your Maximum Retirement Allowance minus a default <strong className="text-slate-300">5%
            holdback</strong> while your case is reviewed. Once finalized, you move to full monthly payments, and
            any gap between the two periods is caught up in your first full payment.
          </p>
          <label className="flex items-center gap-2 text-sm text-slate-300 py-1.5 mb-3">
            <input type="checkbox" checked={showPreFinalization} onChange={(e) => setShowPreFinalization(e.target.checked)} className="accent-amber-500" />
            Show a pre-finalization estimate
          </label>
          {showPreFinalization && (
            <>
              <div className="max-w-xs mb-3">
                <NumField
                  label="Withholding percentage"
                  prefix=""
                  value={preFinalizationPct}
                  onChange={setPreFinalizationPct}
                  hint="Defaults to PPF's standard 5%. Raise this yourself if you're choosing a survivor payment option, which this calculator doesn't model — see the note below."
                />
              </div>

              {tier === 'tier2' ? (
                <PreFinalizationEstimate
                  fullMonthly={t2.totalAnnual / 12}
                  fullAnnual={t2.totalAnnual}
                  withholdPct={num(preFinalizationPct)}
                />
              ) : t3.hasAgeSplit ? (
                <div className="grid sm:grid-cols-2 gap-3">
                  <PreFinalizationEstimate
                    fullMonthly={t3.totalBeforeAnnual / 12}
                    fullAnnual={t3.totalBeforeAnnual}
                    withholdPct={num(preFinalizationPct)}
                  />
                  <PreFinalizationEstimate
                    fullMonthly={t3.totalAfterAnnual / 12}
                    fullAnnual={t3.totalAfterAnnual}
                    withholdPct={num(preFinalizationPct)}
                  />
                </div>
              ) : (
                <PreFinalizationEstimate
                  fullMonthly={t3.totalAfterAnnual / 12}
                  fullAnnual={t3.totalAfterAnnual}
                  withholdPct={num(preFinalizationPct)}
                />
              )}
            </>
          )}
        </Section>

        <Section title="Service Buyback Options" badge={tier === 'tier2' ? '07' : '06'} defaultOpen={false}>
          <p className="text-sm text-slate-400 leading-relaxed mb-3">
            PPF's SPD lists five ways to buy back prior service. Only Military Service has a simple, fixed formula
            this calculator can compute — the other four depend on your specific historical account data that only
            PPF has, so they're covered as reference below rather than a fake calculator.
          </p>

          <div className="border-t border-slate-800 pt-3 mb-4">
            <span className="block text-[13px] font-medium text-slate-300 mb-1">Military Service, RSSL §1000</span>
            <p className="text-xs text-slate-400 leading-relaxed mb-2">
              Purchase up to <strong>3 years</strong> of pre-membership military service. You need 5 years of
              allowable police service already (not counting the time you're buying back) and an honorable
              discharge (DD-214). Must apply and pay in full before your retirement date.
            </p>
            <label className="flex items-center gap-2 text-sm text-slate-300 py-1.5 mb-3">
              <input type="checkbox" checked={showBuyback} onChange={(e) => setShowBuyback(e.target.checked)} className="accent-amber-500" />
              Calculate military buyback cost
            </label>
            {showBuyback && (
              <>
                <div className="grid sm:grid-cols-2 gap-4 mb-2">
                  <NumField
                    label="Years of military service to buy back"
                    prefix=""
                    value={buybackYears}
                    onChange={setBuybackYears}
                    hint="Capped at 3 years total under RSSL §1000."
                  />
                  <NumField
                    label="Compensation, last 12 months of credited service"
                    value={buybackComp}
                    onChange={setBuybackComp}
                    hint="As of your application date — not necessarily the same as your current FAS inputs above."
                  />
                </div>
                <div className="bg-slate-950/60 border border-slate-700 rounded-sm px-3 py-3">
                  <div className="text-xs text-slate-400 mb-1">Estimated cost (3% × years × compensation)</div>
                  <div className="font-mono text-lg text-amber-400">
                    {fmt(0.03 * Math.min(3, num(buybackYears)) * num(buybackComp))}
                  </div>
                  {num(buybackYears) > 3 && (
                    <p className="text-xs text-amber-400 mt-1">Capped at 3 years — using 3, not {buybackYears}.</p>
                  )}
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mt-2">
                  This buys additional years of service credit — once purchased, add it to "Years of allowable
                  police service" in section 01 yourself to see the effect on your pension. The SPD also warns
                  most buybacks recalculate your required contribution rate retroactively, which commonly creates
                  a shortage — check the ASF excess/shortage section above once you know your real figures from
                  PPF.
                </p>
              </>
            )}
          </div>

          <div className="border-t border-slate-800 pt-3 mb-4">
            <span className="block text-[13px] font-medium text-slate-300 mb-2">
              Check this first: Transfer of Service (often free)
            </span>
            <p className="text-xs text-slate-400 leading-relaxed mb-2">
              If you worked for another NYC or NY State public employer before joining NYPD, a straight
              <strong className="text-slate-300"> transfer</strong> is different from a buyback — often free or much
              cheaper, but only within a time window:
            </p>
            <div className="space-y-2 text-xs text-slate-400 leading-relaxed">
              <p>
                <strong className="text-slate-300">Prior NY State service</strong> — transfer within <strong>7
                years</strong> of leaving state service. After that, you must purchase the time instead
                (Chapter 552 buyback below).
              </p>
              <p>
                <strong className="text-slate-300">Prior NYC service</strong> — transfer within <strong>1
                year</strong> of leaving city service. After that, same — a buyback is required.
              </p>
              <p>
                Counts as full uniformed "Allowable Police Service" only for specific prior roles: Housing Police,
                Transit Police, Correction, Sanitation, EMT, other NYS/PFRS uniformed service, or Peace Officer
                status immediately preceding your NYPD appointment (Chapter 498 of 2005). Other prior service
                still transfers, but only as Other Credited Service — added pension value, not faster eligibility.
              </p>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-3">
            <span className="block text-[13px] font-medium text-slate-300 mb-2">Other buyback types (contact PPF for exact cost)</span>
            <div className="space-y-3 text-xs text-slate-400 leading-relaxed">
              <p>
                <strong className="text-slate-300">Chapter 646 (1999)</strong> — former City/State public
                retirement system membership; repay refunded contributions plus interest. Uniformed service
                changes your retirement date; non-uniformed only adds pension value. Changes your contribution
                rate and may create a shortage.
              </p>
              <p>
                <strong className="text-slate-300">Chapter 552 (2000)</strong> — prior City/State/political
                subdivision service before joining PPF, once the free transfer window above has closed. Uniformed
                service changes your retirement date; non-uniformed only adds value. Unlike Chapter 646, your
                contribution rate never changes.
              </p>
              <p>
                <strong className="text-slate-300">Child Care, Chapter 594 (2000)</strong> — purchase uniformed
                credit for authorized childcare leave. Must file within 90 days of the leave ending.
              </p>
              <p>
                <strong className="text-slate-300">Bosnia Bill, Chapter 606 (2000)</strong> — police duty performed
                abroad for the U.S. government. Combined with qualifying military service, capped at 4 years total.
              </p>
            </div>
          </div>
        </Section>

        {/* ============ RESULTS ============ */}
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={18} className="text-amber-500" />
            <h2 className="font-serif text-xl text-slate-100">Estimated Benefit</h2>
          </div>

          {tier === 'tier2' ? (
            <div className="border border-amber-700/40 bg-slate-900 rounded-sm p-5">
              <HeadlineNumber
                monthly={t2.totalAnnual / 12}
                yearly={t2.totalAnnual}
                note={
                  t2.pendingMakesADifference
                    ? `This reflects your Final Average Salary field only, which is currently ${fmt(t2.fas)}. Your best-3-years entries below show a higher pending-law figure: ${fmt(t2.pendingTotalAnnual / 12)}/mo — see the "If S7808A is signed" box further down.`
                    : t2.fas === 0
                    ? 'Your Final Average Salary is still $0, so this only reflects VSF. Fill in your FAS in section 01 for a real estimate.'
                    : undefined
                }
              />
              <CompositionBar
                segments={[
                  { label: 'Core pension', value: t2.coreAnnual + t2.enhancedAnnual, color: '#f59e0b' },
                  { label: 'VSF', value: t2.vsfAnnual, color: '#10b981' },
                ]}
              />
              <div className="mt-4">
                <LedgerRow
                  label={
                    t2.isService
                      ? '50% of FAS + 1/60th after 20th year'
                      : t2.isVested
                      ? '1/40 × FAS × years of service'
                      : t2.isODR
                      ? 'Ordinary Disability Retirement benefit'
                      : 'Accident Disability Retirement benefit'
                  }
                  annual={t2.base}
                  monthly={t2.base / 12}
                />
                {t2ShowNonUni && (
                  <LedgerRow label="Prior non-uniformed service benefit" annual={t2.nonUniformBenefit} monthly={t2.nonUniformBenefit / 12} />
                )}
                {(t2.isService || t2.isVested) && (
                  <>
                    <LedgerRow
                      label="Annuity value of ASF excess less shortage"
                      sub={t2.enhancedAnnual === 0 ? 'Part of the official formula — still $0. Enter your ASF figures in section 02.' : undefined}
                      annual={t2.enhancedAnnual}
                      monthly={t2.enhancedAnnual / 12}
                      negative={t2.enhancedAnnual < 0}
                    />
                    <LedgerRow
                      label="Annuity value of City ITHP after 20th anniversary"
                      sub={t2.ithpAnnual === 0 ? 'Part of the official formula — still $0. Enter your ITHP figure in section 02.' : undefined}
                      annual={t2.ithpAnnual}
                      monthly={t2.ithpAnnual / 12}
                    />
                  </>
                )}
                {t2.longevityAnnual > 0 && (
                  <LedgerRow
                    label="Pension Longevity Enhancement"
                    sub="Manually entered — not computed by this calculator."
                    annual={t2.longevityAnnual}
                    monthly={t2.longevityAnnual / 12}
                  />
                )}
                <LedgerRow
                  label="Pension without VSF"
                  sub="Your core pension only — before any Variable Supplements Fund payment."
                  annual={t2.pensionAnnual}
                  monthly={t2.pensionAnnual / 12}
                  bold
                />
                <LedgerRow
                  label="Variable Supplements Fund (VSF)"
                  sub={t2.vsfEligible ? 'Service retirees only; prorated in your retirement year.' : 'Not payable — only Service retirees receive VSF.'}
                  annual={t2.vsfAnnual}
                  monthly={t2.vsfAnnual / 12}
                />
                <LedgerRow label="Pension with VSF (total)" annual={t2.totalAnnual} monthly={t2.totalAnnual / 12} bold />
                {t2.showPendingLaw && (
                  <PendingLawPreview
                    currentMonthly={t2.totalAnnual / 12}
                    pendingMonthly={t2.pendingTotalAnnual / 12}
                    currentFAS={t2.fas}
                    pendingFAS={t2.pendingFAS}
                  />
                )}

                {t2ShowWithdrawal && t2Withdrawal && t2Withdrawal.grossLumpSum > 0 && (
                  <>
                    <LumpSumRow label="Final withdrawal — gross lump sum" value={t2Withdrawal.grossLumpSum} />
                    {!t2Rollover && (
                      <>
                        <LumpSumRow label="Federal withholding (20%)" value={t2Withdrawal.withholding} negative />
                        {t2Withdrawal.penalty > 0 && (
                          <LumpSumRow label="Early withdrawal penalty (10%)" value={t2Withdrawal.penalty} negative />
                        )}
                        <LumpSumRow label="Net cash received" value={t2Withdrawal.netLumpSum} bold />
                      </>
                    )}
                    {t2Rollover && <LumpSumRow label="Amount rolled into your IRA" value={t2Withdrawal.netLumpSum} bold />}
                    <LedgerRow
                      label="Pension reduction from withdrawal"
                      annual={t2Withdrawal.reductionAnnual}
                      monthly={t2Withdrawal.reductionAnnual / 12}
                      negative
                    />
                    <LedgerRow
                      label="Pension after withdrawal — without VSF"
                      sub="If you'd rather plan around your core pension alone and leave VSF out of the picture entirely."
                      annual={Math.max(0, t2.pensionAnnual - t2Withdrawal.reductionAnnual)}
                      monthly={Math.max(0, t2.pensionAnnual - t2Withdrawal.reductionAnnual) / 12}
                      bold
                    />
                    <LedgerRow
                      label="Pension after withdrawal — with VSF (total)"
                      annual={t2Withdrawal.pensionAfterAnnual}
                      monthly={t2Withdrawal.pensionAfterAnnual / 12}
                      bold
                    />
                    <TradeoffSummary
                      beforeMonthly={t2.totalAnnual / 12}
                      afterMonthly={t2Withdrawal.pensionAfterAnnual / 12}
                      netCash={t2Withdrawal.netLumpSum}
                    />
                  </>
                )}

                {showDefComp && (
                  <LedgerRow label="+ Deferred Comp (separate account)" annual={defCompAnnual} monthly={defCompAnnual / 12} />
                )}
                {showDefComp && (
                  <LedgerRow label="Total estimated retirement income" annual={grand.annual} monthly={grand.annual / 12} bold />
                )}
              </div>
            </div>
          ) : (
            <div className="border border-amber-700/40 bg-slate-900 rounded-sm p-5">
              {t3.hasAgeSplit ? (
                <HeadlineSplit
                  beforeMonthly={t3.totalBeforeAnnual / 12}
                  afterMonthly={t3.totalAfterAnnual / 12}
                  note={t3.fas === 0 ? 'Your Year 1/2/3 earnings in section 01 are still $0, so this only reflects VSF (if eligible). Fill them in for a real estimate.' : undefined}
                />
              ) : (
                <HeadlineNumber
                  monthly={t3.totalAfterAnnual / 12}
                  yearly={t3.totalAfterAnnual}
                  note={t3.fas === 0 ? 'Your Year 1/2/3 earnings in section 01 are still $0, so this only reflects VSF (if eligible). Fill them in for a real estimate.' : undefined}
                />
              )}
              <CompositionBar
                segments={[
                  { label: 'Core pension (after any offset)', value: t3.hasAgeSplit ? t3.beforeOffset : t3.afterOffsetAnnual, color: '#f59e0b' },
                  { label: 'VSF', value: t3.vsfAnnual, color: '#10b981' },
                ]}
              />
              <div className="mt-4">
                <LedgerRow
                  label={retTypeLabelsT3[t3RetType] + ' benefit — without VSF' + (t3.hasAgeSplit ? ', before 62' : '')}
                  annual={t3.beforeOffset}
                  monthly={t3.beforeOffset / 12}
                  bold
                />
                {t3.longevityAnnual > 0 && (
                  <LedgerRow
                    label="— includes Pension Longevity Enhancement"
                    sub="Manually entered — not computed by this calculator. Already folded into the total above."
                    annual={t3.longevityAnnual}
                    monthly={t3.longevityAnnual / 12}
                  />
                )}

                {t3.hasAgeSplit && (
                  <LedgerRow
                    label="Social Security offset at 62"
                    sub="50% of your primary Social Security benefit, applied whether or not you've filed."
                    annual={t3.beforeOffset - t3.afterOffsetAnnual}
                    monthly={(t3.beforeOffset - t3.afterOffsetAnnual) / 12}
                    negative
                  />
                )}
                {t3.hasAgeSplit && (
                  <LedgerRow
                    label="Pension without VSF — age 62 and after"
                    annual={t3.afterOffsetAnnual}
                    monthly={t3.afterOffsetAnnual / 12}
                    bold
                  />
                )}

                <LedgerRow
                  label="Variable Supplements Fund (VSF)"
                  sub={t3.vsfEligible ? 'Early/Normal Service retirees with 20+ years only; prorated in your retirement year.' : 'Not payable for this retirement type.'}
                  annual={t3.vsfAnnual}
                  monthly={t3.vsfAnnual / 12}
                />

                {t3.hasAgeSplit ? (
                  <>
                    <LedgerRow label="Pension with VSF — before age 62 (total)" annual={t3.totalBeforeAnnual} monthly={t3.totalBeforeAnnual / 12} bold />
                    <LedgerRow label="Pension with VSF — age 62 and after (total)" annual={t3.totalAfterAnnual} monthly={t3.totalAfterAnnual / 12} bold />
                  </>
                ) : (
                  <LedgerRow label="Pension with VSF (total)" annual={t3.totalAfterAnnual} monthly={t3.totalAfterAnnual / 12} bold />
                )}

                {t3ShowWithdrawal && t3Withdrawal && t3Withdrawal.grossLumpSum > 0 && (
                  <>
                    <LumpSumRow label="Final withdrawal — gross lump sum" value={t3Withdrawal.grossLumpSum} />
                    {!t3Rollover && (
                      <>
                        <LumpSumRow label="Federal withholding (20%)" value={t3Withdrawal.withholding} negative />
                        {t3Withdrawal.penalty > 0 && (
                          <LumpSumRow label="Early withdrawal penalty (10%)" value={t3Withdrawal.penalty} negative />
                        )}
                        <LumpSumRow label="Net cash received" value={t3Withdrawal.netLumpSum} bold />
                      </>
                    )}
                    {t3Rollover && <LumpSumRow label="Amount rolled into your IRA" value={t3Withdrawal.netLumpSum} bold />}
                    <LedgerRow
                      label="Pension reduction from withdrawal"
                      annual={t3Withdrawal.reductionAnnual}
                      monthly={t3Withdrawal.reductionAnnual / 12}
                      negative
                    />
                    {t3.hasAgeSplit ? (
                      <>
                        <LedgerRow
                          label="Pension after withdrawal — without VSF, before 62"
                          sub="Leaves VSF out entirely, if you'd rather plan around your core pension alone."
                          annual={Math.max(0, t3.beforeOffset - t3Withdrawal.reductionAnnual)}
                          monthly={Math.max(0, t3.beforeOffset - t3Withdrawal.reductionAnnual) / 12}
                          bold
                        />
                        <LedgerRow
                          label="Pension after withdrawal — without VSF, age 62+"
                          annual={Math.max(0, t3.afterOffsetAnnual - t3Withdrawal.reductionAnnual)}
                          monthly={Math.max(0, t3.afterOffsetAnnual - t3Withdrawal.reductionAnnual) / 12}
                          bold
                        />
                        <LedgerRow
                          label="Pension after withdrawal — with VSF, before 62 (total)"
                          annual={t3Withdrawal.pensionAfterBeforeAnnual}
                          monthly={t3Withdrawal.pensionAfterBeforeAnnual / 12}
                          bold
                        />
                        <LedgerRow
                          label="Pension after withdrawal — with VSF, age 62+ (total)"
                          annual={t3Withdrawal.pensionAfterAfterAnnual}
                          monthly={t3Withdrawal.pensionAfterAfterAnnual / 12}
                          bold
                        />
                        <TradeoffSummary
                          periodLabel="before age 62"
                          beforeMonthly={t3.totalBeforeAnnual / 12}
                          afterMonthly={t3Withdrawal.pensionAfterBeforeAnnual / 12}
                          netCash={t3Withdrawal.netLumpSum}
                        />
                        <TradeoffSummary
                          periodLabel="age 62 and after"
                          beforeMonthly={t3.totalAfterAnnual / 12}
                          afterMonthly={t3Withdrawal.pensionAfterAfterAnnual / 12}
                          netCash={t3Withdrawal.netLumpSum}
                        />
                      </>
                    ) : (
                      <>
                        <LedgerRow
                          label="Pension after withdrawal — without VSF"
                          sub="Leaves VSF out entirely, if you'd rather plan around your core pension alone."
                          annual={Math.max(0, t3.afterOffsetAnnual - t3Withdrawal.reductionAnnual)}
                          monthly={Math.max(0, t3.afterOffsetAnnual - t3Withdrawal.reductionAnnual) / 12}
                          bold
                        />
                        <LedgerRow
                        label="Pension after withdrawal — with VSF (total)"
                        annual={t3Withdrawal.pensionAfterAfterAnnual}
                        monthly={t3Withdrawal.pensionAfterAfterAnnual / 12}
                        bold
                      />
                        <TradeoffSummary
                          beforeMonthly={t3.totalAfterAnnual / 12}
                          afterMonthly={t3Withdrawal.pensionAfterAfterAnnual / 12}
                          netCash={t3Withdrawal.netLumpSum}
                        />
                      </>
                    )}
                  </>
                )}

                {showDefComp && (
                  <LedgerRow label="+ Deferred Comp (separate account)" annual={defCompAnnual} monthly={defCompAnnual / 12} />
                )}
                {showDefComp && t3.hasAgeSplit && (
                  <>
                    <LedgerRow label="Total retirement income before 62" annual={grand.beforeAnnual} monthly={grand.beforeAnnual / 12} bold />
                    <LedgerRow label="Total retirement income at 62+" annual={grand.afterAnnual} monthly={grand.afterAnnual / 12} bold />
                  </>
                )}
                {showDefComp && !t3.hasAgeSplit && (
                  <LedgerRow label="Total estimated retirement income" annual={grand.afterAnnual} monthly={grand.afterAnnual / 12} bold />
                )}
              </div>
            </div>
          )}

          <p className="text-xs text-slate-400 mt-4 leading-relaxed">
            Figures exclude future Cost-of-Living Adjustments (Tier 2, from age 55–62) and Escalation (Tier 3, up to
            3%/yr from 25 years of service), both of which increase your benefit over time — as do the rank-based
            Pension Longevity Enhancements available at 25/30/35 years, which aren't modeled here. Source: NYC
            Police Pension Fund Summary Plan Descriptions, June 2026.
          </p>
        </div>

        {/* ============ ACCURACY CHECK AGAINST REAL STATEMENT ============ */}
        {purchasesLoading ? (
          <div className="mt-10">
            <LoadingSection title="Accuracy Check Against Your Statement" />
          </div>
        ) : isPremium ? (
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-3">
            <FileText size={18} className="text-amber-500" />
            <h2 className="font-serif text-xl text-slate-100">Accuracy Check Against Your Statement</h2>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            See how close this estimate lands to your real PPF benefit estimate or annual statement. Browsers can't
            decode a PDF's compressed text without a dedicated library, so this can't open your PDF directly — open
            it yourself, select all the text, copy it, and paste it below. A plain <code className="text-slate-300">.txt</code> export,
            or a photo/screenshot of your statement, can also be uploaded directly — screenshots are read
            on your device using on-screen text recognition, nothing is uploaded anywhere.
          </p>

          <div className="border border-slate-800 bg-slate-900/60 rounded-sm p-4 mb-4">
            <span className="block text-[13px] font-medium text-slate-300 mb-2">1. Paste, upload, or photograph your statement</span>

            <label
              className={`inline-flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-sm px-4 py-2.5 text-sm text-slate-300 mb-3 ${
                ocrLoading ? 'opacity-60' : 'cursor-pointer'
              }`}
            >
              {ocrLoading ? (
                <Loader2 size={16} className="text-amber-500 animate-spin" />
              ) : (
                <Upload size={16} className="text-amber-500" />
              )}
              {ocrLoading ? `Reading image… ${ocrProgress}%` : fileName ? fileName : 'Upload a photo, screenshot, or .txt file'}
              <input
                type="file"
                accept=".txt,text/plain,image/*"
                onChange={handleFileUpload}
                disabled={ocrLoading}
                className="hidden"
              />
            </label>
            {ocrLoading && (
              <p className="text-xs text-slate-400 mb-3 leading-snug">
                Recognizing text on your device — this can take 10-30 seconds depending on the photo, and nothing is
                sent anywhere. First use may take a bit longer while the recognition model downloads.
              </p>
            )}
            {fileError && (
              <p className="text-xs text-amber-400 mb-3 flex items-start gap-1.5">
                <TriangleAlert size={14} className="shrink-0 mt-0.5" /> {fileError}
              </p>
            )}

            <textarea
              value={statementText}
              onChange={(e) => setStatementText(e.target.value)}
              placeholder="Paste the text of your PPF benefit estimate or annual statement here…"
              rows={5}
              className="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 outline-none rounded-sm px-3 py-2 text-base text-slate-200 leading-relaxed"
            />
            <button
              type="button"
              onClick={handleScan}
              disabled={!statementText.trim() || ocrLoading}
              className="mt-3 bg-amber-500 disabled:bg-slate-800 disabled:text-slate-400 text-slate-950 font-medium text-sm rounded-sm px-4 py-2.5"
            >
              Scan for figures
            </button>

            {extracted && (
              <div className="mt-4 border-t border-slate-800 pt-3">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <span className="text-[13px] font-medium text-slate-300">Found in your statement</span>
                  <button
                    type="button"
                    onClick={applyAllExtracted}
                    className="shrink-0 text-xs bg-amber-500 text-slate-950 font-semibold rounded-sm px-3 py-2"
                  >
                    Apply All to Calculator
                  </button>
                </div>
                {appliedCount > 0 && (
                  <p className="text-xs text-emerald-400 bg-emerald-950/30 border border-emerald-800/50 rounded-sm px-3 py-2 mb-3 leading-relaxed">
                    Applied {appliedCount} figure{appliedCount === 1 ? '' : 's'} to your calculator.{' '}
                    {extracted.annual || extracted.monthly
                      ? "Scroll down to the Comparison box below to see how close this calculator lands to your statement."
                      : "Scroll up to your Tier's results to see the updated pension estimate — no official pension amount was found to compare against, so no Comparison box will appear here."}
                  </p>
                )}
                <ExtractedRow label="Final Average Salary" match={extracted.fas} onUse={() => { applyExtracted('fas'); setAppliedCount(1); }} />
                <ExtractedRow label="Years of service" match={extracted.years} onUse={() => { applyExtracted('years'); setAppliedCount(1); }} />
                <ExtractedRow label="Required amount / contributions" match={extracted.required} onUse={() => { applyExtracted('required'); setAppliedCount(1); }} />
                <ExtractedRow label="Annual pension" match={extracted.annual} onUse={() => { applyExtracted('annual'); setAppliedCount(1); }} />
                <ExtractedRow label="Monthly pension" match={extracted.monthly} onUse={() => { applyExtracted('monthly'); setAppliedCount(1); }} />
                <ExtractedRow label="Longevity Enhancement" match={extracted.longevity} onUse={() => { applyExtracted('longevity'); setAppliedCount(1); }} />
                <p className="text-xs text-slate-400 mt-2 leading-snug">
                  This is pattern-matching, not real comprehension — always check the quoted snippet actually says
                  what you think before using it. "Apply All" fills in everything found at once; use the individual
                  Use buttons instead if you only trust some of them.
                </p>
              </div>
            )}
          </div>

          <div className="border border-slate-800 bg-slate-900/60 rounded-sm p-4 mb-4">
            <span className="block text-[13px] font-medium text-slate-300 mb-2">2. Or just type in what your statement reports</span>
            <div className="grid sm:grid-cols-2 gap-4">
              <NumField label="Official annual pension" value={officialAnnual} onChange={setOfficialAnnual} />
              <NumField label="Official monthly pension (optional)" value={officialMonthly} onChange={setOfficialMonthly} />
            </div>
          </div>

          {accuracy && (
            <div className="border border-amber-700/40 bg-slate-900 rounded-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 size={16} className="text-amber-500" />
                <span className="font-serif text-lg text-slate-100">Comparison</span>
              </div>

              {!accuracy.hasSplit ? (
                <>
                  <LedgerRow
                    label="This calculator's estimate"
                    annual={tier === 'tier2' ? accuracy.calc : accuracy.calcAfter}
                    monthly={(tier === 'tier2' ? accuracy.calc : accuracy.calcAfter) / 12}
                  />
                  <LedgerRow label="Your official statement" annual={accuracy.officialAnnual} monthly={accuracy.officialAnnual / 12} />
                  <LedgerRow
                    label="Difference"
                    annual={tier === 'tier2' ? accuracy.diff : accuracy.diffAfter}
                    monthly={(tier === 'tier2' ? accuracy.diff : accuracy.diffAfter) / 12}
                    negative={(tier === 'tier2' ? accuracy.diff : accuracy.diffAfter) < 0}
                  />
                  <div className="flex items-baseline justify-between pt-3 mt-1 border-t border-slate-700">
                    <span className="font-semibold text-slate-100 text-sm">Match accuracy</span>
                    <span className="font-mono text-lg font-bold text-amber-400">
                      {(tier === 'tier2' ? accuracy.accuracyPct : accuracy.accuracyPctAfter).toFixed(1)}%
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <LedgerRow label="Your official statement" annual={accuracy.officialAnnual} monthly={accuracy.officialAnnual / 12} />
                  <LedgerRow label="Calculator — before age 62" annual={accuracy.calcBefore} monthly={accuracy.calcBefore / 12} />
                  <LedgerRow
                    label="Difference vs. before-62 figure"
                    annual={accuracy.diffBefore}
                    monthly={accuracy.diffBefore / 12}
                    negative={accuracy.diffBefore < 0}
                    sub={`${accuracy.accuracyPctBefore.toFixed(1)}% match`}
                  />
                  <LedgerRow label="Calculator — age 62 and after" annual={accuracy.calcAfter} monthly={accuracy.calcAfter / 12} />
                  <LedgerRow
                    label="Difference vs. 62+ figure"
                    annual={accuracy.diffAfter}
                    monthly={accuracy.diffAfter / 12}
                    negative={accuracy.diffAfter < 0}
                    sub={`${accuracy.accuracyPctAfter.toFixed(1)}% match — your statement likely lines up with whichever row is closest.`}
                  />
                </>
              )}

              <p className="text-xs text-slate-400 mt-4 leading-relaxed">
                A gap usually comes from something this calculator doesn't model automatically: an already-applied
                COLA or Escalation increase, a survivor option reduction, a final withdrawal or loan you haven't
                entered above, or an ITHP/50-50/excess annuity value that differs from what's in the ITHP section.
                Open those sections above and compare line by line to close the gap.
              </p>
            </div>
          )}
        </div>
        ) : (
          <div className="mt-10">
            <LockedSection
              title="Accuracy Check Against Your Statement"
              teaser="Paste text from your real PPF benefit estimate and see exactly how close this calculator's numbers land to your official figures, with the gap explained."
              onUnlock={() => setShowPaywall(true)}
            />
          </div>
        )}
      </div>

      {showPaywall && (
        <Paywall
          onClose={() => setShowPaywall(false)}
          purchasePackage={purchasePackage}
          restorePurchases={restorePurchases}
          offerings={offerings}
          loading={purchasesLoading}
          error={purchasesError}
          isNative={isNative}
        />
      )}
    </div>
  );
}
