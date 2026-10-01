import React, { useState, useEffect, useRef } from 'react';
import {
  Printer,
  XCircle,
  X,
  Calendar,
  Clock,
  Save,
  Check,
  Plus,
  Loader2,
  Bluetooth,
  RefreshCw,
  Scale,
  Eye,
  ChevronDown,
  ChevronUp,
  Hash,
} from 'lucide-react';
import { BillItem, FirmSettings, Product, SessionType, VoucherBill, WeighmentSlipData, WeighmentSlipItem } from '../types';
import {
  formatINR,
  getNextBillNo,
  formatDateDDMMYY,
} from '../utils/storage';
import { WeighmentDetailModal } from './WeighmentDetailModal';
import {
  isWebBluetoothSupported,
  isBluetoothConnected,
  isPrinterConfiguredOrPermitted,
  subscribeBluetoothStatus,
  attemptSilentReconnect,
  ensureConnectedPrinter,
  requestWakeLock,
} from '../utils/bluetoothPrinter';
import { printReceiptDirectly, printWeighmentDirectly } from '../utils/directPrint';
import { AddItemModal } from './AddItemModal';
import { VoiceBillingBar } from './VoiceBillingBar';
import {
  KantaWeighment,
  subscribeToWeighments,
  updateWeighmentStatus,
  enqueuePrintJob,
  saveKantaWeighmentToCloud,
} from '../utils/firebaseSync';

const BILL_DRAFT_KEY = 'mandi_bill_active_draft_v1';

