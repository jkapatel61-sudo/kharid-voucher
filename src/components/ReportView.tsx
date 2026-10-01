import React, { useState, useMemo } from 'react';
import {
  Calendar,
  Scale,
  Sun,
  Sunset,
  Sparkles,
  Search,
  X,
  FileSpreadsheet,
  FileText,
  Printer,
  ArrowLeft,
} from 'lucide-react';
import { FirmSettings, Product, SessionType, VoucherBill } from '../types';
import {
  formatINR,
  formatDateDDMMYYYY,
  getDecomposedBillItems,
} from '../utils/storage';
import { isDiveliProduct } from './DailyStockLaborView';

interface ReportViewProps {
  bills: VoucherBill[];
  products: Product[];
  settings: FirmSettings;
  currentDate: string;
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onOpenDatePicker?: () => void;
  onBack?: () => void;
  onOpenReceipt: (bill: VoucherBill) => void;
}

interface RateGroup {
  ratePer20Kg: number;
  weightKg: number;
  amount: number;
  billsCount: number;
}

interface ProductStockSummary {
  productId: string;
  productName: string;
  totalWeightKg: number;
  totalAmount: number;
  rates: RateGroup[];
  isDiveli: boolean;
}

interface SessionLaborCalc {
  billsCount: number;
  totalWeightKg: number;
  totalAmount: number;
  totalLaborAmount: number;
  productSummaries: ProductStockSummary[];
}

