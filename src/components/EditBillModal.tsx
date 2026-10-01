import React, { useState, useEffect, useMemo } from 'react';
import { X, Check, Trash2, Plus, Edit3, Printer, Loader2, Hash } from 'lucide-react';
import { BillItem, FirmSettings, Product, VoucherBill, WeighmentSlipData } from '../types';
import { formatINR, formatDateDDMMYYYY, getDecomposedBillItems } from '../utils/storage';
import { printReceiptDirectly } from '../utils/directPrint';
import { KantaWeighment, saveKantaWeighmentToCloud } from '../utils/firebaseSync';
import { WeighmentDetailModal } from './WeighmentDetailModal';

interface EditBillModalProps {
  bill: VoucherBill;
  products: Product[];
  settings?: FirmSettings;
  weighment?: KantaWeighment | null;
  onClose: () => void;
  onSave: (updatedBill: VoucherBill) => void;
  onOpenReceipt?: (bill: VoucherBill) => void;
}

export interface EditableBillItem extends BillItem {
  weightStr?: string;
  rateStr?: string;
  amountStr?: string;
}

export const EditBillModal: React.FC<EditBillModalProps> = ({
  bill,
  products,
  settings,
  weighment,
  onClose,
  onSave,
}) => {
  const [customerName, setCustomerName] = useState(() => bill.customerName || '');
  const [items, setItems] = useState<EditableBillItem[]>(() =>
    getDecomposedBillItems(bill).map((it) => ({
      ...it,
      weightStr: it.weightKg !== undefined && it.weightKg !== null && it.weightKg > 0 ? String(it.weightKg) : '',
      rateStr: it.ratePer20Kg !== undefined && it.ratePer20Kg !== null && it.ratePer20Kg > 0 ? String(it.ratePer20Kg) : '',
      amountStr: it.amount !== undefined && it.amount !== null && it.amount > 0 ? String(it.amount) : '',
    }))
  );
  const [isPrinting, setIsPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState<string | null>(null);
  const [showItemBox, setShowItemBox] = useState(false);
  const [showFiguresModal, setShowFiguresModal] = useState(false);

  const initialWeighment: KantaWeighment | null = useMemo(() => {
    const billWeight = Number(bill.totalWeightKg ?? bill.weightKg ?? 0);
    if (weighment) {
      if (!billWeight || !weighment.totalWeightKg || Math.abs(weighment.totalWeightKg - billWeight) <= 2) {
        return weighment;
      }
    }
    if (bill.weighmentSlip) {
      const slip = bill.weighmentSlip;
      const slipWeight = Number(slip.totalWeightKg ?? 0);
      if (billWeight && slipWeight && Math.abs(slipWeight - billWeight) > 2) {
        return null;
      }
      const slipItems = slip.items || [];
      const isMulti = slipItems.length > 1;
      const firstItem = slipItems[0];
      const secondItem = slipItems[1];

      return {
        id: bill.weighmentId || `slip_${bill.id}`,
        tokenNo: slip.tokenNo,
        date: slip.date || bill.date,
        time: slip.time || bill.time,
        customerName: slip.customerName || bill.customerName,
        productId: firstItem?.productName || '',
        productName: isMulti
          ? `${firstItem?.productName || ''} + ${secondItem?.productName || ''}`
          : firstItem?.productName || bill.items?.[0]?.productName || 'માલ',
        ratePer20Kg: firstItem?.ratePer20Kg || bill.items?.[0]?.ratePer20Kg || 0,
        bags: isMulti
          ? [...(firstItem?.bags || []).slice(0, 10), ...(secondItem?.bags || []).slice(0, 10)]
          : firstItem?.bags || [],
        totalWeightKg: slip.totalWeightKg || bill.totalWeightKg,
        totalBagsCount: slip.totalBagsCount || slipItems.reduce((s, it) => s + (it.bags?.length || 0), 0),
        tareWeightKg: slip.tareWeightKg || firstItem?.tareWeightKg || 0,
        calculatedAmount: slip.totalAmount || bill.finalTotal,
        status: 'billed',
        billId: bill.id,
        billNoStr: bill.billNoStr,
        createdAt: bill.createdAt,
        items: isMulti
          ? [
              {
                productId: firstItem?.productName || '',
                productName: firstItem?.productName || 'આઇટમ ૧',
                ratePer20Kg: firstItem?.ratePer20Kg || 0,
                bags: firstItem?.bags || [],
                grossWeightKg: firstItem?.grossWeightKg || firstItem?.weightKg || 0,
                tareWeightKg: firstItem?.tareWeightKg,
                netWeightKg: firstItem?.weightKg || 0,
                calculatedAmount: firstItem?.amount || 0,
              },
              {
                productId: secondItem?.productName || '',
                productName: secondItem?.productName || 'આઇટમ ૨',
                ratePer20Kg: secondItem?.ratePer20Kg || 0,
                bags: secondItem?.bags || [],
                grossWeightKg: secondItem?.grossWeightKg || secondItem?.weightKg || 0,
                tareWeightKg: secondItem?.tareWeightKg,
                netWeightKg: secondItem?.weightKg || 0,
                calculatedAmount: secondItem?.amount || 0,
              },
            ]
          : undefined,
      };
    }
    return null;
  }, [weighment, bill]);

  const [currentWeighment, setCurrentWeighment] = useState<KantaWeighment | null>(initialWeighment);

  useEffect(() => {
    setCurrentWeighment(initialWeighment);
  }, [initialWeighment]);

  useEffect(() => {
    setCustomerName(bill.customerName || '');
    setItems(
      getDecomposedBillItems(bill).map((it) => ({
        ...it,
        weightStr: it.weightKg !== undefined && it.weightKg !== null && it.weightKg > 0 ? String(it.weightKg) : '',
        rateStr: it.ratePer20Kg !== undefined && it.ratePer20Kg !== null && it.ratePer20Kg > 0 ? String(it.ratePer20Kg) : '',
        amountStr: it.amount !== undefined && it.amount !== null && it.amount > 0 ? String(it.amount) : '',
      }))
    );
  }, [bill]);

  // Check if this bill actually originated from a weighment / kanta slip (આંકડા)
  // Direct bills created from "નવું બિલ" have NO weighment slip and NO bags/figures, so '#' symbol should NOT appear!
  const hasWeighment = useMemo(() => {
    if (initialWeighment) {
      const hasBags =
        (initialWeighment.bags && initialWeighment.bags.length > 0) ||
        (initialWeighment.items && initialWeighment.items.some((it) => it.bags && it.bags.length > 0)) ||
        (initialWeighment.totalBagsCount && initialWeighment.totalBagsCount > 0);
      return Boolean(hasBags || bill.weighmentSlip || bill.weighmentId);
    }
    return Boolean(bill.weighmentSlip || bill.weighmentId);
  }, [initialWeighment, bill]);

  // Effective weighment for editing via inside '#' (only valid if hasWeighment is true)
  const effectiveWeighment: KantaWeighment | null = useMemo(() => {
    if (!hasWeighment || !currentWeighment) {
      return null;
    }

    if (currentWeighment.items && currentWeighment.items.length === 2 && items.length >= 2) {
      const i1 = currentWeighment.items[0];
      const i2 = currentWeighment.items[1];
      return {
        ...currentWeighment,
        customerName: customerName || currentWeighment.customerName,
        items: [
          {
            ...i1,
            productName: items[0]?.productName || i1.productName,
            ratePer20Kg: items[0]?.ratePer20Kg ?? i1.ratePer20Kg,
            calculatedAmount:
              (items[0]?.ratePer20Kg ?? i1.ratePer20Kg) > 0
                ? Math.round((i1.netWeightKg / 20) * (items[0]?.ratePer20Kg ?? i1.ratePer20Kg))
                : i1.calculatedAmount,
          },
          {
            ...i2,
            productName: items[1]?.productName || i2.productName,
            ratePer20Kg: items[1]?.ratePer20Kg ?? i2.ratePer20Kg,
            calculatedAmount:
              (items[1]?.ratePer20Kg ?? i2.ratePer20Kg) > 0
                ? Math.round((i2.netWeightKg / 20) * (items[1]?.ratePer20Kg ?? i2.ratePer20Kg))
                : i2.calculatedAmount,
          },
        ],
      };
    }
    return {
      ...currentWeighment,
      customerName: customerName || currentWeighment.customerName,
      productName: items[0]?.productName || currentWeighment.productName,
      ratePer20Kg: items[0]?.ratePer20Kg ?? currentWeighment.ratePer20Kg,
    };
  }, [hasWeighment, currentWeighment, items, customerName]);

  // When figures are edited and saved from inside '#'
  const handleSaveFigures = (updated: KantaWeighment) => {
    setCurrentWeighment(updated);
    if (updated.customerName && updated.customerName.trim()) {
      setCustomerName(updated.customerName.trim());
    }

    if (updated.items && updated.items.length === 2) {
      const uItem1 = updated.items[0];
      const uItem2 = updated.items[1];

      setItems((prev) => {
        const next = [...prev];
        const rate1 = uItem1.ratePer20Kg || next[0]?.ratePer20Kg || 0;
        const weight1 = uItem1.netWeightKg;
        const amount1 =
          rate1 > 0
            ? Math.round((weight1 / 20) * rate1)
            : uItem1.calculatedAmount || next[0]?.amount || 0;

        const newItem1: EditableBillItem = {
          id: next[0]?.id || `item_1_${Date.now()}`,
          productId: uItem1.productId || next[0]?.productId || '',
          productName: uItem1.productName || next[0]?.productName || 'આઇટમ ૧',
          productShortcut: next[0]?.productShortcut || '',
          weightKg: weight1,
          ratePer20Kg: rate1,
          amount: amount1,
          weightStr: String(weight1),
          rateStr: String(rate1),
          amountStr: String(amount1),
        };

        const rate2 = uItem2.ratePer20Kg || next[1]?.ratePer20Kg || 0;
        const weight2 = uItem2.netWeightKg;
        const amount2 =
          rate2 > 0
            ? Math.round((weight2 / 20) * rate2)
            : uItem2.calculatedAmount || next[1]?.amount || 0;

        const newItem2: EditableBillItem = {
          id: next[1]?.id || `item_2_${Date.now()}`,
          productId: uItem2.productId || next[1]?.productId || '',
          productName: uItem2.productName || next[1]?.productName || 'આઇટમ ૨',
          productShortcut: next[1]?.productShortcut || '',
          weightKg: weight2,
          ratePer20Kg: rate2,
          amount: amount2,
          weightStr: String(weight2),
          rateStr: String(rate2),
          amountStr: String(amount2),
        };

        return [newItem1, newItem2];
      });
    } else {
      setItems((prev) => {
        if (prev.length === 0) {
          return [
            {
              id: `item_edited_${Date.now()}`,
              productId: updated.productId || '',
              productName: updated.productName || 'માલ',
              productShortcut: '',
              weightKg: updated.totalWeightKg,
              ratePer20Kg: updated.ratePer20Kg || 0,
              amount: updated.calculatedAmount || 0,
              weightStr: String(updated.totalWeightKg),
              rateStr: String(updated.ratePer20Kg || 0),
              amountStr: String(updated.calculatedAmount || 0),
            },
          ];
        }
        const next = [...prev];
        const newWeight = updated.totalWeightKg;
        const currentRate = next[0].ratePer20Kg || updated.ratePer20Kg || 0;
        const newAmount =
          currentRate > 0 ? Math.round((newWeight / 20) * currentRate) : next[0].amount;

        next[0] = {
          ...next[0],
          weightKg: newWeight,
          amount: newAmount,
          weightStr: String(newWeight),
          amountStr: String(newAmount),
          productName: updated.productName || next[0].productName,
        };
        return next;
      });
    }

    // Cloud sync if it has an id
    if (updated.id && !updated.id.startsWith('slip_')) {
      saveKantaWeighmentToCloud(updated).catch((err) =>
        console.warn('Save updated weighment error:', err)
      );
    }
  };

  // Handle item weight change with full decimal typing support
  const handleItemWeightChange = (index: number, val: string) => {
    // Replace comma with dot if mobile keyboard typed comma
    const cleanVal = val.replace(',', '.');
    // Allow empty string, digits, and a single decimal point (e.g. "95", "95.", "95.6")
    if (cleanVal !== '' && !/^\d*\.?\d*$/.test(cleanVal)) {
      return;
    }
    const numWeight = parseFloat(cleanVal) || 0;
    setItems((prev) => {
      const next = [...prev];
      const cur = next[index];
      let newAmount = cur.amount;
      let newAmountStr = cur.amountStr;
      if (cur.ratePer20Kg > 0 && numWeight > 0) {
        newAmount = Math.round((numWeight / 20) * cur.ratePer20Kg);
        newAmountStr = String(newAmount);
      }
      next[index] = {
        ...cur,
        weightKg: numWeight,
        weightStr: cleanVal,
        amount: newAmount,
        amountStr: newAmountStr,
      };
      return next;
    });
  };

  // Handle item rate change with full decimal typing support
  const handleItemRateChange = (index: number, val: string) => {
    const cleanVal = val.replace(',', '.');
    if (cleanVal !== '' && !/^\d*\.?\d*$/.test(cleanVal)) {
      return;
    }
    const numRate = parseFloat(cleanVal) || 0;
    setItems((prev) => {
      const next = [...prev];
      const cur = next[index];
      let newAmount = cur.amount;
      let newAmountStr = cur.amountStr;
      if (cur.weightKg > 0 && numRate > 0) {
        newAmount = Math.round((cur.weightKg / 20) * numRate);
        newAmountStr = String(newAmount);
      }
      next[index] = {
        ...cur,
        ratePer20Kg: numRate,
        rateStr: cleanVal,
        amount: newAmount,
        amountStr: newAmountStr,
      };
      return next;
    });
  };

  // Handle item manual amount change with full decimal typing support
  const handleItemAmountChange = (index: number, val: string) => {
    const cleanVal = val.replace(',', '.');
    if (cleanVal !== '' && !/^\d*\.?\d*$/.test(cleanVal)) {
      return;
    }
    const numAmount = parseFloat(cleanVal) || 0;
    setItems((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        amount: numAmount,
        amountStr: cleanVal,
      };
      return next;
    });
  };

  // Remove an item
  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) {
      alert('ઓછામાં ઓછી એક આઇટમ રાખવી જરૂરી છે');
      return;
    }
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Add a product item
  const handleAddProduct = (prod: Product) => {
    const newItem: EditableBillItem = {
      id: `item_${Date.now()}_${Math.random()}`,
      productId: prod.id,
      productName: prod.name,
      productShortcut: prod.shortcut,
      weightKg: 0,
      ratePer20Kg: prod.lastRatePer20Kg,
      amount: 0,
      weightStr: '',
      rateStr: prod.lastRatePer20Kg ? String(prod.lastRatePer20Kg) : '',
      amountStr: '',
    };
    setItems((prev) => [...prev, newItem]);
  };

  // Calculate totals
  const totalWeightKg = items.reduce((sum, it) => sum + (it.weightKg || 0), 0);
  const totalWeightMan = Number((totalWeightKg / 20).toFixed(2));
  const totalAmount = items.reduce((sum, it) => sum + (it.amount || 0), 0);

  const handleSave = async (andPrint: boolean = false) => {
    if (items.length === 0) {
      alert('ઓછામાં ઓછી એક આઇટમ હોવી જરૂરી છે');
      return;
    }

    const isMultiWeighment = Boolean(currentWeighment?.items && currentWeighment.items.length === 2);
    const updatedSlip: WeighmentSlipData | undefined = currentWeighment
      ? {
          tokenNo: currentWeighment.tokenNo,
          date: currentWeighment.date,
          time: currentWeighment.time,
          customerName: customerName || currentWeighment.customerName,
          items: isMultiWeighment
            ? currentWeighment.items!.map((it, idx) => ({
                productName: items[idx]?.productName || it.productName,
                weightKg: items[idx]?.weightKg ?? it.netWeightKg,
                grossWeightKg: it.grossWeightKg,
                tareWeightKg: it.tareWeightKg,
                weightMan: Math.round(((items[idx]?.weightKg ?? it.netWeightKg) / 20) * 10) / 10,
                ratePer20Kg: items[idx]?.ratePer20Kg ?? it.ratePer20Kg,
                amount: items[idx]?.amount ?? it.calculatedAmount,
                bags: it.bags,
              }))
            : [
                {
                  productName: items[0]?.productName || currentWeighment.productName,
                  weightKg: items[0]?.weightKg ?? currentWeighment.totalWeightKg,
                  grossWeightKg:
                    currentWeighment.bags.length > 0
                      ? Math.round(currentWeighment.bags.reduce((a, b) => a + b, 0) * 10) / 10
                      : (items[0]?.weightKg ?? currentWeighment.totalWeightKg),
                  tareWeightKg: currentWeighment.tareWeightKg || undefined,
                  weightMan: Math.round(((items[0]?.weightKg ?? currentWeighment.totalWeightKg) / 20) * 10) / 10,
                  ratePer20Kg: items[0]?.ratePer20Kg ?? currentWeighment.ratePer20Kg,
                  amount: items[0]?.amount ?? currentWeighment.calculatedAmount,
                  bags: currentWeighment.bags,
                },
              ],
          totalBagsCount: currentWeighment.totalBagsCount,
          totalWeightKg: totalWeightKg,
          grossWeightKg:
            currentWeighment.grossWeightKg ||
            (currentWeighment.bags.length > 0
              ? Math.round(currentWeighment.bags.reduce((a, b) => a + b, 0) * 10) / 10
              : totalWeightKg),
          tareWeightKg: currentWeighment.tareWeightKg,
          totalWeightMan: totalWeightMan,
          totalAmount: totalAmount,
        }
      : bill.weighmentSlip;

    const updatedBill: VoucherBill = {
      ...bill,
      customerName: customerName.trim() || 'સામાન્ય ગ્રાહક',
      items: items,
      totalWeightKg: Math.round(totalWeightKg * 100) / 100,
      totalWeightMan,
      grossAmount: totalAmount,
      discountLess: 0,
      finalTotal: totalAmount,
      weighmentSlip: updatedSlip,
    };

    if (andPrint) {
      setIsPrinting(true);
      setPrintStatus('પ્રિન્ટ મોકલાઈ રહી છે...');
      try {
        if (settings) {
          await printReceiptDirectly(updatedBill, settings, (st) => setPrintStatus(st));
        }
      } catch (err: any) {
        console.warn('Direct print error in edit modal:', err);
        const isUserCancel =
          err?.name === 'NotFoundError' ||
          err?.message?.includes('User cancelled') ||
          err?.message?.includes('કોઈ પ્રિન્ટર પસંદ કરવામાં આવ્યું નથી');

        if (!isUserCancel) {
          alert(
            err?.message === 'IFRAME_PERMISSION_ERROR'
              ? 'બ્લૂટૂથ પ્રિન્ટિંગ માટે એપ નવી ટેબમાં ખોલવી જરૂરી છે.'
              : `પ્રિન્ટિંગ એરર: ${err?.message || 'પ્રિન્ટર કનેક્ટ થઈ શક્યું નહીં.'}`
          );
        }
      } finally {
        setIsPrinting(false);
      }
    }

    onSave(updatedBill);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[92vh] border border-slate-200">
        {/* Modal Header */}
        <div className="p-4 bg-amber-500 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center font-bold">
              <Edit3 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-black text-base leading-tight">
                બિલ એડિટ કરો ({bill.billNoStr})
              </h3>
              <p className="text-[11px] text-amber-100 font-semibold">
                સમય: {bill.time}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition cursor-pointer"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* Customer Name */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 block">
              ગ્રાહકનું નામ:
            </label>
            <input
              type="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="words"
              spellCheck={false}
              data-form-type="other"
              data-lpignore="true"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
              placeholder="ગ્રાહકનું નામ લખો..."
            />
          </div>

          {/* Items List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 block">
                આઇટમ્સની વિગત (વજન, ભાવ અને રકમ):
              </label>
            </div>

            {items.map((it, idx) => (
              <div
                key={it.id || idx}
                className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-black text-sm text-slate-900">
                    {idx + 1}. {it.productName}
                  </span>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(idx)}
                      className="text-slate-400 hover:text-red-600 p-1 rounded-lg transition"
                      title="આઇટમ કાઢી નાખો"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 block mb-0.5">
                      વજન (kg)
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      data-form-type="other"
                      data-lpignore="true"
                      value={it.weightStr !== undefined ? it.weightStr : (it.weightKg ? String(it.weightKg) : '')}
                      onChange={(e) => handleItemWeightChange(idx, e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono font-bold text-sm bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 block mb-0.5">
                      ભાવ (₹/૨૦kg)
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      data-form-type="other"
                      data-lpignore="true"
                      value={it.rateStr !== undefined ? it.rateStr : (it.ratePer20Kg ? String(it.ratePer20Kg) : '')}
                      onChange={(e) => handleItemRateChange(idx, e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono font-bold text-sm bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 block mb-0.5">
                      રકમ (₹)
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      data-form-type="other"
                      data-lpignore="true"
                      value={it.amountStr !== undefined ? it.amountStr : (it.amount ? String(it.amount) : '')}
                      onChange={(e) => handleItemAmountChange(idx, e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono font-black text-sm bg-white text-emerald-800 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>
            ))}

            {/* Action Buttons: '+' to add item, '#' to edit figures (Strictly NO text labels as requested) */}
            <div className="pt-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="open-add-item-box-btn"
                  onClick={() => setShowItemBox((prev) => !prev)}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center transition shadow-2xs cursor-pointer active:scale-95 ${
                    showItemBox
                      ? 'bg-amber-500 text-white border border-amber-600'
                      : 'bg-slate-100 hover:bg-amber-500 text-slate-700 hover:text-white border border-slate-300'
                  }`}
                  title="નવી આઇટમ ઉમેરો (+)"
                  aria-label="નવી આઇટમ ઉમેરો"
                >
                  <Plus className="w-5 h-5 stroke-[2.5]" />
                </button>

                {hasWeighment && effectiveWeighment && (
                  <button
                    type="button"
                    id="open-edit-figures-btn"
                    onClick={() => setShowFiguresModal(true)}
                    className="w-9 h-9 rounded-xl bg-teal-700 hover:bg-teal-800 active:scale-95 text-white flex items-center justify-center transition shadow-2xs cursor-pointer border border-teal-800"
                    title="આંકડા એડિટ કરો (#)"
                    aria-label="આંકડા એડિટ કરો"
                  >
                    <Hash className="w-5 h-5 stroke-[2.5]" />
                  </button>
                )}
              </div>

              {/* Item Name Box: Opens when '+' is clicked */}
              {showItemBox && (
                <div className="mt-2.5 p-3 bg-slate-50 border border-amber-300 rounded-2xl shadow-xs space-y-2 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                    <span className="text-xs font-bold text-slate-700">
                      આઇટમનું નામ પસંદ કરો:
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowItemBox(false)}
                      className="p-1 text-slate-400 hover:text-slate-600 rounded-md cursor-pointer"
                      title="બંધ કરો"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {products.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          handleAddProduct(p);
                          setShowItemBox(false);
                        }}
                        className="px-2.5 py-2 bg-white hover:bg-amber-500 hover:text-white text-slate-800 border border-slate-200 hover:border-amber-500 rounded-xl text-xs font-bold transition text-left truncate flex items-center justify-between shadow-2xs active:scale-95 cursor-pointer"
                      >
                        <span className="truncate">{p.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono ml-1">
                          ₹{p.lastRatePer20Kg}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Live Totals summary */}
          <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-emerald-800 block">
                કુલ વજન:
              </span>
              <span className="text-sm font-black text-emerald-950 font-mono">
                {totalWeightKg.toFixed(1)} kg
              </span>
            </div>
            <div className="text-right">
              <span className="text-[11px] font-bold text-emerald-800 block">
                કુલ રકમ:
              </span>
              <span className="text-base sm:text-lg font-black text-emerald-900 font-mono">
                {formatINR(totalAmount)}
              </span>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            id="cancel-edit-bill-btn"
            disabled={isPrinting}
            onClick={onClose}
            className="px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-100 transition cursor-pointer disabled:opacity-50"
          >
            રદ કરો
          </button>
          <button
            type="button"
            id="save-update-bill-btn"
            disabled={isPrinting}
            onClick={() => handleSave(false)}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-black text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition cursor-pointer disabled:opacity-50"
          >
            <Check className="w-4 h-4 text-emerald-400" />
            <span>સેવ કરો (Update)</span>
          </button>
          <button
            type="button"
            id="save-and-print-edit-bill-btn"
            disabled={isPrinting}
            onClick={() => handleSave(true)}
            className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white font-black text-xs flex items-center gap-1.5 shadow-sm transition cursor-pointer disabled:opacity-50"
          >
            {isPrinting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{printStatus || 'પ્રિન્ટ થાય છે...'}</span>
              </>
            ) : (
              <>
                <Printer className="w-4 h-4" />
                <span>સેવ એન્ડ પ્રિન્ટ (Save & Print)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Edit Figures Modal (અંદરના # થી આંકડા એડિટ થાય) */}
      {showFiguresModal && effectiveWeighment && (
        <WeighmentDetailModal
          weighment={effectiveWeighment}
          isEditable={true}
          onClose={() => setShowFiguresModal(false)}
          onSaveFigures={handleSaveFigures}
        />
      )}
    </div>
  );
};
