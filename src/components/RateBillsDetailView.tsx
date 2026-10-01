import React, { useState } from 'react';
import {
  ArrowLeft,
  Receipt,
} from 'lucide-react';
import { FirmSettings, VoucherBill } from '../types';
import { formatINR } from '../utils/storage';
import { RateGroup } from './DailyStockLaborView';
import { BillReceiptModal } from './BillReceiptModal';

interface RateBillsDetailViewProps {
  productName: string;
  ratePer20Kg: number;
  rateGroup: RateGroup;
  sessionLabel: string;
  dateStr: string;
  settings: FirmSettings;
  onBack: () => void;
  onOpenReceipt?: (bill: VoucherBill) => void;
}

export const RateBillsDetailView: React.FC<RateBillsDetailViewProps> = ({
  productName,
  ratePer20Kg,
  rateGroup,
  sessionLabel,
  dateStr,
  settings,
  onBack,
  onOpenReceipt,
}) => {
  // State for showing the bill copy modal when a bill row is clicked
  const [viewingBill, setViewingBill] = useState<VoucherBill | null>(null);

  const bills = rateGroup.billDetails || [];

  // Totals
  const totals = {
    count: bills.length,
    weightKg: rateGroup.weightKg,
    amount: rateGroup.amount,
  };

  return (
    <div className="space-y-3 pb-4 animate-fade-in">
      {/* Top Header Bar with Back Button */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 sm:p-4 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onBack}
              id="back-to-stock-patrak-btn"
              className="p-2 -ml-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 active:scale-95 transition cursor-pointer flex items-center justify-center shrink-0 shadow-2xs border border-slate-200"
              title="પાછા જાઓ (પત્રક)"
              aria-label="પાછા જાઓ"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight leading-tight truncate">
                  {productName}
                </h2>
                <span className="px-2 py-0.5 rounded-lg bg-emerald-700 text-white font-mono font-black text-xs sm:text-sm shadow-2xs">
                  ભાવ: ₹{ratePer20Kg}
                </span>
              </div>
              <p className="text-[11px] sm:text-xs font-bold text-slate-500 mt-0.5 flex items-center gap-1.5">
                <span>{sessionLabel}</span>
                <span>•</span>
                <span>{dateStr}</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Bills List Table: Only [બિલ નં] થી [રકમ (₹)] */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {bills.length === 0 ? (
          <div className="p-8 text-center text-slate-400 space-y-2">
            <Receipt className="w-10 h-10 mx-auto text-slate-300" />
            <p className="font-bold text-sm text-slate-600">
              કોઈ બિલ મળ્યા નથી.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-black">
                  <th className="py-2.5 px-3">બિલ નં</th>
                  <th className="py-2.5 px-3">ગ્રાહકનું નામ</th>
                  <th className="py-2.5 px-3 text-right">વજન (kg)</th>
                  <th className="py-2.5 px-3 text-right">રકમ (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bills.map((bd, idx) => (
                  <tr
                    key={`${bd.billId}-${idx}`}
                    onClick={() => setViewingBill(bd.bill)}
                    className="hover:bg-emerald-50/70 active:bg-emerald-100/80 transition cursor-pointer select-none"
                    title="આ બિલની કોપી જોવા માટે ક્લિક કરો"
                  >
                    <td className="py-2.5 px-3 font-mono font-black text-slate-900 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 border border-slate-200 text-xs">
                        {bd.billNoStr}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-black text-slate-900">
                      <span>{bd.customerName}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                      {bd.weightKg.toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-black text-emerald-800 whitespace-nowrap text-sm sm:text-base">
                      {formatINR(bd.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-900 text-white font-black border-t-2 border-slate-800">
                  <td colSpan={2} className="py-3 px-3 text-emerald-300 font-black text-xs sm:text-sm">
                    કુલ સરવાળો ({totals.count} બિલો)
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-emerald-300 font-black text-xs sm:text-sm whitespace-nowrap">
                    {totals.weightKg.toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-amber-300 font-black text-sm sm:text-base whitespace-nowrap">
                    {formatINR(totals.amount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Bill Copy / Voucher Modal (મોબાઇલમાં બિલ કોપી જોવા માટે) */}
      {viewingBill && (
        <BillReceiptModal
          bill={viewingBill}
          settings={settings}
          onClose={() => setViewingBill(null)}
          onPrint={onOpenReceipt}
        />
      )}
    </div>
  );
};
