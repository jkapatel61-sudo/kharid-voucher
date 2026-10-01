import React, { useState, useEffect } from 'react';
import { X, Printer, Edit3, Scale, ChevronRight, CheckCircle2, Clock, Layers, Plus, User } from 'lucide-react';
import { KantaWeighment, KantaItemDetail } from '../utils/firebaseSync';
import { WeighmentSlipData, VoucherBill } from '../types';
import { getStoredFirmSettings, formatINR, getStoredBills } from '../utils/storage';
import { printWeighmentDirectly, printCombinedDirectly } from '../utils/directPrint';

interface WeighmentDetailModalProps {
  weighment: KantaWeighment | null;
  onClose: () => void;
  onLoadIntoSheet?: (weighment: KantaWeighment) => void;
  onOpenBill?: (weighment: KantaWeighment) => void;
  isEditable?: boolean;
  onSaveFigures?: (updatedWeighment: KantaWeighment) => void;
}

export const WeighmentDetailModal: React.FC<WeighmentDetailModalProps> = ({
  weighment,
  onClose,
  onLoadIntoSheet,
  onOpenBill,
  isEditable = false,
  onSaveFigures,
}) => {
  const [isPrinting, setIsPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState<string | null>(null);

  const isMultiItem = Boolean(weighment?.items && weighment.items.length === 2);
  const item1 = isMultiItem ? weighment!.items![0] : null;
  const item2 = isMultiItem ? weighment!.items![1] : null;

  // Edit mode local state
  const [isEditing, setIsEditing] = useState(isEditable);
  const activeEditable = isEditable || isEditing;
  const [editCustomerName, setEditCustomerName] = useState<string>('');
  const [editBags, setEditBags] = useState<string[]>([]);
  const [editTare, setEditTare] = useState<string>('');
  const [editTare1, setEditTare1] = useState<string>('');
  const [editTare2, setEditTare2] = useState<string>('');

  useEffect(() => {
    if (!weighment) return;
    setEditCustomerName(weighment.customerName || '');
    const orig = Array.isArray(weighment.bags) ? weighment.bags : [];
    const minSlots = isMultiItem ? 20 : Math.max(20, Math.ceil((orig.length || 1) / 10) * 10);
    const arr = orig.map((b) => (b !== undefined && b !== null && !isNaN(b) && Number(b) > 0 ? b.toString() : ''));
    while (arr.length < minSlots) {
      arr.push('');
    }
    setEditBags(arr);
    setEditTare(
      weighment.tareWeightKg !== undefined && weighment.tareWeightKg > 0
        ? weighment.tareWeightKg.toString()
        : ''
    );
    if (isMultiItem) {
      setEditTare1(
        item1?.tareWeightKg !== undefined && item1.tareWeightKg > 0 ? item1.tareWeightKg.toString() : ''
      );
      setEditTare2(
        item2?.tareWeightKg !== undefined && item2.tareWeightKg > 0 ? item2.tareWeightKg.toString() : ''
      );
    }
  }, [weighment]);

  if (!weighment) return null;

  // View mode values
  const bags = Array.isArray(weighment.bags) ? weighment.bags : [];
  const halfCount = isMultiItem ? 10 : Math.max(10, Math.ceil(bags.length / 2));

  // Compute column subtotals for view mode
  let leftTotal = 0;
  for (let i = 0; i < halfCount; i++) {
    if (i < bags.length && !isNaN(bags[i])) {
      leftTotal += Number(bags[i]);
    }
  }
  leftTotal = Math.round(leftTotal * 10) / 10;

  let rightTotal = 0;
  const rightEnd = isMultiItem ? 20 : bags.length;
  for (let i = halfCount; i < rightEnd; i++) {
    if (i < bags.length && !isNaN(bags[i])) {
      rightTotal += Number(bags[i]);
    }
  }
  rightTotal = Math.round(rightTotal * 10) / 10;

  const grossWeight = isMultiItem
    ? Math.round((leftTotal + rightTotal) * 10) / 10
    : bags.length > 0
    ? Math.round(bags.reduce((acc, v) => acc + (Number(v) || 0), 0) * 10) / 10
    : weighment.totalWeightKg;

  const tare = weighment.tareWeightKg || 0;
  const netWeight = isMultiItem
    ? weighment.totalWeightKg
    : tare > 0
    ? Math.max(0, Math.round((grossWeight - tare) * 10) / 10)
    : weighment.totalWeightKg;

  // Multi-item view mode separate values
  const viewItem1Tare = item1?.tareWeightKg || 0;
  const viewItem1Net = item1?.netWeightKg !== undefined ? item1.netWeightKg : Math.max(0, Math.round((leftTotal - viewItem1Tare) * 10) / 10);
  const viewItem2Tare = item2?.tareWeightKg || 0;
  const viewItem2Net = item2?.netWeightKg !== undefined ? item2.netWeightKg : Math.max(0, Math.round((rightTotal - viewItem2Tare) * 10) / 10);

  // Edit mode real-time calculations
  const editHalf = isMultiItem ? 10 : Math.max(10, Math.ceil(editBags.length / 2));
  let editLeftTotal = 0;
  for (let i = 0; i < editHalf; i++) {
    const val = parseFloat(editBags[i]);
    if (!isNaN(val) && val > 0) editLeftTotal += val;
  }
  editLeftTotal = Math.round(editLeftTotal * 10) / 10;

  let editRightTotal = 0;
  const editRightEnd = isMultiItem ? 20 : editBags.length;
  for (let i = editHalf; i < editRightEnd; i++) {
    const val = parseFloat(editBags[i]);
    if (!isNaN(val) && val > 0) editRightTotal += val;
  }
  editRightTotal = Math.round(editRightTotal * 10) / 10;

  const editGross = Math.round((editLeftTotal + editRightTotal) * 10) / 10;
  const numTare = parseFloat(editTare) || 0;
  const editNet = numTare > 0 ? Math.max(0, Math.round((editGross - numTare) * 10) / 10) : editGross;
  const editBagsCount = editBags.filter((b) => {
    const val = parseFloat(b);
    return !isNaN(val) && val > 0;
  }).length;
  const editAmount =
    weighment.ratePer20Kg > 0 ? Math.round((editNet / 20) * weighment.ratePer20Kg) : 0;

  // Multi-item edit mode separate calculations
  const numTare1 = parseFloat(editTare1) || 0;
  const numTare2 = parseFloat(editTare2) || 0;
  const editItem1Net = Math.max(0, Math.round((editLeftTotal - numTare1) * 10) / 10);
  const editItem2Net = Math.max(0, Math.round((editRightTotal - numTare2) * 10) / 10);
  const editItem1Amount = item1?.ratePer20Kg ? Math.round((editItem1Net / 20) * item1.ratePer20Kg) : 0;
  const editItem2Amount = item2?.ratePer20Kg ? Math.round((editItem2Net / 20) * item2.ratePer20Kg) : 0;
  const editItem1BagsCount = editBags.slice(0, 10).filter((b) => parseFloat(b) > 0).length;
  const editItem2BagsCount = editBags.slice(10, 20).filter((b) => parseFloat(b) > 0).length;
  const multiTotalGross = Math.round((editLeftTotal + editRightTotal) * 10) / 10;
  const multiTotalTare = Math.round((numTare1 + numTare2) * 10) / 10;
  const multiTotalNet = Math.round((editItem1Net + editItem2Net) * 10) / 10;
  const multiTotalAmount = editItem1Amount + editItem2Amount;

  const handleSaveFiguresClick = () => {
    let updated: KantaWeighment;
    const finalCustomerName = editCustomerName.trim() || weighment.customerName || 'સામાન્ય ગ્રાહક';

    if (isMultiItem) {
      const cleanedItem1Bags = editBags
        .slice(0, 10)
        .map((v) => parseFloat(v))
        .filter((n) => !isNaN(n) && n > 0);
      const cleanedItem2Bags = editBags
        .slice(10, 20)
        .map((v) => parseFloat(v))
        .filter((n) => !isNaN(n) && n > 0);

      const full20 = Array(20)
        .fill(0)
        .map((_, i) => parseFloat(editBags[i]) || 0);

      const updatedItem1: KantaItemDetail = {
        ...item1!,
        bags: cleanedItem1Bags,
        grossWeightKg: editLeftTotal,
        tareWeightKg: numTare1 > 0 ? numTare1 : undefined,
        netWeightKg: editItem1Net,
        calculatedAmount: editItem1Amount,
      };

      const updatedItem2: KantaItemDetail = {
        ...item2!,
        bags: cleanedItem2Bags,
        grossWeightKg: editRightTotal,
        tareWeightKg: numTare2 > 0 ? numTare2 : undefined,
        netWeightKg: editItem2Net,
        calculatedAmount: editItem2Amount,
      };

      updated = {
        ...weighment,
        customerName: finalCustomerName,
        bags: full20,
        totalBagsCount: cleanedItem1Bags.length + cleanedItem2Bags.length,
        totalWeightKg: multiTotalNet,
        tareWeightKg: multiTotalTare > 0 ? multiTotalTare : undefined,
        calculatedAmount: multiTotalAmount,
        items: [updatedItem1, updatedItem2],
      };
    } else {
      const cleanedBags = editBags
        .map((v) => parseFloat(v))
        .filter((n) => !isNaN(n) && n > 0);

      updated = {
        ...weighment,
        customerName: finalCustomerName,
        bags: cleanedBags,
        totalBagsCount: cleanedBags.length,
        totalWeightKg: editNet,
        tareWeightKg: numTare > 0 ? numTare : undefined,
        calculatedAmount: editAmount,
      };
    }

    onSaveFigures?.(updated);
    onClose();
  };

  const handlePrint = async () => {
    setIsPrinting(true);
    setPrintStatus('પ્રિન્ટ નીકળી રહી છે...');
    try {
      const settings = getStoredFirmSettings();
      const printItems = isMultiItem
        ? [
            {
              productName: item1!.productName,
              weightKg: viewItem1Net,
              grossWeightKg: leftTotal,
              tareWeightKg: viewItem1Tare > 0 ? viewItem1Tare : undefined,
              weightMan: Math.round((viewItem1Net / 20) * 10) / 10,
              ratePer20Kg: item1!.ratePer20Kg,
              amount: item1!.calculatedAmount,
              bags: bags.slice(0, 10).filter((v) => Number(v) > 0),
            },
            {
              productName: item2!.productName,
              weightKg: viewItem2Net,
              grossWeightKg: rightTotal,
              tareWeightKg: viewItem2Tare > 0 ? viewItem2Tare : undefined,
              weightMan: Math.round((viewItem2Net / 20) * 10) / 10,
              ratePer20Kg: item2!.ratePer20Kg,
              amount: item2!.calculatedAmount,
              bags: bags.slice(10, 20).filter((v) => Number(v) > 0),
            },
          ]
        : [
            {
              productName: weighment.productName,
              weightKg: netWeight,
              grossWeightKg: grossWeight,
              tareWeightKg: tare > 0 ? tare : undefined,
              weightMan: Math.round((netWeight / 20) * 10) / 10,
              ratePer20Kg: weighment.ratePer20Kg,
              amount: weighment.calculatedAmount,
              bags: bags,
            },
          ];

      const storedBills = getStoredBills();
      const matchingBill = storedBills.find(
        (b) =>
          (weighment.billId && b.id === weighment.billId) ||
          (b.customerName === weighment.customerName && Math.abs(b.totalWeightKg - netWeight) < 1)
      );

      const slipData: WeighmentSlipData = {
        date: weighment.date,
        time: weighment.time,
        customerName: weighment.customerName,
        billNoStr: weighment.billNoStr || matchingBill?.billNoStr,
        items: printItems,
        totalBagsCount: weighment.totalBagsCount,
        totalWeightKg: netWeight,
        grossWeightKg: grossWeight,
        tareWeightKg: tare > 0 ? tare : undefined,
        totalWeightMan: Math.round((netWeight / 20) * 10) / 10,
        totalAmount: weighment.calculatedAmount,
      };

      await printWeighmentDirectly(slipData, settings, (st) => {
        setPrintStatus(st);
      });
    } catch (err: any) {
      console.warn('Print weighment error:', err);
    } finally {
      setIsPrinting(false);
      setPrintStatus(null);
    }
  };

  const handlePrintCombined = async () => {
    setIsPrinting(true);
    setPrintStatus('વજન અને બિલ પ્રિન્ટ થઈ રહ્યું છે...');
    try {
      const settings = getStoredFirmSettings();
      const printItems = isMultiItem
        ? [
            {
              productName: item1!.productName,
              weightKg: viewItem1Net,
              grossWeightKg: leftTotal,
              tareWeightKg: viewItem1Tare > 0 ? viewItem1Tare : undefined,
              weightMan: Math.round((viewItem1Net / 20) * 10) / 10,
              ratePer20Kg: item1!.ratePer20Kg,
              amount: item1!.calculatedAmount,
              bags: bags.slice(0, 10).filter((v) => Number(v) > 0),
            },
            {
              productName: item2!.productName,
              weightKg: viewItem2Net,
              grossWeightKg: rightTotal,
              tareWeightKg: viewItem2Tare > 0 ? viewItem2Tare : undefined,
              weightMan: Math.round((viewItem2Net / 20) * 10) / 10,
              ratePer20Kg: item2!.ratePer20Kg,
              amount: item2!.calculatedAmount,
              bags: bags.slice(10, 20).filter((v) => Number(v) > 0),
            },
          ]
        : [
            {
              productName: weighment.productName,
              weightKg: netWeight,
              grossWeightKg: grossWeight,
              tareWeightKg: tare > 0 ? tare : undefined,
              weightMan: Math.round((netWeight / 20) * 10) / 10,
              ratePer20Kg: weighment.ratePer20Kg,
              amount: weighment.calculatedAmount,
              bags: bags,
            },
          ];

      const slipData: WeighmentSlipData = {
        date: weighment.date,
        time: weighment.time,
        customerName: weighment.customerName,
        items: printItems,
        totalBagsCount: weighment.totalBagsCount,
        totalWeightKg: netWeight,
        grossWeightKg: grossWeight,
        tareWeightKg: tare > 0 ? tare : undefined,
        totalWeightMan: Math.round((netWeight / 20) * 10) / 10,
        totalAmount: weighment.calculatedAmount,
      };

      const storedBills = getStoredBills();
      let matchingBill = storedBills.find(
        (b) =>
          (weighment.billId && b.id === weighment.billId) ||
          (b.customerName === weighment.customerName && Math.abs(b.totalWeightKg - netWeight) < 1)
      );

      if (!matchingBill) {
        const billItems = isMultiItem
          ? [
              {
                id: `item_1_${weighment.id}`,
                productId: item1!.productId,
                productName: item1!.productName,
                productShortcut: '',
                weightKg: viewItem1Net,
                ratePer20Kg: item1!.ratePer20Kg,
                amount: item1!.calculatedAmount,
              },
              {
                id: `item_2_${weighment.id}`,
                productId: item2!.productId,
                productName: item2!.productName,
                productShortcut: '',
                weightKg: viewItem2Net,
                ratePer20Kg: item2!.ratePer20Kg,
                amount: item2!.calculatedAmount,
              },
            ]
          : [
              {
                id: `item_${weighment.id}`,
                productId: weighment.productId,
                productName: weighment.productName,
                productShortcut: '',
                weightKg: netWeight,
                ratePer20Kg: weighment.ratePer20Kg,
                amount: weighment.calculatedAmount,
              },
            ];

        matchingBill = {
          id: `bill_${weighment.id}`,
          billNo: 1,
          billNoStr: 'M1',
          date: weighment.date,
          time: weighment.time,
          session: 'M',
          customerName: weighment.customerName,
          items: billItems,
          totalWeightKg: netWeight,
          totalWeightMan: Math.round((netWeight / 20) * 10) / 10,
          grossAmount: weighment.calculatedAmount,
          discountLess: 0,
          finalTotal: weighment.calculatedAmount,
          weighmentId: weighment.id,
          weighmentSlip: slipData,
          createdAt: weighment.createdAt || Date.now(),
        };
      }

      await printCombinedDirectly(matchingBill, slipData, settings, (st) => {
        setPrintStatus(st);
      });
    } catch (err: any) {
      console.warn('Print combined error:', err);
    } finally {
      setIsPrinting(false);
      setPrintStatus(null);
    }
  };

  const isPending = weighment.status === 'pending';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div
          className={`text-white px-4 py-3 flex items-center justify-between shrink-0 ${
            activeEditable
              ? 'bg-gradient-to-r from-teal-800 to-emerald-900'
              : 'bg-gradient-to-r from-emerald-800 to-teal-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-emerald-300" />
            <div>
              <h3 className="font-black text-base leading-tight">
                કાંટા પર લખેલા વજન વિગત
              </h3>
              <div className="text-xs text-emerald-100 flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span>{activeEditable ? (editCustomerName.trim() || 'સામાન્ય ગ્રાહક') : weighment.customerName}</span>
                <span>•</span>
                {isMultiItem ? (
                  <>
                    <span className="bg-amber-600 px-1.5 py-0.2 rounded font-bold text-white text-[11px]">
                      ૧. {item1?.productName}
                    </span>
                    <span className="bg-indigo-600 px-1.5 py-0.2 rounded font-bold text-white text-[11px]">
                      ૨. {item2?.productName}
                    </span>
                  </>
                ) : (
                  <span className="bg-emerald-700/80 px-1.5 py-0.2 rounded font-bold">
                    {weighment.productName}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setIsEditing(!activeEditable)}
              className={`p-1.5 rounded-full transition cursor-pointer ${
                activeEditable
                  ? 'bg-white text-emerald-900 shadow-xs'
                  : 'hover:bg-white/20 text-white'
              }`}
              title={activeEditable ? 'એડિટ બંધ કરો' : 'આંકડા એડિટ કરો'}
              aria-label="એડિટ કરો"
            >
              <Edit3 className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-white/20 text-white transition cursor-pointer"
              title="બંધ કરો"
              aria-label="બંધ કરો"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Subheader info: Time, Date, Status */}
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-3 text-slate-600 font-medium">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              {weighment.date} • {weighment.time}
            </span>
            {weighment.tokenNo ? (
              <span className="font-bold text-slate-800">ટોકન: #{weighment.tokenNo}</span>
            ) : null}
          </div>
          <span
            className={`px-2 py-0.5 rounded-full font-bold text-[11px] ${
              isPending
                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
            }`}
          >
            {isPending ? 'ઓફિસમાં બિલ બાકી' : 'બિલ બની ગયું ✓'}
          </span>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
          {activeEditable ? (
            /* ================= EDITABLE FIGURES MODE ================= */
            <div className="space-y-3">
              {/* Customer Name Editing Input */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex items-center gap-2">
                <label className="text-xs font-black text-slate-700 shrink-0 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-emerald-700" />
                  <span>ગ્રાહકનું નામ:</span>
                </label>
                <input
                  type="search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="words"
                  spellCheck={false}
                  data-form-type="other"
                  data-lpignore="true"
                  value={editCustomerName}
                  onChange={(e) => setEditCustomerName(e.target.value)}
                  placeholder="ગ્રાહકનું નામ લખો..."
                  className="flex-1 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-2xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {/* Column 1: Bags 1 to editHalf */}
                <div
                  className={`border rounded-xl p-2 flex flex-col justify-between space-y-2 ${
                    isMultiItem
                      ? 'border-amber-300 bg-amber-50/40'
                      : 'border-slate-200 bg-slate-50/70'
                  }`}
                >
                  {isMultiItem && (
                    <div className="bg-amber-600 text-white text-[11px] font-black px-2 py-0.5 rounded-lg text-center shadow-xs">
                      ૧. {item1?.productName}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    {Array.from({ length: editHalf }).map((_, idx) => {
                      const bagNum = idx + 1;
                      return (
                        <div
                          key={idx}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white border border-slate-200"
                        >
                          <span className="font-bold text-slate-500 text-xs w-6">{bagNum})</span>
                          <input
                            type="search"
                            inputMode="decimal"
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                            data-form-type="other"
                            data-lpignore="true"
                            step="any"
                            value={editBags[idx] || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditBags((prev) => {
                                const next = [...prev];
                                next[idx] = val;
                                return next;
                              });
                            }}
                            placeholder="0.0"
                            className="w-full text-right font-mono font-bold text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded px-1"
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* Column 1 Subtotal */}
                  <div className="pt-2 border-t border-slate-300 flex items-center justify-between px-1 font-mono">
                    <span className="text-xs text-slate-600 font-bold">ગ્રોસ:</span>
                    <span className="font-black text-sm sm:text-base text-slate-900">
                      {editLeftTotal.toFixed(1)} kg
                    </span>
                  </div>

                  {/* If Multi-Item: Tare Deduction 1 under Item 1 */}
                  {isMultiItem && (
                    <div className="p-2 bg-white border border-amber-200 rounded-lg space-y-1 mt-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] font-black text-amber-950">કપાત વજન:</span>
                        <input
                          type="search"
                          inputMode="decimal"
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                          data-form-type="other"
                          data-lpignore="true"
                          step="any"
                          value={editTare1}
                          onFocus={(e) => {
                            const el = e.currentTarget;
                            el.select();
                            setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
                          }}
                          onChange={(e) => setEditTare1(e.target.value)}
                          placeholder="0.0"
                          className="w-20 px-1.5 py-0.5 bg-amber-50 border border-amber-300 rounded text-right font-mono font-black text-xs text-rose-900 focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-bold text-amber-950 pt-0.5 border-t border-amber-100">
                        <span>નેટ:</span>
                        <span className="font-mono font-black">{editItem1Net.toFixed(1)} kg</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Column 2: Bags editHalf + 1 to End (or 1 to 10 for item 2) */}
                <div
                  className={`border rounded-xl p-2 flex flex-col justify-between space-y-2 ${
                    isMultiItem
                      ? 'border-indigo-300 bg-indigo-50/40'
                      : 'border-slate-200 bg-slate-50/70'
                  }`}
                >
                  {isMultiItem && (
                    <div className="bg-indigo-600 text-white text-[11px] font-black px-2 py-0.5 rounded-lg text-center shadow-xs">
                      ૨. {item2?.productName}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    {Array.from({ length: isMultiItem ? 10 : editHalf }).map((_, idx) => {
                      const bagIdx = editHalf + idx;
                      const bagNum = isMultiItem ? idx + 1 : bagIdx + 1;
                      return (
                        <div
                          key={bagIdx}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white border border-slate-200"
                        >
                          <span className="font-bold text-slate-500 text-xs w-6">{bagNum})</span>
                          <input
                            type="search"
                            inputMode="decimal"
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                            data-form-type="other"
                            data-lpignore="true"
                            step="any"
                            value={editBags[bagIdx] || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditBags((prev) => {
                                const next = [...prev];
                                next[bagIdx] = val;
                                return next;
                              });
                            }}
                            placeholder="0.0"
                            className="w-full text-right font-mono font-bold text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded px-1"
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* Column 2 Subtotal */}
                  <div className="pt-2 border-t border-slate-300 flex items-center justify-between px-1 font-mono">
                    <span className="text-xs text-slate-600 font-bold">ગ્રોસ:</span>
                    <span className="font-black text-sm sm:text-base text-slate-900">
                      {editRightTotal > 0 ? `${editRightTotal.toFixed(1)} kg` : '0 kg'}
                    </span>
                  </div>

                  {/* If Multi-Item: Tare Deduction 2 under Item 2 */}
                  {isMultiItem && (
                    <div className="p-2 bg-white border border-indigo-200 rounded-lg space-y-1 mt-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] font-black text-indigo-950">કપાત વજન:</span>
                        <input
                          type="search"
                          inputMode="decimal"
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                          data-form-type="other"
                          data-lpignore="true"
                          step="any"
                          value={editTare2}
                          onFocus={(e) => {
                            const el = e.currentTarget;
                            el.select();
                            setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
                          }}
                          onChange={(e) => setEditTare2(e.target.value)}
                          placeholder="0.0"
                          className="w-20 px-1.5 py-0.5 bg-indigo-50 border border-indigo-300 rounded text-right font-mono font-black text-xs text-rose-900 focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-bold text-indigo-950 pt-0.5 border-t border-indigo-100">
                        <span>નેટ:</span>
                        <span className="font-mono font-black">{editItem2Net.toFixed(1)} kg</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Single item tare input & add slots */}
              {!isMultiItem && (
                <>
                  <button
                    type="button"
                    onClick={() => setEditBags((prev) => [...prev, ...Array(10).fill('')])}
                    className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer border border-slate-300"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>વધુ ૧૦ થેલીના ખાના ઉમેરો</span>
                  </button>

                  <div className="flex items-center justify-between gap-2 p-2.5 bg-rose-50 border border-rose-200 rounded-xl">
                    <span className="text-xs font-black text-rose-950">કપાત વજન (Tare kg):</span>
                    <input
                      type="search"
                      inputMode="decimal"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      data-form-type="other"
                      data-lpignore="true"
                      step="any"
                      value={editTare}
                      onFocus={(e) => {
                        const el = e.currentTarget;
                        el.select();
                        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
                      }}
                      onChange={(e) => setEditTare(e.target.value)}
                      placeholder="0.0"
                      className="w-28 px-2.5 py-1.5 bg-white border border-rose-300 rounded-lg text-right font-mono font-black text-sm text-rose-900 focus:ring-2 focus:ring-rose-400 focus:outline-none"
                    />
                  </div>
                </>
              )}

              {/* Real-Time Live Summary Card */}
              {isMultiItem ? (
                <div className="bg-emerald-50/90 border border-emerald-300 rounded-xl p-3 space-y-2 font-sans">
                  {/* Item 1 breakdown */}
                  <div className="flex items-center justify-between text-xs font-bold text-amber-950 bg-amber-50/80 p-1.5 rounded-lg border border-amber-200">
                    <span>
                      ૧. {item1?.productName}: {editItem1BagsCount} થેલી | {editItem1Net.toFixed(1)} kg
                    </span>
                    <span className="font-mono font-black">
                      {item1?.ratePer20Kg ? `₹${item1.ratePer20Kg} = ${formatINR(editItem1Amount)}` : `${editItem1Net.toFixed(1)} kg`}
                    </span>
                  </div>

                  {/* Item 2 breakdown */}
                  <div className="flex items-center justify-between text-xs font-bold text-indigo-950 bg-indigo-50/80 p-1.5 rounded-lg border border-indigo-200">
                    <span>
                      ૨. {item2?.productName}: {editItem2BagsCount} થેલી | {editItem2Net.toFixed(1)} kg
                    </span>
                    <span className="font-mono font-black">
                      {item2?.ratePer20Kg ? `₹${item2.ratePer20Kg} = ${formatINR(editItem2Amount)}` : `${editItem2Net.toFixed(1)} kg`}
                    </span>
                  </div>

                  {/* Combined total */}
                  <div className="border-t border-emerald-300 pt-1.5 flex items-center justify-between text-xs sm:text-sm font-black text-emerald-950">
                    <span>કુલ: {editItem1BagsCount + editItem2BagsCount} થેલી (નેટ {multiTotalNet.toFixed(1)} kg)</span>
                    <span className="font-mono text-sm sm:text-base text-emerald-900">
                      {formatINR(multiTotalAmount)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="bg-emerald-50/90 border border-emerald-300 rounded-xl p-3 space-y-1.5 font-sans">
                  <div className="flex items-center justify-between text-xs sm:text-sm font-bold text-slate-700">
                    <span>કુલ થેલીઓ: {editBagsCount}</span>
                    <span className="font-mono text-slate-950 font-black">
                      ગ્રોસ: {editGross.toFixed(1)} kg
                    </span>
                  </div>
                  {numTare > 0 && (
                    <div className="flex items-center justify-between text-xs font-bold text-rose-700">
                      <span>કપાત બાદ:</span>
                      <span className="font-mono font-black">-{numTare.toFixed(1)} kg</span>
                    </div>
                  )}
                  <div className="border-t border-emerald-300 my-1 pt-1.5 flex items-center justify-between">
                    <span className="text-sm font-black text-emerald-950">નવું નેટ વજન:</span>
                    <span className="font-mono text-base sm:text-lg font-black text-emerald-950">
                      {editNet.toFixed(1)} kg
                    </span>
                  </div>
                  {weighment.ratePer20Kg > 0 && (
                    <div className="pt-1.5 border-t border-emerald-200 flex items-center justify-between text-xs text-slate-600">
                      <span>
                        ભાવ: <strong className="font-mono text-slate-800">₹{weighment.ratePer20Kg}</strong> / ૨૦ kg
                      </span>
                      <span>
                        નવી રકમ: <strong className="font-mono text-emerald-800 text-sm font-black">{formatINR(editAmount)}</strong>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* ================= READ-ONLY VIEW MODE (બહાર ના # થી ખાલી આંકડા દેખાય) ================= */
            <div className="space-y-3">
              {bags.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">
                  આ એન્ટ્રીમાં થેલીવાર વજન દાખલ થયેલ નથી.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  {/* Column 1: Bags 1 to halfCount */}
                  <div
                    className={`border rounded-xl p-2 flex flex-col justify-between ${
                      isMultiItem
                        ? 'border-amber-300 bg-amber-50/40'
                        : 'border-slate-200 bg-slate-50/70'
                    }`}
                  >
                    {isMultiItem && (
                      <div className="bg-amber-600 text-white text-[11px] font-black px-2 py-0.5 rounded-lg text-center shadow-xs mb-1.5">
                        ૧. {item1?.productName}
                      </div>
                    )}

                    <div className="space-y-1">
                      {Array.from({ length: halfCount }).map((_, idx) => {
                        const bagNum = idx + 1;
                        const w = bags[idx];
                        const hasVal = w !== undefined && !isNaN(w) && Number(w) > 0;
                        return (
                          <div
                            key={idx}
                            className={`flex items-center justify-between px-2 py-1 rounded-lg text-xs sm:text-sm font-mono ${
                              hasVal
                                ? 'bg-white border border-slate-200 text-slate-900'
                                : 'text-slate-300'
                            }`}
                          >
                            <span className="font-bold text-slate-500">{bagNum})</span>
                            <span className="font-black text-right">
                              {hasVal ? `${Number(w).toFixed(1)} kg` : '-'}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Column 1 Total */}
                    <div className="mt-2 pt-2 border-t border-slate-300 flex items-center justify-between px-1 font-mono">
                      <span className="text-xs text-slate-600 font-bold">ગ્રોસ:</span>
                      <span className="font-black text-sm sm:text-base text-slate-900">
                        {leftTotal.toFixed(1)} kg
                      </span>
                    </div>

                    {/* Multi-Item: Item 1 Deduction & Net */}
                    {isMultiItem && viewItem1Tare > 0 && (
                      <div className="pt-1 border-t border-amber-200 flex items-center justify-between px-1 text-xs">
                        <span className="text-rose-700 font-bold">કપાત: -{viewItem1Tare.toFixed(1)} kg</span>
                        <span className="font-black text-amber-950">નેટ: {viewItem1Net.toFixed(1)} kg</span>
                      </div>
                    )}
                  </div>

                  {/* Column 2: Bags halfCount + 1 to End (or 11 to 20 for item 2) */}
                  <div
                    className={`border rounded-xl p-2 flex flex-col justify-between ${
                      isMultiItem
                        ? 'border-indigo-300 bg-indigo-50/40'
                        : 'border-slate-200 bg-slate-50/70'
                    }`}
                  >
                    {isMultiItem && (
                      <div className="bg-indigo-600 text-white text-[11px] font-black px-2 py-0.5 rounded-lg text-center shadow-xs mb-1.5">
                        ૨. {item2?.productName}
                      </div>
                    )}

                    <div className="space-y-1">
                      {Array.from({ length: isMultiItem ? 10 : halfCount }).map((_, idx) => {
                        const bagIdx = halfCount + idx;
                        const bagNum = isMultiItem ? idx + 1 : bagIdx + 1;
                        const w = bags[bagIdx];
                        const hasVal = w !== undefined && !isNaN(w) && Number(w) > 0;
                        return (
                          <div
                            key={bagIdx}
                            className={`flex items-center justify-between px-2 py-1 rounded-lg text-xs sm:text-sm font-mono ${
                              hasVal
                                ? 'bg-white border border-slate-200 text-slate-900'
                                : 'text-slate-300'
                            }`}
                          >
                            <span className="font-bold text-slate-500">{bagNum})</span>
                            <span className="font-black text-right">
                              {hasVal ? `${Number(w).toFixed(1)} kg` : '-'}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Column 2 Total */}
                    <div className="mt-2 pt-2 border-t border-slate-300 flex items-center justify-between px-1 font-mono">
                      <span className="text-xs text-slate-600 font-bold">ગ્રોસ:</span>
                      <span className="font-black text-sm sm:text-base text-slate-900">
                        {rightTotal > 0 ? `${rightTotal.toFixed(1)} kg` : '0 kg'}
                      </span>
                    </div>

                    {/* Multi-Item: Item 2 Deduction & Net */}
                    {isMultiItem && viewItem2Tare > 0 && (
                      <div className="pt-1 border-t border-indigo-200 flex items-center justify-between px-1 text-xs">
                        <span className="text-rose-700 font-bold">કપાત: -{viewItem2Tare.toFixed(1)} kg</span>
                        <span className="font-black text-indigo-950">નેટ: {viewItem2Net.toFixed(1)} kg</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Clean Summary Card */}
              {isMultiItem ? (
                <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3 space-y-2 font-sans">
                  {/* Item 1 Line */}
                  <div className="flex items-center justify-between text-xs font-bold text-amber-950 bg-amber-50/80 p-1.5 rounded-lg border border-amber-200">
                    <span>
                      ૧. {item1?.productName}: {bags.slice(0, 10).filter((v) => Number(v) > 0).length} થેલી | {viewItem1Net.toFixed(1)} kg
                    </span>
                    <span className="font-mono font-black">
                      {item1?.ratePer20Kg ? `₹${item1.ratePer20Kg} = ${formatINR(item1.calculatedAmount)}` : `${viewItem1Net.toFixed(1)} kg`}
                    </span>
                  </div>

                  {/* Item 2 Line */}
                  <div className="flex items-center justify-between text-xs font-bold text-indigo-950 bg-indigo-50/80 p-1.5 rounded-lg border border-indigo-200">
                    <span>
                      ૨. {item2?.productName}: {bags.slice(10, 20).filter((v) => Number(v) > 0).length} થેલી | {viewItem2Net.toFixed(1)} kg
                    </span>
                    <span className="font-mono font-black">
                      {item2?.ratePer20Kg ? `₹${item2.ratePer20Kg} = ${formatINR(item2.calculatedAmount)}` : `${viewItem2Net.toFixed(1)} kg`}
                    </span>
                  </div>

                  {/* Grand total */}
                  <div className="border-t border-emerald-300 pt-1.5 flex items-center justify-between text-xs sm:text-sm font-black text-emerald-950">
                    <span>કુલ નેટ વજન: {netWeight.toFixed(1)} kg</span>
                    <span className="font-mono text-sm sm:text-base text-emerald-900">
                      {formatINR(weighment.calculatedAmount)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3 space-y-1.5 font-sans">
                  {tare > 0 ? (
                    <>
                      <div className="flex items-center justify-between text-xs sm:text-sm font-bold text-slate-700">
                        <span>કુલ વજન:</span>
                        <span className="font-mono text-slate-950 font-black text-sm sm:text-base">
                          {grossWeight.toFixed(1)} kg
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs sm:text-sm font-bold text-slate-700">
                        <span>કુલ થેલી: {weighment.totalBagsCount}</span>
                        <span className="font-mono text-rose-700 font-black text-sm sm:text-base">
                          -{tare.toFixed(1)} kg
                        </span>
                      </div>
                      <div className="border-t border-emerald-300 my-1 pt-1.5 flex items-center justify-between">
                        <span className="text-sm font-black text-emerald-950">નેટ વજન:</span>
                        <span className="font-mono text-base sm:text-lg font-black text-emerald-950">
                          {netWeight.toFixed(1)} kg
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-xs sm:text-sm font-bold text-slate-700">
                        <span>કુલ થેલી:</span>
                        <span className="font-mono text-slate-950 font-black">
                          {weighment.totalBagsCount} થેલી
                        </span>
                      </div>
                      <div className="border-t border-emerald-300 my-1 pt-1.5 flex items-center justify-between">
                        <span className="text-sm font-black text-emerald-950">કુલ / નેટ વજન:</span>
                        <span className="font-mono text-base sm:text-lg font-black text-emerald-950">
                          {netWeight.toFixed(1)} kg
                        </span>
                      </div>
                    </>
                  )}

                  <div className="pt-1.5 border-t border-emerald-200 flex items-center justify-between text-xs text-slate-600">
                    <span>
                      ભાવ: <strong className="font-mono text-slate-800">₹{weighment.ratePer20Kg}</strong> / ૨૦ kg
                    </span>
                    <span>
                      અંદાજિત રકમ: <strong className="font-mono text-emerald-800 text-sm font-black">{formatINR(weighment.calculatedAmount)}</strong>
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons Footer (Only shown when editing figures) */}
        {activeEditable && (
          <div className="bg-slate-100 border-t border-slate-200 p-3 flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (isEditing && !isEditable) {
                  setIsEditing(false);
                } else {
                  onClose();
                }
              }}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer active:scale-95"
            >
              રદ કરો
            </button>
            <button
              type="button"
              onClick={handleSaveFiguresClick}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs sm:text-sm font-black flex items-center gap-1.5 shadow-xs transition cursor-pointer active:scale-95"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>સેવ કરો (આંકડા અપડેટ)</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
