import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useBackHandler } from '../utils/useBackHandler';
import {
  CheckCircle,
  Save,
  ChevronRight,
  ChevronDown,
  X,
  FileSpreadsheet,
  Plus,
  Minus,
  ArrowLeft,
  Check,
  Warehouse,
  FilePlus2,
} from 'lucide-react';
import { Product, FirmSettings, SessionType, VoucherBill } from '../types';
import {
  KantaWeighment,
  saveKantaWeighmentToCloud,
  subscribeToWeighments,
  syncBillToCloud,
} from '../utils/firebaseSync';
import {
  formatINR,
  getActiveBusinessDate,
  getTodayISODate,
  getCurrentSession,
  getStoredFirmSettings,
  getStoredBills,
  saveStoredBills,
  saveStoredProducts,
} from '../utils/storage';
import { TodayBillView } from './TodayBillView';

const KANTA_DRAFT_KEY = 'mandi_kanta_active_draft_v1';

interface KantaDraftData {
  customerName: string;
  selectedProductId: string;
  rate: string;
  isTwoItemsMode?: boolean;
  selectedProductId2?: string;
  rate2?: string;
  tareDeduction: string;
  tareDeduction2?: string;
  hasTareDeduction?: boolean;
  totalSlots: number;
  bagList: string[];
  item1Bags?: string[];
  item2Bags?: string[];
  isSheetOpen: boolean;
  timestamp: number;
}

const getStoredKantaDraft = (): KantaDraftData | null => {
  try {
    const raw = localStorage.getItem(KANTA_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.bagList)) {
      return parsed;
    }
  } catch (e) {
    console.error('Failed to load kanta draft:', e);
  }
  return null;
};

