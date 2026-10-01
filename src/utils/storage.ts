import { BillItem, DailyReportSummary, FirmSettings, Product, SessionSummary, SessionType, VoucherBill } from '../types';

export const DEFAULT_PRODUCTS: Product[] = [
  { id: 'p_bajri', name: 'બાજરી', shortcut: 'b', lastRatePer20Kg: 440 },
  { id: 'p_ghau', name: 'ઘઉં', shortcut: 'g', lastRatePer20Kg: 480 },
  { id: 'p_juni_bajri', name: 'જૂની બાજરી', shortcut: 'j', lastRatePer20Kg: 400 },
  { id: 'p_raydo', name: 'રાયડો', shortcut: 'r', lastRatePer20Kg: 1000 },
  { id: 'p_diveli', name: 'દિવેલી', shortcut: 'd', lastRatePer20Kg: 1350 },
  { id: 'p_rajgaro', name: 'રાજગરો', shortcut: 'z', lastRatePer20Kg: 1200 },
];

export const DEFAULT_FIRM_SETTINGS: FirmSettings = {
  firmName: 'શ્રી કલેશ્વરી કૃપા ટ્રેડીંગ કું.',
  phone: '9427077011, 9313172801',
  address: 'હરસિદ્ધિ માતાના મંદિર પાસે',
  addressLine2: 'મુ. વાસણા, પો. મહિસા, તા. મહુધા, જી. ખેડા',
  gstNo: '24ADDPP1757F1ZP',
  licenseNo: '01/1998 Dt.25-08-1998',
  tagline: 'અનાજ, કઠોળ, તેલીબીયા તથા કેટલફીડના વહેપારી',
  footerNote: 'આભાર, ફરી પધારશો!',
  paperWidth: '58mm',
  autoPrintOnSave: true,
  printMethod: 'bluetooth',
  pairedPrinterName: 'PSF588',
  keepBluetoothConnected: true,
  autoDisconnectBluetooth: false,
  autoDisconnectDelayMs: 150,
  autoDisconnectDelaySeconds: 2,
  isAutoPrintStation: false,
  cloudRemotePrintEnabled: true,
  playChimeOnAutoPrint: true,
  keepScreenAwakeInStation: true,
  paperFeedLines: 1,
};

const BILLS_KEY = 'kharid_voucher_bills_v1';
const PRODUCTS_KEY = 'kharid_voucher_products_v1';
const SETTINGS_KEY = 'kharid_voucher_settings_v1';

/**
 * Normal calendar business date (auto advances at 12:00 midnight)
 */
export function getActiveBusinessDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const getTodayISODate = getActiveBusinessDate;

/**
 * Formats ISO date (YYYY-MM-DD) to Day, Gujarati Month, and Year (First Date, then Month, then Year)
 * Example: "2026-09-12" => "12 સપ્ટેમ્બર 2026"
 */
export function formatDateDayMonthYear(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    const year = parts[0];
    const monthIndex = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const gujaratiMonths = [
      'જાન્યુઆરી',
      'ફેબ્રુઆરી',
      'માર્ચ',
      'એપ્રિલ',
      'મે',
      'જૂન',
      'જુલાઈ',
      'ઓગસ્ટ',
      'સપ્ટેમ્બર',
      'ઓક્ટોબર',
      'નવેમ્બર',
      'ડિસેમ્બર',
    ];
    const monthName = gujaratiMonths[monthIndex] || parts[1];
    return `${day} ${monthName} ${year}`;
  }
  return isoDate;
}

/**
 * Formats ISO date (YYYY-MM-DD) to DD-MM (First Date, then Month, omitting Year)
 * Example: "2026-09-12" => "12-09"
 */