export const ReportView: React.FC<ReportViewProps> = ({
  bills,
  products,
  settings,
  currentDate,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onOpenDatePicker,
  onBack,
  onOpenReceipt,
}) => {
  const [activeSessionTab, setActiveSessionTab] = useState<'ALL' | 'M' | 'A'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Determine normalized min and max dates
  const { minDate, maxDate } = useMemo(() => {
    const s = startDate || currentDate;
    const e = endDate || currentDate;
    return s <= e ? { minDate: s, maxDate: e } : { minDate: e, maxDate: s };
  }, [startDate, endDate, currentDate]);

  // Bills strictly within the date-to-date range
  const inRangeBills = useMemo(() => {
    return bills.filter((b) => {
      const bDate = b.date || '';
      return bDate >= minDate && bDate <= maxDate;
    });
  }, [bills, minDate, maxDate]);

  // Helper to calculate stock & labor for a given subset of bills (exact match to Photo 2)
  const calculateSessionMetrics = (subBills: VoucherBill[]): SessionLaborCalc => {
    let totalWeightKg = 0;
    let totalAmount = 0;
    let diveliWeightKg = 0;
    let otherWeightKg = 0;

    const productMap = new Map<
      string,
      {
        productId: string;
        productName: string;
        isDiveli: boolean;
        ratesMap: Map<number, { weightKg: number; amount: number; billsCount: number }>;
      }
    >();

    subBills.forEach((bill) => {
      // Decompose items so multi-item bills record weights separately
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
        };
        rEntry.weightKg += wKg;
        rEntry.amount += amt;
        rEntry.billsCount += 1;
        pEntry.ratesMap.set(rate, rEntry);
      });
    });

    // Labor Calculation according to AGENTS.md rules:
    // Castor / Diveli: (weightKg / 20) * 1.00
    // Other commodities: (weightKg / 20) * 0.80
    const diveliMan = diveliWeightKg / 20;
    const otherMan = otherWeightKg / 20;
    const diveliLaborAmount = diveliMan * 1.0;
    const otherLaborAmount = otherMan * 0.8;
    const totalLaborAmount = diveliLaborAmount + otherLaborAmount;

    // Build sorted product summaries list
    const productSummaries: ProductStockSummary[] = Array.from(productMap.values()).map(
      (entry) => {
        let pTotalWeightKg = 0;
        let pTotalAmount = 0;

        const rates: RateGroup[] = Array.from(entry.ratesMap.entries())
          .map(([ratePer20Kg, data]) => {
            pTotalWeightKg += data.weightKg;
            pTotalAmount += data.amount;
            return {
              ratePer20Kg,
              weightKg: data.weightKg,
              amount: data.amount,
              billsCount: data.billsCount,
            };
          })
          .sort((a, b) => b.ratePer20Kg - a.ratePer20Kg);

        return {
          productId: entry.productId,
          productName: entry.productName,
          totalWeightKg: pTotalWeightKg,
          totalAmount: pTotalAmount,
          rates,
          isDiveli: entry.isDiveli,
        };
      }
    );

    // Sort products by total weight descending
    productSummaries.sort((a, b) => b.totalWeightKg - a.totalWeightKg);

    return {
      billsCount: subBills.length,
      totalWeightKg,
      totalAmount,
      totalLaborAmount,
      productSummaries,
    };
  };

  // Metrics for all 3 tabs
  const allDayMetrics = useMemo(() => {
    return calculateSessionMetrics(inRangeBills);
  }, [inRangeBills]);

  const morningMetrics = useMemo(() => {
    return calculateSessionMetrics(inRangeBills.filter((b) => (b.session || 'M') === 'M'));
  }, [inRangeBills]);

  const afternoonMetrics = useMemo(() => {
    return calculateSessionMetrics(inRangeBills.filter((b) => b.session === 'A'));
  }, [inRangeBills]);

  // Active metrics based on selected tab
  const activeMetrics = useMemo(() => {
    if (activeSessionTab === 'M') return morningMetrics;
    if (activeSessionTab === 'A') return afternoonMetrics;
    return allDayMetrics;
  }, [activeSessionTab, allDayMetrics, morningMetrics, afternoonMetrics]);

  // Format labor amount for session badges (e.g. 56.7 -> ₹56.7, 0 -> ₹0)
  const formatLaborBadge = (amt: number): string => {
    if (!amt || amt === 0) return '₹0';
    const rounded = Math.round(amt * 10) / 10;
    return `₹${rounded.toLocaleString('en-IN', {
      minimumFractionDigits: rounded % 1 === 0 ? 0 : 1,
      maximumFractionDigits: 1,
    })}`;
  };

  // Bills list filtered by active session and search query
  const sessionBills = useMemo(() => {
    if (activeSessionTab === 'ALL') return inRangeBills;
    return inRangeBills.filter((b) => (b.session || 'M') === activeSessionTab);
  }, [inRangeBills, activeSessionTab]);

  const filteredBills = useMemo(() => {
    if (!searchQuery.trim()) return sessionBills;
    const q = searchQuery.toLowerCase().trim();
    return sessionBills.filter((bill) => {
      const matchCustomer = bill.customerName?.toLowerCase().includes(q);
      const matchBillNo =
        bill.billNoStr?.toLowerCase().includes(q) ||
        bill.billNo?.toString().includes(q);
      const matchItem = bill.items?.some((it) =>
        it.productName?.toLowerCase().includes(q)
      );
      return matchCustomer || matchBillNo || matchItem;
    });
  }, [sessionBills, searchQuery]);

  const dateLabel = useMemo(() => {
    if (minDate === maxDate) {
      return formatDateDDMMYYYY(minDate);
    }
    return `${formatDateDDMMYYYY(minDate)} થી ${formatDateDDMMYYYY(maxDate)}`;
  }, [minDate, maxDate]);

  return (
    <div className="space-y-3 sm:space-y-4 pb-16 animate-fade-in print:p-0 print:space-y-3">
      {/* Print Only Header */}
      <div className="hidden print:block text-center pb-3 border-b-2 border-slate-800">
        <h1 className="text-xl font-black">{settings.firmName}</h1>
        <p className="text-sm font-bold text-slate-700">
          રિપોર્ટ - તારીખ: {dateLabel}
        </p>
      </div>

      {/* Top Bar: Back Symbol (No text) + 3 Session Tabs: આખો દિવસ (કુલ), સવાર સત્ર (M), બપોર સત્ર (A) with Labor amounts */}
      <div className="flex items-center gap-2 print:hidden">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            id="report-back-to-bill-btn"
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white transition flex items-center justify-center shrink-0 active:scale-95 cursor-pointer shadow-xs"
            title="નવું બિલ"
            aria-label="નવું બિલ"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
          </button>
        )}

        <div className="flex-1 grid grid-cols-3 gap-1.5 sm:gap-2 bg-slate-200/80 p-1.5 rounded-2xl border border-slate-300/80">
          {/* Tab 1: All Day */}
          <button
            type="button"
            onClick={() => setActiveSessionTab('ALL')}
            id="tab-report-all-day"
            className={`py-2 px-1.5 sm:py-2.5 sm:px-2 rounded-xl text-center transition cursor-pointer active:scale-98 ${
              activeSessionTab === 'ALL'
                ? 'bg-emerald-800 text-white shadow-md'
                : 'bg-white/80 hover:bg-white text-slate-700'
            }`}
          >
            <div className="flex items-center justify-center gap-1 sm:gap-1.5">
              <Sparkles
                className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${
                  activeSessionTab === 'ALL' ? 'text-amber-300' : 'text-slate-500'
                }`}
              />
              <span className="font-black text-xs sm:text-sm">આખો દિવસ</span>
            </div>
            <span
              className={`text-[11px] block mt-0.5 font-bold font-mono ${
                activeSessionTab === 'ALL' ? 'text-emerald-200' : 'text-slate-500'
              }`}
            >
              {formatLaborBadge(allDayMetrics.totalLaborAmount)}
            </span>
          </button>

          {/* Tab 2: Morning */}
          <button
            type="button"
            onClick={() => setActiveSessionTab('M')}
            id="tab-report-morning"
            className={`py-2 px-1.5 sm:py-2.5 sm:px-2 rounded-xl text-center transition cursor-pointer active:scale-98 ${
              activeSessionTab === 'M'
                ? 'bg-emerald-800 text-white shadow-md'
                : 'bg-white/80 hover:bg-white text-slate-700'
            }`}
          >
            <div className="flex items-center justify-center gap-1 sm:gap-1.5">
              <Sun
                className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${
                  activeSessionTab === 'M' ? 'text-amber-300' : 'text-amber-500'
                }`}
              />
              <span className="font-black text-xs sm:text-sm">સવાર સત્ર</span>
            </div>
            <span
              className={`text-[11px] block mt-0.5 font-bold font-mono ${
                activeSessionTab === 'M' ? 'text-emerald-200' : 'text-slate-500'
              }`}
            >
              {formatLaborBadge(morningMetrics.totalLaborAmount)}
            </span>
          </button>

          {/* Tab 3: Afternoon */}
          <button
            type="button"
            onClick={() => setActiveSessionTab('A')}
            id="tab-report-afternoon"
            className={`py-2 px-1.5 sm:py-2.5 sm:px-2 rounded-xl text-center transition cursor-pointer active:scale-98 ${
              activeSessionTab === 'A'
                ? 'bg-emerald-800 text-white shadow-md'
                : 'bg-white/80 hover:bg-white text-slate-700'
            }`}
          >
            <div className="flex items-center justify-center gap-1 sm:gap-1.5">
              <Sunset
                className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${
                  activeSessionTab === 'A' ? 'text-amber-300' : 'text-orange-500'
                }`}
              />
              <span className="font-black text-xs sm:text-sm">બપોર સત્ર</span>
            </div>
            <span
              className={`text-[11px] block mt-0.5 font-bold font-mono ${
                activeSessionTab === 'A' ? 'text-emerald-200' : 'text-slate-500'
              }`}
            >
              {formatLaborBadge(afternoonMetrics.totalLaborAmount)}
            </span>
          </button>
        </div>
      </div>

      {/* Single Unified Commodity & Rate-wise Breakdown Table (Screenshot 2) */}
      <div className="space-y-3">
        {activeMetrics.productSummaries.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center border border-slate-200 text-slate-400 space-y-2">
            <Scale className="w-10 h-10 mx-auto text-slate-300" />
            <p className="font-bold text-sm text-slate-600">
              આ તારીખ ગાળા / સત્રમાં કોઈ માલ ખરીદાયો નથી.
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
                          className="hover:bg-slate-50/80 transition"
                        >
                          <td className="py-2.5 px-3 font-black text-slate-900">
                            <span>{product.productName}</span>
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            <span className="inline-block px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 border border-slate-300 font-mono font-black text-xs">
                              ₹{rate.ratePer20Kg}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 text-right font-bold text-slate-800 font-mono whitespace-nowrap">
                            {rate.weightKg.toLocaleString('en-IN', {
                              maximumFractionDigits: 1,
                            })}{' '}
                            kg
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                            {formatINR(rate.amount)}
                          </td>
                        </tr>
                      ))}

                      {/* Subtotal row if product has multiple rates (e.g. ↳ કુલ બાજરી) */}
                      {hasMultipleRates && (
                        <tr className="bg-slate-100/70 font-black text-slate-900 border-b border-slate-200">
                          <td className="py-2 px-3 text-slate-900 font-black text-[11px] sm:text-xs">
                            ↳ કુલ {product.productName}
                          </td>
                          <td className="py-2 px-2 text-center text-slate-400 text-xs">-</td>
                          <td className="py-2 px-2 text-right font-mono font-black text-slate-900 text-[11px] sm:text-xs whitespace-nowrap">
                            {product.totalWeightKg.toLocaleString('en-IN', {
                              maximumFractionDigits: 1,
                            })}{' '}
                            kg
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-black text-slate-900 text-[11px] sm:text-xs whitespace-nowrap">
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
                  <td className="py-3 px-3 text-slate-100 font-black text-xs sm:text-sm">
                    કુલ માલ સરવાળો
                  </td>
                  <td className="py-3 px-2 text-center text-slate-400 font-mono text-xs">-</td>
                  <td className="py-3 px-2 text-right font-mono text-white font-black text-xs sm:text-sm whitespace-nowrap">
                    {activeMetrics.totalWeightKg.toLocaleString('en-IN', {
                      maximumFractionDigits: 1,
                    })}{' '}
                    kg
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-white font-black text-sm sm:text-base whitespace-nowrap">
                    {formatINR(activeMetrics.totalAmount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* PART 2: BILLS LIST SHOWN LIKE HISTORY (નીચે બિલો હિસ્ટ્રી ની જેમ બતાવો) */}
      <div className="space-y-2 pt-2">
        {/* Header with Search and Count */}
        <div className="bg-white rounded-xl p-2.5 shadow-2xs border border-slate-200 flex items-center justify-between gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              data-form-type="other"
              data-lpignore="true"
              placeholder="ગ્રાહકનું નામ અથવા બિલ નં. શોધો..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 focus:bg-white transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <span className="text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-lg shrink-0">
            {filteredBills.length} બિલો
          </span>
        </div>

        {/* Bills list rendered exactly as History Cards */}
        <div className="space-y-1.5">
          {filteredBills.length === 0 ? (
            <div className="bg-white rounded-xl p-8 text-center border border-dashed border-slate-300">
              <FileText className="w-8 h-8 text-slate-300 mx-auto mb-1.5" />
              <p className="text-xs font-bold text-slate-600">
                આ ફિલ્ટર મુજબ કોઈ બિલ મળ્યું નથી
              </p>
            </div>
          ) : (
            filteredBills.map((bill) => {
              return (
                <div
                  key={bill.id}
                  className="bg-white rounded-xl px-3 py-2 border border-slate-200 shadow-2xs hover:border-emerald-500 transition flex items-center justify-between gap-2"
                >
                  {/* Left side: Bill #, Customer Name, Date/Time & Items */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded-md bg-slate-900 text-white font-mono font-black text-[11px] shrink-0">
                        {bill.billNoStr || `${bill.session || 'M'}${bill.billNo}`}
                      </span>

                      <span className="font-black text-xs sm:text-sm text-slate-900 truncate">
                        {bill.customerName || 'સામાન્ય ગ્રાહક'}
                      </span>

                      {/* Date & Time pill */}
                      <span className="text-[10px] text-slate-500 font-semibold bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <span>{formatDateDDMMYYYY(bill.date || '')}</span>
                        {bill.time && (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="text-slate-600 font-mono">{bill.time}</span>
                          </>
                        )}
                      </span>
                    </div>

                    {/* Items row */}
                    <div className="text-[11px] text-slate-600 truncate mt-0.5 font-medium flex items-center gap-1.5 flex-wrap">
                      {bill.items && bill.items.length > 0 ? (
                        bill.items.map((it, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1">
                            <span className="font-semibold text-slate-800">
                              {it.productName}
                            </span>
                            <span className="font-mono text-slate-800 font-bold">
                              {it.weightKg} kg
                            </span>
                            <span className="text-slate-400 text-[10px]">
                              ({it.ratePer20Kg})
                            </span>
                            {idx < (bill.items?.length || 0) - 1 && (
                              <span className="text-slate-300 mx-0.5">|</span>
                            )}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-500">{bill.productName || '-'}</span>
                      )}
                    </div>
                  </div>

                  {/* Right side: Amount & Slip Button */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs sm:text-sm font-black text-slate-900 font-mono">
                      {formatINR(bill.finalTotal)}
                    </span>

                    <button
                      type="button"
                      onClick={() => onOpenReceipt(bill)}
                      id={`report-view-print-${bill.id}`}
                      className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1 shadow-2xs transition active:scale-95 cursor-pointer"
                      title="સીધી પ્રિન્ટ કરો"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span className="text-[11px] font-bold">પ્રિન્ટ</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
