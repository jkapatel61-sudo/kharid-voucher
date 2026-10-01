import React, { useState, useMemo } from 'react';
import {
  Scale,
  Sun,
  Sunset,
  Sparkles,
  Calendar,
  Printer,
  Receipt,
} from 'lucide-react';
import { FirmSettings, Product, SessionType, VoucherBill } from '../types';
import {
  formatINR,
  formatDateDDMMYYYY,
  getDecomposedBillItems,
  formatTimeSimple,
} from '../utils/storage';
import { RateBillsDetailView } from './RateBillsDetailView';

export interface RateBillDetail {
  billId: string;
  billNoStr: string;
  customerName: string;
  weightKg: number;
  ratePer20Kg: number;
  amount: number;
  date: string;
  time?: string;
  session?: SessionType;
  bill: VoucherBill;
}

interface DailyStockLaborViewProps {
  bills: VoucherBill[];
  products: Product[];
  settings: FirmSettings;
  currentDate: string;
  startDate?: string;
  endDate?: string;
  onResetDate?: () => void;
  onBack?: () => void;
  onOpenReceipt?: (bill: VoucherBill) => void;
}

export interface RateGroup {
  ratePer20Kg: number;
  weightKg: number;
  weightMan: number;
  amount: number;
  billsCount: number;
  billDetails: RateBillDetail[];
}

interface ProductStockSummary {
  productId: string;
  productName: string;
  totalWeightKg: number;
  totalWeightMan: number;
  totalAmount: number;
  rates: RateGroup[];
  isDiveli: boolean;
}

interface SessionLaborCalc {
  sessionLabel: string;
  sessionCode: 'ALL' | 'M' | 'A';
  billsCount: number;
  totalWeightKg: number;
  totalWeightMan: number;
  totalAmount: number;
  diveliWeightKg: number;
  diveliWeightMan: number;
  diveliLaborRate: number; // 1.00
  diveliLaborAmount: number;
  otherWeightKg: number;
  otherWeightMan: number;
  otherLaborRate: number; // 0.80
  otherLaborAmount: number;
  totalLaborAmount: number;
  productSummaries: ProductStockSummary[];
}

// Check if a commodity name refers to Diveli / Castor seeds
export function isDiveliProduct(name: string): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  return (
    n.includes('દિવેલી') ||
    n.includes('દિવેલા') ||
    n.includes('એરંડા') ||
    n.includes('diveli') ||
    n.includes('eranda')
  );
}