export function formatDateDDMM(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}`;
  }
  return isoDate;
}

/**
 * Formats ISO date (YYYY-MM-DD) to DD/MM/YY (e.g. "2026-09-23" => "23/09/26")
 */
export function formatDateDDMMYY(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    const yy = parts[0].slice(-2);
    return `${parts[2]}/${parts[1]}/${yy}`;
  }
  return isoDate;
}

/**
 * Formats ISO date (YYYY-MM-DD) to DD-MM-YYYY (First Date, then Month, then Year)
 * Example: "2026-09-12" => "12-09-2026"
 */
export function formatDateDDMMYYYY(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return isoDate;
}

/**
 * Formats time string to simple 12-hour format without AM/PM (e.g. "10:42 AM" => "10.42", "03:25 PM" => "3.25", "15:25" => "3.25")
 */
export function formatTimeSimple(timeStr?: string): string {
  if (!timeStr) return '';
  const clean = timeStr.trim();
  const match = clean.match(/^(\d{1,2})[:.](\d{1,2})(?:\s*([AaPp][Mm]))?/);
  if (!match) return clean.replace(/[AaPp][Mm]/gi, '').trim();

  let hours = parseInt(match[1], 10);
  const minutes = match[2].padStart(2, '0');
  const ampm = match[3]?.toUpperCase();

  if (ampm === 'PM' && hours < 12) {
    // e.g. 03:25 PM => 3
  } else if (ampm === 'AM' && hours === 12) {
    hours = 12;
  } else if (!ampm && hours > 12) {
    hours = hours - 12;
  } else if (!ampm && hours === 0) {
    hours = 12;
  }

  return `${hours}.${minutes}`;
}

/**
 * Backward-compatible helper: returns "Day Month Year" in Gujarati (e.g. "12 સપ્ટેમ્બર 2026")
 */
export function formatDayMonthOnly(isoDate: string): string {
  return formatDateDayMonthYear(isoDate);
}

/**
 * Session Logic:
 * 12:00 (midnight 00:00) to 1:30 PM (13:30) => 'M' (સવારનું સત્ર)
 * 1:31 PM (13:31) to 12:00 (midnight 23:59) => 'A' (બપોરનું સત્ર)
 */
export function getCurrentSession(): SessionType {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes <= 810 ? 'M' : 'A';
}

export function getSessionInfo(session: SessionType): { label: string; timeRange: string; badge: string } {
  if (session === 'M') {
    return {
      label: 'સવારનું સત્ર (M)',
      timeRange: '12:00 થી 1:30',
      badge: 'M (સવાર)',
    };
  }
  return {
    label: 'બપોરનું સત્ર (A)',
    timeRange: '1:31 થી 12:00',
    badge: 'A (બપોર)',
  };
}

export function getStoredProducts(): Product[] {
  try {
    const data = localStorage.getItem(PRODUCTS_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const list: Product[] = parsed
          .filter((p: any) => p && p.name !== 'ડાંગર' && p.id !== 'p_dangar')
          .map((p: any, idx: number) => ({
            id: p.id || `p_${idx}`,
            name: p.name || 'આઇટમ',
            shortcut: p.shortcut || p.name?.charAt(0)?.toLowerCase() || `p${idx}`,
            lastRatePer20Kg: Number(p.lastRatePer20Kg) || 0,
          }));

        if (list.length > 0) {
          // Strictly preserve the user's exact order from localStorage!
          return list;
        }
      }
    }

    // Default initialization only if localStorage was completely empty
    saveStoredProducts(DEFAULT_PRODUCTS);
    return DEFAULT_PRODUCTS;
  } catch (e) {
    console.error('Error reading stored products:', e);
  }
  return DEFAULT_PRODUCTS;
}

export function saveStoredProducts(products: Product[]) {
  localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
}

export function getDecomposedBillItems(b: VoucherBill | any): BillItem[] {
  if (!b) return [];

  const rawItems: BillItem[] = Array.isArray(b.items) && b.items.length > 0 ? b.items : [];
  const billWeight = Number(b.totalWeightKg ?? b.weightKg ?? 0);
  const slip = b.weighmentSlip;
  const isSlipWeightValid =
    !slip ||
    !billWeight ||
    !slip.totalWeightKg ||
    Math.abs(Number(slip.totalWeightKg) - billWeight) <= 2;
  const slipItems = isSlipWeightValid ? slip?.items : undefined;
  const hasPlusInRawItems = rawItems.some((it) => it.productName && it.productName.includes('+'));
  const hasPlusInBillName = Boolean(b.productName && b.productName.includes('+'));

  // 1. If weighment slip has multiple items, and the bill either has only 1 item or contains '+'
  if (
    Array.isArray(slipItems) &&
    slipItems.length > 1 &&
    (rawItems.length <= 1 || hasPlusInRawItems || hasPlusInBillName)
  ) {
    return slipItems.map((sit: any, sIdx: number) => {
      const sNet = Number(sit.weightKg) || 0;
      const sRate =
        Number(sit.ratePer20Kg) ||
        Number(rawItems[sIdx]?.ratePer20Kg) ||
        Number(rawItems[0]?.ratePer20Kg) ||
        0;
      const sAmt =
        sit.amount && sit.amount > 0
          ? Number(sit.amount)
          : Math.round((sNet / 20) * sRate);
      return {
        id: `decomp_${b.id || Date.now()}_${sIdx}`,
        productId: sit.productId || `p_${sIdx}_${sit.productName}`,
        productName: sit.productName,
        productShortcut: sit.productShortcut || '',
        weightKg: sNet,
        ratePer20Kg: sRate,
        amount: sAmt,
      };
    });
  }

  // 2. If bill already has cleanly separated items (length > 1 and no '+')
  if (rawItems.length > 1 && !hasPlusInRawItems) {
    return rawItems;
  }

  // 3. If rawItems has items, but an item contains '+'
  if (rawItems.length > 0) {
    const decomposed: BillItem[] = [];
    rawItems.forEach((it, idx) => {
      if (it.productName && it.productName.includes('+')) {
        if (Array.isArray(slipItems) && slipItems.length > 0) {
          slipItems.forEach((sit: any, sIdx: number) => {
            const sNet = Number(sit.weightKg) || 0;
            const sRate = Number(sit.ratePer20Kg) || Number(it.ratePer20Kg) || 0;
            const sAmt =
              sit.amount && sit.amount > 0
                ? Number(sit.amount)
                : Math.round((sNet / 20) * sRate);
            decomposed.push({
              id: `decomp_${b.id || Date.now()}_${idx}_${sIdx}`,
              productId: sit.productId || `p_${sIdx}_${sit.productName}`,
              productName: sit.productName,
              productShortcut: '',
              weightKg: sNet,
              ratePer20Kg: sRate,
              amount: sAmt,
            });
          });
          return;
        }
      }
      decomposed.push(it);
    });
    if (decomposed.length > 0) return decomposed;
  }

  // 4. Fallback to single item or legacy fields
  if (rawItems.length === 1) {
    return rawItems;
  }

  if (b.productName && (b.weightKg || b.totalWeightKg)) {
    return [
      {
        id: `item_${b.id || Date.now()}`,
        productId: b.productId || 'p_unknown',
        productName: b.productName,
        productShortcut: b.productShortcut || '',
        weightKg: Number(b.weightKg || b.totalWeightKg || 0),
        ratePer20Kg: Number(b.ratePer20Kg || 0),
        amount:
          (Number(b.weightKg || b.totalWeightKg || 0) / 20) *
          Number(b.ratePer20Kg || 0),
      },
    ];
  }

  return [];
}

export function normalizeBillRecord(b: any): VoucherBill {
  const items = getDecomposedBillItems(b);
  const totalWeightKg =
    b.totalWeightKg ??
    (b.weightKg ?? items.reduce((sum: number, it: any) => sum + (it.weightKg || 0), 0));
  const totalWeightMan = b.totalWeightMan ?? Number((totalWeightKg / 20).toFixed(2));
  const session: SessionType = b.session || 'M';

  let weighmentSlip = b.weighmentSlip;
  let weighmentId = b.weighmentId;

  // Sanity check: If a weighment slip has total weight completely different from this bill's weight,
  // it was mistakenly linked (e.g. 1003 kg weighment attached to a 27 kg or 13.8 kg manual bill).
  if (
    weighmentSlip &&
    totalWeightKg > 0 &&
    weighmentSlip.totalWeightKg &&
    Math.abs(Number(weighmentSlip.totalWeightKg) - totalWeightKg) > 2
  ) {
    weighmentSlip = undefined;
    weighmentId = undefined;
  }

  return {
    ...b,
    session,
    items,
    totalWeightKg,
    totalWeightMan,
    weighmentSlip,
    weighmentId,
  } as VoucherBill;
}

export function getStoredBills(): VoucherBill[] {
  try {
    const data = localStorage.getItem(BILLS_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      // Migrate / normalize older records to have decomposed `items`, `totalWeightKg`, `totalWeightMan`, `session`
      return parsed.map((b: any) => normalizeBillRecord(b));
    }
  } catch (e) {
    console.error(e);
  }
  return [];
}

export function saveStoredBills(bills: VoucherBill[]) {
  localStorage.setItem(BILLS_KEY, JSON.stringify(bills));
}

export function getStoredFirmSettings(): FirmSettings {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    if (data) {
      const parsed = JSON.parse(data);

      const merged: FirmSettings = {
        ...DEFAULT_FIRM_SETTINGS,
        ...parsed,
        // Firm details are permanently fixed and cannot be changed
        firmName: DEFAULT_FIRM_SETTINGS.firmName,
        phone: DEFAULT_FIRM_SETTINGS.phone,
        address: DEFAULT_FIRM_SETTINGS.address,
        addressLine2: DEFAULT_FIRM_SETTINGS.addressLine2,
        gstNo: DEFAULT_FIRM_SETTINGS.gstNo,
        licenseNo: DEFAULT_FIRM_SETTINGS.licenseNo,
        tagline: DEFAULT_FIRM_SETTINGS.tagline,
        footerNote: DEFAULT_FIRM_SETTINGS.footerNote,
        // Configurable printer preferences
        pairedPrinterName: parsed.pairedPrinterName || 'PSF588',
        keepBluetoothConnected: parsed.keepBluetoothConnected ?? true,
        autoDisconnectBluetooth: parsed.autoDisconnectBluetooth ?? false,
        autoPrintOnSave: parsed.autoPrintOnSave ?? true,
        printMethod: parsed.printMethod || 'bluetooth',
        paperWidth: parsed.paperWidth || '58mm',
      };

      if (parsed.firmName !== DEFAULT_FIRM_SETTINGS.firmName) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
      }

      return merged;
    }
  } catch (e) {
    console.error(e);
  }
  return DEFAULT_FIRM_SETTINGS;
}

export function saveStoredFirmSettings(settings: FirmSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getNextBillNo(
  bills: VoucherBill[],
  targetDate?: string,
  targetSession?: SessionType
): number {
  const filtered = bills.filter((b) => {
    if (targetDate && b.date !== targetDate) return false;
    if (targetSession && (b.session || 'M') !== targetSession) return false;
    return true;
  });
  if (filtered.length === 0) return 1;
  const maxNo = Math.max(...filtered.map((b) => b.billNo || 0));
  return maxNo + 1;
}

export function formatINR(val: number): string {
  return `₹${Math.round(val).toLocaleString('en-IN')}`;
}

function buildSessionSummary(session: SessionType, sessionBills: VoucherBill[]): SessionSummary {
  const info = getSessionInfo(session);
  const count = sessionBills.length;
  const weightKg = sessionBills.reduce((acc, b) => acc + (b.totalWeightKg || 0), 0);
  const weightMan = Number((weightKg / 20).toFixed(2));
  const gross = sessionBills.reduce((acc, b) => acc + (b.grossAmount || 0), 0);
  const discount = sessionBills.reduce((acc, b) => acc + (b.discountLess || 0), 0);
  const net = sessionBills.reduce((acc, b) => acc + (b.finalTotal || 0), 0);

  return {
    session,
    label: info.label,
    timeRange: info.timeRange,
    billsCount: count,
    totalWeightKg: Math.round(weightKg * 100) / 100,
    totalWeightMan: weightMan,
    grossAmount: Math.round(gross),
    discountLess: Math.round(discount),
    netSale: Math.round(net),
  };
}

export function calculateDailyReport(
  targetDate: string,
  bills: VoucherBill[],
  products: Product[]
): DailyReportSummary {
  const dayBills = bills.filter((b) => b.date === targetDate);

  const totalBills = dayBills.length;
  const totalWeightKg = dayBills.reduce((acc, b) => acc + (b.totalWeightKg || 0), 0);
  const totalWeightMan = Number((totalWeightKg / 20).toFixed(2));
  const totalGrossSale = dayBills.reduce((acc, b) => acc + (b.grossAmount || 0), 0);
  const totalDiscountLess = dayBills.reduce((acc, b) => acc + (b.discountLess || 0), 0);
  const netSale = totalGrossSale - totalDiscountLess;

  // Session M and Session A breakdown
  const billsM = dayBills.filter((b) => b.session === 'M');
  const billsA = dayBills.filter((b) => b.session === 'A');

  const sessionM = buildSessionSummary('M', billsM);
  const sessionA = buildSessionSummary('A', billsA);

  const productMap = new Map<
    string,
    {
      product: Product;
      billsCount: number;
      weightKg: number;
      gross: number;
      discount: number;
      net: number;
    }
  >();

  // Ensure all configured products exist in breakdown
  for (const prod of products) {
    productMap.set(prod.id, {
      product: prod,
      billsCount: 0,
      weightKg: 0,
      gross: 0,
      discount: 0,
      net: 0,
    });
  }

  // Aggregate items from day bills
  for (const bill of dayBills) {
    const items = getDecomposedBillItems(bill);
    // If bill has discount, distribute proportionally or attribute to first item
    const billGross = bill.grossAmount || 1;
    const discountRatio = bill.discountLess > 0 ? bill.discountLess / billGross : 0;

    for (const item of items) {
      // Find existing entry by ID or by productName
      let entry = productMap.get(item.productId);
      if (!entry) {
        for (const val of productMap.values()) {
          if (val.product.name.trim() === item.productName.trim()) {
            entry = val;
            break;
          }
        }
      }

      if (!entry) {
        entry = {
          product: {
            id: item.productId,
            name: item.productName,
            shortcut: item.productShortcut,
            lastRatePer20Kg: item.ratePer20Kg,
          },
          billsCount: 0,
          weightKg: 0,
          gross: 0,
          discount: 0,
          net: 0,
        };
        productMap.set(item.productId, entry);
      }
      entry.billsCount += 1;
      entry.weightKg += item.weightKg;
      entry.gross += item.amount;
      const itemDiscount = item.amount * discountRatio;
      entry.discount += itemDiscount;
      entry.net += item.amount - itemDiscount;
    }
  }

  const productBreakdown = Array.from(productMap.values()).map((e) => {
    const man = Number((e.weightKg / 20).toFixed(2));
    const avgRate = man > 0 ? Math.round(e.gross / man) : e.product.lastRatePer20Kg;
    return {
      productId: e.product.id,
      productName: e.product.name,
      shortcut: e.product.shortcut,
      billsCount: e.billsCount,
      totalWeightKg: Math.round(e.weightKg * 100) / 100,
      totalWeightMan: man,
      avgRatePer20Kg: avgRate,
      totalGross: Math.round(e.gross),
      totalDiscount: Math.round(e.discount),
      netAmount: Math.round(e.net),
    };
  });

  return {
    date: targetDate,
    totalBills,
    totalWeightKg: Math.round(totalWeightKg * 100) / 100,
    totalWeightMan,
    totalGrossSale: Math.round(totalGrossSale),
    totalDiscountLess: Math.round(totalDiscountLess),
    netSale: Math.round(netSale),
    sessionM,
    sessionA,
    productBreakdown,
  };
}

