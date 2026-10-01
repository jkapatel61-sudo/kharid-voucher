import React, { useState, useEffect, useMemo } from 'react';
import { useBackHandler } from '../utils/useBackHandler';
import {
  Search,
  Receipt,
  Trash2,
  Edit3,
  Printer,
  CheckCircle2,
  X,
  AlertTriangle,
  Hash,
  Calendar,
} from 'lucide-react';
import { FirmSettings, Product, VoucherBill } from '../types';
import { formatINR, formatDateDDMMYYYY, getDecomposedBillItems } from '../utils/storage';
import { EditBillModal } from './EditBillModal';
import { KantaWeighment, subscribeToWeighments, saveKantaWeighmentToCloud } from '../utils/firebaseSync';
import { WeighmentDetailModal } from './WeighmentDetailModal';
import { BillReceiptModal } from './BillReceiptModal';

interface HistoryViewProps {
  bills: VoucherBill[];
  products: Product[];
  settings: FirmSettings;
  currentDate: string;
  startDate?: string;
  endDate?: string;
  onResetDate?: () => void;
  onBack: () => void;
  onOpenReceipt: (bill: VoucherBill) => void;
  onDeleteBill?: (id: string) => void;
  onUpdateBill: (bill: VoucherBill) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  bills,
  products,
  settings,
  currentDate,
  startDate,
  endDate,
  onResetDate,
  onBack,
  onOpenReceipt,
  onDeleteBill,
  onUpdateBill,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingBill, setEditingBill] = useState<VoucherBill | null>(null);
  const [billToDelete, setBillToDelete] = useState<VoucherBill | null>(null);
  const [viewingBillCopy, setViewingBillCopy] = useState<VoucherBill | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [selectedWeighmentForDetail, setSelectedWeighmentForDetail] = useState<KantaWeighment | null>(null);

  // Step-by-step Sub-modal back handlers:
  useBackHandler('history-viewing-bill', Boolean(viewingBillCopy), () => setViewingBillCopy(null));
  useBackHandler('history-editing-bill', Boolean(editingBill), () => setEditingBill(null));
  useBackHandler('history-weighment-detail', Boolean(selectedWeighmentForDetail), () => setSelectedWeighmentForDetail(null));
  useBackHandler('history-delete-bill', Boolean(billToDelete), () => setBillToDelete(null));

  // Effective Date Range (from parent props if provided, or fallback)
  const effectiveStart = startDate || currentDate;
  const effectiveEnd = endDate || currentDate;

  // Determine normalized min and max dates & whether filtering a non-today date
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

  // Real-time weighments to recognize Kanta entries
  const [weighments, setWeighments] = useState<KantaWeighment[]>([]);
  useEffect(() => {
    const unsub = subscribeToWeighments((list) => {
      setWeighments(list || []);
    });
    return () => unsub();
  }, []);

  const kantaBillIdSet = useMemo(() => {
    const set = new Set<string>();
    weighments.forEach((w) => {
      if (w.billId) set.add(w.billId);
    });
    return set;
  }, [weighments]);

  const getWeighmentForBill = (b: VoucherBill): KantaWeighment | null => {
    const billWeight = Number(b.totalWeightKg ?? b.weightKg ?? 0);

    // 1. Slip attached directly to bill (must have consistent weight with the bill)
    if (b.weighmentSlip) {
      const slip = b.weighmentSlip;
      const slipWeight = Number(slip.totalWeightKg ?? 0);
      const isWeightConsistent =
        !billWeight || !slipWeight || Math.abs(slipWeight - billWeight) <= 2;

      if (isWeightConsistent) {
        const slipItems = slip.items || [];
        const isMulti = slipItems.length > 1;
        const firstItem = slipItems[0];
        const secondItem = slipItems[1];

        const allBags = isMulti
          ? slipItems.flatMap((it) => it.bags || [])
          : firstItem?.bags || [];

        return {
          id: b.weighmentId || `slip_${b.id}`,
          tokenNo: slip.tokenNo,
          date: slip.date || b.date,
          time: slip.time || b.time,
          customerName: slip.customerName || b.customerName,
          productId: firstItem?.productName || '',
          productName: isMulti
            ? `${firstItem?.productName || ''} + ${secondItem?.productName || ''}`
            : firstItem?.productName || b.items?.[0]?.productName || 'માલ',
          ratePer20Kg: firstItem?.ratePer20Kg || b.items?.[0]?.ratePer20Kg || 0,
          bags: allBags,
          totalWeightKg: slip.totalWeightKg || b.totalWeightKg,
          totalBagsCount:
            slip.totalBagsCount ||
            slipItems.reduce((s, it) => s + (it.bags?.length || 0), 0) ||
            allBags.length,
          tareWeightKg: slip.tareWeightKg || firstItem?.tareWeightKg || 0,
          calculatedAmount: slip.totalAmount || b.finalTotal,
          status: 'billed',
          billId: b.id,
          billNoStr: b.billNoStr,
          createdAt: b.createdAt,
          items: slipItems.map((it) => ({
            productId: it.productName,
            productName: it.productName,
            ratePer20Kg: it.ratePer20Kg,
            netWeightKg: it.weightKg,
            grossWeightKg: it.grossWeightKg || it.weightKg,
            tareWeightKg: it.tareWeightKg || 0,
            calculatedAmount: it.amount,
            bags: it.bags || [],
          })),
        };
      }
    }

    // 2. Match from live weighments by explicit ID or billId AND matching weight
    const found = weighments.find(
      (w) =>
        ((b.weighmentId && w.id === b.weighmentId) || (w.billId && w.billId === b.id)) &&
        (!billWeight || !w.totalWeightKg || Math.abs(w.totalWeightKg - billWeight) <= 2)
    );
    if (found) return found;

    return null;
  };

  // Filter bills by selected date / date range (તારીખ કે તારીખ ટુ તારીખ)
  const dateBills = useMemo(() => {
    return bills.filter((b) => {
      const bDate = b.date || '';
      return bDate >= minDate && bDate <= maxDate;
    });
  }, [bills, minDate, maxDate]);

  const filteredBills = dateBills.filter((bill) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const matchCustomer = bill.customerName.toLowerCase().includes(q);
    const matchBillNo =
      bill.billNoStr?.toLowerCase().includes(q) ||
      bill.billNo.toString().includes(q);
    const matchItem = bill.items?.some((it) =>
      it.productName.toLowerCase().includes(q)
    );
    return matchCustomer || matchBillNo || matchItem;
  });

  const handleSaveEditedBill = (updated: VoucherBill) => {
    onUpdateBill(updated);
    setToastMessage(`બિલ #${updated.billNoStr || updated.billNo} અપડેટ થઈ ગયું છે`);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleConfirmDelete = () => {
    if (!billToDelete) return;
    const deletedNo = billToDelete.billNoStr || billToDelete.billNo;
    if (onDeleteBill) {
      onDeleteBill(billToDelete.id);
    }
    setToastMessage(`બિલ #${deletedNo} ડિલીટ થઈ ગયું છે`);
    setTimeout(() => setToastMessage(null), 3500);
    setBillToDelete(null);
  };

  return (
    <div className="space-y-2 pb-10 animate-fade-in">
      {/* Compact Top Bar: Search input & Count */}
      <div className="bg-white rounded-xl p-2 sm:p-2.5 shadow-2xs border border-slate-200 flex items-center gap-2">
        {/* Compact Search Input */}
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

        {/* Count badge */}
        <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg shrink-0">
          {filteredBills.length} બિલો
        </span>
      </div>

      {/* Active Date Indicator (shown when non-today date or date range is selected) */}
      {isFilteredDate && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-1.5 flex items-center justify-between text-xs font-bold text-amber-900 shadow-2xs">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>
              તારીખ: {formatDateDDMMYYYY(minDate)}
              {minDate !== maxDate ? ` થી ${formatDateDDMMYYYY(maxDate)}` : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={handleResetToToday}
            className="text-[11px] bg-white border border-amber-300 hover:bg-amber-100 px-2 py-0.5 rounded-md text-amber-900 font-black cursor-pointer flex items-center gap-1 transition active:scale-95"
            title="આજની તારીખ પર પાછા જાઓ"
          >
            <span>આજ</span>
            <X className="w-3 h-3 text-amber-700" />
          </button>
        </div>
      )}

      {/* Success Toast Notice */}
      {toastMessage && (
        <div className="p-2.5 bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-md animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* High-Density Compact Bill List (વધુમાં વધુ એન્ટ્રીઓ સ્ક્રીન પર દેખાય તેવું કોમ્પેક્ટ લેઆઉટ) */}
      <div className="space-y-1.5">
        {filteredBills.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center border border-dashed border-slate-300">
            <Receipt className="w-8 h-8 text-slate-300 mx-auto mb-1.5" />
            <p className="text-xs font-bold text-slate-600">
              {isFilteredDate
                ? 'પસંદ કરેલી તારીખ માટે કોઈ બિલ મળ્યા નથી'
                : 'આજે હજી સુધી કોઈ બિલ બનેલ નથી'}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {isFilteredDate
                ? 'અન્ય તારીખ પસંદ કરો અથવા આજ પર પાછા જાઓ'
                : "'નવું બિલ' પર ક્લિક કરી નવું વાઉચર બનાવો"}
            </p>
          </div>
        ) : (
          filteredBills.map((bill) => {
            const weighmentForThisBill = getWeighmentForBill(bill);
            const isKantaEntry = Boolean(weighmentForThisBill);

            return (
              <div
                key={bill.id}
                onClick={() => setViewingBillCopy(bill)}
                className={`rounded-xl px-3 py-2 border shadow-2xs transition flex items-center justify-between gap-2 cursor-pointer select-none active:scale-[0.99] ${
                  isKantaEntry
                    ? 'bg-teal-100 border-teal-300 hover:border-teal-400'
                    : 'bg-white border-slate-200 hover:border-emerald-500'
                }`}
                title="બિલ કોપી જોવા માટે ક્લિક કરો"
              >
                {/* Left side: Bill #, Customer Name, Time & Items in a tight scannable row */}
                <div className="flex-1 min-w-0">
                  {/* Top row: Bill No, Customer Name, Time */}
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded-md bg-slate-900 text-white font-mono font-black text-[11px] shrink-0">
                      {bill.billNoStr}
                    </span>

                    <span className="font-black text-xs sm:text-sm text-slate-900 truncate">
                      {bill.customerName || 'સામાન્ય ગ્રાહક'}
                    </span>

                    <span className="text-[10px] text-slate-400 font-semibold shrink-0">
                      {bill.time}
                    </span>
                  </div>

                  {/* Bottom row: Compact Items string */}
                  <div className="text-[11px] text-slate-600 truncate mt-0.5 font-medium flex items-center gap-1.5">
                    {getDecomposedBillItems(bill).map((it, idx, arr) => (
                      <span key={idx} className="inline-flex items-center gap-1">
                        <span className="font-semibold text-slate-800">{it.productName}</span>
                        <span className="font-mono text-emerald-800 font-bold">
                          {it.weightKg} kg
                        </span>
                        <span className="text-slate-400 text-[10px]">
                          ({it.ratePer20Kg})
                        </span>
                        {idx < arr.length - 1 && (
                          <span className="text-slate-300 mx-0.5">|</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Right side: Amount & Action buttons in one compact horizontal block */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs sm:text-sm font-black text-emerald-800 font-mono">
                    {formatINR(bill.finalTotal)}
                  </span>

                  {/* KANTA FIGURES / આંકડા BUTTON (Icon Only) */}
                  {isKantaEntry && weighmentForThisBill && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedWeighmentForDetail(weighmentForThisBill);
                      }}
                      id={`view-figures-btn-${bill.id}`}
                      className="p-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white shadow-2xs transition active:scale-95 cursor-pointer flex items-center justify-center"
                      title="આંકડા જુઓ (વજન પત્રક)"
                      aria-label="આંકડા જુઓ"
                    >
                      <Hash className="w-3.5 h-3.5 stroke-[2.5]" />
                    </button>
                  )}

                  {/* DIRECT PRINT BUTTON (Icon Only) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenReceipt(bill);
                    }}
                    id={`history-print-btn-${bill.id}`}
                    className="p-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-2xs transition active:scale-95 cursor-pointer flex items-center justify-center"
                    title="સીધી પ્રિન્ટ કરો"
                    aria-label="પ્રિન્ટ"
                  >
                    <Printer className="w-3.5 h-3.5" />
                  </button>

                  {/* EDIT BUTTON (Icon Only) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingBill(bill);
                    }}
                    id={`edit-bill-btn-${bill.id}`}
                    className="p-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white shadow-2xs transition active:scale-95 cursor-pointer flex items-center justify-center"
                    title="બિલ એડિટ કરો"
                    aria-label="એડિટ"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>

                  {/* Delete button (Trash icon with comfortable touch area) */}
                  {onDeleteBill && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setBillToDelete(bill);
                      }}
                      id={`delete-bill-btn-${bill.id}`}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer active:scale-95 flex items-center justify-center"
                      title="બિલ ડિલીટ કરો"
                      aria-label="બિલ ડિલીટ કરો"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Delete Permission / Confirmation Modal (પરમિશન મોડલ: 'શું આ બિલ ડિલીટ કરવું છે?') */}
      {billToDelete && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setBillToDelete(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 text-center space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Warning Icon */}
            <div className="w-13 h-13 rounded-full bg-red-100 text-red-600 mx-auto flex items-center justify-center shadow-inner">
              <AlertTriangle className="w-6 h-6 stroke-[2.5]" />
            </div>

            {/* Main Question / Title */}
            <div className="space-y-1">
              <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">
                શું આ બિલ ડિલીટ કરવું છે?
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                આ બિલ લિસ્ટ અને હિસાબમાંથી કાયમ માટે રદ્દ થઈ જશે.
              </p>
            </div>

            {/* Bill Details Summary Card */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-left space-y-2 text-xs">
              <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-500 font-semibold">બિલ નં:</span>
                <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono font-black text-xs">
                  {billToDelete.billNoStr || billToDelete.billNo}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-semibold">ગ્રાહક:</span>
                <span className="font-bold text-slate-900 truncate max-w-[170px]">
                  {billToDelete.customerName || 'સામાન્ય ગ્રાહક'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-semibold">સમય:</span>
                <span className="font-medium text-slate-700">{billToDelete.time}</span>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                <span className="text-slate-800 font-black">કુલ રકમ:</span>
                <span className="font-mono font-black text-emerald-800 text-sm">
                  {formatINR(billToDelete.finalTotal)}
                </span>
              </div>

              {billToDelete.items && billToDelete.items.length > 0 && (
                <div className="text-[11px] text-slate-600 bg-white p-2 rounded-lg border border-slate-200 space-y-0.5 max-h-24 overflow-y-auto">
                  {billToDelete.items.map((it, idx) => (
                    <div key={idx} className="flex justify-between items-center">
                      <span className="font-semibold text-slate-800">{it.productName}</span>
                      <span className="text-slate-600">
                        {it.weightKg} kg (@₹{it.ratePer20Kg})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action Buttons: Cancel vs Confirm Delete */}
            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                id="cancel-delete-bill-btn"
                onClick={() => setBillToDelete(null)}
                className="flex-1 py-2.5 px-3 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold text-xs sm:text-sm transition cursor-pointer active:scale-95"
              >
                ના, રદ્દ કરો
              </button>

              <button
                type="button"
                id="confirm-delete-bill-btn"
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 px-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-md transition cursor-pointer active:scale-95"
              >
                <Trash2 className="w-4 h-4" />
                <span>હા, ડિલીટ કરો</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Bill Modal */}
      {editingBill && (
        <EditBillModal
          bill={editingBill}
          products={products}
          settings={settings}
          weighment={getWeighmentForBill(editingBill)}
          onClose={() => setEditingBill(null)}
          onSave={handleSaveEditedBill}
          onOpenReceipt={onOpenReceipt}
        />
      )}

      {/* View Weighment Figures Modal (આંકડા વાળું પેજ) */}
      {selectedWeighmentForDetail && (
        <WeighmentDetailModal
          weighment={selectedWeighmentForDetail}
          onClose={() => setSelectedWeighmentForDetail(null)}
          onSaveFigures={(updated) => {
            saveKantaWeighmentToCloud(updated);
            setSelectedWeighmentForDetail(null);
          }}
        />
      )}

      {/* Bill Copy / Voucher Modal (મોબાઇલમાં બિલ કોપી જોવા માટે) */}
      {viewingBillCopy && (
        <BillReceiptModal
          bill={viewingBillCopy}
          settings={settings}
          onClose={() => setViewingBillCopy(null)}
          onPrint={onOpenReceipt}
        />
      )}
    </div>
  );
};