const saveKantaDraft = (data: Partial<KantaDraftData>) => {
  try {
    const prev = getStoredKantaDraft() || {
      customerName: '',
      selectedProductId: '',
      rate: '',
      isTwoItemsMode: false,
      selectedProductId2: '',
      rate2: '',
      tareDeduction: '',
      tareDeduction2: '',
      hasTareDeduction: false,
      totalSlots: 20,
      bagList: Array(20).fill(''),
      isSheetOpen: false,
      timestamp: Date.now(),
    };
    const updated = {
      ...prev,
      ...data,
      timestamp: Date.now(),
    };
    localStorage.setItem(KANTA_DRAFT_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save kanta draft:', e);
  }
};

const clearKantaDraft = () => {
  try {
    localStorage.removeItem(KANTA_DRAFT_KEY);
  } catch (e) {}
};

interface KantaEntryViewProps {
  products: Product[];
  onOpenBillForWeighment?: (weighment: KantaWeighment) => void;
  onViewAllRecords?: () => void;
  initialWeighmentToEdit?: KantaWeighment | null;
  onClearInitialWeighmentToEdit?: () => void;
  businessDate?: string;
  currentSession?: SessionType;
  settings?: FirmSettings;
  bills?: VoucherBill[];
  onSaveBill?: (bill: VoucherBill, updatedProducts: Product[]) => void;
  onSaveProducts?: (products: Product[]) => void;
  onOpenReceipt?: (bill: VoucherBill) => void;
}

export const KantaEntryView: React.FC<KantaEntryViewProps> = ({
  products,
  onOpenBillForWeighment,
  onViewAllRecords,
  initialWeighmentToEdit,
  onClearInitialWeighmentToEdit,
  businessDate,
  currentSession,
  settings,
  bills,
  onSaveBill,
  onSaveProducts,
  onOpenReceipt,
}) => {
  // Modal to create a quick new bill from inside the weighment sheet
  const [showQuickBillModal, setShowQuickBillModal] = useState(false);



  // Read saved draft so mobile screen-off or browser reload never loses entered weights
  const initialDraft = useRef(getStoredKantaDraft()).current;

  // Safe focus helper to prevent mobile browser viewport jumping
  const safeFocus = (el: HTMLElement | null) => {
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  };

  // 1. Farmer Name
  const [customerName, setCustomerName] = useState(() => initialDraft?.customerName || '');

  // Mode: 1 Item or 2 Items (Lines 1-10 for Item 1, Lines 11-20 for Item 2)
  const [isTwoItemsMode, setIsTwoItemsMode] = useState<boolean>(
    () => Boolean(initialDraft?.isTwoItemsMode)
  );

  // Product 1 Selection
  const [selectedProductId, setSelectedProductId] = useState<string>(
    () => initialDraft?.selectedProductId || products[0]?.id || 'p_bajri'
  );
  const [rate, setRate] = useState<string>(
    () => initialDraft?.rate || products[0]?.lastRatePer20Kg?.toString() || '475'
  );

  // 4 Boxes for Item Selection (2 on top, 2 on bottom with horizontal sliding across pages)
  const [productPageIndex, setProductPageIndex] = useState(0);
  const productScrollRef = useRef<HTMLDivElement>(null);

  const productPages = useMemo(() => {
    const pages: Product[][] = [];
    for (let i = 0; i < products.length; i += 4) {
      pages.push(products.slice(i, i + 4));
    }
    return pages;
  }, [products]);

  const handleProductScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const page = Math.round(el.scrollLeft / (el.clientWidth || 1));
    if (page !== productPageIndex) {
      setProductPageIndex(page);
    }
  };

  const scrollToPage = (idx: number) => {
    if (!productScrollRef.current) return;
    const el = productScrollRef.current;
    el.scrollTo({
      left: idx * el.clientWidth,
      behavior: 'smooth',
    });
    setProductPageIndex(idx);
  };

  useEffect(() => {
    if (!selectedProductId || !productScrollRef.current) return;
    const pIndex = products.findIndex((p) => p.id === selectedProductId);
    if (pIndex >= 0) {
      const targetPage = Math.floor(pIndex / 4);
      if (targetPage !== productPageIndex) {
        scrollToPage(targetPage);
      }
    }
  }, [selectedProductId, products]);

  // Product 2 & Rate (Lines 11 to 20)
  const [selectedProductId2, setSelectedProductId2] = useState<string>(() => {
    if (initialDraft?.selectedProductId2) return initialDraft.selectedProductId2;
    const second = products.find((p) => p.id !== (products[0]?.id || 'p_bajri')) || products[1] || products[0];
    return second?.id || 'p_ghau';
  });
  const [rate2, setRate2] = useState<string>(() => {
    if (initialDraft?.rate2) return initialDraft.rate2;
    const prod2 = products.find(
      (p) => p.id === (initialDraft?.selectedProductId2 || (products[1]?.id || 'p_ghau'))
    );
    return prod2?.lastRatePer20Kg?.toString() || '520';
  });

  // 3. Weight Sheet State - Start with 1 to 20 (2 columns of 10) filling the screen width
  const [isSheetOpen, setIsSheetOpen] = useState(() => Boolean(initialDraft?.isSheetOpen));

  // Step-by-step Kanta sub-modal back handlers:
  useBackHandler('kanta-quick-bill', showQuickBillModal, () => setShowQuickBillModal(false));
  useBackHandler('kanta-sheet', isSheetOpen, () => setIsSheetOpen(false));

  const [totalSlots, setTotalSlots] = useState<number>(() => {
    if (initialDraft?.totalSlots) return Math.max(20, initialDraft.totalSlots);
    if (initialDraft?.bagList?.length) return Math.max(20, Math.ceil(initialDraft.bagList.length / 20) * 20);
    return 20;
  });
  const [bagList, setBagList] = useState<string[]>(() => {
    if (initialDraft?.bagList && initialDraft.bagList.length > 0) {
      if (initialDraft.bagList.length < 20) {
        return [...initialDraft.bagList, ...Array(20 - initialDraft.bagList.length).fill('')];
      }
      return initialDraft.bagList;
    }
    return Array(20).fill('');
  });

  // 4. Tare Deduction: Item 1 (કપાત ૧) and Item 2 (કપાત ૨)
  const [tareDeduction, setTareDeduction] = useState<string>(() => initialDraft?.tareDeduction || '');
  const [tareDeduction2, setTareDeduction2] = useState<string>(() => initialDraft?.tareDeduction2 || '');
  const [showTareDeduction, setShowTareDeduction] = useState<boolean>(() => {
    if (initialDraft?.hasTareDeduction !== undefined) return initialDraft.hasTareDeduction;
    return Boolean(
      (initialDraft?.tareDeduction && parseFloat(initialDraft.tareDeduction) > 0) ||
      (initialDraft?.tareDeduction2 && parseFloat(initialDraft.tareDeduction2) > 0)
    );
  });

  // 2-Items Mode Bags state: Item 1 (10, 20, 30...) and Item 2 (10, 20, 30...)
  const [item1Bags, setItem1Bags] = useState<string[]>(() => {
    if (initialDraft?.item1Bags && initialDraft.item1Bags.length > 0) {
      // Check if any bag beyond 10 has weight
      const hasWeightBeyond10 = initialDraft.item1Bags.slice(10).some((v) => {
        const n = parseFloat(v);
        return !isNaN(n) && n > 0;
      });
      if (!hasWeightBeyond10) {
        return initialDraft.item1Bags.slice(0, 10);
      }
      return initialDraft.item1Bags;
    }
    if (initialDraft?.bagList && initialDraft.bagList.length > 0) {
      let filledCols = 1;
      for (let c = 0; c < Math.ceil(initialDraft.bagList.length / 10); c++) {
        const colBags = initialDraft.bagList.slice(c * 10, (c + 1) * 10);
        if (colBags.some((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0)) {
          filledCols = Math.max(filledCols, c + 1);
        }
      }
      const sliced = initialDraft.bagList.slice(0, filledCols * 10);
      return [
        ...sliced,
        ...Array(Math.max(0, filledCols * 10 - sliced.length)).fill(''),
      ];
    }
    return Array(10).fill('');
  });

  const [item2Bags, setItem2Bags] = useState<string[]>(() => {
    if (initialDraft?.item2Bags && initialDraft.item2Bags.length > 0) {
      let filledCols = 1;
      for (let c = 0; c < Math.ceil(initialDraft.item2Bags.length / 10); c++) {
        const colBags = initialDraft.item2Bags.slice(c * 10, (c + 1) * 10);
        if (colBags.some((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0)) {
          filledCols = Math.max(filledCols, c + 1);
        }
      }
      return initialDraft.item2Bags.slice(0, filledCols * 10);
    }
    return Array(10).fill('');
  });

  // Cloud Weighments & Saving State
  const [cloudWeighments, setCloudWeighments] = useState<KantaWeighment[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // Empty box warning state when Enter is pressed on an empty box
  const [emptyAlertIndex, setEmptyAlertIndex] = useState<number | null>(null);
  const [emptyAlertItem, setEmptyAlertItem] = useState<'item1' | 'item2' | 'single' | null>(null);

  // Product Selection Modal Target: 'item1' (1-10) or 'item2' (11-20)
  const [productPickerTarget, setProductPickerTarget] = useState<'item1' | 'item2' | null>(null);

  // Double-click to edit existing weight: track which filled cell is unlocked for editing
  const [unlockedItem1Idx, setUnlockedItem1Idx] = useState<number | null>(null);
  const [unlockedItem2Idx, setUnlockedItem2Idx] = useState<number | null>(null);
  const [unlockedSingleIdx, setUnlockedSingleIdx] = useState<number | null>(null);
  // Track which cell currently has the active keyboard and highlight color
  const [activeCell, setActiveCell] = useState<{ item: 'single' | 'item1' | 'item2'; idx: number } | null>(null);
  const [activeTypingSlot, setActiveTypingSlot] = useState<number | null>(null);
  const [fillingBagIdx, setFillingBagIdx] = useState<number | null>(null);
  const [currentActiveSlot, setCurrentActiveSlot] = useState<number | null>(null);
  const lastTapRef = useRef<{ item: string; idx: number; time: number }>({ item: '', idx: -1, time: 0 });

  const sheetScrollRef = useRef<HTMLDivElement>(null);

  const customerInputRef = useRef<HTMLInputElement>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const item1InputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const item2InputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const tareInputRef = useRef<HTMLInputElement | null>(null);
  const tareInputRef2 = useRef<HTMLInputElement | null>(null);
  const columnsContainerRef = useRef<HTMLDivElement>(null);
  const autoAdvanceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load a saved weighment back into the active weighing sheet for viewing or editing
  const handleLoadIntoSheet = (entry: KantaWeighment) => {
    setCustomerName(entry.customerName || '');

    if (entry.items && entry.items.length === 2) {
      setIsTwoItemsMode(true);
      setSelectedProductId(entry.items[0].productId);
      setRate(entry.items[0].ratePer20Kg?.toString() || '');
      setTareDeduction(entry.items[0].tareWeightKg ? entry.items[0].tareWeightKg.toString() : '');

      setSelectedProductId2(entry.items[1].productId);
      setRate2(entry.items[1].ratePer20Kg?.toString() || '');
      setTareDeduction2(entry.items[1].tareWeightKg ? entry.items[1].tareWeightKg.toString() : '');
      const hasTare = Boolean(
        (entry.items[0].tareWeightKg && entry.items[0].tareWeightKg > 0) ||
        (entry.items[1].tareWeightKg && entry.items[1].tareWeightKg > 0)
      );
      setShowTareDeduction(hasTare);

      const bags1 = (entry.items[0].bags || []).map((b) => b.toString());
      const bags2 = (entry.items[1].bags || []).map((b) => b.toString());
      const slots1 = Math.max(10, Math.ceil(bags1.length / 10) * 10);
      const slots2 = Math.max(10, Math.ceil(bags2.length / 10) * 10);
      const pad1 = [...bags1, ...Array(slots1 - bags1.length).fill('')];
      const pad2 = [...bags2, ...Array(slots2 - bags2.length).fill('')];

      setItem1Bags(pad1);
      setItem2Bags(pad2);
      setTotalSlots(slots1 + slots2);
      setBagList([...pad1, ...pad2]);
    } else {
      setIsTwoItemsMode(false);
      if (entry.productId) setSelectedProductId(entry.productId);
      if (entry.ratePer20Kg) setRate(entry.ratePer20Kg.toString());
      setTareDeduction(entry.tareWeightKg ? entry.tareWeightKg.toString() : '');
      setTareDeduction2('');
      setShowTareDeduction(Boolean(entry.tareWeightKg && entry.tareWeightKg > 0));

      const newBags = (entry.bags || []).map((b) =>
        b !== undefined && b !== null ? b.toString() : ''
      );
      const neededSlots = Math.max(20, Math.ceil(newBags.length / 20) * 20);
      const paddedBags = [
        ...newBags,
        ...Array(Math.max(0, neededSlots - newBags.length)).fill(''),
      ];
      setTotalSlots(neededSlots);
      setBagList(paddedBags);
    }

    setIsSheetOpen(true);
    setSaveToast(`ખેડૂત ${entry.customerName} ના વજન શીટમાં ખુલ્યા છે.`);
    setTimeout(() => setSaveToast(null), 3000);
  };

  // Handle incoming weighment to edit
  useEffect(() => {
    if (initialWeighmentToEdit) {
      handleLoadIntoSheet(initialWeighmentToEdit);
      onClearInitialWeighmentToEdit?.();
    }
  }, [initialWeighmentToEdit]);

  // Keep mobile screen awake while weighing scale is open
  useEffect(() => {
    let sentinel: any = null;

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && (navigator as any).wakeLock) {
          sentinel = await (navigator as any).wakeLock.request('screen');
        }
      } catch (e) {
        // gracefully ignore if wake lock is unavailable or blocked
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (sentinel) {
        try {
          sentinel.release();
        } catch (e) {}
      }
    };
  }, []);

  // Continuous auto-save draft to localStorage whenever any value changes
  useEffect(() => {
    saveKantaDraft({
      customerName,
      selectedProductId,
      rate,
      isTwoItemsMode,
      selectedProductId2,
      rate2,
      tareDeduction,
      tareDeduction2,
      hasTareDeduction: showTareDeduction,
      totalSlots,
      bagList,
      item1Bags,
      item2Bags,
      isSheetOpen,
    });
  }, [
    customerName,
    selectedProductId,
    rate,
    isTwoItemsMode,
    selectedProductId2,
    rate2,
    tareDeduction,
    tareDeduction2,
    showTareDeduction,
    totalSlots,
    bagList,
    item1Bags,
    item2Bags,
    isSheetOpen,
  ]);

  // Subscribe to live cloud weighments
  useEffect(() => {
    const unsub = subscribeToWeighments((list) => {
      setCloudWeighments(list);
    });
    return () => unsub();
  }, []);

  // When selected product 1 changes
  const handleProductSelect = (prod: Product) => {
    setSelectedProductId(prod.id);
    const newRate = prod.lastRatePer20Kg.toString();
    setRate(newRate);
    saveKantaDraft({ selectedProductId: prod.id, rate: newRate });
  };

  // When selected product 2 changes (for lines 11-20)
  const handleProduct2Select = (prod: Product) => {
    setSelectedProductId2(prod.id);
    const newRate = prod.lastRatePer20Kg.toString();
    setRate2(newRate);
    saveKantaDraft({ selectedProductId2: prod.id, rate2: newRate });
  };

  const selectedProduct =
    products.find((p) => p.id === selectedProductId) || products[0] || {
      id: 'p_bajri',
      name: 'બાજરી',
      lastRatePer20Kg: 475,
    };

  const selectedProduct2 =
    products.find((p) => p.id === selectedProductId2) ||
    products.find((p) => p.id !== selectedProductId) ||
    products[1] ||
    products[0] || {
      id: 'p_ghau',
      name: 'ઘઉં',
      lastRatePer20Kg: 520,
    };

  // Calculations:
  // In 2-item mode:
  // Item 1 uses item1Bags
  // Item 2 uses item2Bags
  const validBagsAll = bagList
    .map((b) => parseFloat(b))
    .filter((n) => !isNaN(n) && n > 0);

  // Item 1
  const validBags1 = isTwoItemsMode
    ? item1Bags
        .map((b) => parseFloat(b))
        .filter((n) => !isNaN(n) && n > 0)
    : bagList
        .slice(0, totalSlots)
        .map((b) => parseFloat(b))
        .filter((n) => !isNaN(n) && n > 0);
  const count1 = validBags1.length;
  const gross1 = Math.round(validBags1.reduce((acc, v) => acc + v, 0) * 100) / 100;
  const deductionNum1 = parseFloat(tareDeduction) || 0;
  const net1 = Math.max(0, Math.round((gross1 - deductionNum1) * 100) / 100);
  const rateNum1 = parseFloat(rate) || 0;
  const amount1 = Math.round((net1 / 20) * rateNum1);

  // Item 2 (only when in 2-item mode)
  const validBags2 = isTwoItemsMode
    ? item2Bags
        .map((b) => parseFloat(b))
        .filter((n) => !isNaN(n) && n > 0)
    : [];
  const count2 = validBags2.length;
  const gross2 = Math.round(validBags2.reduce((acc, v) => acc + v, 0) * 100) / 100;
  const deductionNum2 = parseFloat(tareDeduction2) || 0;
  const net2 = Math.max(0, Math.round((gross2 - deductionNum2) * 100) / 100);
  const rateNum2 = parseFloat(rate2) || 0;
  const amount2 = Math.round((net2 / 20) * rateNum2);

  // Totals
  const totalBagsCount = isTwoItemsMode ? count1 + count2 : validBagsAll.length;
  const grossWeightKg = isTwoItemsMode
    ? Math.round((gross1 + gross2) * 100) / 100
    : Math.round(validBagsAll.reduce((acc, v) => acc + v, 0) * 100) / 100;
  const totalDeductionNum = isTwoItemsMode ? deductionNum1 + deductionNum2 : deductionNum1;
  const netWeightKg = isTwoItemsMode
    ? Math.round((net1 + net2) * 100) / 100
    : Math.max(0, Math.round((grossWeightKg - deductionNum1) * 100) / 100);
  const calculatedAmount = isTwoItemsMode ? amount1 + amount2 : Math.round((netWeightKg / 20) * rateNum1);

  // Calculate 10-line block subtotal for single-item mode
  const getBlockTotal = (startIdx: number) => {
    let sum = 0;
    for (let i = startIdx; i < startIdx + 10; i++) {
      const v = parseFloat(bagList[i]);
      if (!isNaN(v) && v > 0) sum += v;
    }
    return Math.round(sum * 100) / 100;
  };

  // -------------------------------------------------------------------------
  // Sequential Entry Rules: Weight entry MUST start from 1 and proceed sequentially.
  // -------------------------------------------------------------------------
  // 1. Single-Item sequential: first empty slot (must start from 0 / slot 1)
  const firstEmptyBagIdx = React.useMemo(() => {
    for (let i = 0; i < totalSlots; i++) {
      const val = (bagList[i] || '').trim();
      const num = parseFloat(val);
      if (!val || isNaN(num) || num <= 0) {
        return i;
      }
    }
    return totalSlots;
  }, [bagList, totalSlots]);

  // 2. Item 1 sequential: first empty slot (must start from 0 / slot 1)
  const firstEmptyItem1Idx = React.useMemo(() => {
    for (let i = 0; i < item1Bags.length; i++) {
      const val = (item1Bags[i] || '').trim();
      const num = parseFloat(val);
      if (!val || isNaN(num) || num <= 0) {
        return i;
      }
    }
    return item1Bags.length;
  }, [item1Bags]);

  // 3. Item 2 sequential: first empty slot (must start from 0 / slot 1)
  const firstEmptyItem2Idx = React.useMemo(() => {
    for (let i = 0; i < item2Bags.length; i++) {
      const val = (item2Bags[i] || '').trim();
      const num = parseFloat(val);
      if (!val || isNaN(num) || num <= 0) {
        return i;
      }
    }
    return item2Bags.length;
  }, [item2Bags]);

  // Alert & focus the active sequential box when a user taps a future locked box
  const handleLockedClick = (item: 'single' | 'item1' | 'item2', targetIdx: number) => {
    setEmptyAlertIndex(targetIdx);
    setEmptyAlertItem(item);
    setTimeout(() => {
      setEmptyAlertIndex((prev) => (prev === targetIdx ? null : prev));
    }, 900);
    if (item === 'single') {
      inputRefs.current[targetIdx]?.focus();
    } else if (item === 'item1') {
      item1InputRefs.current[targetIdx]?.focus();
    } else if (item === 'item2') {
      item2InputRefs.current[targetIdx]?.focus();
    }
  };

  // Unlock cell for editing on double click / double tap
  const unlockCell = (item: "single" | "item1" | "item2", idx: number) => {
    setActiveCell({ item, idx });
    if (item === "single") {
      setUnlockedSingleIdx(idx);
      setTimeout(() => {
        const el = inputRefs.current[idx];
        if (el) {
          safeFocus(el);
          try { el.select(); } catch {}
        }
      }, 30);
    } else if (item === "item1") {
      setUnlockedItem1Idx(idx);
      setTimeout(() => {
        const el = item1InputRefs.current[idx];
        if (el) {
          safeFocus(el);
          try { el.select(); } catch {}
        }
      }, 30);
    } else if (item === "item2") {
      setUnlockedItem2Idx(idx);
      setTimeout(() => {
        const el = item2InputRefs.current[idx];
        if (el) {
          safeFocus(el);
          try { el.select(); } catch {}
        }
      }, 30);
    }
  };

  const handleCellClick = (
    item: 'single' | 'item1' | 'item2',
    idx: number,
    hasVal: boolean,
    isLocked: boolean
  ) => {
    if (isLocked) {
      if (item === 'item1') handleLockedClick('item1', firstEmptyItem1Idx);
      else if (item === 'item2') handleLockedClick('item2', firstEmptyItem2Idx);
      else handleLockedClick('single', firstEmptyBagIdx);
      return;
    }

    if (hasVal) {
      // Cell already has a weight: require double click / double tap (within 650ms) to edit!
      const now = Date.now();
      const isDouble =
        lastTapRef.current.item === item &&
        lastTapRef.current.idx === idx &&
        now - lastTapRef.current.time < 650;

      if (isDouble) {
        lastTapRef.current = { item: '', idx: -1, time: 0 };
        unlockCell(item, idx);
      } else {
        lastTapRef.current = { item, idx, time: now };
      }
    } else {
      // Empty sequential box: normal focus and highlight
      setActiveCell({ item, idx });
      if (item === 'item1') {
        setUnlockedItem1Idx(idx);
        safeFocus(item1InputRefs.current[idx]);
      } else if (item === 'item2') {
        setUnlockedItem2Idx(idx);
        safeFocus(item2InputRefs.current[idx]);
      } else {
        setUnlockedSingleIdx(idx);
        safeFocus(inputRefs.current[idx]);
      }
    }
  };

  // Auto-focus on Box 1 whenever the weight sheet opens
  useEffect(() => {
    if (isSheetOpen) {
      const timer = setTimeout(() => {
        if (isTwoItemsMode) {
          const target = firstEmptyItem1Idx < item1Bags.length ? firstEmptyItem1Idx : 0;
          setActiveCell({ item: 'item1', idx: target });
          item1InputRefs.current[target]?.focus();
        } else {
          const target = firstEmptyBagIdx < totalSlots ? firstEmptyBagIdx : 0;
          setActiveCell({ item: 'single', idx: target });
          inputRefs.current[target]?.focus();
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isSheetOpen, isTwoItemsMode]);

  // Add 10 lines to Item 1 (e.g. 10 -> 20 -> 30)
  const handleAdd10LinesItem1 = (shouldFocus = true) => {
    const newIdx = item1Bags.length;
    setItem1Bags((prev) => {
      const updated = [...prev, ...Array(10).fill('')];
      saveKantaDraft({ item1Bags: updated, bagList: [...updated, ...item2Bags] });
      return updated;
    });
    if (shouldFocus) {
      setTimeout(() => {
        setActiveCell({ item: 'item1', idx: newIdx });
        safeFocus(item1InputRefs.current[newIdx]);
        if (columnsContainerRef.current) {
          columnsContainerRef.current.scrollTo({
            left: columnsContainerRef.current.scrollWidth,
            behavior: 'smooth',
          });
        }
      }, 120);
    }
  };

  // Check if last 10 bags of Item 1 have any weight written
  const item1LastColHasWeight = React.useMemo(() => {
    if (item1Bags.length <= 10) return false;
    const last10 = item1Bags.slice(-10);
    return last10.some((v) => {
      if (!v) return false;
      const str = String(v).trim();
      if (!str) return false;
      const num = parseFloat(str);
      return !isNaN(num) ? num > 0 : true;
    });
  }, [item1Bags]);

  // Remove 10 lines from Item 1 - STRICT CONDITION: Never if weight is entered
  const handleRemove10LinesItem1 = () => {
    if (item1Bags.length <= 10) return;
    const last10 = item1Bags.slice(-10);
    const hasWeight = last10.some((v) => {
      if (!v) return false;
      const str = String(v).trim();
      if (!str) return false;
      const num = parseFloat(str);
      return !isNaN(num) ? num > 0 : true;
    });
    if (hasWeight) return; // Strict safety check
    setItem1Bags((prev) => {
      if (prev.length <= 10) return prev;
      const updated = prev.slice(0, prev.length - 10);
      saveKantaDraft({ item1Bags: updated, bagList: [...updated, ...item2Bags] });
      return updated;
    });
  };

  // Add 10 lines to Item 2 (e.g. 10 -> 20 -> 30)
  const handleAdd10LinesItem2 = (shouldFocus = true) => {
    const newIdx = item2Bags.length;
    setItem2Bags((prev) => {
      const updated = [...prev, ...Array(10).fill('')];
      saveKantaDraft({ item2Bags: updated, bagList: [...item1Bags, ...updated] });
      return updated;
    });
    if (shouldFocus) {
      setTimeout(() => {
        setActiveCell({ item: 'item2', idx: newIdx });
        safeFocus(item2InputRefs.current[newIdx]);
        if (columnsContainerRef.current) {
          columnsContainerRef.current.scrollTo({
            left: columnsContainerRef.current.scrollWidth,
            behavior: 'smooth',
          });
        }
      }, 120);
    }
  };

  // Check if last 10 bags of Item 2 have any weight written
  const item2LastColHasWeight = React.useMemo(() => {
    if (item2Bags.length <= 10) return false;
    const last10 = item2Bags.slice(-10);
    return last10.some((v) => {
      if (!v) return false;
      const str = String(v).trim();
      if (!str) return false;
      const num = parseFloat(str);
      return !isNaN(num) ? num > 0 : true;
    });
  }, [item2Bags]);

  // Check if Item 2 has ANY weight written across all bags
  const item2HasAnyWeight = React.useMemo(() => {
    return item2Bags.some((v) => {
      if (!v) return false;
      const str = String(v).trim();
      if (!str) return false;
      const num = parseFloat(str);
      return !isNaN(num) ? num > 0 : true;
    });
  }, [item2Bags]);

  // Remove 10 lines from Item 2, or remove Item 2 completely if 10 lines and empty - STRICT CONDITION: Never if weight is entered
  const handleRemove10LinesItem2 = () => {
    if (item2Bags.length > 10) {
      const last10 = item2Bags.slice(-10);
      const hasWeight = last10.some((v) => {
        if (!v) return false;
        const str = String(v).trim();
        if (!str) return false;
        const num = parseFloat(str);
        return !isNaN(num) ? num > 0 : true;
      });
      if (hasWeight) return; // Strict safety check
      setItem2Bags((prev) => {
        if (prev.length <= 10) return prev;
        const updated = prev.slice(0, prev.length - 10);
        saveKantaDraft({ item2Bags: updated, bagList: [...item1Bags, ...updated] });
        return updated;
      });
    } else if (item2Bags.length === 10) {
      if (item2HasAnyWeight) return; // Strict safety check
      setIsTwoItemsMode(false);
      saveKantaDraft({ isTwoItemsMode: false });
    }
  };

  const handleItem1BagChange = (idx: number, val: string) => {
    setActiveCell({ item: 'item1', idx });
    setUnlockedItem1Idx(idx);
    if (idx > firstEmptyItem1Idx && !item1Bags[idx]) {
      handleLockedClick('item1', firstEmptyItem1Idx);
      return;
    }
    const updated = [...item1Bags];
    updated[idx] = val;
    setItem1Bags(updated);
    saveKantaDraft({ item1Bags: updated, bagList: [...updated, ...item2Bags] });
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    const trimmed = val.trim();
    const num = parseFloat(trimmed);
    const isValid = !isNaN(num) && num > 0;

    // Advance only when user finishes writing:
    const advanceItem1 = () => {
      setUnlockedItem1Idx(null);
      if (idx === item1Bags.length - 1) {
        // At the end of column (Line 10, 20, 30): auto-add 10 lines and focus Line 11, 21, 31
        handleAdd10LinesItem1(true);
      } else if (idx + 1 < item1Bags.length) {
        const nextIdx = idx + 1;
        setActiveCell({ item: 'item1', idx: nextIdx });
        safeFocus(item1InputRefs.current[nextIdx]);
      } else if (item2InputRefs.current[0]) {
        setActiveCell({ item: 'item2', idx: 0 });
        safeFocus(item2InputRefs.current[0]);
      }
    };

    // 1) Auto-advance immediately when ending with .5 (e.g. 26.5, 35.5)
    if (/^\d{2,4}\.5$/.test(trimmed)) {
      advanceItem1();
    } else if (/^\d{2,4}$/.test(trimmed)) {
      // 2) જો ૨ કે વધારે આંકડા (દા.ત. 34, 25, 45) હોય તો ૧ સેકન્ડ પછી નીચેના બોક્સમાં જશે
      if (isValid) {
        autoAdvanceTimerRef.current = setTimeout(() => {
          advanceItem1();
        }, 1000);
      }
    }
  };

  const handleItem1KeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      setUnlockedItem1Idx(null);
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
      const currentVal = (item1Bags[idx] || '').trim();
      const num = parseFloat(currentVal);
      // જો બોક્સ લખ્યા વગરનું હોય કે ૦ હોય, તો એન્ટર થઈને નીચે જવું જોઈએ નહીં
      if (!currentVal || isNaN(num) || num <= 0) {
        setEmptyAlertIndex(idx);
        setEmptyAlertItem('item1');
        setTimeout(() => {
          setEmptyAlertIndex((prev) => (prev === idx ? null : prev));
        }, 900);
        item1InputRefs.current[idx]?.focus();
        return;
      }

      if (idx === item1Bags.length - 1) {
        handleAdd10LinesItem1(true);
      } else if (idx + 1 < item1Bags.length) {
        const nextIdx = idx + 1;
        setActiveCell({ item: 'item1', idx: nextIdx });
        safeFocus(item1InputRefs.current[nextIdx]);
      } else if (item2InputRefs.current[0]) {
        setActiveCell({ item: 'item2', idx: 0 });
        safeFocus(item2InputRefs.current[0]);
      } else {
        setActiveCell(null);
        tareInputRef.current?.focus();
      }
    } else if (e.key === 'Backspace' || e.keyCode === 8) {
      const currentVal = (item1Bags[idx] || '').trim();
      if (currentVal.length > 0) {
        // Allow native backspace to delete characters while typing
        return;
      }
      e.preventDefault();
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
      if (idx > 0) {
        const prevInput = item1InputRefs.current[idx - 1];
        if (prevInput) {
          prevInput.focus();
          prevInput.select();
          setTimeout(() => {
            try {
              prevInput.setSelectionRange(0, prevInput.value.length);
            } catch {}
          }, 30);
        }
      }
    }
  };

  const handleItem2BagChange = (idx: number, val: string) => {
    setActiveCell({ item: 'item2', idx });
    setUnlockedItem2Idx(idx);
    if (idx > firstEmptyItem2Idx && !item2Bags[idx]) {
      handleLockedClick('item2', firstEmptyItem2Idx);
      return;
    }
    const updated = [...item2Bags];
    updated[idx] = val;
    setItem2Bags(updated);
    saveKantaDraft({ item2Bags: updated, bagList: [...item1Bags, ...updated] });
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    const trimmed = val.trim();
    const num = parseFloat(trimmed);
    const isValid = !isNaN(num) && num > 0;

    const advanceItem2 = () => {
      setUnlockedItem2Idx(null);
      if (idx === item2Bags.length - 1) {
        handleAdd10LinesItem2(true);
      } else if (idx + 1 < item2Bags.length) {
        const nextIdx = idx + 1;
        setActiveCell({ item: 'item2', idx: nextIdx });
        safeFocus(item2InputRefs.current[nextIdx]);
      }
    };

    // 1) Auto-advance immediately when ending with .5 (e.g. 26.5, 35.5)
    if (/^\d{2,4}\.5$/.test(trimmed)) {
      advanceItem2();
    } else if (/^\d{2,4}$/.test(trimmed)) {
      // 2) જો ૨ કે વધારે આંકડા (દા.ત. 34, 25, 45) હોય તો ૧ સેકન્ડ પછી નીચેના બોક્સમાં જશે
      if (isValid) {
        autoAdvanceTimerRef.current = setTimeout(() => {
          advanceItem2();
        }, 1000);
      }
    }
  };

  const handleItem2KeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      setUnlockedItem2Idx(null);
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
      const currentVal = (item2Bags[idx] || '').trim();
      const num = parseFloat(currentVal);
      // જો બોક્સ લખ્યા વગરનું હોય કે ૦ હોય, તો એન્ટર થઈને નીચે જવું જોઈએ નહીં
      if (!currentVal || isNaN(num) || num <= 0) {
        setEmptyAlertIndex(idx);
        setEmptyAlertItem('item2');
        setTimeout(() => {
          setEmptyAlertIndex((prev) => (prev === idx ? null : prev));
        }, 900);
        item2InputRefs.current[idx]?.focus();
        return;
      }

      if (idx === item2Bags.length - 1) {
        handleAdd10LinesItem2(true);
      } else if (idx + 1 < item2Bags.length) {
        const nextIdx = idx + 1;
        setActiveCell({ item: 'item2', idx: nextIdx });
        safeFocus(item2InputRefs.current[nextIdx]);
      } else {
        setActiveCell(null);
        if (tareInputRef2.current) {
          tareInputRef2.current.focus();
        } else if (tareInputRef.current) {
          tareInputRef.current.focus();
        }
      }
    } else if (e.key === 'Backspace' || e.keyCode === 8) {
      const currentVal = (item2Bags[idx] || '').trim();
      if (currentVal.length > 0) {
        // Allow native backspace to delete characters while typing
        return;
      }
      e.preventDefault();
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
      if (idx > 0) {
        const prevInput = item2InputRefs.current[idx - 1];
        if (prevInput) {
          prevInput.focus();
          prevInput.select();
          setTimeout(() => {
            try {
              prevInput.setSelectionRange(0, prevInput.value.length);
            } catch {}
          }, 30);
        }
      } else if (idx === 0 && item1InputRefs.current.length > 0) {
        const lastItem1Input = item1InputRefs.current[item1Bags.length - 1];
        if (lastItem1Input) {
          lastItem1Input.focus();
          lastItem1Input.select();
          setTimeout(() => {
            try {
              lastItem1Input.setSelectionRange(0, lastItem1Input.value.length);
            } catch {}
          }, 30);
        }
      }
    }
  };

  const getItem1ColTotal = (colIdx: number) => {
    let sum = 0;
    const start = colIdx * 10;
    for (let i = start; i < start + 10; i++) {
      const v = parseFloat(item1Bags[i]);
      if (!isNaN(v) && v > 0) sum += v;
    }
    return Math.round(sum * 100) / 100;
  };

  const getItem2ColTotal = (colIdx: number) => {
    let sum = 0;
    const start = colIdx * 10;
    for (let i = start; i < start + 10; i++) {
      const v = parseFloat(item2Bags[i]);
      if (!isNaN(v) && v > 0) sum += v;
    }
    return Math.round(sum * 100) / 100;
  };

  // Add 10 more slots to single-item mode automatically when current slots are filled
  const handleAutoAdd10Slots = () => {
    setTotalSlots((prevTotal) => {
      const newTotal = prevTotal + 10;
      setBagList((prevBagList) => {
        const newBagList = [...prevBagList, ...Array(10).fill('')];
        saveKantaDraft({ totalSlots: newTotal, bagList: newBagList });
        return newBagList;
      });
      return newTotal;
    });
  };

  // Move down to next row smoothly when weight ends with .5 (immediately), or 1 second after entering 2+ digits (e.g. 32)
  // If the last slot is filled, automatically add 10 more bags
  const handleBagChange = (index: number, val: string) => {
    setActiveCell({ item: 'single', idx: index });
    setUnlockedSingleIdx(index);
    setActiveTypingSlot(index);
    setCurrentActiveSlot(index);
    const updated = [...bagList];
    updated[index] = val;
    setBagList(updated);
    saveKantaDraft({ bagList: updated });

    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }

    const trimmed = val.trim();
    const num = parseFloat(trimmed);
    const isValid = !isNaN(num) && num > 0;

    // If filling the last slot or if all slots are filled, auto add 10 slots
    if (isValid && index === totalSlots - 1) {
      const willBeAllFilled = updated.slice(0, totalSlots).every((b) => {
        const n = parseFloat(b);
        return !isNaN(n) && n > 0;
      });
      if (willBeAllFilled) {
        handleAutoAdd10Slots();
      }
    }

    // ૧) જો પાછળ .5 હોય (દા.ત. 32.5) તો તૈયારીમાં નીચે જશે (no jump)
    if (/^\d{2,4}\.5$/.test(trimmed)) {
      setUnlockedSingleIdx(null);
      setFillingBagIdx(null);
      const nextIndex = index + 1;
      setActiveCell({ item: 'single', idx: nextIndex });
      setCurrentActiveSlot(nextIndex);
      safeFocus(inputRefs.current[nextIndex]);
    } else if (/^\d{2,4}$/.test(trimmed)) {
      // ૨) જો ખાલી ૩૨ (૨ ડીજીટ) હોય તો ૧ સેકન્ડ પછી નીચે જશે
      if (isValid) {
        autoAdvanceTimerRef.current = setTimeout(() => {
          setUnlockedSingleIdx(null);
          setActiveTypingSlot(index + 1);
          setFillingBagIdx(null);
          const nextIndex = index + 1;
          setActiveCell({ item: 'single', idx: nextIndex });
          setCurrentActiveSlot(nextIndex);
          safeFocus(inputRefs.current[nextIndex]);
        }, 1000);
      }
    }
  };

  // Handle key navigation (Enter goes to next line only if current box has valid weight, Backspace goes to previous)
  const handleKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      setUnlockedSingleIdx(null);
      setActiveTypingSlot(index + 1);
      setFillingBagIdx(null);
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
      const currentVal = (bagList[index] || '').trim();
      const num = parseFloat(currentVal);
      // જો બોક્સ લખ્યા વગરનું હોય કે ૦ હોય, તો એન્ટર થઈને નીચે જવું જોઈએ નહીં
      if (!currentVal || isNaN(num) || num <= 0) {
        setEmptyAlertIndex(index);
        setEmptyAlertItem('single');
        setTimeout(() => {
          setEmptyAlertIndex((prev) => (prev === index ? null : prev));
        }, 900);
        inputRefs.current[index]?.focus();
        return;
      }

      // Check if filling last box and auto-add 10
      if (index === totalSlots - 1) {
        const isAllFilled = bagList.slice(0, totalSlots).every((b) => {
          const n = parseFloat(b);
          return !isNaN(n) && n > 0;
        });
        if (isAllFilled) {
          handleAutoAdd10Slots();
        }
      }

      const nextIndex = index + 1;
      if (nextIndex < totalSlots || index === totalSlots - 1) {
        setTimeout(() => {
          safeFocus(inputRefs.current[nextIndex]);
        }, 30);
      } else {
        tareInputRef.current?.focus();
      }
    } else if (e.key === 'Backspace' || e.keyCode === 8) {
      const currentVal = (bagList[index] || '').trim();
      if (currentVal.length > 0) {
        // Allow native backspace to delete characters while typing
        return;
      }
      e.preventDefault();
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
      if (index > 0) {
        const prevInput = inputRefs.current[index - 1];
        if (prevInput) {
          prevInput.focus();
          prevInput.select();
          setTimeout(() => {
            try {
              prevInput.setSelectionRange(0, prevInput.value.length);
            } catch {}
          }, 30);
        }
      }
    }
  };

  // Check if current 20-slot set is completely filled
  const isCurrentSheetFull =
    totalSlots > 0 &&
    bagList.slice(0, totalSlots).every((b) => {
      const n = parseFloat(b);
      return !isNaN(n) && n > 0;
    });

  // Remaining bags to fill before +20 can be unlocked
  const filledSlotsCount = bagList
    .slice(0, totalSlots)
    .filter((b) => !isNaN(parseFloat(b)) && parseFloat(b) > 0).length;
  const remainingToFill = totalSlots - filledSlotsCount;

  // Add more slots (+20 bags: 21-40, 41-60, etc.) - Only if all 20 bags are filled
  const handleAddMoreSlots = () => {
    if (!isCurrentSheetFull) {
      alert(`પહેલા ચાલુ ૨૦ થેલીનું વજન પૂરેપૂરું ભરો (${remainingToFill} થેલી ભરવાની બાકી છે). ૨૦ થેલી ભરાય પછી જ +૨૦ થશે.`);
      return;
    }
    const newTotal = totalSlots + 20;
    const newBagList = [...bagList, ...Array(20).fill('')];
    setTotalSlots(newTotal);
    setBagList(newBagList);
    saveKantaDraft({ totalSlots: newTotal, bagList: newBagList });
    setTimeout(() => {
      inputRefs.current[totalSlots]?.focus();
      if (columnsContainerRef.current) {
        columnsContainerRef.current.scrollTo({
          left: columnsContainerRef.current.scrollWidth,
          behavior: 'smooth',
        });
      }
    }, 120);
  };

  // Check if last 20 slots have any weight in 1-item mode
  const last20HasWeight = React.useMemo(() => {
    if (totalSlots <= 20) return false;
    return bagList.slice(totalSlots - 20, totalSlots).some((v) => {
      if (!v) return false;
      const str = String(v).trim();
      if (!str) return false;
      const num = parseFloat(str);
      return !isNaN(num) ? num > 0 : true;
    });
  }, [bagList, totalSlots]);

  // Remove last 20 slots - STRICT CONDITION: Never if weight exists
  const handleRemove20Bags = () => {
    if (totalSlots <= 20 || last20HasWeight) return;
    const newTotal = totalSlots - 20;
    const newBagList = bagList.slice(0, newTotal);
    setTotalSlots(newTotal);
    setBagList(newBagList);
    saveKantaDraft({ totalSlots: newTotal, bagList: newBagList });
  };

  // Reset current form for next farmer
  const handleResetForm = () => {
    clearKantaDraft();
    setCustomerName('');
    setTotalSlots(20);
    setBagList(Array(20).fill(''));
    setItem1Bags(Array(10).fill(''));
    setItem2Bags(Array(10).fill(''));
    setTareDeduction('');
    setTareDeduction2('');
    setShowTareDeduction(false);
    setIsTwoItemsMode(false);
    customerInputRef.current?.focus();
  };

  // Save to Firebase Cloud from the main page
  const handleSaveWeighment = async (destinationType: 'standard' | 'vado' = 'standard') => {
    if (totalBagsCount === 0) {
      alert('કૃપા કરીને વજન દાખલ કરો.');
      setIsSheetOpen(true);
      return;
    }

    setIsSaving(true);
    try {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });

      const newEntry: KantaWeighment = {
        id: `kanta_${Date.now()}`,
        date: getActiveBusinessDate(),
        time: timeStr,
        customerName: customerName.trim() || 'સામાન્ય ગ્રાહક',
        productId: selectedProduct.id,
        productName: isTwoItemsMode
          ? `${selectedProduct.name} + ${selectedProduct2.name}`
          : selectedProduct.name,
        ratePer20Kg: rateNum1,
        bags: isTwoItemsMode ? [...validBags1, ...validBags2] : validBagsAll,
        totalBagsCount,
        totalWeightKg: netWeightKg,
        destination: destinationType,
        isVado: destinationType === 'vado',
        ...(totalDeductionNum > 0 ? { tareWeightKg: totalDeductionNum } : {}),
        calculatedAmount,
        status: 'pending',
        createdAt: Date.now(),
        ...(isTwoItemsMode
          ? {
              items: [
                {
                  productId: selectedProduct.id,
                  productName: selectedProduct.name,
                  ratePer20Kg: rateNum1,
                  bags: validBags1,
                  grossWeightKg: gross1,
                  tareWeightKg: deductionNum1 > 0 ? deductionNum1 : undefined,
                  netWeightKg: net1,
                  calculatedAmount: amount1,
                },
                {
                  productId: selectedProduct2.id,
                  productName: selectedProduct2.name,
                  ratePer20Kg: rateNum2,
                  bags: validBags2,
                  grossWeightKg: gross2,
                  tareWeightKg: deductionNum2 > 0 ? deductionNum2 : undefined,
                  netWeightKg: net2,
                  calculatedAmount: amount2,
                },
              ],
            }
          : {}),
      };

      await saveKantaWeighmentToCloud(newEntry);

      clearKantaDraft();
      setIsSheetOpen(false);
      setSaveToast(
        destinationType === 'vado'
          ? `✅ ${newEntry.customerName} - ${netWeightKg} kg વાડામાં સેવ થઈ ગયું!`
          : `✅ ${newEntry.customerName} - ${netWeightKg} kg વજન સેવ થઈ ગયું!`
      );
      setTimeout(() => setSaveToast(null), 4000);

      // Reset for next farmer
      handleResetForm();
    } catch (err: any) {
      alert(`સેવ કરવામાં એરર: ${err.message || 'ઇન્ટરનેટ કનેક્શન તપાસો'}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-12">
      {saveToast && (
        <div className="p-3.5 bg-emerald-100 border border-emerald-300 text-emerald-950 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 animate-in fade-in">
          <CheckCircle className="w-5 h-5 text-emerald-700 shrink-0" />
          <span>{saveToast}</span>
        </div>
      )}

      {/* Main Entry Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-4">
        {/* Step 1: Customer Name */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            ૧. ગ્રાહકનું નામ
          </label>
          <div className="relative">
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
                  setIsSheetOpen(true);
                }
              }}
              className="w-full px-3.5 py-2.5 text-base font-bold text-slate-900 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
            {customerName && (
              <button
                type="button"
                onClick={() => {
                  setCustomerName('');
                  customerInputRef.current?.focus();
                }}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 font-bold cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Step 2: Product Selection - 4 Boxes (2 Top, 2 Bottom) with Slide */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-700">
            ૨. માલ પસંદ કરો
          </label>

          {/* 4 Boxes with Slide (2 on top, 2 on bottom) */}
          <div className="space-y-1.5">
            <div
              ref={productScrollRef}
              onScroll={handleProductScroll}
              className="flex items-stretch overflow-x-auto pb-1 pt-0.5 no-scrollbar snap-x snap-mandatory gap-2 -mx-0.5 px-0.5"
            >
              {productPages.map((page, pageIdx) => (
                <div
                  key={pageIdx}
                  className="w-full shrink-0 grid grid-cols-2 gap-2 snap-start"
                >
                  {page.map((prod) => {
                    const isSelected = prod.id === selectedProductId;
                    return (
                      <button
                        key={prod.id}
                        type="button"
                        onClick={() => handleProductSelect(prod)}
                        className={`py-3 px-2 rounded-xl text-center border font-bold text-sm transition cursor-pointer active:scale-95 flex items-center justify-center min-h-[48px] ${
                          isSelected
                            ? 'bg-emerald-700 text-white border-emerald-800 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="truncate font-black text-sm">{prod.name}</div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Pagination dots if more than 1 page */}
            {productPages.length > 1 && (
              <div className="flex items-center justify-center gap-1.5 pt-0.5">
                {productPages.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => scrollToPage(i)}
                    className={`h-1.5 rounded-full transition-all cursor-pointer ${
                      i === productPageIndex ? 'w-5 bg-emerald-600' : 'w-1.5 bg-slate-300 hover:bg-slate-400'
                    }`}
                    aria-label={`પેજ ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Step 3: Weight Entry / Summary Box */}
        <div className="pt-2 border-t border-slate-100">
          {totalBagsCount === 0 ? (
            <button
              type="button"
              onClick={() => setIsSheetOpen(true)}
              className="w-full py-3.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white font-black text-base flex items-center justify-center gap-2.5 shadow-md transition cursor-pointer active:scale-98"
            >
              <FileSpreadsheet className="w-5 h-5 shrink-0" />
              <span>વજન પત્રક</span>
            </button>
          ) : (
            /* કુલ થેલી વાળું box (કુલ થેલીઓ & કુલ વજન નેટ) */
            <div
              onClick={() => setIsSheetOpen(true)}
              id="kanta-bags-weight-summary-box"
              className="w-full bg-emerald-50 hover:bg-emerald-100/70 border border-emerald-200 rounded-2xl p-3.5 sm:p-4 transition cursor-pointer shadow-2xs"
              title="વજન પત્રક જોવા અથવા સુધારવા માટે ટેપ કરો"
            >
              <div className="grid grid-cols-2 gap-2 text-center">
                <div>
                  <span className="text-xs sm:text-sm font-bold text-emerald-900 block">
                    કુલ થેલીઓ
                  </span>
                  <p className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5">
                    {totalBagsCount}{' '}
                    <span className="text-sm font-bold text-slate-700">થેલી</span>
                  </p>
                </div>
                <div>
                  <span className="text-xs sm:text-sm font-bold text-emerald-900 block">
                    કુલ વજન (નેટ)
                  </span>
                  <p className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5">
                    {netWeightKg}{' '}
                    <span className="text-sm font-bold text-slate-700">kg</span>
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Action Button: Save Weight */}
        <div className="pt-1">
          <button
            type="button"
            disabled={isSaving || totalBagsCount === 0}
            onClick={() => handleSaveWeighment('standard')}
            className="w-full py-3.5 px-4 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 disabled:opacity-50 text-white rounded-xl font-black text-base flex items-center justify-center gap-2 shadow-md transition cursor-pointer active:scale-98"
          >
            <Save className="w-5 h-5" />
            <span>
              {isSaving ? 'સેવ થાય છે...' : 'સેવ કરો'}
            </span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* DEDICATED FULL SCREEN WEIGHT SHEET PAGE (આખું પેજ) */}
      {/* ========================================================================= */}
      {isSheetOpen && (
        <div className="fixed inset-0 z-50 bg-slate-50 flex flex-col w-full h-full overflow-hidden overscroll-none">
          {/* Full Page Top Header */}
          <div className="bg-gradient-to-r from-teal-900 via-emerald-800 to-teal-900 text-white px-4 py-3 shrink-0 flex items-center justify-between shadow-xs safe-camera-top">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setIsSheetOpen(false)}
                className="p-1.5 hover:bg-white/10 rounded-lg text-white/80 hover:text-white transition cursor-pointer"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h3 className="font-black text-base leading-tight">
                  વજન
                </h3>
                <p className="text-[11px] text-emerald-100">
                  {customerName.trim() || 'સામાન્ય ગ્રાહક'} •{' '}
                  {isTwoItemsMode
                    ? `${selectedProduct.name} + ${selectedProduct2.name}`
                    : selectedProduct.name}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* વચે કોઈનું નવું બિલ બનાવવું હોય તો ફક્ત એક સિમ્બોલ (કોઈ લખાણ વગર) */}
              <button
                type="button"
                onClick={() => setShowQuickBillModal(true)}
                className="p-1.5 sm:p-2 bg-emerald-700/80 hover:bg-emerald-600 active:bg-emerald-800 rounded-full text-white transition cursor-pointer shadow-2xs active:scale-95 flex items-center justify-center border border-white/20"
                title="નવું બિલ બનાવો"
                aria-label="નવું બિલ બનાવો"
              >
                <FilePlus2 className="w-5 h-5 text-white" />
              </button>

              <button
                type="button"
                onClick={() => setIsSheetOpen(false)}
                className="p-1.5 bg-white/10 hover:bg-white/20 rounded-full text-white transition cursor-pointer"
                title="બંધ કરો"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Live Sticky Summary Bar: Bags, Total Weight in kg, Rate */}
          <div className="bg-emerald-50 border-b border-emerald-200 px-3 sm:px-4 py-1.5 shrink-0 flex items-center justify-between text-xs shadow-2xs gap-2">
            <div className="flex items-center gap-1 font-bold text-emerald-900">
              <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
              <span>થેલી:</span>
              <span className="text-sm font-black text-emerald-950 font-mono">
                {totalBagsCount}
              </span>
            </div>

            <div className="flex items-center gap-1 font-bold text-emerald-900">
              <span>વજન:</span>
              <span className="text-sm sm:text-base font-black text-emerald-950 font-mono">
                {grossWeightKg} kg
              </span>
            </div>

            {/* Editable Rate in Single-Item Mode */}
            {!isTwoItemsMode && (
              <div className="flex items-center">
                <div className="flex items-center bg-white border border-emerald-300 rounded px-1.5 py-0.5 shadow-2xs focus-within:ring-1 focus-within:ring-emerald-500">
                  <span className="text-xs font-bold text-emerald-700 mr-0.5">₹</span>
                  <input
                    type="search"
                    inputMode="decimal"
                    autoComplete="off"
                    name="single_item_rate"
                    id="single_item_rate"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-form-type="other"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-bwignore="true"
                    aria-autocomplete="none"
                    value={rate}
                    onChange={(e) => {
                      setRate(e.target.value);
                      saveKantaDraft({ rate: e.target.value });
                    }}
                    className="w-12 sm:w-14 text-center text-xs font-mono font-black text-emerald-950 bg-transparent focus:outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
                    placeholder="0"
                    title="ભાવ બદલો"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Main Weight Sheet Content: Fixed height layout to keep whole page fixed on screen */}
          {(() => {
            const item1ColCount = Math.ceil(item1Bags.length / 10);
            const item2ColCount = Math.ceil(item2Bags.length / 10);
            const totalColumns = isTwoItemsMode
              ? item1ColCount + item2ColCount
              : Math.ceil(totalSlots / 10);
            const isThreeOrMoreCols = totalColumns >= 3;

            return (
              <div
                ref={sheetScrollRef}
                className="flex-1 min-h-0 overflow-y-auto px-1.5 sm:px-3 pt-1 pb-1 flex flex-col"
              >
                {/* Sliding Columns Container: ONLY this row slides horizontally when there are 3+ boxes */}
                <div
                  ref={columnsContainerRef}
                  className="w-full flex-1 min-h-[460px] overflow-x-auto overflow-y-hidden no-scrollbar scroll-smooth touch-pan-x py-0.5 flex flex-col"
                >
                  {isTwoItemsMode ? (
                    /* 2-Items Mode: Columns for Item 1 and Item 2 with + button next to product name */
                    <div className={`flex flex-nowrap ${isThreeOrMoreCols ? 'gap-1.5' : 'gap-2'} items-stretch min-w-full w-max sm:w-full sm:justify-center flex-1 min-h-[460px] h-full`}>
                      {/* Item 1 Columns */}
                      {Array.from({ length: item1ColCount }).map((_, c1) => {
                        const isLastColOfItem1 = c1 === item1ColCount - 1;
                        const startIdx = c1 * 10;
                        return (
                          <div
                            key={`item1-col-${c1}`}
                            className={`${
                              isThreeOrMoreCols
                                ? 'w-[calc((100vw-28px)/2.5)] max-w-[160px] min-w-[130px] sm:w-48 p-1.5'
                                : 'w-[calc(50vw-12px)] max-w-[240px] min-w-[165px] sm:w-60 p-2'
                            } shrink-0 h-full min-h-[460px] flex flex-col justify-between bg-white border border-emerald-300 ring-1 ring-emerald-200/50 rounded-xl shadow-2xs snap-start`}
                          >
                            {/* Column Header: Product 1 Name & Rate Box & +/- on a single top line (no 'ભાવ' label) */}
                            <div className="pb-1 mb-1 border-b border-slate-100 flex items-center justify-between gap-1 w-full shrink-0 h-7">
                              {/* Left: Product Name */}
                              <div className="flex items-center gap-1 min-w-0 flex-1">
                                <span className={`${isThreeOrMoreCols ? 'text-[11px] px-1 py-0.5 max-w-[65px]' : 'text-xs px-1.5 py-0.5 max-w-[80px] sm:max-w-[105px]'} font-black text-emerald-950 bg-emerald-50 rounded border border-emerald-300 truncate`}>
                                  {selectedProduct.name}
                                </span>
                                {item1ColCount > 1 && (
                                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/70 px-1 py-0.5 rounded shrink-0">
                                    ({startIdx + 1}-{startIdx + 10})
                                  </span>
                                )}
                              </div>

                              {/* Right: Rate Box (Clean box with ₹ prefix, no 'ભાવ' label) & Action Buttons */}
                              <div className="flex items-center gap-1 shrink-0">
                                {c1 === 0 && (
                                  <div className="flex items-center bg-white border border-emerald-400 rounded px-1 py-0.5 shadow-2xs focus-within:ring-1 focus-within:ring-emerald-500">
                                    <span className="text-[11px] font-black text-emerald-700 mr-0.5">₹</span>
                                    <input
                                      type="search"
                                      inputMode="decimal"
                                      autoComplete="off"
                                      name="col1_item_rate"
                                      id="col1_item_rate"
                                      autoCorrect="off"
                                      autoCapitalize="off"
                                      spellCheck={false}
                                      data-form-type="other"
                                      data-lpignore="true"
                                      data-1p-ignore="true"
                                      data-bwignore="true"
                                      aria-autocomplete="none"
                                      value={rate}
                                      onChange={(e) => {
                                        setRate(e.target.value);
                                        saveKantaDraft({ rate: e.target.value });
                                      }}
                                      className={`${isThreeOrMoreCols ? 'w-8 text-[11px]' : 'w-10 sm:w-12 text-xs'} text-center font-mono font-black text-emerald-950 bg-transparent focus:outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden`}
                                      placeholder="0"
                                      title="ભાવ"
                                    />
                                  </div>
                                )}

                                {/* - Button to remove last 10 lines (only if length > 10) */}
                                {isLastColOfItem1 && item1Bags.length > 10 && (
                                  <button
                                    type="button"
                                    disabled={item1LastColHasWeight}
                                    onClick={handleRemove10LinesItem1}
                                    className={`w-5 h-5 rounded flex items-center justify-center transition shrink-0 ${
                                      item1LastColHasWeight
                                        ? 'bg-slate-100 text-slate-300 border border-slate-200 cursor-not-allowed opacity-50'
                                        : 'bg-rose-100 hover:bg-rose-200 active:scale-90 text-rose-900 border border-rose-300 cursor-pointer shadow-2xs'
                                    }`}
                                    title={
                                      item1LastColHasWeight
                                        ? 'વજન લખેલું હોવાથી કાઢી શકાશે નહીં'
                                        : 'છેલ્લી ૧૦ થેલી કાઢી નાખો (-)'
                                    }
                                    aria-label="૧૦ થેલી કાઢો"
                                  >
                                    <Minus className="w-3.5 h-3.5 stroke-[3]" />
                                  </button>
                                )}
                                {/* + Button to add 10 more lines */}
                                {isLastColOfItem1 && (
                                  <button
                                    type="button"
                                    onClick={handleAdd10LinesItem1}
                                    className="w-5 h-5 rounded bg-emerald-100 hover:bg-emerald-200 active:scale-90 text-emerald-900 border border-emerald-300 flex items-center justify-center transition cursor-pointer shrink-0 shadow-2xs"
                                    title="બીજી ૧૦ થેલી ઉમેરો (+)"
                                    aria-label="બીજી ૧૦ થેલી ઉમેરો"
                                  >
                                    <Plus className="w-3.5 h-3.5 stroke-[3]" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* 10 Bag Inputs: Numbered sequentially (1-10, 11-20, etc.) */}
                            <div className="flex-1 min-h-[340px] flex flex-col justify-between gap-1 py-0.5">
                              {Array.from({ length: 10 }).map((_, rIdx) => {
                                const idx = startIdx + rIdx;
                                const hasVal = Boolean(item1Bags[idx] && item1Bags[idx].trim() !== '');
                                const isAlerted = emptyAlertItem === 'item1' && emptyAlertIndex === idx;
                                const rowNum = idx + 1;
                                const isLocked = !hasVal && idx > firstEmptyItem1Idx;
                                const isEditing = Boolean(unlockedItem1Idx === idx);
                                const isCurrentActive =
                                  (activeCell?.item === 'item1' && activeCell?.idx === idx) ||
                                  (!activeCell && idx === firstEmptyItem1Idx);
                                const isCellReadOnly = isLocked || (hasVal && !isEditing);
                                  return (
                                    <div
                                      key={idx}
                                      onClick={() => handleCellClick('item1', idx, hasVal, isLocked)}
                                      onDoubleClick={() => {
                                        if (!isLocked) unlockCell('item1', idx);
                                      }}
                                      className={`w-full flex-1 min-h-[32px] max-h-[46px] ${
                                        isThreeOrMoreCols
                                          ? 'px-1 gap-0.5 rounded-md'
                                          : 'px-1.5 gap-1 rounded-lg'
                                      } flex items-center border transition relative ${
                                        isAlerted
                                          ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-400 shadow-xs animate-pulse'
                                          : isLocked
                                          ? 'bg-slate-50/70 border-slate-200/80 opacity-60 cursor-pointer'
                                          : isEditing
                                          ? 'bg-amber-50 border-amber-500 ring-2 ring-amber-400 shadow-xs'
                                          : isCurrentActive
                                          ? 'bg-white border-emerald-500 ring-2 ring-emerald-400/60 shadow-xs'
                                          : hasVal
                                          ? 'bg-emerald-50/40 border-emerald-300 shadow-2xs hover:border-emerald-400'
                                          : 'bg-white border-slate-200'
                                      }`}
                                    >
                                      <span className={`${isThreeOrMoreCols ? 'text-[10px] sm:text-xs w-3.5 sm:w-4' : 'text-xs w-5'} font-black text-slate-500 shrink-0 text-right`}>
                                        {rowNum})
                                      </span>
                                      <input
                                        ref={(el) => (item1InputRefs.current[idx] = el)}
                                        type="search"
                                        inputMode="decimal"
                                        enterKeyHint="next"
                                        autoComplete="off"
                                        name={`kanta_wt1_${idx}`}
                                        id={`kanta_wt1_${idx}`}
                                        autoCorrect="off"
                                        autoCapitalize="off"
                                        spellCheck={false}
                                        data-form-type="other"
                                        data-lpignore="true"
                                        data-1p-ignore="true"
                                        data-bwignore="true"
                                        aria-autocomplete="none"
                                        readOnly={isCellReadOnly}
                                        tabIndex={isCellReadOnly ? -1 : 0}
                                        value={item1Bags[idx] || ''}
                                        onChange={(e) => handleItem1BagChange(idx, e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            setUnlockedItem1Idx(null);
                                          }
                                          handleItem1KeyDown(idx, e);
                                        }}
                                        onClick={(e) => {
                                          if (hasVal && !isEditing) {
                                            e.stopPropagation();
                                            handleCellClick('item1', idx, hasVal, isLocked);
                                          }
                                        }}
                                        onDoubleClick={() => {
                                          if (!isLocked) unlockCell('item1', idx);
                                        }}

                                        onFocus={(e) => {
                                          if (isLocked) {
                                            handleLockedClick('item1', firstEmptyItem1Idx);
                                          } else {
                                            setActiveCell({ item: 'item1', idx });
                                          }
                                          if (!isLocked && (!hasVal || isEditing)) {
                                            const el = e.currentTarget;
                                            
                                            setTimeout(() => {
                                              try {
                                                
                                              } catch {}
                                            }, 30);
                                          } else {
                                            
                                          }
                                        }}
                                        title={
                                          isLocked
                                            ? 'ક્રમ અનુસાર આગળ વધો'
                                            : hasVal
                                            ? 'ડબલ ક્લિક કરીને વજન બદલો'
                                            : 'વજન લખો'
                                        }
                                        className={`w-full text-center font-mono font-black ${
                                          isThreeOrMoreCols ? 'text-xs sm:text-sm py-0' : 'text-sm sm:text-base py-0.5'
                                        } bg-transparent focus:outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden ${
                                          isCellReadOnly ? 'text-slate-700 pointer-events-none select-none cursor-pointer' : 'text-slate-900 cursor-text'
                                        }`}
                                      />
                                    </div>
                                  );
                              })}
                            </div>

                            {/* Subtotal directly below bag #10: Just 'ટોટલ:' */}
                            <div className={`pt-0.5 mt-0.5 border-t border-slate-200 flex items-center justify-between ${isThreeOrMoreCols ? 'px-1 py-0.5' : 'px-1.5 py-1'} bg-slate-100/90 rounded-md shrink-0`}>
                              <span className={`${isThreeOrMoreCols ? 'text-[10px]' : 'text-[11px]'} font-bold text-slate-700`}>
                                ટોટલ:
                              </span>
                              <span className={`font-mono font-black text-emerald-950 ${isThreeOrMoreCols ? 'text-[11px]' : 'text-xs'}`}>
                                {getItem1ColTotal(c1)} kg
                              </span>
                            </div>
                          </div>
                        );
                      })}

                      {/* Item 2 Columns */}
                      {Array.from({ length: item2ColCount }).map((_, c2) => {
                        const isLastColOfItem2 = c2 === item2ColCount - 1;
                        const startIdx = c2 * 10;
                        return (
                          <div
                            key={`item2-col-${c2}`}
                            className={`${
                              isThreeOrMoreCols
                                ? 'w-[calc((100vw-28px)/2.5)] max-w-[160px] min-w-[130px] sm:w-48 p-1.5'
                                : 'w-[calc(50vw-12px)] max-w-[240px] min-w-[165px] sm:w-60 p-2'
                            } shrink-0 h-full min-h-[460px] flex flex-col justify-between bg-white border border-amber-300 ring-1 ring-amber-200/50 rounded-xl shadow-2xs snap-start`}
                          >
                            {/* Column Header: Product 2 Name & Rate Box & +/- on a single top line (no 'ભાવ' label) */}
                            <div className="pb-1 mb-1 border-b border-slate-100 flex items-center justify-between gap-1 w-full shrink-0 h-7">
                              {/* Left: Product 2 Name/Dropdown */}
                              <div className="flex items-center gap-1 min-w-0 flex-1">
                                <button
                                  type="button"
                                  onClick={() => setProductPickerTarget('item2')}
                                  className={`flex items-center gap-1 font-black text-amber-950 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 active:scale-95 ${
                                    isThreeOrMoreCols ? 'text-[11px] px-1 py-0.5 max-w-[65px]' : 'text-xs px-1.5 py-0.5 max-w-[80px] sm:max-w-[105px]'
                                  } rounded border border-amber-300 transition cursor-pointer`}
                                  title="આઇટમ ૨ બદલો"
                                >
                                  <span className="truncate">{selectedProduct2.name}</span>
                                  <ChevronDown className="w-3 h-3 text-amber-700 shrink-0" />
                                </button>
                                {item2ColCount > 1 && (
                                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100/70 px-1 py-0.5 rounded shrink-0">
                                    ({startIdx + 1}-{startIdx + 10})
                                  </span>
                                )}
                              </div>

                              {/* Right: Rate Box (Clean box with ₹ prefix, no 'ભાવ' label) & Action Buttons */}
                              <div className="flex items-center gap-1 shrink-0">
                                {c2 === 0 && (
                                  <div className="flex items-center bg-white border border-amber-400 rounded px-1 py-0.5 shadow-2xs focus-within:ring-1 focus-within:ring-amber-500">
                                    <span className="text-[11px] font-black text-amber-700 mr-0.5">₹</span>
                                    <input
                                      type="search"
                                      inputMode="decimal"
                                      autoComplete="off"
                                      name="col2_item_rate"
                                      id="col2_item_rate"
                                      autoCorrect="off"
                                      autoCapitalize="off"
                                      spellCheck={false}
                                      data-form-type="other"
                                      data-lpignore="true"
                                      data-1p-ignore="true"
                                      data-bwignore="true"
                                      aria-autocomplete="none"
                                      value={rate2}
                                      onChange={(e) => {
                                        setRate2(e.target.value);
                                        saveKantaDraft({ rate2: e.target.value });
                                      }}
                                      className={`${isThreeOrMoreCols ? 'w-8 text-[11px]' : 'w-10 sm:w-12 text-xs'} text-center font-mono font-black text-amber-950 bg-transparent focus:outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden`}
                                      placeholder="0"
                                      title="ભાવ"
                                    />
                                  </div>
                                )}

                                {/* - Button to remove last 10 lines / item 2 (STRICT CONDITION: never if weight entered) */}
                                {isLastColOfItem2 && (
                                  <button
                                    type="button"
                                    disabled={item2Bags.length > 10 ? item2LastColHasWeight : item2HasAnyWeight}
                                    onClick={handleRemove10LinesItem2}
                                    className={`w-5 h-5 rounded flex items-center justify-center transition shrink-0 ${
                                      (item2Bags.length > 10 ? item2LastColHasWeight : item2HasAnyWeight)
                                        ? 'bg-slate-100 text-slate-300 border border-slate-200 cursor-not-allowed opacity-50'
                                        : 'bg-rose-100 hover:bg-rose-200 active:scale-90 text-rose-900 border border-rose-300 cursor-pointer shadow-2xs'
                                    }`}
                                    title={
                                      (item2Bags.length > 10 ? item2LastColHasWeight : item2HasAnyWeight)
                                        ? 'વજન લખેલું હોવાથી કાઢી શકાશે નહીં'
                                        : item2Bags.length > 10
                                        ? 'છેલ્લી ૧૦ થેલી કાઢી નાખો (-)'
                                        : 'બીજો માલ કાઢી નાખો (-)'
                                    }
                                    aria-label="આઇટમ અથવા ૧૦ થેલી કાઢો"
                                  >
                                    <Minus className="w-3.5 h-3.5 stroke-[3]" />
                                  </button>
                                )}
                                {/* + Button to add 10 more lines */}
                                {isLastColOfItem2 && (
                                  <button
                                    type="button"
                                    onClick={handleAdd10LinesItem2}
                                    className="w-5 h-5 rounded bg-amber-100 hover:bg-amber-200 active:scale-90 text-amber-900 border border-amber-300 flex items-center justify-center transition cursor-pointer shrink-0 shadow-2xs"
                                    title="બીજી ૧૦ થેલી ઉમેરો (+)"
                                    aria-label="બીજી ૧૦ થેલી ઉમેરો"
                                  >
                                    <Plus className="w-3.5 h-3.5 stroke-[3]" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* 10 Bag Inputs: Numbered sequentially (1-10, 11-20, etc.) */}
                            <div className="flex-1 min-h-[340px] flex flex-col justify-between gap-1 py-0.5">
                              {Array.from({ length: 10 }).map((_, rIdx) => {
                                const idx = startIdx + rIdx;
                                const hasVal = Boolean(item2Bags[idx] && item2Bags[idx].trim() !== '');
                                const isAlerted = emptyAlertItem === 'item2' && emptyAlertIndex === idx;
                                const rowNum = idx + 1;
                                const isLocked = !hasVal && idx > firstEmptyItem2Idx;
                                const isEditing = Boolean(unlockedItem2Idx === idx);
                                const isCurrentActive =
                                  (activeCell?.item === 'item2' && activeCell?.idx === idx) ||
                                  (!activeCell && idx === firstEmptyItem2Idx);
                                const isCellReadOnly = isLocked || (hasVal && !isEditing);
                                  return (
                                    <div
                                      key={idx}
                                      onClick={() => handleCellClick('item2', idx, hasVal, isLocked)}
                                      onDoubleClick={() => {
                                        if (!isLocked) unlockCell('item2', idx);
                                      }}
                                      className={`w-full flex-1 min-h-[32px] max-h-[46px] ${
                                        isThreeOrMoreCols
                                          ? 'px-1 gap-0.5 rounded-md'
                                          : 'px-1.5 gap-1 rounded-lg'
                                      } flex items-center border transition relative ${
                                        isAlerted
                                          ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-400 shadow-xs animate-pulse'
                                          : isLocked
                                          ? 'bg-slate-50/70 border-slate-200/80 opacity-60 cursor-pointer'
                                          : isEditing
                                          ? 'bg-amber-50 border-amber-500 ring-2 ring-amber-400 shadow-xs'
                                          : isCurrentActive
                                          ? 'bg-white border-amber-500 ring-2 ring-amber-400/60 shadow-xs'
                                          : hasVal
                                          ? 'bg-amber-50/50 border-amber-300 shadow-2xs hover:border-amber-400 focus-within:border-amber-600 focus-within:ring-1 focus-within:ring-amber-400'
                                          : 'bg-white border-slate-200 '
                                      }`}
                                    >
                                      <span className={`${isThreeOrMoreCols ? 'text-[10px] sm:text-xs w-3.5 sm:w-4' : 'text-xs w-5'} font-black text-slate-500 shrink-0 text-right`}>
                                        {rowNum})
                                      </span>
                                      <input
                                        ref={(el) => (item2InputRefs.current[idx] = el)}
                                        type="search"
                                        inputMode="decimal"
                                        enterKeyHint="next"
                                        autoComplete="off"
                                        name={`kanta_wt2_${idx}`}
                                        id={`kanta_wt2_${idx}`}
                                        autoCorrect="off"
                                        autoCapitalize="off"
                                        spellCheck={false}
                                        data-form-type="other"
                                        data-lpignore="true"
                                        data-1p-ignore="true"
                                        data-bwignore="true"
                                        aria-autocomplete="none"
                                        readOnly={isCellReadOnly}
                                        tabIndex={isCellReadOnly ? -1 : 0}
                                        value={item2Bags[idx] || ''}
                                        onChange={(e) => handleItem2BagChange(idx, e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            setUnlockedItem2Idx(null);
                                          }
                                          handleItem2KeyDown(idx, e);
                                        }}
                                        onClick={(e) => {
                                          if (hasVal && !isEditing) {
                                            e.stopPropagation();
                                            handleCellClick('item2', idx, hasVal, isLocked);
                                          }
                                        }}
                                        onDoubleClick={() => {
                                          if (!isLocked) unlockCell('item2', idx);
                                        }}

                                        onFocus={(e) => {
                                          if (isLocked) {
                                            handleLockedClick('item2', firstEmptyItem2Idx);
                                          } else {
                                            setActiveCell({ item: 'item2', idx });
                                          }
                                          if (!isLocked && (!hasVal || isEditing)) {
                                            const el = e.currentTarget;
                                            
                                            setTimeout(() => {
                                              try {
                                                
                                              } catch {}
                                            }, 30);
                                          } else {
                                            
                                          }
                                        }}
                                        title={
                                          isLocked
                                            ? 'ક્રમ અનુસાર આગળ વધો'
                                            : hasVal
                                            ? 'ડબલ ક્લિક કરીને વજન બદલો'
                                            : 'વજન લખો'
                                        }
                                        className={`w-full text-center font-mono font-black ${
                                          isThreeOrMoreCols ? 'text-xs sm:text-sm py-0' : 'text-sm sm:text-base py-0.5'
                                        } bg-transparent focus:outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden ${
                                          isLocked ? 'text-slate-400 cursor-pointer' : 'text-slate-900'
                                        }`}
                                      />
                                    </div>
                                  );
                              })}
                            </div>

                            {/* Subtotal directly below bag #10: Just 'ટોટલ:' */}
                            <div className={`pt-0.5 mt-0.5 border-t border-slate-200 flex items-center justify-between ${isThreeOrMoreCols ? 'px-1 py-0.5' : 'px-1.5 py-1'} bg-slate-100/90 rounded-md shrink-0`}>
                              <span className={`${isThreeOrMoreCols ? 'text-[10px]' : 'text-[11px]'} font-bold text-slate-700`}>
                                ટોટલ:
                              </span>
                              <span className={`font-mono font-black text-amber-950 ${isThreeOrMoreCols ? 'text-[11px]' : 'text-xs'}`}>
                                {getItem2ColTotal(c2)} kg
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* 1-Item Mode: Standard 20, 40, etc. columns */
                    <div className={`flex flex-nowrap ${isThreeOrMoreCols ? 'gap-1.5' : 'gap-2'} items-stretch min-w-full w-max sm:w-full sm:justify-center flex-1 min-h-[460px] h-full`}>
                      {Array.from({ length: Math.ceil(totalSlots / 10) }).map(
                        (_, colIdx) => {
                          const start = colIdx * 10;
                          const isSecondCol = colIdx === 1;

                          return (
                            <div
                              key={colIdx}
                              className={`${
                                isThreeOrMoreCols
                                  ? 'w-[calc((100vw-28px)/2.5)] max-w-[155px] min-w-[124px] sm:w-44 p-1'
                                  : 'w-[calc(50vw-14px)] max-w-[220px] min-w-[155px] sm:w-56 p-1.5'
                              } shrink-0 h-full min-h-[460px] flex flex-col justify-between bg-white border border-slate-200 rounded-xl shadow-2xs snap-start`}
                            >
                              {/* Column Header */}
                              <div className="pb-1 mb-1 border-b border-slate-100 flex items-center justify-between px-1 shrink-0">
                                <div className="flex items-center justify-between w-full">
                                  <span className={`${isThreeOrMoreCols ? 'text-[11px]' : 'text-xs'} font-black text-slate-700`}>
                                    {start + 1} થી {start + 10}
                                  </span>
                                  {isSecondCol && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setProductPickerTarget('item2');
                                      }}
                                      className="w-5 h-5 rounded bg-teal-50 hover:bg-teal-100 active:scale-95 text-teal-800 border border-teal-300 flex items-center justify-center transition cursor-pointer shadow-2xs"
                                      title="બીજી આઇટમ પસંદ કરો (+)"
                                      aria-label="બીજી આઇટમ પસંદ કરો"
                                    >
                                      <Plus className="w-3 h-3 stroke-[3]" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* 10 Bag Inputs */}
                              <div className="flex-1 min-h-[340px] flex flex-col justify-between gap-1 py-0.5">
                                {Array.from({ length: 10 }).map((_, rIdx) => {
                                  const bagIdx = start + rIdx;
                                  if (bagIdx >= totalSlots) return null;
                                  const hasVal = Boolean(bagList[bagIdx] && bagList[bagIdx].trim() !== '');
                                  const isAlerted = emptyAlertItem === 'single' && emptyAlertIndex === bagIdx;
                                  const rowLabel = bagIdx + 1;
                                  const isLocked = !hasVal && bagIdx > firstEmptyBagIdx;
                                  const isEditing = Boolean(unlockedSingleIdx === bagIdx);
                                  const isCurrentActive =
                                    (activeCell?.item === 'single' && activeCell?.idx === bagIdx) ||
                                    (!activeCell && bagIdx === firstEmptyBagIdx);
                                  const isCellReadOnly = isLocked || (hasVal && !isEditing);
                                  return (
                                    <div
                                      key={bagIdx}
                                      onClick={() => handleCellClick('single', bagIdx, hasVal, isLocked)}
                                      onDoubleClick={() => {
                                        if (!isLocked) unlockCell('single', bagIdx);
                                      }}
                                      className={`w-full flex-1 min-h-[32px] max-h-[46px] ${
                                        isThreeOrMoreCols
                                          ? 'px-1 gap-0.5 rounded-md'
                                          : 'px-1.5 gap-1 rounded-lg'
                                      } flex items-center border transition relative ${
                                        isAlerted
                                          ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-400 shadow-xs animate-pulse'
                                          : isLocked
                                          ? 'bg-slate-50/70 border-slate-200/80 opacity-60 cursor-pointer'
                                          : isEditing
                                          ? 'bg-amber-50 border-amber-500 ring-2 ring-amber-400 shadow-xs'
                                          : isCurrentActive
                                          ? 'bg-white border-emerald-500 ring-2 ring-emerald-400/60 shadow-xs'
                                          : hasVal
                                          ? 'bg-emerald-50/40 border-emerald-300 shadow-2xs hover:border-emerald-400'
                                          : 'bg-white border-slate-200'
                                      }`}
                                    >
                                      <span className={`${isThreeOrMoreCols ? 'text-[10px] sm:text-xs w-3.5 sm:w-4' : 'text-xs w-5'} font-black text-slate-500 shrink-0 text-right`}>
                                        {rowLabel})
                                      </span>
                                      <input
                                        ref={(el) => (inputRefs.current[bagIdx] = el)}
                                        type="search"
                                        inputMode="decimal"
                                        enterKeyHint="next"
                                        autoComplete="off"
                                        name={`kanta_wt_single_${bagIdx}`}
                                        id={`kanta_wt_single_${bagIdx}`}
                                        autoCorrect="off"
                                        autoCapitalize="off"
                                        spellCheck={false}
                                        data-form-type="other"
                                        data-lpignore="true"
                                        data-1p-ignore="true"
                                        data-bwignore="true"
                                        aria-autocomplete="none"
                                        readOnly={isCellReadOnly}
                                        tabIndex={isCellReadOnly ? -1 : 0}
                                        value={bagList[bagIdx] || ''}
                                        onChange={(e) =>
                                          handleBagChange(bagIdx, e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            setUnlockedSingleIdx(null);
                                          }
                                          handleKeyDown(bagIdx, e);
                                        }}
                                        onClick={(e) => {
                                          if (hasVal && !isEditing) {
                                            e.stopPropagation();
                                            handleCellClick('single', bagIdx, hasVal, isLocked);
                                          }
                                        }}
                                        onDoubleClick={() => {
                                          if (!isLocked) unlockCell('single', bagIdx);
                                        }}
                                        onBlur={() => {
                                          if (unlockedSingleIdx === bagIdx) {
                                            setUnlockedSingleIdx(null);
                                          }
                                          if (activeTypingSlot === bagIdx) {
                                            setActiveTypingSlot(null);
                                          }
                                          if (fillingBagIdx === bagIdx) {
                                            setFillingBagIdx(null);
                                          }
                                        }}
                                        onFocus={(e) => {
                                          if (isLocked) {
                                            handleLockedClick('single', firstEmptyBagIdx);
                                            return;
                                          }
                                          setActiveCell({ item: 'single', idx: bagIdx });
                                        }}
                                        title={
                                          isLocked
                                            ? 'ક્રમ અનુસાર આગળ વધો'
                                            : hasVal
                                            ? 'ડબલ ક્લિક કરીને વજન બદલો'
                                            : 'વજન લખો'
                                        }
                                        className={`w-full text-center font-mono font-black ${
                                          isThreeOrMoreCols ? 'text-xs sm:text-sm py-0' : 'text-sm sm:text-base py-0.5'
                                        } bg-transparent focus:outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden ${
                                          isCellReadOnly ? 'text-slate-700 pointer-events-none select-none cursor-pointer' : 'text-slate-900 cursor-text'
                                        }`}
                                      />
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Subtotal directly below bag #10 */}
                              <div className={`pt-0.5 mt-0.5 border-t border-slate-200 flex items-center justify-between ${isThreeOrMoreCols ? 'px-1 py-0.5' : 'px-1.5 py-1'} bg-slate-100/90 rounded-md shrink-0`}>
                                <span className={`${isThreeOrMoreCols ? 'text-[10px]' : 'text-[11px]'} font-bold text-slate-700 truncate max-w-[90px]`}>
                                  ટોટલ:
                                </span>
                                <span className={`font-mono font-black text-emerald-950 ${isThreeOrMoreCols ? 'text-[11px]' : 'text-xs'}`}>
                                  {getBlockTotal(start)} kg
                                </span>
                              </div>
                            </div>
                          );
                        }
                      )}
                    </div>
                  )}
                </div>

                {/* Bottom Actions: Kapat (Tare Deduction) Box & Save Weight Button */}
                <div className="mt-auto pt-1 max-w-md mx-auto w-full space-y-1.5 pb-2 shrink-0">
                  {/* Tare Deduction: Item 1 & Item 2 cards sleek & compact */}
                  {isTwoItemsMode ? (
                    <div className="space-y-1">
                      {/* Item 1: Name + Weight with red deduction box */}
                      <div className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1 shadow-2xs">
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-black text-slate-900 text-xs sm:text-sm truncate">
                              ૧. {selectedProduct.name}
                            </span>
                            {deductionNum1 > 0 && gross1 > 0 ? (
                              <div className="flex items-center gap-1 font-mono font-bold text-xs whitespace-nowrap">
                                <span className="text-slate-600">{gross1}</span>
                                <span className="text-rose-600">-{tareDeduction || deductionNum1}</span>
                                <span className="text-slate-400">=</span>
                                <span className="text-emerald-800 font-black">{net1} kg</span>
                              </div>
                            ) : (
                              <span className="font-mono font-black text-emerald-900 text-xs sm:text-sm whitespace-nowrap">
                                {gross1 > 0 ? `${gross1} kg` : '0 kg'}
                              </span>
                            )}
                          </div>
                          <div className="shrink-0">
                            <input
                              ref={tareInputRef}
                              type="search"
                              inputMode="decimal"
                              enterKeyHint="next"
                              autoComplete="off"
                              name="tare_deduction_1"
                              id="tare_deduction_1"
                              placeholder="0"
                              title="કપાત"
                              value={tareDeduction}
                              onChange={(e) => {
                                setTareDeduction(e.target.value);
                                saveKantaDraft({ tareDeduction: e.target.value });
                              }}
                              onFocus={(e) => e.currentTarget.select()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  tareInputRef2.current?.focus();
                                  tareInputRef2.current?.select();
                                }
                              }}
                              className="w-16 sm:w-20 h-7 text-center font-mono font-black text-sm text-rose-800 bg-rose-50 border-2 border-rose-300 focus:border-rose-600 focus:bg-white focus:ring-1 focus:ring-rose-500 focus:outline-none rounded-lg py-0.5 px-1 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Item 2: Name + Weight with red deduction box */}
                      <div className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1 shadow-2xs">
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-black text-slate-900 text-xs sm:text-sm truncate">
                              ૨. {selectedProduct2.name}
                            </span>
                            {deductionNum2 > 0 && gross2 > 0 ? (
                              <div className="flex items-center gap-1 font-mono font-bold text-xs whitespace-nowrap">
                                <span className="text-slate-600">{gross2}</span>
                                <span className="text-rose-600">-{tareDeduction2 || deductionNum2}</span>
                                <span className="text-slate-400">=</span>
                                <span className="text-emerald-800 font-black">{net2} kg</span>
                              </div>
                            ) : (
                              <span className="font-mono font-black text-emerald-900 text-xs sm:text-sm whitespace-nowrap">
                                {gross2 > 0 ? `${gross2} kg` : '0 kg'}
                              </span>
                            )}
                          </div>
                          <div className="shrink-0">
                            <input
                              ref={tareInputRef2}
                              type="search"
                              inputMode="decimal"
                              enterKeyHint="done"
                              autoComplete="off"
                              name="tare_deduction_2"
                              id="tare_deduction_2"
                              placeholder="0"
                              title="કપાત"
                              value={tareDeduction2}
                              onChange={(e) => {
                                setTareDeduction2(e.target.value);
                                saveKantaDraft({ tareDeduction2: e.target.value });
                              }}
                              onFocus={(e) => e.currentTarget.select()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  tareInputRef2.current?.blur();
                                }
                              }}
                              className="w-16 sm:w-20 h-7 text-center font-mono font-black text-sm text-rose-800 bg-rose-50 border-2 border-rose-300 focus:border-rose-600 focus:bg-white focus:ring-1 focus:ring-rose-500 focus:outline-none rounded-lg py-0.5 px-1 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Single Item: Name + Weight with red deduction box */
                    <div className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1 shadow-2xs">
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-black text-slate-900 text-xs sm:text-sm truncate">
                            {selectedProduct.name}
                          </span>
                          {deductionNum1 > 0 && grossWeightKg > 0 ? (
                            <div className="flex items-center gap-1 font-mono font-bold text-xs whitespace-nowrap">
                              <span className="text-slate-600">{grossWeightKg}</span>
                              <span className="text-rose-600">-{tareDeduction || deductionNum1}</span>
                              <span className="text-slate-400">=</span>
                              <span className="text-emerald-800 font-black">{netWeightKg} kg</span>
                            </div>
                          ) : (
                            <span className="font-mono font-black text-emerald-900 text-xs sm:text-sm whitespace-nowrap">
                              {grossWeightKg > 0 ? `${grossWeightKg} kg` : '0 kg'}
                            </span>
                          )}
                        </div>
                        <div className="shrink-0">
                          <input
                            ref={tareInputRef}
                            type="search"
                            inputMode="decimal"
                            enterKeyHint="done"
                            autoComplete="off"
                            name="tare_deduction_single"
                            id="tare_deduction_single"
                            placeholder="0"
                            title="કપાત"
                            value={tareDeduction}
                            onChange={(e) => {
                              setTareDeduction(e.target.value);
                              saveKantaDraft({ tareDeduction: e.target.value });
                            }}
                            onFocus={(e) => e.currentTarget.select()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                tareInputRef.current?.blur();
                              }
                            }}
                            className="w-16 sm:w-20 h-7 text-center font-mono font-black text-sm text-rose-800 bg-rose-50 border-2 border-rose-300 focus:border-rose-600 focus:bg-white focus:ring-1 focus:ring-rose-500 focus:outline-none rounded-lg py-0.5 px-1 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Save Weight Button */}
                  <button
                    type="button"
                    disabled={isSaving || totalBagsCount === 0}
                    onClick={() => handleSaveWeighment('standard')}
                    className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 disabled:opacity-50 text-white rounded-xl font-black text-sm flex items-center justify-center gap-2 shadow-md transition cursor-pointer active:scale-98"
                  >
                    <Save className="w-5 h-5" />
                    <span>{isSaving ? 'સેવ થાય છે...' : 'વજન સેવ કરો'}</span>
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ========================================================================= */}
      {/* PRODUCT SELECTION MODAL (આઇટમ પસંદગી પોપઅપ) */}
      {/* ========================================================================= */}
      {productPickerTarget && (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-[280px] rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[75vh] overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header: Clean & Compact, No 11-20 text */}
            <div className="px-3.5 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
              <h3 className="text-sm font-black text-slate-900">
                આઇટમ પસંદ કરો
              </h3>
              <button
                type="button"
                onClick={() => setProductPickerTarget(null)}
                className="p-1 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition cursor-pointer"
                title="બંધ કરો"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Products List (Single Vertical Column, Compact, Fits Name Size) */}
            <div className="p-2 overflow-y-auto max-h-[58vh] flex flex-col gap-1">
              {products.map((prod) => {
                const isCurrentItem1 = prod.id === selectedProductId;
                const isCurrentItem2 = isTwoItemsMode && prod.id === selectedProductId2;
                const isSelected =
                  productPickerTarget === 'item2' ? isCurrentItem2 : isCurrentItem1;

                return (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() => {
                      if (productPickerTarget === 'item2') {
                        handleProduct2Select(prod);
                        // Clean item 1: Only keep 10-bag columns that actually have weights written in them (minimum 10 bags)
                        const sourceBags = item1Bags.some((b) => parseFloat(b) > 0) ? item1Bags : bagList;
                        let filledCols = 1;
                        for (let c = 0; c < Math.ceil(sourceBags.length / 10); c++) {
                          const colBags = sourceBags.slice(c * 10, (c + 1) * 10);
                          if (colBags.some((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0)) {
                            filledCols = Math.max(filledCols, c + 1);
                          }
                        }
                        const cleanItem1 = [
                          ...sourceBags.slice(0, filledCols * 10),
                          ...Array(Math.max(0, filledCols * 10 - sourceBags.slice(0, filledCols * 10).length)).fill(''),
                        ];
                        setItem1Bags(cleanItem1);

                        // Clean item 2: Only keep 10-bag columns that actually have weights written in them (minimum 10 bags)
                        let filledCols2 = 1;
                        for (let c = 0; c < Math.ceil(item2Bags.length / 10); c++) {
                          const colBags = item2Bags.slice(c * 10, (c + 1) * 10);
                          if (colBags.some((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0)) {
                            filledCols2 = Math.max(filledCols2, c + 1);
                          }
                        }
                        const cleanItem2 = [
                          ...item2Bags.slice(0, filledCols2 * 10),
                          ...Array(Math.max(0, filledCols2 * 10 - item2Bags.slice(0, filledCols2 * 10).length)).fill(''),
                        ];
                        setItem2Bags(cleanItem2);

                        setIsTwoItemsMode(true);
                        saveKantaDraft({
                          isTwoItemsMode: true,
                          selectedProductId2: prod.id,
                          rate2: prod.lastRatePer20Kg.toString(),
                          item1Bags: cleanItem1,
                          item2Bags: cleanItem2,
                        });
                        setProductPickerTarget(null);
                        setTimeout(() => {
                          item2InputRefs.current[0]?.focus();
                        }, 120);
                      } else {
                        handleProductSelect(prod);
                        setProductPickerTarget(null);
                        setTimeout(() => {
                          if (isTwoItemsMode) {
                            item1InputRefs.current[0]?.focus();
                          } else {
                            inputRefs.current[0]?.focus();
                          }
                        }, 120);
                      }
                    }}
                    className={`w-full py-1.5 px-3 rounded-lg text-left transition cursor-pointer flex items-center justify-between border active:scale-[0.98] ${
                      isSelected
                        ? 'bg-emerald-50 border-emerald-500 font-black text-emerald-950 shadow-2xs'
                        : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-800'
                    }`}
                  >
                    <span className="text-sm font-bold truncate">
                      {prod.name}
                    </span>
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[3] shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div className="p-2 border-t border-slate-100 bg-slate-50 shrink-0 text-center">
              <button
                type="button"
                onClick={() => setProductPickerTarget(null)}
                className="w-full py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-lg transition cursor-pointer"
              >
                રદ કરો
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QUICK NEW BILL MODAL (વચે કોઈનું નવું બિલ બનાવવું હોય તો) */}
      {showQuickBillModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowQuickBillModal(false);
          }}
          className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-xs flex flex-col items-center justify-center p-2 sm:p-4 overflow-hidden"
        >
          <div className="bg-white w-full max-w-xl h-[calc(100dvh-16px)] sm:h-auto sm:max-h-[92vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
            <TodayBillView
              businessDate={businessDate || getTodayISODate()}
              currentSession={currentSession || getCurrentSession()}
              products={products}
              settings={settings || getStoredFirmSettings()}
              bills={bills || getStoredBills()}
              onSaveBill={(bill, updatedProducts) => {
                if (onSaveBill) {
                  onSaveBill(bill, updatedProducts);
                } else {
                  const nextBills = [bill, ...(bills || getStoredBills())];
                  saveStoredBills(nextBills);
                  syncBillToCloud(bill);
                  saveStoredProducts(updatedProducts);
                }
              }}
              onSaveProducts={onSaveProducts}
              onOpenReceipt={onOpenReceipt || ((b) => {})}
              onClose={() => setShowQuickBillModal(false)}
              onAfterBillSavedOrPrinted={() => {
                // સેવ એન્ડ પ્રિન્ટ થાય કે સેવ થાય એટલે તરત પાછા કાંટા વજન વાળી જગ્યા પર આવી જવું
                setShowQuickBillModal(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
