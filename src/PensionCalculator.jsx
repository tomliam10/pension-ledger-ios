import React, { useState, useMemo, useEffect } from 'react';
import { Shield, ChevronDown, ChevronRight, TriangleAlert, BookOpen, Upload, FileText, CheckCircle2 } from 'lucide-react';

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
  return isFinite(n) ? n : 0;
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
    /(?:years[ \t]{0,2}of[ \t]{0,2}(?:allowable police|credited|uniformed)[ \t]{0,2}service|total[ \t]{0,2}service)[ \t:\u2013\-]{0,8}(\d+(?:\.\d+)?)/i,
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
  return {
    fas: findFigure(clean, ['final average salary', 'FAS']),
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
  };
}

/* ---------------------------------------------------------------
   Small building blocks
--------------------------------------------------------------- */
function NumField({ label, value, onChange, prefix = '$', hint, suffix }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-slate-300 mb-1">{label}</span>
      <div className="flex items-center bg-slate-950 border border-slate-700 focus-within:border-amber-500 rounded-sm px-3 py-2">
        {prefix && <span className="text-slate-500 font-mono mr-1 text-sm">{prefix}</span>}
        <input
          type="number"
          inputMode="decimal"
          className="bg-transparent outline-none w-full font-mono text-slate-100 text-base"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix && <span className="text-slate-500 font-mono ml-1 text-sm">{suffix}</span>}
      </div>
      {hint && <span className="block text-xs text-slate-500 mt-1 leading-snug">{hint}</span>}
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
        {sub && <div className="text-xs text-slate-500 mt-0.5 leading-snug max-w-md">{sub}</div>}
      </div>
      <div className="text-right shrink-0">
        <div className={`font-mono ${bold ? 'text-lg font-bold text-amber-400' : 'text-slate-200 text-sm'}`}>
          {negative && amt < 0 ? '−' : ''}{fmt(Math.abs(amt))}
          <span className="text-[11px] text-slate-500 font-sans ml-1">/yr</span>
        </div>
        <div className="text-xs text-slate-500 font-mono">
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
          <span className="text-slate-500 font-mono mr-1 text-sm">$</span>
          <input
            type="number"
            inputMode="decimal"
            className="bg-transparent outline-none w-28 sm:w-32 font-mono text-slate-100 text-base"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
        <span className="text-xs text-slate-500 whitespace-nowrap">of {fmt(safeMax)} max</span>
      </div>
      {hint && <span className="block text-xs text-slate-500 mt-1 leading-snug">{hint}</span>}
    </div>
  );
}

function LumpSumRow({ label, value, sub, bold, negative }) {
  const v = Math.abs(value);
  return (
    <div className={`flex items-start justify-between py-2.5 ${bold ? 'border-t border-slate-700 mt-1 pt-3' : 'border-b border-dotted border-slate-800'}`}>
      <div className="pr-3">
        <div className={`${bold ? 'font-semibold text-slate-100' : 'text-slate-300'} text-sm`}>{label}</div>
        {sub && <div className="text-xs text-slate-500 mt-0.5 leading-snug max-w-md">{sub}</div>}
      </div>
      <div className="text-right shrink-0">
        <div className={`font-mono ${bold ? 'text-lg font-bold text-amber-400' : 'text-slate-200 text-sm'}`}>
          {negative ? '−' : ''}{fmt(v)}
        </div>
        <div className="text-[11px] text-slate-500">one-time</div>
      </div>
    </div>
  );
}

