import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { FirmSettings, VoucherBill } from '../types';
import {
  formatINR,
  formatDateDDMM,
  formatTimeSimple,
  getDecomposedBillItems,
} from '../utils/storage';

interface BillReceiptModalProps {
  bill: VoucherBill | null;
  settings: FirmSettings;
  onClose: () => void;
  onPrint?: (bill: VoucherBill) => void;
}

export const BillReceiptModal: React.FC<BillReceiptModalProps> = ({
  bill,
  settings,
  onClose,
}) => {
  // Prevent background scroll while modal is open
  useEffect(() => {
    if (!bill) return;
    const originalOverflow = document.body.style.overflow;
    const originalTouchAction = document.body.style.touchAction;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.touchAction = originalTouchAction;
    };
  }, [bill]);

  if (!bill) return null;

  const phoneList = [settings.phone1, settings.phone2].filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 select-none touch-none animate-in fade-in"
      onClick={onClose}
      onTouchMove={(e) => {
        // Prevent background scrolling on touch devices
        if (e.target === e.currentTarget) {
          e.preventDefault();
        }
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden border border-slate-200 animate-in zoom-in-95 flex flex-col max-h-[92vh] touch-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header: Only Bill Number and Close Button */}
        <div className="bg-emerald-800 text-white px-4 py-2.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-200 font-bold text-xs sm:text-sm">બિલ નં:</span>
            <span className="px-2 py-0.5 rounded bg-emerald-950/70 text-amber-300 font-mono text-sm sm:text-base font-black tracking-wider border border-emerald-700/50 shadow-2xs">
              {bill.billNoStr || bill.billNo}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-emerald-200 hover:text-white hover:bg-emerald-700 active:scale-95 transition cursor-pointer"
            title="બંધ કરો"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Receipt Body (Paper Receipt Look) */}
        <div className="p-4 overflow-y-auto flex-1 bg-slate-50 text-slate-800 text-xs sm:text-sm font-sans space-y-3 overscroll-contain">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-2.5">
            {/* Firm Header */}
            <div className="text-center space-y-0.5 pb-2 border-b border-dashed border-slate-300">
              <h3 className="font-black text-base text-slate-900">
                {settings.firmName || 'શ્રી કલેશ્વરી કૃપા ટ્રેડીંગ કું.'}
              </h3>
              {settings.tagline && (
                <p className="text-[11px] text-slate-600 font-medium">
                  {settings.tagline}
                </p>
              )}
              {settings.address && (
                <p className="text-[10px] text-slate-500">
                  {settings.address}
                </p>
              )}
              {settings.addressLine2 && (
                <p className="text-[10px] text-slate-500">
                  {settings.addressLine2}
                </p>
              )}
              {phoneList.length > 0 && (
                <p className="text-[10px] font-mono text-slate-600 mt-1">
                  Mo. {phoneList.join('  Mo. ')}
                </p>
              )}
              {settings.gstNo && (
                <p className="text-[9px] font-mono text-slate-500">
                  GSTIN: {settings.gstNo}
                </p>
              )}
              {settings.licenseNo && (
                <p className="text-[9px] text-slate-500">
                  લા.નં: {settings.licenseNo}
                </p>
              )}
            </div>

            {/* Bill Meta */}
            <div className="space-y-1 pb-2 border-b border-dashed border-slate-300 text-xs font-bold">
              <div className="flex justify-between items-center">
                <span>
                  બિલ નં: <b className="font-mono text-slate-900">{bill.billNoStr || bill.billNo}</b>
                </span>
                <span className="font-mono text-slate-700">
                  તારીખ: {formatDateDDMM(bill.date)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-900 font-black">
                  ગ્રાહક: {bill.customerName || 'સામાન્ય ગ્રાહક'}
                </span>
                {bill.time && (
                  <span className="text-[11px] text-slate-500 font-mono">
                    {formatTimeSimple(bill.time)}
                  </span>
                )}
              </div>
            </div>

            {/* Items Table: Well-spaced, balanced widths and centered */}
            <div className="py-1">
              <table className="w-full text-xs border-collapse table-fixed">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-black text-[11px]">
                    <th className="py-1.5 px-1 text-left w-[30%]">માલ</th>
                    <th className="py-1.5 px-1 text-center w-[26%]">વજન</th>
                    <th className="py-1.5 px-1 text-center w-[20%]">ભાવ</th>
                    <th className="py-1.5 px-1 text-right w-[24%]">રકમ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {getDecomposedBillItems(bill).map((item, idx) => (
                    <tr key={idx} className="py-1 text-slate-800">
                      <td className="py-2 px-1 text-left font-bold text-slate-900 truncate">
                        {item.productName}
                      </td>
                      <td className="py-2 px-1 text-center font-mono font-bold text-slate-900 whitespace-nowrap">
                        {item.weightKg} kg
                      </td>
                      <td className="py-2 px-1 text-center font-mono text-slate-700 whitespace-nowrap">
                        ₹{item.ratePer20Kg}
                      </td>
                      <td className="py-2 px-1 text-right font-mono font-black text-emerald-800 whitespace-nowrap">
                        {formatINR(item.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Grand Total */}
            <div className="pt-2 border-t border-dashed border-slate-300">
              <div className="flex justify-between items-center text-sm sm:text-base font-black text-slate-900">
                <span>ચોખ્ખી રકમ:</span>
                <span className="text-emerald-800 font-mono">{formatINR(bill.finalTotal)}</span>
              </div>
            </div>

            {/* Footer Thank you */}
            <div className="text-center pt-2 text-[11px] font-bold text-slate-500">
              આભાર, ફરી પધારશો!
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