export const DailyStockLaborView: React.FC<DailyStockLaborViewProps> = ({
  bills,
  products,
  settings,
  currentDate,
  startDate,
  endDate,
  onResetDate,
  onBack,
  onOpenReceipt,
}) => {
  const [activeSessionTab, setActiveSessionTab] = useState<'ALL' | 'M' | 'A'>('ALL');
  const [selectedRatePage, setSelectedRatePage] = useState<{
    productName: string;
    ratePer20Kg: number;
  } | null>(null);

  // Effective Date Range (from parent props if provided, or fallback)
  const effectiveStart = startDate || currentDate;
  const effectiveEnd = endDate || currentDate;

  // Normalize min/max and determine if filtered to a non-today date
  const { minDate, maxDate, isFilteredDate } = useMemo(() => {
    const s = effectiveStart;
    const e = effectiveEnd;
    const min = s <= e ? s : e;
    const max = s <= e ? e : s;
    const isFiltered = min !== currentDate || max !== currentDate;
    return { minDate: min, maxDate: max, isFilteredDate: isFiltered };
  }, [effectiveStart, effectiveEnd, currentDate]);

  const handleResetToToday = () => {
    if (onResetDate) {
      onResetDate();
    }
  };

  // Filter bills for selected date range directly
  const dateBills = useMemo(() => {
    return bills.filter((b) => {
      const bDate = b.date || '';
      return bDate >= minDate && bDate <= maxDate;
    });
  }, [bills, minDate, maxDate]);

  // Helper to calculate stock & labor for a given subset of bills
  const calculateSessionMetrics = (
    subBills: VoucherBill[],
    code: 'ALL' | 'M' | 'A',
    label: string
  ): SessionLaborCalc => {
    let totalWeightKg = 0;
    let totalAmount = 0;
    let diveliWeightKg = 0;
    let otherWeightKg = 0;

    // Map: productName -> Map of ratePer20Kg -> { weightKg, amount, billsCount, billDetails }
    const productMap = new Map<
      string,
      {
        productId: string;
        productName: string;
        isDiveli: boolean;
        ratesMap: Map<
          number,
          { weightKg: number; amount: number; billsCount: number; billDetails: RateBillDetail[] }
        >;
      }
    >();

    subBills.forEach((bill) => {
      // Decompose items so multi-item bills record weights separately (e.g. Wheat & Bajri)
      const items = getDecomposedBillItems(bill);

      items.forEach((item) => {
        const pName = (item.productName || 'અન્ય').trim();
        const wKg = Number(item.weightKg) || 0;
        const rate = Number(item.ratePer20Kg) || 0;
        const amt = item.amount || (wKg / 20) * rate;
        const isDiv = isDiveliProduct(pName);

        totalWeightKg += wKg;
        totalAmount += amt;

        if (isDiv) {
          diveliWeightKg += wKg;
        } else {
          otherWeightKg += wKg;
        }

        if (!productMap.has(pName)) {
          productMap.set(pName, {
            productId: item.productId || `p_${pName}`,
            productName: pName,
            isDiveli: isDiv,
            ratesMap: new Map(),
          });
        }

        const pEntry = productMap.get(pName)!;
        const rEntry = pEntry.ratesMap.get(rate) || {
          weightKg: 0,
          amount: 0,
          billsCount: 0,
          billDetails: [],
        };
        rEntry.weightKg += wKg;
        rEntry.amount += amt;
        rEntry.billsCount += 1;
        rEntry.billDetails.push({
          billId: bill.id,
          billNoStr: bill.billNoStr || `${bill.session || 'M'}${bill.billNo}`,
          customerName: bill.customerName || 'સામાન્ય ગ્રાહક',
          weightKg: wKg,
          ratePer20Kg: rate,
          amount: amt,
          date: bill.date,
          time: bill.time,
          session: bill.session,
          bill,
        });
        pEntry.ratesMap.set(rate, rEntry);
      });
    });

    const totalWeightMan = totalWeightKg / 20;
    const diveliWeightMan = diveliWeightKg / 20;
    const otherWeightMan = otherWeightKg / 20;

    // Labor Rates:
    // દિવેલી = ₹1.00 પ્રતિ મણ
    // દિવેલી સિવાયનો તમામ માલ = ₹0.80 (80 પૈસા) પ્રતિ મણ
    const diveliLaborRate = 1.0;
    const otherLaborRate = 0.8;

    const diveliLaborAmount = diveliWeightMan * diveliLaborRate;
    const otherLaborAmount = otherWeightMan * otherLaborRate;
    const totalLaborAmount = diveliLaborAmount + otherLaborAmount;

    // Convert products map to sorted array
    const productSummaries: ProductStockSummary[] = [];
    productMap.forEach((entry) => {
      let pTotalKg = 0;
      let pTotalAmt = 0;
      const rates: RateGroup[] = [];

      entry.ratesMap.forEach((rVal, rateKey) => {
        pTotalKg += rVal.weightKg;
        pTotalAmt += rVal.amount;
        rates.push({
          ratePer20Kg: rateKey,
          weightKg: rVal.weightKg,
          weightMan: rVal.weightKg / 20,
          amount: rVal.amount,
          billsCount: rVal.billsCount,
          billDetails: rVal.billDetails,
        });
      });

      // Sort rates ascending or descending (higher rate first)
      rates.sort((a, b) => b.ratePer20Kg - a.ratePer20Kg);

      productSummaries.push({
        productId: entry.productId,
        productName: entry.productName,
        totalWeightKg: pTotalKg,
        totalWeightMan: pTotalKg / 20,
        totalAmount: pTotalAmt,
        rates,
        isDiveli: entry.isDiveli,
      });
    });

    // Sort products: બાજરી, ઘઉં, રાયડો, દિવેલી, રાજગરો, others
    const sortPriority = ['બાજરી', 'ઘઉં', 'જૂની બાજરી', 'રાયડો', 'દિવેલી', 'રાજગરો'];
    productSummaries.sort((a, b) => {
      const idxA = sortPriority.indexOf(a.productName);
      const idxB = sortPriority.indexOf(b.productName);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.productName.localeCompare(b.productName, 'gu');
    });

    return {
      sessionLabel: label,
      sessionCode: code,
      billsCount: subBills.length,
      totalWeightKg,
      totalWeightMan,
      totalAmount,
      diveliWeightKg,
      diveliWeightMan,
      diveliLaborRate,
      diveliLaborAmount,
      otherWeightKg,
      otherWeightMan,
      otherLaborRate,
      otherLaborAmount,
      totalLaborAmount,
      productSummaries,
    };
  };

  // Full Day Metrics
  const allDayMetrics = useMemo(
    () => calculateSessionMetrics(dateBills, 'ALL', 'આખો દિવસ (કુલ)'),
    [dateBills]
  );

  // Morning Session (M) Metrics
  const morningMetrics = useMemo(() => {
    const mBills = dateBills.filter((b) => b.session === 'M');
    return calculateSessionMetrics(mBills, 'M', 'સવાર સત્ર (M)');
  }, [dateBills]);

  // Afternoon Session (A) Metrics
  const afternoonMetrics = useMemo(() => {
    const aBills = dateBills.filter((b) => b.session === 'A');
    return calculateSessionMetrics(aBills, 'A', 'બપોર સત્ર (A)');
  }, [dateBills]);

  // Currently active selected metrics
  const activeMetrics = useMemo(() => {
    if (activeSessionTab === 'M') return morningMetrics;
    if (activeSessionTab === 'A') return afternoonMetrics;
    return allDayMetrics;
  }, [activeSessionTab, allDayMetrics, morningMetrics, afternoonMetrics]);

  // Format labor amount for session badges (e.g. 56.7 -> ₹56.7, 0 -> ₹0)
  const formatLaborBadge = (amt: number): string => {
    if (!amt || amt === 0) return '₹0';
    const rounded = Math.round(amt * 10) / 10;
    return `₹${rounded.toLocaleString('en-IN', { minimumFractionDigits: rounded % 1 === 0 ? 0 : 1, maximumFractionDigits: 1 })}`;
  };

  // Dedicated Full Page for a specific rate's bills
  if (selectedRatePage) {
    const product = activeMetrics.productSummaries.find(
      (p) => p.productName === selectedRatePage.productName
    );
    const rateGroup = product?.rates.find(
      (r) => r.ratePer20Kg === selectedRatePage.ratePer20Kg
    );

    if (rateGroup) {
      return (
        <RateBillsDetailView
          productName={selectedRatePage.productName}
          ratePer20Kg={selectedRatePage.ratePer20Kg}
          rateGroup={rateGroup}
          sessionLabel={activeMetrics.sessionLabel}
          dateStr={
            minDate === maxDate
              ? formatDateDDMMYYYY(minDate)
              : `${formatDateDDMMYYYY(minDate)} થી ${formatDateDDMMYYYY(maxDate)}`
          }
          settings={settings}
          onBack={() => setSelectedRatePage(null)}
          onOpenReceipt={onOpenReceipt}
        />
      );
    }
  }

  return (
    <div className="space-y-3 pb-2 animate-fade-in">
      {/* Top 3 Session Tabs: All Day, Morning, Afternoon with Labor amounts */}
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2 bg-slate-200/80 p-1.5 rounded-2xl border border-slate-300/80 shadow-2xs">
        {/* Tab 1: All Day */}
        <button
          type="button"
          onClick={() => setActiveSessionTab('ALL')}
          id="tab-labor-all-day"
          className={`py-2.5 px-2 rounded-xl text-center transition cursor-pointer active:scale-98 ${
            activeSessionTab === 'ALL'
              ? 'bg-emerald-800 text-white shadow-md'
              : 'bg-white/80 hover:bg-white text-slate-700'
          }`}
        >
          <div className="flex items-center justify-center gap-1.5">
            <Sparkles className={`w-4 h-4 ${activeSessionTab === 'ALL' ? 'text-amber-300' : 'text-slate-500'}`} />
            <span className="font-black text-xs sm:text-sm">આખો દિવસ</span>
          </div>
          <span className={`text-[11px] block mt-0.5 font-bold font-mono ${activeSessionTab === 'ALL' ? 'text-emerald-200' : 'text-slate-500'}`}>
            {formatLaborBadge(allDayMetrics.totalLaborAmount)}
          </span>
        </button>

        {/* Tab 2: Morning */}
        <button
          type="button"
          onClick={() => setActiveSessionTab('M')}
          id="tab-labor-morning"
          className={`py-2.5 px-2 rounded-xl text-center transition cursor-pointer active:scale-98 ${
            activeSessionTab === 'M'
              ? 'bg-emerald-800 text-white shadow-md'
              : 'bg-white/80 hover:bg-white text-slate-700'
          }`}
        >
          <div className="flex items-center justify-center gap-1.5">
            <Sun className={`w-4 h-4 ${activeSessionTab === 'M' ? 'text-amber-300' : 'text-amber-500'}`} />
            <span className="font-black text-xs sm:text-sm">સવાર સત્ર</span>
          </div>
          <span className={`text-[11px] block mt-0.5 font-bold font-mono ${activeSessionTab === 'M' ? 'text-emerald-200' : 'text-slate-500'}`}>
            {formatLaborBadge(morningMetrics.totalLaborAmount)}
          </span>
        </button>

        {/* Tab 3: Afternoon */}
        <button
          type="button"
          onClick={() => setActiveSessionTab('A')}
          id="tab-labor-afternoon"
          className={`py-2.5 px-2 rounded-xl text-center transition cursor-pointer active:scale-98 ${
            activeSessionTab === 'A'
              ? 'bg-emerald-800 text-white shadow-md'
              : 'bg-white/80 hover:bg-white text-slate-700'
          }`}
        >
          <div className="flex items-center justify-center gap-1.5">
            <Sunset className={`w-4 h-4 ${activeSessionTab === 'A' ? 'text-amber-300' : 'text-orange-500'}`} />
            <span className="font-black text-xs sm:text-sm">બપોર સત્ર</span>
          </div>
          <span className={`text-[11px] block mt-0.5 font-bold font-mono ${activeSessionTab === 'A' ? 'text-emerald-200' : 'text-slate-500'}`}>
            {formatLaborBadge(afternoonMetrics.totalLaborAmount)}
          </span>
        </button>
      </div>

      {/* Active Date Indicator (shown when non-today date or date range is selected) */}
      {isFilteredDate && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-2 flex items-center justify-between text-xs font-bold text-amber-900 shadow-2xs">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              તારીખ: {formatDateDDMMYYYY(minDate)}
              {minDate !== maxDate ? ` થી ${formatDateDDMMYYYY(maxDate)}` : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={handleResetToToday}
            className="text-[11px] font-black text-amber-800 bg-amber-200/80 hover:bg-amber-300 px-2.5 py-1 rounded-lg transition cursor-pointer active:scale-95 shadow-2xs"
          >
            આજની તારીખ પર પાછા જાઓ
          </button>
        </div>
      )}

      {/* Quick Stat Summary Cards */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div className="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200 shadow-xs">
          <span className="text-[11px] sm:text-xs font-bold text-slate-500 block">
            કુલ માલ વજન
          </span>
          <p className="text-base sm:text-xl font-black font-mono text-slate-900 mt-0.5">
            {activeMetrics.totalWeightKg.toLocaleString('en-IN', { maximumFractionDigits: 1 })}{' '}
            <span className="text-xs font-bold text-slate-500">kg</span>
          </p>
        </div>

        <div className="bg-emerald-800 text-white rounded-2xl p-3 sm:p-4 border border-emerald-900 shadow-xs">
          <span className="text-[11px] sm:text-xs font-bold text-emerald-200 block">
            કુલ ખરીદી રકમ
          </span>
          <p className="text-base sm:text-xl font-black font-mono text-amber-300 mt-0.5">
            {formatINR(activeMetrics.totalAmount)}
          </p>
        </div>
      </div>

      {/* COMMODITY STOCK & RATE-WISE BREAKDOWN - SINGLE UNIFIED CLEAN TABLE */}
      <div className="space-y-3">
        {activeMetrics.productSummaries.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center border border-slate-200 text-slate-400 space-y-2">
            <Scale className="w-10 h-10 mx-auto text-slate-300" />
            <p className="font-bold text-sm text-slate-600">
              આ સત્રમાં કોઈ માલ ખરીદાયો નથી.
            </p>
            <p className="text-xs text-slate-400">
              નવા બિલો બનશે એટલે તેની વિગત આપોઆપ અહીં ઉમેરાશે.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <table className="w-full text-left text-xs sm:text-sm border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-black">
                  <th className="py-2.5 px-3">માલ</th>
                  <th className="py-2.5 px-2 text-center">ભાવ (૨૦kg)</th>
                  <th className="py-2.5 px-2 text-right">વજન (કિલો)</th>
                  <th className="py-2.5 px-3 text-right">રકમ (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeMetrics.productSummaries.map((product) => {
                  const hasMultipleRates = product.rates.length > 1;

                  return (
                    <React.Fragment key={product.productName}>
                      {product.rates.map((rate, rIdx) => (
                        <tr
                          key={`${product.productName}-${rate.ratePer20Kg}-${rIdx}`}
                          onClick={() =>
                            setSelectedRatePage({
                              productName: product.productName,
                              ratePer20Kg: rate.ratePer20Kg,
                            })
                          }
                          className="hover:bg-emerald-50/60 active:bg-emerald-100/70 transition cursor-pointer select-none"
                          title="આ ભાવના બિલોનું નવું પેજ ખોલવા માટે ક્લિક કરો"
                        >
                          <td className="py-2.5 px-3 font-black text-slate-900">
                            <span>{product.productName}</span>
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRatePage({
                                  productName: product.productName,
                                  ratePer20Kg: rate.ratePer20Kg,
                                });
                              }}
                              className="inline-block px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 font-mono font-black text-xs transition shadow-2xs active:scale-95 cursor-pointer"
                              title="આ ભાવના તમામ બિલો જોવા માટે ક્લિક કરો"
                            >
                              ₹{rate.ratePer20Kg}
                            </button>
                          </td>
                          <td className="py-2.5 px-2 text-right font-bold text-slate-800 font-mono whitespace-nowrap">
                            {rate.weightKg.toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-black text-emerald-800 whitespace-nowrap">
                            {formatINR(rate.amount)}
                          </td>
                        </tr>
                      ))}

                      {/* Subtotal row if product has multiple rates */}
                      {hasMultipleRates && (
                        <tr className="bg-emerald-50/60 font-black text-slate-900 border-b border-slate-200">
                          <td className="py-2 px-3 text-emerald-950 font-black text-[11px] sm:text-xs">
                            ↳ કુલ {product.productName}
                          </td>
                          <td className="py-2 px-2 text-center text-slate-400 text-xs">-</td>
                          <td className="py-2 px-2 text-right font-mono font-black text-slate-900 text-[11px] sm:text-xs whitespace-nowrap">
                            {product.totalWeightKg.toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-black text-emerald-900 text-[11px] sm:text-xs whitespace-nowrap">
                            {formatINR(product.totalAmount)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-900 text-white font-black border-t-2 border-slate-800">
                  <td className="py-3 px-3 text-emerald-300 font-black text-xs sm:text-sm">
                    કુલ માલ સરવાળો
                  </td>
                  <td className="py-3 px-2 text-center text-slate-500 font-mono text-xs">-</td>
                  <td className="py-3 px-2 text-right font-mono text-emerald-300 font-black text-xs sm:text-sm whitespace-nowrap">
                    {activeMetrics.totalWeightKg.toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-amber-300 font-black text-sm sm:text-base whitespace-nowrap">
                    {formatINR(activeMetrics.totalAmount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};