function ExtractedRow({ label, match, onUse }) {
  if (!match) {
    return (
      <div className="flex items-center justify-between py-2 border-b border-dotted border-slate-800">
        <span className="text-sm text-slate-500">{label}</span>
        <span className="text-xs text-slate-600">not found</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-dotted border-slate-800">
      <div className="min-w-0">
        <div className="text-sm text-slate-200">
          {label}: <span className="font-mono text-amber-400">{match.value}</span>
        </div>
        <div className="text-xs text-slate-500 truncate">"…{match.snippet}…"</div>
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
        {open ? <ChevronDown size={18} className="text-slate-500 shrink-0" /> : <ChevronRight size={18} className="text-slate-500 shrink-0" />}
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
   MAIN APP
================================================================= */
export default function PensionCalculator() {
  const [tier, setTier] = useState('tier2');

  /* ---------------- Tier 2 state ---------------- */
  const [t2AppointDate, setT2AppointDate] = useState('after2000');
  const [t2RetType, setT2RetType] = useState('service');
  const [t2Years, setT2Years] = useState('20');
  const [t2FAS, setT2FAS] = useState('125000');
  const [t2EarningsAfter20, setT2EarningsAfter20] = useState('0');
  const [t2AppointAge, setT2AppointAge] = useState('25');

  const [t2ShowNonUni, setT2ShowNonUni] = useState(false);
  const [t2NonUniYears, setT2NonUniYears] = useState('0');
  const [t2NonUniAvg, setT2NonUniAvg] = useState('0');

  const [t2ShowEnhanced, setT2ShowEnhanced] = useState(false);
  const [t2WaivedITHP, setT2WaivedITHP] = useState(false);
  const [t2Uses5050, setT2Uses5050] = useState(false);
  const [t2EnhancedMode, setT2EnhancedMode] = useState('lumpsum'); // 'lumpsum' | 'annual'
  const [t2EnhancedAnnual, setT2EnhancedAnnual] = useState('0');
  const [t2ExcessBalance, setT2ExcessBalance] = useState('0');
  const [t2ShortageBalance, setT2ShortageBalance] = useState('0');
  const [t2Factor, setT2Factor] = useState('82');

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
  const [t3Years, setT3Years] = useState('22');
  const [t3FAS, setT3FAS] = useState('125000');
  const [t3SS62, setT3SS62] = useState('0');
  const [t3SSDI, setT3SSDI] = useState('0');
  const [t3ADRHasSSDI, setT3ADRHasSSDI] = useState(false);
  const [t3ShowEarlyVest, setT3ShowEarlyVest] = useState(false);
  const [t3YearsEarly, setT3YearsEarly] = useState('0');

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
  const [defCompBalance, setDefCompBalance] = useState('0');
  const [defCompMode, setDefCompMode] = useState('rate');
  const [defCompRate, setDefCompRate] = useState('4');
  const [defCompFixedMonthly, setDefCompFixedMonthly] = useState('0');

  /* ---------------- Accuracy check against real statement ---------------- */
  const [statementText, setStatementText] = useState('');
  const [extracted, setExtracted] = useState(null);
  const [officialAnnual, setOfficialAnnual] = useState('0');
  const [officialMonthly, setOfficialMonthly] = useState('0');
  const [fileError, setFileError] = useState('');
  const [fileName, setFileName] = useState('');

  /* ---------------- Tier 2 computation ---------------- */
  const t2 = useMemo(() => {
    const years = num(t2Years);
    const fas = num(t2FAS);
    const earningsAfter20 = num(t2EarningsAfter20);
    const nuYears = t2ShowNonUni ? num(t2NonUniYears) : 0;
    const nuAvg = t2ShowNonUni ? num(t2NonUniAvg) : 0;
    const nonUniformBenefit = 0.75 * (1 / 60) * nuAvg * nuYears;

    const isService = t2RetType === 'service';
    const under20Warning = isService && years < 20;

    let base = 0;
    if (isService) {
      base = 0.5 * fas + (1 / 60) * earningsAfter20;
    } else {
      base = (1 / 40) * fas * years;
    }
    const coreAnnual = base + nonUniformBenefit;

    let enhancedAnnual = 0;
    if (t2ShowEnhanced) {
      if (t2EnhancedMode === 'annual') {
        enhancedAnnual = num(t2EnhancedAnnual);
      } else {
        const excess = num(t2ExcessBalance);
        const shortage = num(t2ShortageBalance);
        const factor = num(t2Factor);
        enhancedAnnual = ((excess - shortage) / 1000) * factor;
      }
    }

    const vsfEligible = isService && years >= 20;
    const vsfAnnual = vsfEligible ? 12000 : 0;

    const pensionAnnual = Math.max(0, coreAnnual + enhancedAnnual);
    const totalAnnual = pensionAnnual + vsfAnnual;

    return {
      years, fas, base, nonUniformBenefit, coreAnnual, enhancedAnnual,
      vsfEligible, vsfAnnual, pensionAnnual, totalAnnual, under20Warning, isService,
    };
  }, [
    t2Years, t2FAS, t2EarningsAfter20, t2RetType, t2ShowNonUni, t2NonUniYears, t2NonUniAvg,
    t2ShowEnhanced, t2EnhancedMode, t2EnhancedAnnual, t2ExcessBalance, t2ShortageBalance, t2Factor,
  ]);

  const t2Rate = TIER2_RATE_TABLE.find((r) => r.age === Math.round(num(t2AppointAge))) || TIER2_RATE_TABLE[5];

  /* ---------------- Tier 3 computation ---------------- */
  const t3 = useMemo(() => {
    const years = num(t3Years);
    const fas = num(t3FAS);
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
    } else if (t3RetType === 'early') {
      underMinWarning = years < 20;
      const base20 = 0.021 * fas * 20;
      const monthsBeyond = Math.max(0, (years - 20) * 12);
      const addl = (1 / 300) * fas * monthsBeyond;
      beforeOffset = Math.min(base20 + addl, 0.5 * fas);
      offsetKind = 'age62';
      vsfEligible = years >= 20;
    } else if (t3RetType === 'normal') {
      underMinWarning = years < 22;
      beforeOffset = 0.5 * fas;
      offsetKind = 'age62';
      vsfEligible = true;
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
      years, fas, beforeOffset, afterOffsetAnnual, vsfEligible, vsfAnnual,
      offsetKind, hasAgeSplit, underMinWarning,
      totalBeforeAnnual: beforeOffset + vsfAnnual,
      totalAfterAnnual: afterOffsetAnnual + vsfAnnual,
    };
  }, [t3Years, t3FAS, t3SS62, t3SSDI, t3RetType, t3Plan, t3ADRHasSSDI, t3ShowEarlyVest, t3YearsEarly]);

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
  function handleFileUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setFileError('');
    setFileName(file.name);
    const isTxt = file.type === 'text/plain' || /\.txt$/i.test(file.name);
    if (!isTxt) {
      setFileError(
        "Browsers can't decode a PDF's compressed text on their own here — open your statement, select all the text, copy it, and paste it into the box below instead."
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
    setExtracted(extractFigures(statementText));
  }

  function applyExtracted(key) {
    if (!extracted || !extracted[key]) return;
    const val = extracted[key].value;
    if (key === 'fas') tier === 'tier2' ? setT2FAS(val) : setT3FAS(val);
    if (key === 'years') tier === 'tier2' ? setT2Years(val) : setT3Years(val);
    if (key === 'required') tier === 'tier2' ? setT2RequiredAmount(val) : setT3RequiredAmount(val);
    if (key === 'annual') setOfficialAnnual(val);
    if (key === 'monthly') setOfficialMonthly(val);
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
    early: 'Early Service Retirement',
    normal: 'Normal Service Retirement',
    odr: 'Ordinary Disability Retirement',
    adr: 'Accident Disability Retirement',
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans overflow-x-hidden">
      {/* Letterhead */}
      <header className="bg-slate-900 border-b border-amber-700/40">
        <div className="max-w-4xl mx-auto px-5 py-6">
          <div className="flex items-center gap-3">
            <Shield className="text-amber-500 shrink-0" size={30} strokeWidth={1.5} />
            <div>
              <h1 className="font-serif text-2xl sm:text-3xl text-slate-50 tracking-tight">Pension Ledger</h1>
              <p className="text-xs sm:text-sm text-slate-400 tracking-wide">NYPD Tier 2 &amp; Tier 3 Benefit Estimator</p>
            </div>
          </div>
        </div>
        <div className="h-[3px] bg-gradient-to-r from-amber-700 via-amber-500 to-amber-700" />
      </header>

      <div className="max-w-4xl mx-auto px-5 py-6">
        {/* Disclaimer */}
        <div className="flex gap-3 bg-amber-950/30 border border-amber-800/50 rounded-sm px-4 py-3 mb-6">
          <TriangleAlert className="text-amber-500 shrink-0 mt-0.5" size={18} />
          <p className="text-xs text-amber-200/90 leading-relaxed">
            This is an independent, unofficial estimator built from the Police Pension Fund's published October 2024
            Summary Plan Descriptions. It is not affiliated with the City of New York or NYCPPF, and it cannot
            replicate the exact actuarial factors the Office of the Actuary uses for excess, shortage, and ITHP
            annuity conversions. Treat every figure here as a planning estimate — request your official benefit
            estimate from PPF (212-693-5100 / webCOPS) before making retirement decisions.
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
              <div className="text-xs text-slate-500 mt-0.5">{t.sub}</div>
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
                  <p className="text-xs text-slate-500 mt-1 leading-snug">
                    {t2AppointDate === 'before2000'
                      ? 'Your FAS is the greatest of: final 12 months, average of final 36 months, or average of your best 3 consecutive calendar years.'
                      : 'Your FAS is your pensionable earnings in the final 12 months before retirement.'}
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
                  hint="Twenty years of allowable police service are required for Service Retirement."
                />
                <NumField
                  label="Final Average Salary (FAS)"
                  value={t2FAS}
                  onChange={setT2FAS}
                  hint="Base salary, overtime, night differential, holiday pay, worked vacation, and allowable longevity."
                />
                {t2.isService && t2.years > 20 && (
                  <NumField
                    label="Pensionable earnings after your 20th anniversary"
                    value={t2EarningsAfter20}
                    onChange={setT2EarningsAfter20}
                    hint="Total earnings from your 20th anniversary through your retirement date — credited at 1/60th."
                  />
                )}
              </div>

              {t2.under20Warning && (
                <p className="text-xs text-amber-400 mt-3 flex items-center gap-1.5">
                  <TriangleAlert size={14} /> Service Retirement needs 20+ years — with fewer years this reflects a Vested-style calculation instead.
                </p>
              )}

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
                <span className="block text-[13px] font-medium text-slate-300 mb-2">Add the annuity value to your pension</span>
                <SegGroup
                  value={t2ShowEnhanced ? t2EnhancedMode : 'off'}
                  onChange={(v) => {
                    if (v === 'off') { setT2ShowEnhanced(false); return; }
                    setT2ShowEnhanced(true);
                    setT2EnhancedMode(v);
                  }}
                  options={[
                    { value: 'off', label: "Don't include" },
                    { value: 'lumpsum', label: 'Estimate from ASF balance' },
                    { value: 'annual', label: 'I know my annual annuity figure' },
                  ]}
                />

                {t2ShowEnhanced && t2EnhancedMode === 'lumpsum' && (
                  <div className="grid sm:grid-cols-3 gap-4 mt-3">
                    <NumField label="ASF / ITHP excess balance" value={t2ExcessBalance} onChange={setT2ExcessBalance} />
                    <NumField label="Shortage balance (if any)" value={t2ShortageBalance} onChange={setT2ShortageBalance} />
                    <NumField
                      label="Actuarial factor ($ per $1,000)"
                      prefix=""
                      value={t2Factor}
                      onChange={setT2Factor}
                      hint="PPF's published example uses $81.78/yr per $1,000 for a 45-year-old retiree. This factor rises with age at retirement — ask PPF for yours."
                    />
                  </div>
                )}
                {t2ShowEnhanced && t2EnhancedMode === 'annual' && (
                  <div className="mt-3 max-w-xs">
                    <NumField label="Annual annuity add-on" value={t2EnhancedAnnual} onChange={setT2EnhancedAnnual} hint="From your PPF benefit estimate letter or webCOPS statement." />
                  </div>
                )}
              </div>

              <details className="mt-4">
                <summary className="text-xs text-slate-500 cursor-pointer select-none">Contribution rate by age at appointment (reference)</summary>
                <div className="mt-2 max-h-40 overflow-y-auto border border-slate-800 rounded-sm">
                  <table className="w-full text-xs font-mono">
                    <thead className="text-slate-500 sticky top-0 bg-slate-900">
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
                      label="Required amount in your ASF account"
                      value={t2RequiredAmount}
                      onChange={setT2RequiredAmount}
                      hint="From your PPF benefit estimate or webCOPS statement."
                    />
                    <div>
                      <span className="block text-[13px] font-medium text-slate-300 mb-1">Maximum you can withdraw</span>
                      <div className="font-mono text-amber-400 text-lg">{fmt(t2Withdrawal ? t2Withdrawal.max : 0)}</div>
                      <span className="text-xs text-slate-500">90% of your required amount</span>
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
                    </div>
                  ) : (
                    <div className="mt-4">
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
                          <p className="text-xs text-slate-500 mt-2">
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
                      hint="Shared with the excess/shortage factor above — PPF's example is $81.78/yr per $1,000 for a 45-year-old retiree."
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
                  <p className="text-xs text-slate-500 mt-2 leading-snug">
                    Cash withdrawals are subject to 20% federal withholding, plus a 10% early-withdrawal penalty
                    unless you're over 50 or have 25+ years of uniformed service. A direct IRA rollover avoids both,
                    though the funds stay taxable whenever you eventually withdraw them from the IRA.
                  </p>
                </>
              )}
            </Section>
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
                <p className="text-xs text-slate-500 mt-1 leading-snug">
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
                    { value: 'early', label: 'Early Service' },
                    { value: 'normal', label: 'Normal Service' },
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
                hint="Early Service needs 20+ years; Normal Service needs 22+ years without reduction."
              />
              <NumField
                label="Final Average Salary (FAS)"
                value={t3FAS}
                onChange={setT3FAS}
                hint="Highest 3 consecutive calendar years / 36 months, with a 10% year-over-year cap."
              />
              {(t3RetType === 'vested' || t3RetType === 'early' || t3RetType === 'normal') && (
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
          </Section>

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
                        <p className="text-xs text-slate-500 mt-2">
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
                    hint="Set by PPF's Office of the Actuary using mortality tables and 30-year Treasury rates at your retirement — ask PPF for your exact figure."
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
                <p className="text-xs text-slate-500 mt-2 leading-snug">
                  Cash withdrawals are subject to 20% federal withholding, plus a 10% early-withdrawal penalty unless
                  you're over 50 or have 25+ years of uniformed service. A direct IRA rollover avoids both.
                </p>
              </>
            )}
          </Section>
          </>
        )}

        {/* ============ DEFERRED COMP (shared, visually separated) ============ */}
        <Section title="Deferred Compensation (457 Plan)" badge={tier === 'tier2' ? '04' : '03'} defaultOpen={false}>
          <p className="text-sm text-slate-400 leading-relaxed mb-3">
            The NYC Deferred Compensation Plan is a separate, voluntary defined-contribution account — it is not part
            of your NYPD pension formula and isn't guaranteed for life the way your pension is. It's shown separately
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

        {/* ============ RESULTS ============ */}
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={18} className="text-amber-500" />
            <h2 className="font-serif text-xl text-slate-100">Estimated Benefit</h2>
          </div>

          {tier === 'tier2' ? (
            <div className="border border-amber-700/40 bg-slate-900 rounded-sm p-5">
              <CompositionBar
                segments={[
                  { label: 'Core pension', value: t2.coreAnnual + t2.enhancedAnnual, color: '#f59e0b' },
                  { label: 'VSF', value: t2.vsfAnnual, color: '#10b981' },
                ]}
              />
              <div className="mt-4">
                <LedgerRow
                  label={t2.isService ? '50% of FAS + 1/60th after 20th year' : '1/40 × FAS × years of service'}
                  annual={t2.base}
                  monthly={t2.base / 12}
                />
                {t2ShowNonUni && (
                  <LedgerRow label="Prior non-uniformed service benefit" annual={t2.nonUniformBenefit} monthly={t2.nonUniformBenefit / 12} />
                )}
                {t2ShowEnhanced && (
                  <LedgerRow
                    label="ITHP / 50-50 / excess annuity add-on"
                    annual={t2.enhancedAnnual}
                    monthly={t2.enhancedAnnual / 12}
                    negative={t2.enhancedAnnual < 0}
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
                  sub={t2.vsfEligible ? 'Service retirees only; prorated in your retirement year.' : 'Not payable — Vested retirees do not receive VSF.'}
                  annual={t2.vsfAnnual}
                  monthly={t2.vsfAnnual / 12}
                />
                <LedgerRow label="Pension with VSF (total)" annual={t2.totalAnnual} monthly={t2.totalAnnual / 12} bold />

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
                      label="Your pension after withdrawal"
                      annual={t2Withdrawal.pensionAfterAnnual}
                      monthly={t2Withdrawal.pensionAfterAnnual / 12}
                      bold
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
                          label="Pension after withdrawal — before 62"
                          annual={t3Withdrawal.pensionAfterBeforeAnnual}
                          monthly={t3Withdrawal.pensionAfterBeforeAnnual / 12}
                          bold
                        />
                        <LedgerRow
                          label="Pension after withdrawal — age 62+"
                          annual={t3Withdrawal.pensionAfterAfterAnnual}
                          monthly={t3Withdrawal.pensionAfterAfterAnnual / 12}
                          bold
                        />
                      </>
                    ) : (
                      <LedgerRow
                        label="Pension after withdrawal"
                        annual={t3Withdrawal.pensionAfterAfterAnnual}
                        monthly={t3Withdrawal.pensionAfterAfterAnnual / 12}
                        bold
                      />
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

          <p className="text-xs text-slate-600 mt-4 leading-relaxed">
            Figures exclude future Cost-of-Living Adjustments (Tier 2, from age 55–62) and Escalation (Tier 3, up to
            3%/yr from 25 years of service), both of which increase your benefit over time. Source: NYC Police
            Pension Fund Summary Plan Descriptions, October 2024.
          </p>
        </div>

        {/* ============ ACCURACY CHECK AGAINST REAL STATEMENT ============ */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-3">
            <FileText size={18} className="text-amber-500" />
            <h2 className="font-serif text-xl text-slate-100">Accuracy Check Against Your Statement</h2>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            See how close this estimate lands to your real PPF benefit estimate or annual statement. Browsers can't
            decode a PDF's compressed text without a dedicated library, so this can't open your PDF directly — open
            it yourself, select all the text, copy it, and paste it below. A plain <code className="text-slate-300">.txt</code> export
            can also be uploaded directly.
          </p>

          <div className="border border-slate-800 bg-slate-900/60 rounded-sm p-4 mb-4">
            <span className="block text-[13px] font-medium text-slate-300 mb-2">1. Paste or upload your statement text</span>

            <label className="inline-flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-sm px-4 py-2.5 text-sm text-slate-300 cursor-pointer mb-3">
              <Upload size={16} className="text-amber-500" />
              {fileName ? fileName : 'Upload a .txt file'}
              <input type="file" accept=".txt,text/plain,.pdf" onChange={handleFileUpload} className="hidden" />
            </label>
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
              disabled={!statementText.trim()}
              className="mt-3 bg-amber-500 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-medium text-sm rounded-sm px-4 py-2.5"
            >
              Scan for figures
            </button>

            {extracted && (
              <div className="mt-4 border-t border-slate-800 pt-3">
                <span className="block text-[13px] font-medium text-slate-300 mb-2">Found in your statement — tap Use to fill it in</span>
                <ExtractedRow label="Final Average Salary" match={extracted.fas} onUse={() => applyExtracted('fas')} />
                <ExtractedRow label="Years of service" match={extracted.years} onUse={() => applyExtracted('years')} />
                <ExtractedRow label="Required amount / contributions" match={extracted.required} onUse={() => applyExtracted('required')} />
                <ExtractedRow label="Annual pension" match={extracted.annual} onUse={() => applyExtracted('annual')} />
                <ExtractedRow label="Monthly pension" match={extracted.monthly} onUse={() => applyExtracted('monthly')} />
                <p className="text-xs text-slate-500 mt-2 leading-snug">
                  This is pattern-matching, not real comprehension — always check the quoted snippet actually says
                  what you think before using it.
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

              <p className="text-xs text-slate-500 mt-4 leading-relaxed">
                A gap usually comes from something this calculator doesn't model automatically: an already-applied
                COLA or Escalation increase, a survivor option reduction, a final withdrawal or loan you haven't
                entered above, or an ITHP/50-50/excess annuity value that differs from what's in the ITHP section.
                Open those sections above and compare line by line to close the gap.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