const getStoredBillDraft = () => {
  try {
    const raw = localStorage.getItem(BILL_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
};

interface TodayBillViewProps {
  businessDate: string;
  currentSession: SessionType;
  products: Product[];
  settings: FirmSettings;
  bills: VoucherBill[];
  initialWeighment?: KantaWeighment | null;
  onClearInitialWeighment?: () => void;
  onSaveBill: (bill: VoucherBill, updatedProducts: Product[]) => void;
  onDeleteBill?: (id: string) => void;
  onSaveProducts?: (products: Product[]) => void;
  onOpenReceipt: (bill: VoucherBill) => void;
  onOpenReport?: () => void;
  onGoToKanta?: () => void;
  onClose?: () => void;
  onAfterBillSavedOrPrinted?: () => void;
}

export const TodayBillView: React.FC<TodayBillViewProps> = ({
  businessDate,
  currentSession,
  products,
  settings,
  bills,
  initialWeighment,
  onClearInitialWeighment,
  onSaveBill,
  onOpenReceipt,
  onSaveProducts,
  onGoToKanta,
  onClose,
  onAfterBillSavedOrPrinted,
}) => {
  const initialBillDraft = useRef(getStoredBillDraft()).current;

  // Form State
  const [customerName, setCustomerName] = useState(() => initialBillDraft?.customerName || '');
  const [voiceResetKey, setVoiceResetKey] = useState(0);
  const [attachedWeighmentId, setAttachedWeighmentId] = useState<string | null>(() => initialBillDraft?.attachedWeighmentId || null);
  const [attachedWeighmentIds, setAttachedWeighmentIds] = useState<string[]>(() => {
    if (initialBillDraft?.attachedWeighmentIds && Array.isArray(initialBillDraft.attachedWeighmentIds)) {
      return initialBillDraft.attachedWeighmentIds;
    }
    return initialBillDraft?.attachedWeighmentId ? [initialBillDraft.attachedWeighmentId] : [];
  });

  // Cloud Kanta Weighments (બહાર કાંટા પરથી આવેલા વજન)
  const [pendingWeighments, setPendingWeighments] = useState<KantaWeighment[]>([]);
  const [allWeighments, setAllWeighments] = useState<KantaWeighment[]>([]);
  const [viewingKantaWeighment, setViewingKantaWeighment] = useState<KantaWeighment | null>(null);
  const [isKantaExpanded, setIsKantaExpanded] = useState<boolean>(false);
  const lastSavedBillRef = useRef<VoucherBill | null>(null);
  const lastSavedWeighmentsRef = useRef<KantaWeighment[]>([]);
  const [isWeightPrinting, setIsWeightPrinting] = useState(false);

  useEffect(() => {
    const unsub = subscribeToWeighments((list) => {
      setAllWeighments(list);
      const pending = list.filter((w) => w.status === 'pending');
      setPendingWeighments(pending);
    });
    return () => unsub();
  }, []);
  // Direct Print state & live Bluetooth status
  const [isDirectPrinting, setIsDirectPrinting] = useState(false);
  const [directPrintStatus, setDirectPrintStatus] = useState<string | null>(null);
  const [btConnected, setBtConnected] = useState<boolean>(() => isBluetoothConnected());
  const [isBtConnecting, setIsBtConnecting] = useState(false);

  // In native Android APK or installed standalone mode, hide the manual reconnect row
  const isStandaloneOrApk =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((window.navigator as any).standalone) ||
      Boolean((window as any).isAndroidApk));

  useEffect(() => {
    // Keep screen awake while billing page is active
    requestWakeLock();

    // Subscribe to real-time Bluetooth connection status changes
    const unsubscribe = subscribeBluetoothStatus((connected) => {
      setBtConnected(connected);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Active product IDs whose input boxes are open
  const [activeProductIds, setActiveProductIds] = useState<string[]>(() => initialBillDraft?.activeProductIds || []);

  // Horizontal sliding carousel ref and active slide tracker
  const productSliderRef = useRef<HTMLDivElement>(null);
  const [activeSlide, setActiveSlide] = useState(0);

  // Real-time live clock ticker (updates every second)
  const [currentTime, setCurrentTime] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 1. Cleaned products: strictly preserves custom order from Settings
  const cleanProducts = React.useMemo(() => {
    return (products || []).filter(
      (p) => p && p.name !== 'ડાંગર' && p.id !== 'p_dangar'
    );
  }, [products]);

  // Modal to add new item
  const [showAddItemModal, setShowAddItemModal] = useState(false);

  const handleAddNewProduct = (newProduct: Product) => {
    const updated = [...cleanProducts, newProduct];
    if (onSaveProducts) {
      onSaveProducts(updated);
    }
    handleProductToggle(newProduct);
  };

  // Build slides:
  // - Slide 1 (પહેલી સ્લાઇડ): The first 4 products in cleanProducts (મુખ્ય સ્ક્રીન)
  // - Slide 2 (બીજી સ્લાઇડ): The remaining products + [+ એડ આઇટમ] button!
  const slides = React.useMemo(() => {
    type GridSlot =
      | { type: 'product'; product: Product }
      | { type: 'add_button' }
      | { type: 'empty' };

    const slide1Prods = cleanProducts.slice(0, 4);
    const remainingProds = cleanProducts.slice(4);

    const pages: { slots: GridSlot[] }[] = [];

    // Slide 1: exactly the first 4 products
    const page1Slots: GridSlot[] = slide1Prods.map((p) => ({ type: 'product', product: p }));
    while (page1Slots.length < 4) {
      page1Slots.push({ type: 'empty' });
    }
    pages.push({ slots: page1Slots });

    // Secondary slide(s): remaining products + [+ એડ આઇટમ] button
    let currIdx = 0;
    while (currIdx < remainingProds.length || pages.length < 2) {
      const pageSlots: GridSlot[] = [];
      // Take up to 3 products so there's always space for [+ એડ આઇટમ]
      while (pageSlots.length < 3 && currIdx < remainingProds.length) {
        pageSlots.push({ type: 'product', product: remainingProds[currIdx++] });
      }

      // If no more products left, add [+ એડ આઇટમ]
      if (currIdx >= remainingProds.length) {
        pageSlots.push({ type: 'add_button' });
      } else if (pageSlots.length < 4) {
        pageSlots.push({ type: 'product', product: remainingProds[currIdx++] });
      }

      while (pageSlots.length < 4) {
        pageSlots.push({ type: 'empty' });
      }

      pages.push({ slots: pageSlots });

      if (currIdx >= remainingProds.length) {
        break;
      }
    }

    return pages;
  }, [cleanProducts]);

  const totalSlides = slides.length;

  const handleSliderScroll = () => {
    if (productSliderRef.current) {
      const scrollLeft = productSliderRef.current.scrollLeft;
      const width = productSliderRef.current.clientWidth;
      if (width > 0) {
        const index = Math.round(scrollLeft / width);
        setActiveSlide(index);
      }
    }
  };

  // Input states (weight, rate, amount) for each product
  const [productInputs, setProductInputs] = useState<
    Record<string, { weight: string; rate: string; amount?: string }>
  >(() => {
    const init: Record<string, { weight: string; rate: string; amount?: string }> = {};
    (products || []).forEach((p) => {
      const draftVal = initialBillDraft?.productInputs?.[p.id];
      init[p.id] = {
        weight: draftVal?.weight || '',
        rate: draftVal?.rate || p.lastRatePer20Kg.toString(),
        amount: draftVal?.amount || '',
      };
    });
    return init;
  });

  // Keep draft updated in localStorage so mobile screen-off or reload never loses entered values
  useEffect(() => {
    const hasAny =
      customerName.trim().length > 0 ||
      activeProductIds.length > 0 ||
      Object.values(productInputs).some((v: { weight: string }) => v?.weight && v.weight.trim().length > 0);

    if (hasAny) {
      try {
        localStorage.setItem(
          BILL_DRAFT_KEY,
          JSON.stringify({
            customerName,
            activeProductIds,
            productInputs,
            attachedWeighmentId,
            attachedWeighmentIds,
          })
        );
      } catch (e) {}
    }
  }, [customerName, activeProductIds, productInputs, attachedWeighmentId, attachedWeighmentIds]);

  // Handle incoming weighment if opened directly from Kanta view
  useEffect(() => {
    if (initialWeighment) {
      handleAttachWeighment(initialWeighment);
      if (onClearInitialWeighment) {
        onClearInitialWeighment();
      }
    }
  }, [initialWeighment]);

  // Attach a single weighment from outside Kanta to current bill (merges if same customer)
  const handleAttachWeighment = (rawW: KantaWeighment) => {
    const w = allWeighments.find((aw) => aw.id === rawW.id) || rawW;
    const isSameCustomer =
      !customerName.trim() ||
      customerName.trim().toLowerCase() === (w.customerName || '').trim().toLowerCase();

    if (isSameCustomer) {
      if (!customerName.trim()) {
        setCustomerName(w.customerName);
      }
      const effectiveItems =
        w.items && w.items.length > 0
          ? w.items
          : (w as any).weighmentSlip?.items && (w as any).weighmentSlip.items.length > 0
          ? (w as any).weighmentSlip.items
          : null;

      if (effectiveItems && effectiveItems.length > 0) {
        const itemProdIds: string[] = [];
        const itemInputs: Record<string, { weight: string; rate: string; amount?: string }> = {};
        effectiveItems.forEach((it: any) => {
          const prod = cleanProducts.find((p) => p.id === it.productId || p.name === it.productName) || cleanProducts[0];
          if (prod) {
            itemProdIds.push(prod.id);
            itemInputs[prod.id] = {
              weight: (it.netWeightKg ?? it.weightKg ?? '').toString(),
              rate: (it.ratePer20Kg ?? '').toString(),
              amount: (it.calculatedAmount ?? it.amount ?? '').toString(),
            };
          }
        });
        setActiveProductIds((prev) => Array.from(new Set([...prev, ...itemProdIds])));
        setProductInputs((prev) => ({ ...prev, ...itemInputs }));
      } else {
        const targetProd = cleanProducts.find((p) => p.id === w.productId) || cleanProducts[0];
        if (targetProd) {
          setActiveProductIds((prev) => Array.from(new Set([...prev, targetProd.id])));
          setProductInputs((prev) => ({
            ...prev,
            [targetProd.id]: {
              weight: w.totalWeightKg.toString(),
              rate: w.ratePer20Kg.toString(),
              amount: w.calculatedAmount.toString(),
            },
          }));
        }
      }
      setAttachedWeighmentIds((prev) => Array.from(new Set([...prev, w.id])));
    } else {
      // Different customer name: replace with this customer's details
      setCustomerName(w.customerName);
      setAttachedWeighmentIds([w.id]);
      const effectiveItems =
        w.items && w.items.length > 0
          ? w.items
          : (w as any).weighmentSlip?.items && (w as any).weighmentSlip.items.length > 0
          ? (w as any).weighmentSlip.items
          : null;

      if (effectiveItems && effectiveItems.length > 0) {
        const itemProdIds: string[] = [];
        const itemInputs: Record<string, { weight: string; rate: string; amount?: string }> = {};
        effectiveItems.forEach((it: any) => {
          const prod = cleanProducts.find((p) => p.id === it.productId || p.name === it.productName) || cleanProducts[0];
          if (prod) {
            itemProdIds.push(prod.id);
            itemInputs[prod.id] = {
              weight: (it.netWeightKg ?? it.weightKg ?? '').toString(),
              rate: (it.ratePer20Kg ?? '').toString(),
              amount: (it.calculatedAmount ?? it.amount ?? '').toString(),
            };
          }
        });
        setActiveProductIds(itemProdIds);
        setProductInputs(itemInputs);
      } else {
        const targetProd = cleanProducts.find((p) => p.id === w.productId) || cleanProducts[0];
        if (targetProd) {
          setActiveProductIds([targetProd.id]);
          setProductInputs({
            [targetProd.id]: {
              weight: w.totalWeightKg.toString(),
              rate: w.ratePer20Kg.toString(),
              amount: w.calculatedAmount.toString(),
            },
          });
        }
      }
    }
  };

  // Attach ALL pending weighments for a customer into 1 single comprehensive bill
  const handleAttachAllForCustomer = (weighmentsForCust: KantaWeighment[]) => {
    if (weighmentsForCust.length === 0) return;
    const custName = weighmentsForCust[0].customerName;
    setCustomerName(custName);

    const newProdIds: string[] = [];
    const newInputs: Record<string, { weight: string; rate: string; amount?: string }> = { ...productInputs };
    const newAttachedIds: string[] = [...attachedWeighmentIds];

    weighmentsForCust.forEach((rawW) => {
      const w = allWeighments.find((aw) => aw.id === rawW.id) || rawW;
      const effectiveItems =
        w.items && w.items.length > 0
          ? w.items
          : (w as any).weighmentSlip?.items && (w as any).weighmentSlip.items.length > 0
          ? (w as any).weighmentSlip.items
          : null;

      if (effectiveItems && effectiveItems.length > 0) {
        effectiveItems.forEach((it: any) => {
          const prod = cleanProducts.find((p) => p.id === it.productId || p.name === it.productName) || cleanProducts[0];
          if (prod) {
            newProdIds.push(prod.id);
            newInputs[prod.id] = {
              weight: (it.netWeightKg ?? it.weightKg ?? '').toString(),
              rate: (it.ratePer20Kg ?? '').toString(),
              amount: (it.calculatedAmount ?? it.amount ?? '').toString(),
            };
          }
        });
      } else {
        const targetProd = cleanProducts.find((p) => p.id === w.productId) || cleanProducts[0];
        if (targetProd) {
          newProdIds.push(targetProd.id);
          newInputs[targetProd.id] = {
            weight: w.totalWeightKg.toString(),
            rate: w.ratePer20Kg.toString(),
            amount: w.calculatedAmount.toString(),
          };
        }
      }
      newAttachedIds.push(w.id);
    });

    setActiveProductIds(Array.from(new Set([...activeProductIds, ...newProdIds])));
    setProductInputs(newInputs);
    setAttachedWeighmentIds(Array.from(new Set(newAttachedIds)));
  };

  // Group pending weighments by customer name for clear visibility
  const groupedPendingWeighments = React.useMemo(() => {
    const map = new Map<string, { customerName: string; weighments: KantaWeighment[] }>();
    pendingWeighments.forEach((w) => {
      const key = (w.customerName || 'સામાન્ય ખેડૂત').trim().toLowerCase();
      if (!map.has(key)) {
        map.set(key, { customerName: w.customerName || 'સામાન્ય ખેડૂત', weighments: [] });
      }
      map.get(key)!.weighments.push(w);
    });
    return Array.from(map.values());
  }, [pendingWeighments]);

  // Ensure all products have initial rates in state
  useEffect(() => {
    setProductInputs((prev) => {
      const updated = { ...prev };
      let changed = false;
      cleanProducts.forEach((p) => {
        if (!updated[p.id]) {
          updated[p.id] = { weight: '', rate: p.lastRatePer20Kg.toString(), amount: '' };
          changed = true;
        }
      });
      return changed ? updated : prev;
    });
  }, [cleanProducts]);

  const customerInputRef = useRef<HTMLInputElement>(null);

  // Function to remove/close an item and reset its weight and amount
  const handleRemoveProduct = (productId: string) => {
    setActiveProductIds((prev) => prev.filter((id) => id !== productId));
    setProductInputs((prev) => {
      const current = prev[productId];
      const prod = cleanProducts.find((p) => p.id === productId);
      const defRate = prod ? prod.lastRatePer20Kg.toString() : current?.rate || '';
      return {
        ...prev,
        [productId]: {
          weight: '',
          rate: defRate,
          amount: '',
        },
      };
    });
  };

  // Toggle product open / close (Tik / select item first)
  const handleProductToggle = (p: Product) => {
    setActiveProductIds((prev) => {
      if (prev.includes(p.id)) {
        // Close and clear if already open
        handleRemoveProduct(p.id);
        return prev.filter((id) => id !== p.id);
      } else {
        return [...prev, p.id];
      }
    });

    // Make sure rate is populated
    setProductInputs((prev) => {
      if (!prev[p.id] || !prev[p.id].rate) {
        return {
          ...prev,
          [p.id]: {
            weight: '',
            rate: p.lastRatePer20Kg.toString(),
            amount: '',
          },
        };
      }
      return prev;
    });
  };

  // Helper to render individual product selection button
  const renderProductButton = (p: Product) => {
    const isOpen = activeProductIds.includes(p.id);
    return (
      <button
        key={p.id}
        type="button"
        id={`product-select-${p.id}`}
        onClick={() => handleProductToggle(p)}
        className={`h-13 sm:h-16 py-1 px-2 rounded-xl border text-center transition flex flex-col items-center justify-center gap-0.5 cursor-pointer select-none active:scale-95 shadow-2xs ${
          isOpen
            ? 'bg-emerald-700 text-white border-emerald-800 ring-2 ring-emerald-600/30'
            : 'bg-white text-slate-800 border-slate-300 hover:border-emerald-500 hover:bg-slate-50'
        }`}
      >
        <span className="font-black text-xs sm:text-base leading-tight truncate max-w-full px-1">
          {p.name}
        </span>
        <span
          className={`font-mono font-bold text-[11px] sm:text-sm leading-tight ${
            isOpen ? 'text-emerald-100' : 'text-slate-500'
          }`}
        >
          ₹{p.lastRatePer20Kg}
        </span>
      </button>
    );
  };

  // When Enter is pressed in customer name, move down to selected item's rate box (or weight if rate not present)
  const handleCustomerEnter = () => {
    const targetId = activeProductIds[0];
    if (targetId) {
      setTimeout(() => {
        const rateEl = document.getElementById(`rate-input-${targetId}`) as HTMLInputElement | null;
        if (rateEl) {
          rateEl.focus();
          rateEl.select();
        } else {
          const weightEl = document.getElementById(`weight-input-${targetId}`) as HTMLInputElement | null;
          if (weightEl) {
            weightEl.focus();
            weightEl.select();
          }
        }
      }, 50);
    } else {
      // If user hasn't ticked an item yet, inform them gently
      alert('કૃપા કરીને પહેલા આઇટમ ટીક (પસંદ) કરો.');
    }
  };

  const handleProductInputChange = (
    pId: string,
    field: 'weight' | 'rate' | 'amount',
    val: string
  ) => {
    setProductInputs((prev) => {
      const current = prev[pId] || { weight: '', rate: '', amount: '' };
      const next = { ...current, [field]: val };

      // If user altered weight or rate, auto-calculate amount
      if (field === 'weight' || field === 'rate') {
        const w = parseFloat(next.weight) || 0;
        const r = parseFloat(next.rate) || 0;
        if (w > 0 && r > 0) {
          next.amount = Math.round((w / 20) * r).toString();
        } else {
          next.amount = '';
        }
      }

      return {
        ...prev,
        [pId]: next,
      };
    });
  };

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      const isInputFocused =
        activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

      const key = e.key ? e.key.toLowerCase() : '';

      // Check if this key matches any product shortcut
      const matchedProduct = key
        ? cleanProducts.find(
            (p) => (p.shortcut || '').toLowerCase() === key
          )
        : undefined;

      if (matchedProduct) {
        if (!isInputFocused || e.altKey) {
          e.preventDefault();
          handleProductToggle(matchedProduct);
        }
      }

      // F2 to quick-save
      if (e.key === 'F2') {
        e.preventDefault();
        handleSubmit(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cleanProducts, activeProductIds, productInputs, customerName, currentSession]);

  // Compile full list of items from all active products where weight & rate > 0
  const getBillItems = (): BillItem[] => {
    const result: BillItem[] = [];
    activeProductIds.forEach((pId) => {
      const prod = cleanProducts.find((x) => x.id === pId);
      const inp = productInputs[pId];
      if (!prod || !inp) return;
      const w = parseFloat(inp.weight) || 0;
      const r = parseFloat(inp.rate) || 0;
      const customA = parseFloat(inp.amount || '');
      const calcA = Math.round((w / 20) * r);
      const finalAmt = !isNaN(customA) && customA > 0 ? customA : calcA;
      if (w > 0 && r > 0) {
        result.push({
          id: `item_${Date.now()}_${pId}`,
          productId: prod.id,
          productName: prod.name,
          productShortcut: prod.shortcut,
          weightKg: w,
          ratePer20Kg: r,
          amount: finalAmt,
        });
      }
    });
    return result;
  };

  const currentBillItems = getBillItems();
  const totalBillAmount = currentBillItems.reduce((acc, it) => acc + it.amount, 0);

  const currentBillNo = getNextBillNo(bills, businessDate, currentSession);

  // Submit bill
  const handleSubmit = (
    autoPrint: boolean = settings.autoPrintOnSave,
    overrideCustomerName?: string,
    overrideBillItems?: BillItem[],
    overrideWeighments?: KantaWeighment[]
  ) => {
    // If this bill came from outside kanta weighment(s), attach weighment slip for combined printing (વજન + બિલ એકસાથે)
    const idsToUpdate =
      overrideWeighments && overrideWeighments.length > 0
        ? overrideWeighments.map((w) => w.id)
        : attachedWeighmentIds.length > 0
        ? attachedWeighmentIds
        : attachedWeighmentId
        ? [attachedWeighmentId]
        : [];

    let currentAttached =
      overrideWeighments && overrideWeighments.length > 0
        ? overrideWeighments
        : allWeighments.filter((w) => idsToUpdate.includes(w.id));

    let billItems =
      overrideBillItems && overrideBillItems.length > 0
        ? overrideBillItems
        : getBillItems();

    // If attached weighment has multiple items, ensure billItems records each commodity separately
    if (currentAttached.length > 0) {
      const multiW = currentAttached.find((w) => w.items && w.items.length > 1);
      if (
        multiW &&
        multiW.items &&
        (billItems.length <= 1 || billItems.some((bi) => bi.productName && bi.productName.includes('+')))
      ) {
        billItems = multiW.items.map((it, itIdx) => {
          const prod = cleanProducts.find((p) => p.id === it.productId || p.name === it.productName) || {
            id: it.productId || `prod_${itIdx}`,
            name: it.productName,
            shortcut: '',
            lastRatePer20Kg: it.ratePer20Kg || 0,
          };
          const rate = it.ratePer20Kg > 0 ? it.ratePer20Kg : prod.lastRatePer20Kg || 0;
          const weight = it.netWeightKg || 0;
          const amount = it.calculatedAmount > 0 ? it.calculatedAmount : Math.round((weight / 20) * rate);
          return {
            id: `item_${Date.now()}_${itIdx}`,
            productId: prod.id,
            productName: it.productName || prod.name,
            productShortcut: prod.shortcut || '',
            weightKg: weight,
            ratePer20Kg: rate,
            amount: amount,
          };
        });
      }
    }

    if (billItems.length === 0) {
      alert('કૃપા કરીને વજન (kg) દાખલ કરો.');
      return;
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const billTotalWeightKg = billItems.reduce((acc, it) => acc + it.weightKg, 0);
    const billTotalWeightMan = Number((billTotalWeightKg / 20).toFixed(2));
    const billGrossAmount = billItems.reduce((acc, it) => acc + it.amount, 0);
    const billFinalTotal = billGrossAmount;

    const sessionLetter = currentSession;
    const sessionBillNo = getNextBillNo(bills, businessDate, sessionLetter);
    const sessionBillNoStr = `${sessionLetter}${sessionBillNo}`;

    const finalCustomerName =
      (overrideCustomerName !== undefined ? overrideCustomerName : customerName).trim() ||
      'સામાન્ય ગ્રાહક';

    const newBill: VoucherBill = {
      id: `bill_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      billNo: sessionBillNo,
      billNoStr: sessionBillNoStr,
      date: businessDate,
      time: timeStr,
      session: sessionLetter,
      customerName: finalCustomerName,
      items: billItems,
      totalWeightKg: Math.round(billTotalWeightKg * 100) / 100,
      totalWeightMan: billTotalWeightMan,
      grossAmount: billGrossAmount,
      discountLess: 0,
      finalTotal: billFinalTotal,
      createdAt: Date.now(),
      // Legacy fields for first item
      productId: billItems[0].productId,
      productName: billItems[0].productName,
      productShortcut: billItems[0].productShortcut,
      weightKg: billItems[0].weightKg,
      ratePer20Kg: billItems[0].ratePer20Kg,
    };

    // Update last remembered rates for all products in this bill
    const rateMap = new Map<string, number>();
    billItems.forEach((it) => rateMap.set(it.productId, it.ratePer20Kg));

    const updatedProducts = cleanProducts.map((p) => {
      const newRate = rateMap.get(p.id);
      return newRate ? { ...p, lastRatePer20Kg: newRate } : p;
    });

    // Attach weighment slip if this bill has attached kanta weighments
    if (currentAttached.length > 0) {
      lastSavedWeighmentsRef.current = currentAttached;
      let totalBags = 0;
      let totalNetW = 0;
      let totalGrossW = 0;
      let totalTareW = 0;
      const slipItems: any[] = [];
      currentAttached.forEach((w) => {
        if (w.items && w.items.length > 0) {
          w.items.forEach((it) => {
            const bags = it.bags || [];
            const grossFromBags = it.grossWeightKg !== undefined
              ? it.grossWeightKg
              : bags.length > 0
              ? Math.round(bags.reduce((acc, b) => acc + Number(b), 0) * 10) / 10
              : it.netWeightKg;
            const tareKg = it.tareWeightKg;
            const netKg = it.netWeightKg;

            totalBags += bags.length;
            totalNetW += netKg;
            totalGrossW += grossFromBags;
            if (tareKg && tareKg > 0) totalTareW += tareKg;

            slipItems.push({
              productName: it.productName,
              weightKg: netKg,
              grossWeightKg: grossFromBags,
              weightMan: Math.round((netKg / 20) * 10) / 10,
              ratePer20Kg: it.ratePer20Kg,
              amount: it.calculatedAmount,
              bags: it.bags,
              tareWeightKg: tareKg && tareKg > 0 ? tareKg : undefined,
            });
          });
        } else {
          totalBags += w.totalBagsCount || (w.bags ? w.bags.length : 0);
          const bags = w.bags || [];
          const grossFromBags = bags.length > 0
            ? Math.round(bags.reduce((acc, b) => acc + Number(b), 0) * 10) / 10
            : w.totalWeightKg;
          let tareKg = w.tareWeightKg;
          if ((!tareKg || tareKg <= 0) && grossFromBags > w.totalWeightKg) {
            tareKg = Math.round((grossFromBags - w.totalWeightKg) * 10) / 10;
          }
          const netKg = tareKg && tareKg > 0
            ? Math.round((grossFromBags - tareKg) * 10) / 10
            : w.totalWeightKg;

          totalNetW += netKg;
          totalGrossW += grossFromBags;
          if (tareKg && tareKg > 0) totalTareW += tareKg;

          slipItems.push({
            productName: w.productName,
            weightKg: netKg,
            grossWeightKg: grossFromBags,
            weightMan: Math.round((netKg / 20) * 10) / 10,
            ratePer20Kg: w.ratePer20Kg,
            amount: w.calculatedAmount,
            bags: w.bags,
            tareWeightKg: tareKg && tareKg > 0 ? tareKg : undefined,
          });
        }
      });

      // Synchronize: if bill has additional items (e.g. ঘઉં) not in the attached weighment, add them!
      billItems.forEach((bi) => {
        const alreadyExists = slipItems.some(
          (si) =>
            si.productName.trim().toLowerCase() === bi.productName.trim().toLowerCase() ||
            (bi.productName.includes('+') && bi.productName.includes(si.productName))
        );
        if (!alreadyExists) {
          totalNetW += bi.weightKg;
          totalGrossW += bi.weightKg;
          slipItems.push({
            productName: bi.productName,
            weightKg: bi.weightKg,
            grossWeightKg: bi.weightKg,
            weightMan: Math.round((bi.weightKg / 20) * 10) / 10,
            ratePer20Kg: bi.ratePer20Kg,
            amount: bi.amount,
            bags: [],
          });
        }
      });

      newBill.weighmentSlip = {
        date: currentAttached[0].date || businessDate,
        time: currentAttached[0].time || timeStr,
        customerName: finalCustomerName,
        billNoStr: sessionBillNoStr,
        items: slipItems,
        totalBagsCount: totalBags,
        totalWeightKg: Math.round(totalNetW * 100) / 100,
        grossWeightKg: Math.round(totalGrossW * 100) / 100,
        tareWeightKg: totalTareW > 0 ? Math.round(totalTareW * 100) / 100 : undefined,
        totalWeightMan: Math.round((totalNetW / 20) * 10) / 10,
        totalAmount: billFinalTotal,
      };
      newBill.weighmentId = currentAttached[0].id;
    }

    onSaveBill(newBill, updatedProducts);

    // Save reference for immediate weight printing if requested by farmer
    lastSavedBillRef.current = newBill;

    idsToUpdate.forEach((wId) => {
      updateWeighmentStatus(wId, 'billed', newBill.id, newBill.billNoStr);
    });
    setAttachedWeighmentIds([]);
    setAttachedWeighmentId(null);
    if (onClearInitialWeighment) {
      onClearInitialWeighment();
    }

    // Reset weight and amount inputs and DESELECT all items so user can choose manually for next customer
    try {
      localStorage.removeItem(BILL_DRAFT_KEY);
    } catch (e) {}
    setCustomerName('');
    setActiveProductIds([]);
    setVoiceResetKey((prev) => prev + 1);
    setProductInputs((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((k) => {
        updated[k] = { ...updated[k], weight: '', amount: '' };
      });
      return updated;
    });

    if (!autoPrint) {
      if (onAfterBillSavedOrPrinted) {
        onAfterBillSavedOrPrinted();
      }
    }

    if (autoPrint) {
      setIsDirectPrinting(true);

      const hasDirectPrinter =
        isBluetoothConnected() ||
        isPrinterConfiguredOrPermitted();

      if (hasDirectPrinter) {
        // Direct print immediately on this device (Single print, never enqueue to cloud)
        setDirectPrintStatus('પ્રિન્ટ થઈ રહી છે...');
        printReceiptDirectly(newBill, settings, (status) => {
          setDirectPrintStatus(status);
        })
          .catch((err) => {
            const isUserCancel =
              err?.name === 'NotFoundError' ||
              err?.message?.includes('User cancelled') ||
              err?.message?.includes('કોઈ પ્રિન્ટર પસંદ કરવામાં આવ્યું નથી');
            const isIframeErr =
              err?.message === 'IFRAME_PERMISSION_ERROR' ||
              err?.name === 'SecurityError';

            if (isIframeErr) {
              console.warn('Direct print in iframe:', err);
            } else if (!isUserCancel) {
              console.warn('Direct print failed:', err);
              alert(
                `પ્રિન્ટિંગ એરર: ${err?.message || 'પ્રિન્ટર કનેક્ટ થઈ શક્યું નહીં. પ્રિન્ટર ચાલુ છે કે નહીં તે ચકાસો.'}`
              );
            }
          })
          .finally(() => {
            setIsDirectPrinting(false);
            setDirectPrintStatus(null);
            if (onAfterBillSavedOrPrinted) {
              setTimeout(() => {
                onAfterBillSavedOrPrinted();
              }, 400);
            }
          });
      } else if (!settings.isAutoPrintStation && settings.cloudRemotePrintEnabled !== false) {
        // This device has NO Bluetooth printer connected, but Cloud Remote Print is on:
        // Enqueue to the cloud queue so the office printer prints it once!
        setDirectPrintStatus('📡 ઓફિસ પ્રિન્ટર પર મોકલાઈ રહ્યું છે...');
        enqueuePrintJob({
          type: 'bill',
          bill: newBill,
          title: `બિલ ${newBill.billNoStr} - ${newBill.customerName}`,
          sourceDevice: 'મોબાઈલ',
        })
          .then(() => {
            setDirectPrintStatus('✅ ઓફિસ પ્રિન્ટરમાં મોકલાઈ ગયું!');
            setTimeout(() => {
              setIsDirectPrinting(false);
              setDirectPrintStatus(null);
              if (onAfterBillSavedOrPrinted) {
                onAfterBillSavedOrPrinted();
              }
            }, 1800);
          })
          .catch((err) => {
            console.warn('Cloud print queue enqueue note:', err);
            // Fallback to local print
            printReceiptDirectly(newBill, settings, (status) => {
              setDirectPrintStatus(status);
            })
              .catch((e) => console.warn('Direct print fallback err:', e))
              .finally(() => {
                setIsDirectPrinting(false);
                setDirectPrintStatus(null);
                if (onAfterBillSavedOrPrinted) {
                  setTimeout(() => {
                    onAfterBillSavedOrPrinted();
                  }, 400);
                }
              });
          });
      } else {
        // Fallback: try direct print (prompts user to connect bluetooth)
        setDirectPrintStatus('પ્રિન્ટ મોકલાઈ રહી છે...');
        printReceiptDirectly(newBill, settings, (status) => {
          setDirectPrintStatus(status);
        })
          .catch((err) => {
            console.warn('Direct print failed:', err);
          })
          .finally(() => {
            setIsDirectPrinting(false);
            setDirectPrintStatus(null);
            if (onAfterBillSavedOrPrinted) {
              setTimeout(() => {
                onAfterBillSavedOrPrinted();
              }, 400);
            }
          });
      }
    }

    setTimeout(() => {
      customerInputRef.current?.focus();
    }, 100);
  };

  // 1-Click Direct Print for incoming Kanta weighment(s) - Zero double labor
  const handleDirectPrintWeighmentGroup = (weighmentsToBill: KantaWeighment[]) => {
    if (weighmentsToBill.length === 0) return;
    const custName = (weighmentsToBill[0].customerName || '').trim() || 'સામાન્ય ગ્રાહક';

    const billItems: BillItem[] = [];
    let hasMissingRate = false;

    weighmentsToBill.forEach((rawW, idx) => {
      const w = allWeighments.find((aw) => aw.id === rawW.id) || rawW;
      const effectiveItems =
        w.items && w.items.length > 0
          ? w.items
          : rawW.items && rawW.items.length > 0
          ? rawW.items
          : (w as any).weighmentSlip?.items && (w as any).weighmentSlip.items.length > 0
          ? (w as any).weighmentSlip.items
          : null;

      if (effectiveItems && effectiveItems.length > 0) {
        effectiveItems.forEach((it: any, itIdx: number) => {
          const prod = cleanProducts.find((p) => p.id === it.productId || p.name === it.productName) || {
            id: it.productId || `prod_${idx}_${itIdx}`,
            name: it.productName,
            shortcut: '',
            lastRatePer20Kg: it.ratePer20Kg || 0,
          };
          const rate = it.ratePer20Kg > 0 ? it.ratePer20Kg : prod.lastRatePer20Kg || 0;
          if (rate <= 0) {
            hasMissingRate = true;
          }
          const weight = it.netWeightKg || 0;
          const amount = it.calculatedAmount > 0 ? it.calculatedAmount : Math.round((weight / 20) * rate);

          billItems.push({
            id: `item_${Date.now()}_${idx}_${itIdx}`,
            productId: prod.id,
            productName: it.productName || prod.name,
            productShortcut: prod.shortcut || '',
            weightKg: weight,
            ratePer20Kg: rate,
            amount: amount,
          });
        });
      } else {
        const prod = cleanProducts.find((p) => p.id === w.productId || p.name === w.productName) || {
          id: w.productId || `prod_${idx}`,
          name: w.productName,
          shortcut: '',
          lastRatePer20Kg: w.ratePer20Kg || 0,
        };
        const rate = w.ratePer20Kg > 0 ? w.ratePer20Kg : prod.lastRatePer20Kg || 0;
        if (rate <= 0) {
          hasMissingRate = true;
        }
        const weight = w.totalWeightKg || 0;
        const amount = w.calculatedAmount > 0 ? w.calculatedAmount : Math.round((weight / 20) * rate);

        billItems.push({
          id: `item_${Date.now()}_${idx}`,
          productId: prod.id,
          productName: w.productName || prod.name,
          productShortcut: prod.shortcut || '',
          weightKg: weight,
          ratePer20Kg: rate,
          amount: amount,
        });
      }
    });

    if (hasMissingRate) {
      handleAttachAllForCustomer(weighmentsToBill);
      alert('કૃપા કરીને આ માલ માટે ભાવ દાખલ કરો.');
      return;
    }

    handleSubmit(true, custName, billItems, weighmentsToBill);
  };

  // Voice handler to set weight & rate
  const handleVoiceWeightAndRate = (
    productId: string,
    weight?: number,
    rate?: number
  ) => {
    setActiveProductIds((prev) => (prev.includes(productId) ? prev : [...prev, productId]));

    setProductInputs((prev) => {
      const prod = cleanProducts.find((p) => p.id === productId);
      const defaultRate = prod ? prod.lastRatePer20Kg.toString() : '0';
      const current = prev[productId] || { weight: '', rate: defaultRate, amount: '' };
      const nextWeight = weight !== undefined ? weight.toString() : current.weight;
      const nextRate = rate !== undefined ? rate.toString() : current.rate;

      let nextAmount = current.amount;
      const w = parseFloat(nextWeight) || 0;
      const r = parseFloat(nextRate) || 0;
      if (w > 0 && r > 0) {
        nextAmount = Math.round((w / 20) * r).toString();
      }

      return {
        ...prev,
        [productId]: {
          weight: nextWeight,
          rate: nextRate,
          amount: nextAmount,
        },
      };
    });
  };

  // Voice handler to immediately save and print
  const handleVoiceSaveAndPrint = (
    overrideProduct?: Product,
    overrideCustomerName?: string,
    overrideWeight?: number,
    overrideRate?: number
  ) => {
    const targetProd =
      overrideProduct ||
      cleanProducts.find((p) => activeProductIds.includes(p.id)) ||
      cleanProducts[0];

    const currentInp = targetProd ? productInputs[targetProd.id] : undefined;
    const finalWeight =
      overrideWeight !== undefined
        ? overrideWeight
        : parseFloat(currentInp?.weight || '') || 0;

    const finalRate =
      overrideRate !== undefined
        ? overrideRate
        : parseFloat(currentInp?.rate || '') || (targetProd ? targetProd.lastRatePer20Kg : 0);

    if (finalWeight <= 0) {
      alert('કૃપા કરીને વજન બોલો અથવા દાખલ કરો (દા.ત. "૫૪૦ કિલો").');
      return;
    }

    if (!targetProd) {
      alert('કૃપા કરીને પહેલા માલ પસંદ કરો.');
      return;
    }

    const itemAmount = Math.round((finalWeight / 20) * finalRate);
    const voiceItem: BillItem = {
      id: `item_${Date.now()}_${targetProd.id}`,
      productId: targetProd.id,
      productName: targetProd.name,
      productShortcut: targetProd.shortcut,
      weightKg: finalWeight,
      ratePer20Kg: finalRate,
      amount: itemAmount,
    };

    handleSubmit(true, overrideCustomerName, [voiceItem]);
  };

  // Helper to build WeighmentSlipData from KantaWeighment(s) supporting multi-item weighments
  const buildSlipDataFromWeighments = (
    weighments: KantaWeighment[],
    date: string,
    time: string,
    customerName: string,
    billNoStr?: string
  ): WeighmentSlipData => {
    let totalBags = 0;
    let totalNetW = 0;
    let totalGrossW = 0;
    let totalTareW = 0;
    let totalAmt = 0;
    const items: WeighmentSlipItem[] = [];

    weighments.forEach((w) => {
      if (w.items && w.items.length > 0) {
        w.items.forEach((it) => {
          const bags = it.bags || [];
          const grossFromBags =
            it.grossWeightKg !== undefined
              ? it.grossWeightKg
              : bags.length > 0
              ? Math.round(bags.reduce((acc, b) => acc + Number(b), 0) * 10) / 10
              : it.netWeightKg;
          const tareKg = it.tareWeightKg;
          const netKg = it.netWeightKg;

          totalBags += bags.length;
          totalNetW += netKg;
          totalGrossW += grossFromBags;
          if (tareKg && tareKg > 0) totalTareW += tareKg;
          totalAmt += it.calculatedAmount || 0;

          items.push({
            productName: it.productName,
            weightKg: netKg,
            grossWeightKg: grossFromBags,
            weightMan: Math.round((netKg / 20) * 10) / 10,
            ratePer20Kg: it.ratePer20Kg,
            amount: it.calculatedAmount,
            bags: it.bags,
            tareWeightKg: tareKg && tareKg > 0 ? tareKg : undefined,
          });
        });
      } else {
        const bags = w.bags || [];
        const grossFromBags =
          bags.length > 0
            ? Math.round(bags.reduce((acc, b) => acc + Number(b), 0) * 10) / 10
            : w.totalWeightKg;
        let tareKg = w.tareWeightKg;
        if ((!tareKg || tareKg <= 0) && grossFromBags > w.totalWeightKg) {
          tareKg = Math.round((grossFromBags - w.totalWeightKg) * 10) / 10;
        }
        const netKg =
          tareKg && tareKg > 0
            ? Math.round((grossFromBags - tareKg) * 10) / 10
            : w.totalWeightKg;

        totalBags += w.totalBagsCount || (w.bags ? w.bags.length : 0);
        totalNetW += netKg;
        totalGrossW += grossFromBags;
        if (tareKg && tareKg > 0) totalTareW += tareKg;
        totalAmt += w.calculatedAmount || 0;

        items.push({
          productName: w.productName,
          weightKg: netKg,
          grossWeightKg: grossFromBags,
          weightMan: Math.round((netKg / 20) * 10) / 10,
          ratePer20Kg: w.ratePer20Kg,
          amount: w.calculatedAmount,
          bags: w.bags,
          tareWeightKg: tareKg && tareKg > 0 ? tareKg : undefined,
        });
      }
    });

    return {
      date,
      time,
      customerName,
      billNoStr,
      items,
      totalBagsCount: totalBags,
      totalWeightKg: Math.round(totalNetW * 100) / 100,
      grossWeightKg: Math.round(totalGrossW * 100) / 100,
      tareWeightKg: totalTareW > 0 ? Math.round(totalTareW * 100) / 100 : undefined,
      totalWeightMan: Math.round((totalNetW / 20) * 10) / 10,
      totalAmount: totalAmt > 0 ? totalAmt : undefined,
    };
  };

  // Direct Weight Slip Print (કાંટા પર લખેલા વજનની સીધી પ્રિન્ટ)
  const handleDirectWeightPrint = async (customWeighment?: KantaWeighment) => {
    if (isDirectPrinting || isWeightPrinting) return;

    let targetCustomer = customerName.trim();
    let slipData: WeighmentSlipData | null = null;

    // 1. If a specific weighment was passed (e.g. from the live list)
    if (customWeighment) {
      slipData = buildSlipDataFromWeighments(
        [customWeighment],
        customWeighment.date || businessDate,
        customWeighment.time || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
        customWeighment.customerName || 'સામાન્ય ખેડૂત'
      );
    } else {
      // 2. Attached weighments in the current form
      const attached = allWeighments.filter((w) => attachedWeighmentIds.includes(w.id));
      if (attached.length > 0) {
        slipData = buildSlipDataFromWeighments(
          attached,
          businessDate,
          new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
          targetCustomer || attached[0].customerName || 'સામાન્ય ખેડૂત'
        );
      } else if (targetCustomer) {
        // 3. Search weighments with matching customer name
        const matched = allWeighments.filter(
          (w) => w.customerName.trim().toLowerCase() === targetCustomer.toLowerCase()
        );
        if (matched.length > 0) {
          const todayMatched = matched.filter((w) => w.date === businessDate);
          const toUse = todayMatched.length > 0 ? todayMatched : [matched[0]];
          slipData = buildSlipDataFromWeighments(
            toUse,
            businessDate,
            new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
            targetCustomer
          );
        }
      }

      // 4. Current bill items in inputs
      if (!slipData && currentBillItems.length > 0) {
        const totalW = currentBillItems.reduce((acc, it) => acc + it.weightKg, 0);
        slipData = {
          date: businessDate,
          time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
          customerName: targetCustomer || 'સામાન્ય ખેડૂત',
          items: currentBillItems.map((it) => ({
            productName: it.productName,
            weightKg: it.weightKg,
            weightMan: Math.round((it.weightKg / 20) * 10) / 10,
            ratePer20Kg: it.ratePer20Kg,
            amount: it.amount,
          })),
          totalWeightKg: Math.round(totalW * 100) / 100,
          totalWeightMan: Math.round((totalW / 20) * 10) / 10,
          totalAmount: totalBillAmount > 0 ? totalBillAmount : undefined,
        };
      }

      // 5. If form is cleared (e.g. just after bill was saved), use last saved bill / weighments
      if (!slipData && (lastSavedWeighmentsRef.current.length > 0 || lastSavedBillRef.current)) {
        if (lastSavedWeighmentsRef.current.length > 0) {
          const toUse = lastSavedWeighmentsRef.current;
          slipData = buildSlipDataFromWeighments(
            toUse,
            toUse[0].date || businessDate,
            toUse[0].time || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
            toUse[0].customerName || lastSavedBillRef.current?.customerName || 'સામાન્ય ખેડૂત',
            lastSavedBillRef.current?.billNoStr
          );
          if (lastSavedBillRef.current?.finalTotal && (!slipData.totalAmount || slipData.totalAmount <= 0)) {
            slipData.totalAmount = lastSavedBillRef.current.finalTotal;
          }
        } else if (lastSavedBillRef.current) {
          const lb = lastSavedBillRef.current;
          slipData = {
            date: lb.date,
            time: lb.time,
            customerName: lb.customerName,
            billNoStr: lb.billNoStr,
            items: lb.items.map((it) => ({
              productName: it.productName,
              weightKg: it.weightKg,
              weightMan: Math.round((it.weightKg / 20) * 10) / 10,
              ratePer20Kg: it.ratePer20Kg,
              amount: it.amount,
            })),
            totalWeightKg: lb.totalWeightKg,
            totalWeightMan: lb.totalWeightMan,
            totalAmount: lb.finalTotal,
          };
        }
      }
    }

    if (!slipData) {
      alert('વજન પ્રિન્ટ માટે કૃપા કરીને ખેડૂતનું નામ અને વજન દાખલ કરો અથવા કાંટાનું પત્રક પસંદ કરો.');
      return;
    }

    setIsWeightPrinting(true);
    setDirectPrintStatus('લખેલા વજનની પ્રિન્ટ નીકળી રહી છે...');
    try {
      await printWeighmentDirectly(slipData, settings, (status) => {
        setDirectPrintStatus(status);
      });
    } catch (err: any) {
      const isUserCancel =
        err?.name === 'NotFoundError' ||
        String(err?.message || '').toLowerCase().includes('cancelled') ||
        String(err?.message || '').toLowerCase().includes('user cancelled');
      const isIframeErr =
        err?.message === 'IFRAME_PERMISSION_ERROR' ||
        err?.name === 'SecurityError';

      if (isIframeErr) {
        console.warn('Direct weight print in iframe:', err);
      } else if (!isUserCancel) {
        console.warn('Direct weight print error:', err);
        alert('વજન પ્રિન્ટ મોકલવામાં ખામી આવી. કૃપા કરીને પ્રિન્ટર ચાલુ છે તે ચકાસો.');
      }
    } finally {
      setIsWeightPrinting(false);
      setDirectPrintStatus(null);
    }
  };

  return (
    <div className="max-w-xl mx-auto w-full h-full flex flex-col min-h-0">
      {/* BILLING FORM */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full min-h-0">
          {/* Header of Form - Bill Number with Date & Time below it (just like Screenshot_20260921_164612.jpg) */}
          <div className="px-3.5 py-2.5 sm:py-3 bg-[#38556d] text-white flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs sm:text-sm font-bold text-slate-200">બિલ નં:</span>
                <span className="bg-white/15 text-white font-mono font-black text-sm sm:text-base px-3 py-0.5 sm:py-1 rounded-lg border border-white/20 tracking-wider">
                  {currentSession}{currentBillNo}
                </span>
              </div>

              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1 hover:bg-white/20 rounded-full text-white cursor-pointer transition"
                  title="પાછા કાંટા વજન પર જાઓ"
                  aria-label="બંધ કરો"
                >
                  <X className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              )}
            </div>

            {/* Real-time Date and Time row below Bill Number */}
            <div className="flex items-center gap-2 text-xs">
              <div className="flex items-center gap-1.5 bg-white/15 px-2.5 py-1 rounded-lg border border-white/20 text-white">
                <Calendar className="w-3.5 h-3.5 text-slate-200" />
                <span className="font-semibold text-xs">
                  {formatDateDDMMYY(businessDate)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 bg-white/15 px-2.5 py-1 rounded-lg border border-white/20 text-white font-mono font-bold">
                <Clock className="w-3.5 h-3.5 text-slate-200 animate-pulse" />
                <span className="text-xs tracking-wide">
                  {currentTime.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true,
                  })}
                </span>
              </div>
            </div>
          </div>

          {/* Form Content - fits entirely without scrolling */}
          <div className="p-2.5 sm:p-5 space-y-2 sm:space-y-4 flex-1 overflow-y-auto min-h-0 overscroll-contain">
            {/* LIVE KANTA INCOMING: Farmer Name with Direct Print Symbol (ખાલી નામ અને જોડે પ્રિન્ટ સિમ્બોલ) */}
            {pendingWeighments.length > 0 && !onClose && (
              <div className="space-y-2" id="kanta-incoming-direct-list">
                {groupedPendingWeighments.map((group) => {
                  const hasMultiple = group.weighments.length > 1;
                  const totalNetKg = Math.round(
                    group.weighments.reduce((sum, w) => sum + (w.totalWeightKg || 0), 0) * 10
                  ) / 10;
                  const firstW = group.weighments[0];
                  const commoditiesLabel = group.weighments
                    .map(
                      (w) =>
                        `${w.productName} ${w.totalWeightKg}kg${
                          w.ratePer20Kg > 0 ? ` (₹${w.ratePer20Kg})` : ''
                        }`
                    )
                    .join(', ');

                  return (
                    <div
                      key={group.customerName}
                      className="bg-white border-2 border-emerald-500 rounded-2xl px-3.5 py-2.5 shadow-sm flex items-center justify-between gap-2.5 transition hover:shadow-md"
                    >
                      {/* Farmer Name & Details */}
                      <div
                        onClick={() => handleAttachAllForCustomer(group.weighments)}
                        className="flex-1 min-w-0 cursor-pointer group"
                        title="ફોર્મમાં લોડ કરવા ક્લિક કરો"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-base sm:text-lg text-slate-900 tracking-tight group-hover:text-emerald-800 transition">
                            {group.customerName}
                          </span>
                          <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg">
                            {commoditiesLabel}
                          </span>
                        </div>
                      </div>

                      {/* Action buttons: Hash (#) for figures + Direct PRINT SYMBOL */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setViewingKantaWeighment(firstW)}
                          id={`view-kanta-figures-${firstW.id}`}
                          className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center transition active:scale-95 cursor-pointer"
                          title="આંકડા / વજન જુઓ"
                          aria-label="આંકડા જુઓ"
                        >
                          <Hash className="w-4 h-4 stroke-[2.5]" />
                        </button>

                        <button
                          type="button"
                          id={`direct-print-kanta-${firstW.id}`}
                          disabled={isDirectPrinting}
                          onClick={() => handleDirectPrintWeighmentGroup(group.weighments)}
                          className="px-3 py-2 bg-emerald-700 hover:bg-emerald-800 active:scale-95 text-white font-black text-xs sm:text-sm rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          title="સીધું બિલ બનાવો અને પ્રિન્ટ કરો"
                          aria-label="પ્રિન્ટ"
                        >
                          {isDirectPrinting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Printer className="w-4 h-4" />
                          )}
                          <span>પ્રિન્ટ</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Voice Assistant Billing Bar (બોલીને બિલ બનાવો) */}
            <VoiceBillingBar
              cleanProducts={cleanProducts}
              activeProductIds={activeProductIds}
              customerName={customerName}
              resetKey={voiceResetKey}
              onSelectProduct={handleProductToggle}
              onSetCustomerName={setCustomerName}
              onSetWeightAndRate={handleVoiceWeightAndRate}
              onVoiceSaveAndPrint={handleVoiceSaveAndPrint}
            />

            {/* 1. PRODUCT BUTTONS (Sliding 4 items per slide, slightly smaller boxes) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 block">
                  ૧. આઇટમ પસંદ કરો
                </label>
              </div>

              {/* Product buttons Slider (4 items per slide, swipe left/right) */}
              <div
                ref={productSliderRef}
                onScroll={handleSliderScroll}
                onWheel={(e) => {
                  if (Math.abs(e.deltaX) < Math.abs(e.deltaY) && productSliderRef.current) {
                    productSliderRef.current.scrollLeft += e.deltaY;
                  }
                }}
                className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth touch-pan-x select-none pb-0.5 -mx-0.5 px-0.5"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {/* Render Slides uniformly: Slide 1 has top 4 products, Slide 2 has next products + Add Item button */}
                {slides.map((page, pIdx) => (
                  <div
                    key={`slide-page-${pIdx}`}
                    className="w-full shrink-0 snap-start grid grid-cols-2 gap-2"
                  >
                    {page.slots.map((slot, sIdx) => {
                      if (slot.type === 'product' && slot.product) {
                        return (
                          <React.Fragment key={slot.product.id}>
                            {renderProductButton(slot.product)}
                          </React.Fragment>
                        );
                      }
                      if (slot.type === 'add_button') {
                        return (
                          <button
                            key={`add-btn-${pIdx}-${sIdx}`}
                            type="button"
                            id="grid-add-item-btn"
                            onClick={() => setShowAddItemModal(true)}
                            className="h-13 sm:h-16 py-1 px-2 rounded-xl border-2 border-dashed border-emerald-500/80 bg-emerald-50/70 hover:bg-emerald-100 text-emerald-800 transition flex flex-col items-center justify-center gap-0.5 cursor-pointer select-none active:scale-95 shadow-2xs"
                            title="નવી આઇટમ ઉમેરો"
                          >
                            <div className="flex items-center gap-1 font-black text-xs sm:text-base text-emerald-800 leading-tight">
                              <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-700 stroke-[2.5]" />
                              <span>એડ આઇટમ</span>
                            </div>
                            <span className="text-[10px] sm:text-[11px] font-bold text-emerald-600 leading-tight">
                              + નવી આઇટમ ઉમેરો
                            </span>
                          </button>
                        );
                      }
                      return (
                        <div
                          key={`empty-slot-${pIdx}-${sIdx}`}
                          onClick={() => setShowAddItemModal(true)}
                          className="h-13 sm:h-16 py-1 px-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/40 hover:bg-slate-50 hover:border-slate-300 text-slate-400 transition flex flex-col items-center justify-center gap-0.5 cursor-pointer select-none"
                          title="આઇટમ ઉમેરો"
                        >
                          <span className="text-xs font-semibold text-slate-300">—</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Slider indicator dots (only if multiple slides exist) */}
              {totalSlides > 1 && (
                <div className="flex items-center justify-center gap-1.5 pt-0.5">
                  {Array.from({ length: totalSlides }).map((_, dotIdx) => (
                    <button
                      key={dotIdx}
                      type="button"
                      onClick={() => {
                        if (productSliderRef.current) {
                          productSliderRef.current.scrollTo({
                            left: dotIdx * productSliderRef.current.clientWidth,
                            behavior: 'smooth',
                          });
                        }
                      }}
                      className={`h-1.5 rounded-full transition-all cursor-pointer ${
                        activeSlide === dotIdx ? 'w-5 bg-emerald-700' : 'w-1.5 bg-slate-300'
                      }`}
                      aria-label={`Slide ${dotIdx + 1}`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* 2. CUSTOMER NAME */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 block">
                ૨. ગ્રાહકનું નામ
              </label>
              <div className="relative flex items-center">
                <input
                  ref={customerInputRef}
                  type="search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="words"
                  spellCheck={false}
                  data-form-type="other"
                  data-lpignore="true"
                  placeholder=""
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCustomerEnter();
                    }
                  }}
                  className="w-full text-sm font-semibold pl-3.5 pr-10 py-1.5 sm:py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none transition shadow-2xs"
                />
                {customerName && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerName('');
                      customerInputRef.current?.focus();
                    }}
                    className="absolute right-2.5 p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition cursor-pointer"
                    title="નામ સાફ કરો"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* 3. DYNAMIC ITEM INPUT BOXES (Weight & Amount) */}
            <div className="space-y-3">
              <div className="space-y-2.5">
                {activeProductIds.map((pId) => {
                  const prod = cleanProducts.find((x) => x.id === pId);
                  if (!prod) return null;
                  const inputData = productInputs[pId] || {
                    weight: '',
                    rate: prod.lastRatePer20Kg.toString(),
                  };
                  const wNum = parseFloat(inputData.weight) || 0;
                  const rNum = parseFloat(inputData.rate) || 0;
                  const mNum = wNum / 20;
                  const itemAmt = Math.round(mNum * rNum);

                  return (
                    <div
                      key={prod.id}
                      className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5 relative shadow-2xs"
                    >
                      {/* Product Header: Item Name + Compact Rate Box (sized to match item name) + Delete Button */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-sm text-slate-900 flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block"></span>
                            <span>{prod.name}</span>
                          </span>

                          {/* Small Rate Box next to item name - sized to match item name */}
                          <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg px-2 py-0.5 shadow-2xs focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500">
                            <span className="text-xs font-bold text-slate-500">ભાવ: ₹</span>
                            <input
                              id={`rate-input-${prod.id}`}
                              type="search"
                              inputMode="decimal"
                              autoComplete="off"
                              autoCorrect="off"
                              spellCheck={false}
                              data-form-type="other"
                              data-lpignore="true"
                              step="any"
                              placeholder="ભાવ"
                              value={inputData.rate}
                              onChange={(e) =>
                                handleProductInputChange(prod.id, 'rate', e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  const weightEl = document.getElementById(`weight-input-${prod.id}`) as HTMLInputElement | null;
                                  if (weightEl) {
                                    weightEl.focus();
                                    weightEl.select();
                                  }
                                }
                              }}
                              className="w-14 sm:w-16 text-xs sm:text-sm font-black text-slate-900 bg-transparent focus:outline-none"
                            />
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveProduct(prod.id)}
                          className="text-slate-400 hover:text-rose-600 p-0.5 rounded transition cursor-pointer"
                          title="કાઢી નાખો"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Weight & Amount (રકમ) 50% - 50% on one line */}
                      <div className="grid grid-cols-2 gap-3 items-end">
                        {/* Weight (kg) */}
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-700 block">
                            વજન (kg)
                          </label>
                          <input
                            id={`weight-input-${prod.id}`}
                            type="search"
                            inputMode="decimal"
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                            data-form-type="other"
                            data-lpignore="true"
                            step="any"
                            placeholder="દા.ત. 40"
                            value={inputData.weight}
                            onChange={(e) =>
                              handleProductInputChange(prod.id, 'weight', e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const amtEl = document.getElementById(
                                  `amount-input-${prod.id}`
                                ) as HTMLInputElement | null;
                                if (amtEl) {
                                  amtEl.focus();
                                  amtEl.select();
                                }
                              }
                            }}
                            className="w-full text-base font-black px-3 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white transition shadow-2xs"
                          />
                        </div>

                        {/* Amount / રકમ (₹) */}
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-700 block">
                            રકમ (₹)
                          </label>
                          <div className="relative flex items-center">
                            <span className="absolute left-3 text-slate-400 font-bold text-sm pointer-events-none select-none">
                              ₹
                            </span>
                            <input
                              id={`amount-input-${prod.id}`}
                              type="search"
                              inputMode="decimal"
                              autoComplete="off"
                              autoCorrect="off"
                              spellCheck={false}
                              data-form-type="other"
                              data-lpignore="true"
                              step="any"
                              placeholder="0"
                              value={
                                inputData.amount !== undefined && inputData.amount !== ''
                                  ? inputData.amount
                                  : itemAmt > 0
                                  ? itemAmt.toString()
                                  : ''
                              }
                              onChange={(e) =>
                                handleProductInputChange(prod.id, 'amount', e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSubmit(false);
                                }
                              }}
                              className="w-full text-base font-mono font-black pl-7 pr-3 py-2.5 rounded-xl border border-slate-300 text-emerald-800 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white transition shadow-2xs"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* SAVE AND PRINT BUTTON + SAVE ONLY ROW */}
              <div className="pt-1 sm:pt-2">
                <div className="flex items-center gap-2">
                  {/* SAVE ONLY BUTTON (ફક્ત સેવ કરવા નાનો સિમ્બોલ, કોઈ લખાણ વગર - ડાબી બાજુ) */}
                  <button
                    type="button"
                    id="save-only-bill-btn"
                    disabled={isDirectPrinting || isWeightPrinting}
                    onClick={() => handleSubmit(false)}
                    title="ફક્ત સેવ કરો (પ્રિન્ટ વગર)"
                    aria-label="સેવ કરો"
                    className="self-stretch w-11 sm:w-12 rounded-xl bg-[#38556d] hover:bg-[#2d465c] active:bg-[#223547] text-white shadow-md flex items-center justify-center cursor-pointer transition shrink-0 active:scale-95 disabled:opacity-50 border border-slate-700/30"
                  >
                    <Save className="w-5 h-5 sm:w-5.5 sm:h-5.5 text-slate-100" />
                  </button>

                  {/* SAVE AND PRINT BUTTON */}
                  <button
                    type="button"
                    id="create-and-print-bill-btn"
                    disabled={isDirectPrinting || isWeightPrinting}
                    onClick={() => handleSubmit(true)}
                    className={`flex-1 text-white font-black py-2.5 sm:py-3.5 px-3 sm:px-4 rounded-xl text-sm sm:text-base flex items-center justify-center gap-2 shadow-md transition group cursor-pointer ${
                      isDirectPrinting
                        ? 'bg-[#3b5871] opacity-95 cursor-wait'
                        : 'bg-[#466782] hover:bg-[#38556d] active:bg-[#2d465c]'
                    }`}
                  >
                    {isDirectPrinting ? (
                      <>
                        <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                        <span>{directPrintStatus || 'સીધી પ્રિન્ટ મોકલાઈ રહી છે...'}</span>
                      </>
                    ) : (
                      <>
                        <Printer className="w-4 h-4 sm:w-5 sm:h-5 group-hover:scale-110 transition-transform" />
                        <span>
                          સેવ એન્ડ પ્રિન્ટ {totalBillAmount > 0 ? `• ${formatINR(totalBillAmount)}` : ''}
                        </span>
                      </>
                    )}
                  </button>
                </div>

                {/* Direct Printer Info Badge (visible in web preview, hidden in APK) */}
                {!isStandaloneOrApk && (
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 sm:pt-2 px-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Bluetooth className={`w-3.5 h-3.5 ${btConnected ? 'text-blue-600' : 'text-slate-400'}`} />
                      <span className="font-semibold text-slate-700">
                        {settings.pairedPrinterName || 'PSF588'}:
                      </span>
                      {btConnected ? (
                        <span className="text-emerald-700 font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                          કનેક્ટેડ (સતત એક્ટિવ)
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={isBtConnecting}
                          onClick={async () => {
                            setIsBtConnecting(true);
                            try {
                              const reconnected = await attemptSilentReconnect();
                              if (!reconnected) {
                                await ensureConnectedPrinter(settings);
                              }
                            } catch (e: any) {
                              console.warn('Manual reconnect:', e);
                            } finally {
                              setIsBtConnecting(false);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold hover:bg-blue-100 transition cursor-pointer border border-blue-200 active:scale-95"
                          title="પ્રિન્ટર તરત ફરી કનેક્ટ કરો"
                        >
                          {isBtConnecting ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>કનેક્ટ થાય છે...</span>
                            </>
                          ) : (
                            <>
                              <RefreshCw className="w-3 h-3" />
                              <span>કનેક્ટ કરો</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

      {/* Add Item Modal */}
      {showAddItemModal && (
        <AddItemModal
          existingProducts={cleanProducts}
          onClose={() => setShowAddItemModal(false)}
          onAdd={handleAddNewProduct}
        />
      )}

      {/* View Weighment Modal (લખેલા વજન જુઓ) */}
      <WeighmentDetailModal
        weighment={viewingKantaWeighment}
        onClose={() => setViewingKantaWeighment(null)}
        onSaveFigures={(updated) => {
          saveKantaWeighmentToCloud(updated);
          if (
            attachedWeighmentIds.includes(updated.id) ||
            !customerName ||
            customerName === 'સામાન્ય ગ્રાહક' ||
            (viewingKantaWeighment && customerName === viewingKantaWeighment.customerName)
          ) {
            if (updated.customerName && updated.customerName !== 'સામાન્ય ગ્રાહક') {
              setCustomerName(updated.customerName);
            }
          }
          setViewingKantaWeighment(null);
        }}
        onOpenBill={(w) => {
          handleAttachWeighment(w);
          setViewingKantaWeighment(null);
        }}
      />
    </div>
  );
};

