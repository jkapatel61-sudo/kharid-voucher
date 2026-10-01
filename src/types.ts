export interface Product {
  id: string;
  name: string; // e.g. 'બાજરી', 'ઘઉં', 'ડાંગર', 'મકાઈ'
  shortcut: string; // e.g. 'b', 'g', 'd', 'm'
  lastRatePer20Kg: number; // e.g. 780
}

export interface BillItem {
  id: string;
  productId: string;
  productName: string;
  productShortcut: string;
  weightKg: number; // વજન (kg)
  ratePer20Kg: number; // ભાવ (20 kg દીઠ)
  amount: number; // (વજન / 20) * ભાવ
}

export type SessionType = 'M' | 'A'; // 'M' = 12:00 to 1:30 (સવાર), 'A' = 1:31 to 12:00 (બપોર)

export interface VoucherBill {
  id: string;
  billNo: number;
  billNoStr: string; // e.g. '#1'
  date: string; // YYYY-MM-DD
  time: string; // HH:mm AM/PM
  session: SessionType; // 'M' or 'A'
  customerName: string; // ગ્રાહકનું નામ
  items: BillItem[]; // બિલમાં એક કે તેથી વધુ આઇટમ્સ
  totalWeightKg: number; // કુલ વજન (kg)
  totalWeightMan: number; // કુલ મણ (૨૦ kg)
  grossAmount: number; // ગ્રોસ રકમ
  discountLess: number; // લેસ (Discount)
  finalTotal: number; // Final Total (ચોખ્ખી રકમ)
  createdAt: number;
  // Attached weighment slip data for combined printing (કાંટા વજન + બિલ એકસાથે પ્રિન્ટ માટે)
  weighmentSlip?: WeighmentSlipData;
  weighmentId?: string;
  // Backward compatibility fields for legacy records
  productId?: string;
  productName?: string;
  productShortcut?: string;
  weightKg?: number;
  ratePer20Kg?: number;
  isNextDayShift?: boolean;
}

export interface FirmSettings {
  firmName: string;
  phone: string;
  address: string;
  addressLine2?: string;
  gstNo?: string;
  licenseNo?: string;
  tagline?: string;
  footerNote: string;
  paperWidth: '58mm' | '80mm';
  autoPrintOnSave: boolean;
  printMethod?: 'bluetooth' | 'system';
  pairedPrinterName?: string; // e.g. "PSF588"
  keepBluetoothConnected?: boolean; // Maintain connection for zero-click instant printing
  autoDisconnectBluetooth?: boolean; // ઑટો અનપેર / ડિસ્કનેક્ટ (Default: false)
  autoDisconnectDelayMs?: number; // કેટલા મિલીસેકન્ડમાં અનપેર કરવું (Default: 150ms)
  autoDisconnectDelaySeconds?: number; // Legacy compatibility
  isAutoPrintStation?: boolean; // શું આ મોબાઈલ ઓફિસ પ્રિન્ટ સ્ટેશન તરીકે સેટ છે (ઓટો પ્રિન્ટ રિસીવર)
  cloudRemotePrintEnabled?: boolean; // અન્ય ફોનમાંથી બનાવેલા બિલ ક્લાઉડ દ્વારા ઓફિસ પ્રિન્ટર પર મોકલવા (Default: true)
  playChimeOnAutoPrint?: boolean; // પ્રિન્ટ થાય ત્યારે ડીંગ-ડોંગ અવાજ કરવો (Default: true)
  keepScreenAwakeInStation?: boolean; // પ્રિન્ટ સ્ટેશન ચાલુ હોય ત્યારે સ્ક્રીન ચાલુ રાખવી (Default: true)
  paperFeedLines?: number; // પ્રિન્ટ પછી નીચે વધારાની કાગળ ફીડ લાઇન (0, 1, 2) (Default: 1)
}

export interface SessionSummary {
  session: SessionType;
  label: string; // 'સવારનું સત્ર (M)' or 'બપોરનું સત્ર (A)'
  timeRange: string; // '12:00 થી 1:30' or '1:31 થી 12:00'
  billsCount: number;
  totalWeightKg: number;
  totalWeightMan: number;
  grossAmount: number;
  discountLess: number;
  netSale: number;
}

export interface DailyReportSummary {
  date: string;
  totalBills: number;
  totalWeightKg: number;
  totalWeightMan: number;
  totalGrossSale: number;
  totalDiscountLess: number;
  netSale: number;
  sessionM: SessionSummary;
  sessionA: SessionSummary;
  productBreakdown: {
    productId: string;
    productName: string;
    shortcut: string;
    billsCount: number;
    totalWeightKg: number;
    totalWeightMan: number;
    avgRatePer20Kg: number;
    totalGross: number;
    totalDiscount: number;
    netAmount: number;
  }[];
}

export interface WeighmentSlipItem {
  productName: string;
  weightKg: number;
  grossWeightKg?: number;
  weightMan?: number;
  ratePer20Kg?: number;
  amount?: number;
  bags?: number[]; // દરેક થેલીનું વજન [50.5, 49.8, ...]
  tareWeightKg?: number;
}

export interface WeighmentSlipData {
  firmName?: string;
  slipTitle?: string; // Default: 'કાંટા વજન પત્રક (WEIGHT SLIP)'
  date: string;
  time: string;
  customerName: string;
  tokenNo?: number;
  billNoStr?: string;
  items: WeighmentSlipItem[];
  totalWeightKg: number;
  grossWeightKg?: number;
  tareWeightKg?: number;
  totalWeightMan: number;
  totalBagsCount?: number;
  totalAmount?: number;
}

export interface PrintJob {
  id: string;
  type: 'bill' | 'kanta_weighment' | 'combined';
  billId?: string;
  bill?: VoucherBill;
  slip?: WeighmentSlipData;
  title: string; // e.g. "બિલ #1 - રમેશભાઈ"
  status: 'pending' | 'printing' | 'completed' | 'failed';
  sourceDevice?: string; // e.g. "મોબાઈલ ૨ (બહાર ટેબલ)" or device info
  createdAt: number;
  completedAt?: number;
  errorMessage?: string;
}

