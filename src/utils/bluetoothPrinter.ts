/**
 * Web Bluetooth ESC/POS Thermal Printer Driver with Auto-Pair & Auto-Reconnect
 * Specially optimized for PSF588 & standard 58mm/80mm thermal receipt printers.
 */
import { BillItem, FirmSettings, VoucherBill, WeighmentSlipData } from '../types';
import { formatDateDDMM, formatINR, formatTimeSimple } from './storage';

// Cached active Bluetooth device & characteristic for instant zero-prompt printing
let activeBluetoothDevice: any = null;
let activeGattServer: any = null;
let activeWriteCharacteristic: any = null;
let disconnectTimer: any = null;
let heartbeatInterval: any = null;
let autoReconnectTimer: any = null;
let isReconnecting = false;
let wakeLockSentinel: any = null;

// Concurrency locks to completely eliminate "GATT operation already in progress"
let bleQueue: Promise<any> = Promise.resolve();
let isPrinting = false;
let activePrintQueueCount = 0;
let isConnecting = false;
let pendingConnectPromise: Promise<any> | null = null;

/**
 * Runs an operation serialized through the BLE queue with automatic retry
 * if a previous GATT operation was temporarily still in flight.
 */
export function runWithBleLock<T>(task: () => Promise<T>): Promise<T> {
  // Cancel any pending disconnect immediately so consecutive prints never get cut off mid-flight:
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  const next = bleQueue.then(async () => {
    let attempts = 0;
    while (true) {
      try {
        return await task();
      } catch (err: any) {
        attempts++;
        const msg = String(err?.message || '').toLowerCase();
        const isGattBusy =
          msg.includes('gatt operation already in progress') ||
          msg.includes('networkerror') ||
          err?.name === 'NetworkError';

        if (isGattBusy && attempts < 5) {
          console.warn(`BLE GATT busy, auto-retrying (${attempts}/5) after ${attempts * 120}ms...`);
          await new Promise((res) => setTimeout(res, attempts * 120));
          continue;
        }
        throw err;
      }
    }
  });

  bleQueue = next.catch(() => {});
  return next;
}

// Subscribers for live Bluetooth connection status changes
const statusListeners = new Set<(connected: boolean, deviceName: string) => void>();

export const subscribeBluetoothStatus = (
  listener: (connected: boolean, deviceName: string) => void
): (() => void) => {
  statusListeners.add(listener);
  // Emit immediately
  try {
    listener(isBluetoothConnected(), getActiveBluetoothDeviceName());
  } catch {}
  return () => {
    statusListeners.delete(listener);
  };
};

function notifyStatusChange(connected: boolean) {
  const name = getActiveBluetoothDeviceName();
  statusListeners.forEach((fn) => {
    try {
      fn(connected, name);
    } catch {}
  });
}

/**
 * Screen Wake Lock: Keeps the mobile screen awake and prevents Android / Chrome
 * from sleeping and killing Bluetooth connections during business hours.
 */
export const requestWakeLock = async (): Promise<void> => {
  if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
    try {
      if (!wakeLockSentinel || wakeLockSentinel.released) {
        wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
          wakeLockSentinel = null;
        });
      }
    } catch (e) {
      // Benign if user agent disallows or battery saver active
    }
  }
};

export const releaseWakeLock = async (): Promise<void> => {
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch {}
    wakeLockSentinel = null;
  }
};

/**
 * Keep-Alive Heartbeat: Sends a harmless 0x00 (NUL byte) every 25 seconds.
 * In ESC/POS thermal printers, 0x00 is a safe padding/no-op byte that does not
 * advance paper or print anything, but continuously resets the printer's
 * internal 2-minute sleep timer and keeps the BLE radio active!
 * 
 * Protected by BLE Lock and completely suppressed during printing or connecting.
 */
export const startHeartbeat = (): void => {
  stopHeartbeat();
  // Safe link-level health check (checks gatt.connected without injecting 0x00 bytes into UART parser):
  heartbeatInterval = setInterval(async () => {
    if (isPrinting || isConnecting || isReconnecting) return;
    if (activeBluetoothDevice && activeGattServer) {
      if (!activeGattServer.connected) {
        console.warn('Printer connection dropped, attempting silent reconnect...');
        stopHeartbeat();
        attemptSilentReconnect().catch(() => {});
      }
    }
  }, 10000);
};

export const stopHeartbeat = (): void => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
};

const PAIRED_PRINTER_NAME_KEY = 'apmc_mandi_paired_printer_name';
const LAST_PAIRED_DEVICE_ID_KEY = 'apmc_last_paired_bt_device_id';

export const getSavedPairedPrinterName = (): string => {
  try {
    return localStorage.getItem(PAIRED_PRINTER_NAME_KEY) || 'PSF588';
  } catch {
    return 'PSF588';
  }
};

export const setSavedPairedPrinterName = (name: string): void => {
  try {
    if (name) localStorage.setItem(PAIRED_PRINTER_NAME_KEY, name.trim());
  } catch {}
};

export const getSavedPairedDeviceId = (): string => {
  try {
    return localStorage.getItem(LAST_PAIRED_DEVICE_ID_KEY) || '';
  } catch {
    return '';
  }
};

export const setSavedPairedDeviceId = (id: string): void => {
  try {
    if (id) localStorage.setItem(LAST_PAIRED_DEVICE_ID_KEY, id.trim());
  } catch {}
};

let hasPermittedDevicesCache: boolean | null = null;

export const hasPairedBluetoothDevice = async (): Promise<boolean> => {
  if (activeBluetoothDevice) return true;
  if (getSavedPairedDeviceId()) return true;
  const navBt = typeof navigator !== 'undefined' ? (navigator as any)?.bluetooth : null;
  if (navBt?.getDevices) {
    try {
      const devices = await navBt.getDevices();
      const has = Boolean(devices && devices.length > 0);
      hasPermittedDevicesCache = has;
      return has;
    } catch {}
  }
  return Boolean(getSavedPairedDeviceId());
};

export const isPrinterConfiguredOrPermitted = (): boolean => {
  if (
    typeof window !== 'undefined' &&
    Boolean((window as any).AndroidPrinter || (window as any).AndroidBridge || (window as any).Android)
  ) {
    return true;
  }
  return Boolean(
    activeBluetoothDevice ||
    getSavedPairedDeviceId() ||
    hasPermittedDevicesCache ||
    isBluetoothConnected()
  );
};

export const getActiveBluetoothDeviceName = (): string => {
  return activeBluetoothDevice?.name || getSavedPairedPrinterName() || 'PSF588';
};

// Immediately prime permitted device in background on load (zero prompt)
if (typeof navigator !== 'undefined' && (navigator as any).bluetooth?.getDevices) {
  (navigator as any).bluetooth.getDevices().then((devices: any[]) => {
    if (devices && devices.length > 0) {
      hasPermittedDevicesCache = true;
      const savedId = getSavedPairedDeviceId();
      const savedName = getSavedPairedPrinterName();
      const match =
        (savedId && devices.find((d: any) => d.id === savedId)) ||
        (savedName && devices.find((d: any) => d.name && d.name.toLowerCase().includes(savedName.toLowerCase()))) ||
        devices.find((d: any) =>
          d.name && (
            d.name.toLowerCase().includes('psf') ||
            d.name.toLowerCase().includes('588') ||
            d.name.toLowerCase().includes('printer') ||
            d.name.toLowerCase().includes('pos') ||
            d.name.toLowerCase().includes('mpt') ||
            d.name.toLowerCase().includes('rpp')
          )
        ) ||
        devices[0];

      if (match) {
        activeBluetoothDevice = match;
        if (match.name) setSavedPairedPrinterName(match.name);
        if (match.id) setSavedPairedDeviceId(match.id);
        notifyStatusChange(isBluetoothConnected());
      }
    }
  }).catch(() => {});
}

// ESC/POS Bluetooth Service & Characteristic UUIDs
const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // Standard ESC/POS
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC transparent UART
  '0000fee7-0000-1000-8000-00805f9b34fb', // PSF588 / Jerry UART
  '0000fff0-0000-1000-8000-00805f9b34fb', // POS-58 / FFF0
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ae00-0000-1000-8000-00805f9b34fb',
  '0000af00-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
];

export const isWebBluetoothSupported = (): boolean => {
  if (
    typeof window !== 'undefined' &&
    Boolean((window as any).AndroidPrinter || (window as any).AndroidBridge || (window as any).Android)
  ) {
    return true;
  }
  return typeof navigator !== 'undefined' && Boolean((navigator as any).bluetooth);
};

export const isBluetoothConnected = (): boolean => {
  return Boolean(activeGattServer && activeGattServer.connected);
};

function handleDisconnection() {
  console.log('Bluetooth GATT disconnected/released cleanly');
  activeGattServer = null;
  activeWriteCharacteristic = null;
  stopHeartbeat();
  notifyStatusChange(false);
  // NOTE: We do NOT auto-reconnect in the background while idle!
  // Keeping the printer released allows OTHER APPS (RawBT, accounting apps, etc.)
  // on the user's phone to connect and print instantly without any pairing issues.
}

function bindDisconnectListener(device: any) {
  if (!device) return;
  try {
    device.removeEventListener('gattserverdisconnected', handleDisconnection);
    device.addEventListener('gattserverdisconnected', handleDisconnection);
  } catch {}
}

/**
 * Attempts silent reconnection to cached or previously paired Bluetooth device
 * on-demand without prompting the user or opening the pair dialog.
 */
export const attemptSilentReconnect = async (): Promise<boolean> => {
  if (isReconnecting || isConnecting || isPrinting) return false;
  if (isBluetoothConnected()) return true;
  if (!isWebBluetoothSupported()) return false;

  return runWithBleLock(async () => {
    if (isBluetoothConnected()) return true;
    try {
      isReconnecting = true;
      const res = await ensureConnectedPrinterInternal();
      return Boolean(res?.writeChar);
    } catch {
      return false;
    } finally {
      isReconnecting = false;
    }
  });
};

/**
 * Disconnects / releases the Bluetooth printer GATT connection.
 * By default, keeps activeBluetoothDevice cached in memory so the next print
 * can re-connect in 200ms with zero dialogs.
 */
export const disconnectBluetoothPrinter = (keepDeviceInMemory: boolean = true) => {
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  if (autoReconnectTimer) {
    clearTimeout(autoReconnectTimer);
    autoReconnectTimer = null;
  }
  stopHeartbeat();
  releaseWakeLock();

  if (activeGattServer) {
    try {
      activeGattServer.disconnect();
    } catch {}
  }
  if (activeBluetoothDevice && activeBluetoothDevice.gatt) {
    try {
      activeBluetoothDevice.gatt.disconnect();
    } catch {}
  }
  activeGattServer = null;
  activeWriteCharacteristic = null;

  if (!keepDeviceInMemory) {
    activeBluetoothDevice = null;
  }

  notifyStatusChange(false);
};

/**
 * Clean divider line on canvas
 */
function drawReceiptDivider(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y: number,
  x2: number
) {
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.fillRect(x1, y, x2 - x1, 2);
  ctx.restore();
}

/**
 * Renders the identical, complete firm header on receipts:
 * Firm name, Tagline, Address lines, Phone numbers, GSTIN, and License number (લા.નં)
 */
function drawCommonReceiptHeader(
  ctx: CanvasRenderingContext2D,
  settings: FirmSettings,
  width: number,
  margin: number,
  rightX: number,
  startY = 40,
  showDivider = true
): number {
  let y = startY;

  // 1. Firm Name (Bold & Large)
  ctx.textAlign = 'center';
  ctx.font = '700 32px "Noto Sans Gujarati", Arial, sans-serif';
  ctx.fillText(settings.firmName || 'શ્રી કલેશ્વરી કૃપા ટ્રેડીંગ કું.', width / 2, y);
  y += 34;

  // 2. Tagline (Clear & readable)
  const tagline = settings.tagline || 'અનાજ, કઠોળ, તેલીબીયા તથા કેટલફીડના વહેપારી';
  if (tagline) {
    ctx.font = '500 18px "Noto Sans Gujarati", Arial, sans-serif';
    ctx.fillText(tagline, width / 2, y);
    y += 24;
  }

  // 3. Address Lines
  const addr1 = settings.address || 'હરસિદ્ધિ માતાના મંદિર પાસે';
  if (addr1) {
    ctx.font = '500 18px "Noto Sans Gujarati", Arial, sans-serif';
    ctx.fillText(addr1, width / 2, y);
    y += 24;
  }
  const addr2 = settings.addressLine2 || 'મુ. વાસણા, પો. મહિસા, તા. મહુધા, જી. ખેડા';
  if (addr2) {
    ctx.font = '500 18px "Noto Sans Gujarati", Arial, sans-serif';
    ctx.fillText(addr2, width / 2, y);
    y += 24;
  }

  // 4. Phones (Prominent)
  let phoneList = (settings.phone || '')
    .split(/[,/\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!phoneList.includes('9427077011') || !phoneList.includes('9313172801')) {
    phoneList = ['9427077011', '9313172801'];
  }
  ctx.font = '600 19px monospace';
  ctx.fillText(`Mo. ${phoneList.join(' | ')}`, width / 2, y);
  y += 26;

  // 5. GSTIN & License No (લા.નં:)
  const gstNo = settings.gstNo || '24ADDPP1757F1ZP';
  const licenseNo = settings.licenseNo || '01/1998 Dt.25-08-1998';
  if (gstNo || licenseNo) {
    ctx.font = '500 17px monospace';
    if (gstNo && licenseNo) {
      ctx.fillText(`GSTIN: ${gstNo}`, width / 2, y);
      y += 22;
      ctx.fillText(`લા.નં: ${licenseNo}`, width / 2, y);
      y += 22;
    } else if (gstNo) {
      ctx.fillText(`GSTIN: ${gstNo}`, width / 2, y);
      y += 22;
    } else if (licenseNo) {
      ctx.fillText(`લા.નં: ${licenseNo}`, width / 2, y);
      y += 22;
    }
  }

  // Divider line
  if (showDivider) {
    y += 2;
    drawReceiptDivider(ctx, margin, y, rightX);
    y += 20;
  } else {
    y += 12;
  }

  return y;
}

/**
 * Renders the bill into a high-contrast monochrome bitmap for 58mm (384px) or 80mm (576px)
 * to support full Gujarati text rendering on all thermal printers!
 */
export const renderReceiptToCanvas = (
  bill: VoucherBill,
  settings: FirmSettings
): HTMLCanvasElement => {
  const is80mm = settings.paperWidth === '80mm';
  const width = is80mm ? 576 : 384;
  // Use edge-to-edge margin (4px) on 58mm to maximize printable area across the entire thermal head
  const margin = is80mm ? 10 : 4;
  const rightX = width - margin;

  // Generous height to accommodate all elements cleanly
  const estimatedHeight = 950 + (bill.items?.length || 1) * 80;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = estimatedHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Fill pure white background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, estimatedHeight);

  // Black ink
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';

  // Common Header (Firm Name, Tagline, Address, Phone, GSTIN, License No)
  // ⭐️ Line 1: બિલ નંબર ની ઉપર આડી લાઇન
  let y = drawCommonReceiptHeader(ctx, settings, width, margin, rightX, 40, true);

  // 6. Bill Info (Large & bold)
  ctx.textAlign = 'left';
  ctx.font = '600 22px monospace';
  const billNum = bill.billNoStr || `${bill.session || 'M'}${bill.billNo}`;
  ctx.fillText(`બિલ નં: ${billNum}`, margin, y);

  ctx.textAlign = 'right';
  ctx.fillText(`તારીખ: ${formatDateDDMM(bill.date)}`, rightX, y);
  y += 26;

  // Customer Name (Prominent)
  ctx.textAlign = 'left';
  ctx.font = '600 23px "Noto Sans Gujarati", Arial, sans-serif';
  ctx.fillText(`ગ્રાહક: ${bill.customerName || 'સામાન્ય ગ્રાહક'}`, margin, y);

  const billTimeSimple = formatTimeSimple(bill.time);
  if (billTimeSimple) {
    ctx.textAlign = 'right';
    ctx.font = '600 20px monospace';
    ctx.fillText(billTimeSimple, rightX, y);
  }
  y += 22;

  // ⭐️ Line 2: ગ્રાહક ની નીચે આડી લાઇન
  drawReceiptDivider(ctx, margin, y, rightX);
  y += 24;

  // 7 & 8. Items Table (Product Name, Rate, Amount) - NO divider lines inside table
  const items = bill.items && bill.items.length > 0 ? bill.items : [];
  items.forEach((it, idx) => {
    // Top row: Product Name (e.g. 'બાજરી') on left, 'ભાવ' in center, 'રકમ' on right
    ctx.textAlign = 'left';
    ctx.font = 'bold 24px "Noto Sans Gujarati", Arial, sans-serif';
    ctx.fillText(it.productName, margin, y);

    ctx.textAlign = 'center';
    ctx.font = 'bold 21px "Noto Sans Gujarati", Arial, sans-serif';
    ctx.fillText('ભાવ', width * 0.52, y);

    ctx.textAlign = 'right';
    ctx.font = 'bold 21px "Noto Sans Gujarati", Arial, sans-serif';
    ctx.fillText('રકમ', rightX, y);
    y += 26;

    // Bottom row: Weight (kg only, no man count), Rate, Amount (pure number, no ₹ symbol)
    ctx.textAlign = 'left';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`${it.weightKg} kg`, margin, y);

    ctx.textAlign = 'center';
    ctx.font = 'bold 24px monospace';
    ctx.fillText(`${it.ratePer20Kg}`, width * 0.52, y);

    ctx.textAlign = 'right';
    ctx.font = 'bold 25px monospace';
    ctx.fillText(`${Math.round(it.amount).toLocaleString('en-IN')}`, rightX, y);
    y += 28;

    if (idx < items.length - 1) {
      y += 10;
    }
  });

  // ⭐️ એકમાત્ર આડી લાઇન: ફક્ત 1950 (ચોખ્ખી રકમ) ની બરાબર ઉપર જ આડી લાઇન
  y += 8;
  drawReceiptDivider(ctx, margin, y, rightX);
  y += 36;

  // 9. Summary & Totals (Pure numbers, no ₹ symbol)
  if (bill.discountLess > 0) {
    ctx.textAlign = 'left';
    ctx.font = '600 20px "Noto Sans Gujarati", Arial, sans-serif';
    ctx.fillText('કુલ રકમ:', margin, y);
    ctx.textAlign = 'right';
    ctx.font = '600 22px monospace';
    ctx.fillText(`${Math.round(bill.grossAmount).toLocaleString('en-IN')}`, rightX, y);
    y += 26;

    ctx.textAlign = 'left';
    ctx.font = '600 20px "Noto Sans Gujarati", Arial, sans-serif';
    ctx.fillText('કપાત / લેસ:', margin, y);
    ctx.textAlign = 'right';
    ctx.font = '600 22px monospace';
    ctx.fillText(`-${Math.round(bill.discountLess).toLocaleString('en-IN')}`, rightX, y);
    y += 26;
  }

  // Final Total (Big & Bold Total, pure number, no ₹ symbol)
  ctx.textAlign = 'left';
  ctx.font = 'bold 25px "Noto Sans Gujarati", Arial, sans-serif';
  ctx.fillText('ચોખ્ખી રકમ:', margin, y);

  ctx.textAlign = 'right';
  ctx.font = 'bold 34px monospace';
  ctx.fillText(`${Math.round(bill.finalTotal).toLocaleString('en-IN')}`, rightX, y);
  y += 34;

  // NO divider below total
  y += 12;

  // Footer Note
  if (settings.footerNote) {
    ctx.textAlign = 'center';
    ctx.font = '600 20px "Noto Sans Gujarati", Arial, sans-serif';
    ctx.fillText(settings.footerNote, width / 2, y);
    y += 20;
  }

  // ⭐️ નીચે આભાર વાળા લખાણની નીચે બરાબર .5 cm (40px) ખાલી જગ્યા
  y += 40;
  const finalHeight = y;

  // Trim canvas to exact content height
  const trimmed = document.createElement('canvas');
  trimmed.width = width;
  trimmed.height = finalHeight;
  const tCtx = trimmed.getContext('2d');
  if (tCtx) {
    tCtx.fillStyle = '#FFFFFF';
    tCtx.fillRect(0, 0, width, finalHeight);
    tCtx.drawImage(canvas, 0, 0, width, finalHeight, 0, 0, width, finalHeight);
    return trimmed;
  }

  return canvas;
};

/**
 * Renders a detailed Weight Slip (કાંટા વજન પત્રક / લખેલા વજનની પાવતી) to canvas
 * with bag-by-bag weights displayed in balanced columns.
 */
export const renderWeighmentToCanvas = (
  slip: WeighmentSlipData,
  settings: FirmSettings
): HTMLCanvasElement => {
  const is80mm = settings.paperWidth === '80mm';
  const width = is80mm ? 576 : 384;
  const margin = is80mm ? 10 : 4;
  const rightX = width - margin;

  let totalBags = 0;
  slip.items.forEach((it) => {
    if (it.bags && it.bags.length > 0) {
      totalBags += it.bags.length;
    }
  });
  const estimatedHeight = 900 + Math.ceil(totalBags / 2) * 34 + slip.items.length * 200;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.max(800, estimatedHeight);

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, canvas.height);

  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';

  // Common Header (Firm Name, Tagline, Address, Phone, GSTIN, License No, Divider)
  let y = drawCommonReceiptHeader(ctx, settings, width, margin, rightX, 40);

  // Bill Info & Date (Matching Photo 2: Bill No on left, Date on right, No time, No પત્રક title)
  ctx.textAlign = 'left';
  ctx.font = '600 22px monospace';
  const billNum = slip.billNoStr || '-';
  ctx.fillText(`બિલ નં: ${billNum}`, margin, y);

  ctx.textAlign = 'right';
  ctx.fillText(`તારીખ: ${formatDateDDMM(slip.date)}`, rightX, y);
  y += 26;

  // Customer Name (Prominent, matching Photo 2: "ગ્રાહક: ...")
  ctx.textAlign = 'left';
  ctx.font = '600 23px "Noto Sans Gujarati", Arial, sans-serif';
  ctx.fillText(`ગ્રાહક: ${slip.customerName || 'સામાન્ય ગ્રાહક'}`, margin, y);

  const timeSimple = formatTimeSimple(slip.time);
  if (timeSimple) {
    ctx.textAlign = 'right';
    ctx.font = '600 20px monospace';
    ctx.fillText(timeSimple, rightX, y);
  }
  y += 22;

  // Divider
  drawReceiptDivider(ctx, margin, y, rightX);
  y += 22;

  // 5. Items & Individual Bag Weights Breakdown
  slip.items.forEach((item, itemIdx) => {
    ctx.textAlign = 'left';
    ctx.font = '700 24px "Noto Sans Gujarati", Arial, sans-serif';
    ctx.fillText(`માલ: ${item.productName}`, margin, y);
    y += 26;

    if (item.bags && item.bags.length > 0) {
      // Show bags directly in 2 balanced columns with bigger, clearer text
      const halfCount = Math.ceil(item.bags.length / 2);
      const leftColX = margin + 4;
      const rightColX = Math.round(width / 2) + 4;

      ctx.font = '800 22px monospace';
      let leftColTotal = 0;
      let rightColTotal = 0;

      for (let i = 0; i < halfCount; i++) {
        const leftBagNum = i + 1;
        const leftWeight = Number(item.bags[i]);
        leftColTotal += leftWeight;

        // Individual bag rows: only weight without 'kg'
        const leftText = `${String(leftBagNum).padStart(2, ' ')} ) ${leftWeight.toFixed(1)}`;

        ctx.textAlign = 'left';
        ctx.fillText(leftText, leftColX, y);

        const rightIdx = i + halfCount;
        if (rightIdx < item.bags.length) {
          const rightBagNum = rightIdx + 1;
          const rightWeight = Number(item.bags[rightIdx]);
          rightColTotal += rightWeight;

          const rightText = `${String(rightBagNum).padStart(2, ' ')} ) ${rightWeight.toFixed(1)}`;
          ctx.fillText(rightText, rightColX, y);
        }
        y += 26;
      }

      // Column Subtotals (aligned right under the ')' of ' 1 ) ', with 'kg')
      y += 2;
      drawReceiptDivider(ctx, margin, y, rightX);
      y += 18;

      ctx.font = '800 22px monospace';
      const parenOffset = ctx.measureText(' 1 ').width;

      ctx.font = '900 26px monospace';
      ctx.textAlign = 'left';
      const leftFormatted = parseFloat(leftColTotal.toFixed(1));
      ctx.fillText(`${leftFormatted} kg`, leftColX + parenOffset, y);

      if (rightColTotal > 0) {
        const rightFormatted = parseFloat(rightColTotal.toFixed(1));
        ctx.fillText(`${rightFormatted} kg`, rightColX + parenOffset, y);
      }
      y += 24;
    } else {
      // Direct total weight (bigger font)
      ctx.textAlign = 'left';
      ctx.font = '800 24px monospace';
      ctx.fillText(`વજન: ${item.weightKg} kg`, margin, y);
      y += 24;
    }

    // If multiple items, show this item's deduction (કપાત) and net weight immediately below it
    if (slip.items.length > 1) {
      const itemGross =
        item.grossWeightKg ??
        (item.bags && item.bags.length > 0
          ? Math.round(item.bags.reduce((acc, v) => acc + (Number(v) || 0), 0) * 10) / 10
          : item.weightKg);
      const diffGrossNet = Math.round((itemGross - item.weightKg) * 10) / 10;
      const itemTare = item.tareWeightKg ?? (diffGrossNet > 0 ? diffGrossNet : 0);
      const itemNet =
        itemTare > 0
          ? Math.round((itemGross - itemTare) * 10) / 10
          : Math.round(item.weightKg * 10) / 10;
      const itemBagsCount = item.bags ? item.bags.length : 0;

      y += 2;
      drawReceiptDivider(ctx, margin, y, rightX);
      y += 18;

      if (itemTare > 0) {
        ctx.textAlign = 'left';
        ctx.font = '700 22px "Noto Sans Gujarati", Arial, sans-serif';
        ctx.fillText('કુલ વજન:', margin, y);
        ctx.textAlign = 'right';
        ctx.font = '800 25px monospace';
        ctx.fillText(`${parseFloat(itemGross.toFixed(1))} kg`, rightX, y);
        y += 24;

        ctx.textAlign = 'left';
        ctx.font = '700 22px "Noto Sans Gujarati", Arial, sans-serif';
        // 3-4 spaces after colon for bags count
        ctx.fillText(`કુલ થેલી:    ${itemBagsCount || ''}`, margin, y);
        ctx.textAlign = 'right';
        ctx.font = '800 25px monospace';
        ctx.fillText(`-${parseFloat(itemTare.toFixed(1))} kg`, rightX, y);
        y += 24;

        ctx.textAlign = 'left';
        ctx.font = '800 24px "Noto Sans Gujarati", Arial, sans-serif';
        ctx.fillText('નેટ વજન:', margin, y);
        ctx.textAlign = 'right';
        ctx.font = '900 30px monospace';
        ctx.fillText(`${parseFloat(itemNet.toFixed(1))} kg`, rightX, y);
        y += 28;
      } else {
        if (itemBagsCount > 0) {
          ctx.textAlign = 'left';
          ctx.font = '700 22px "Noto Sans Gujarati", Arial, sans-serif';
          ctx.fillText(`કુલ થેલી:    ${itemBagsCount}`, margin, y);
          y += 22;
        }
        ctx.textAlign = 'left';
        ctx.font = '800 24px "Noto Sans Gujarati", Arial, sans-serif';
        ctx.fillText('નેટ વજન:', margin, y);
        ctx.textAlign = 'right';
        ctx.font = '900 30px monospace';
        ctx.fillText(`${parseFloat(itemNet.toFixed(1))} kg`, rightX, y);
        y += 28;
      }
    }

    if (itemIdx < slip.items.length - 1) {
      drawReceiptDivider(ctx, margin, y, rightX);
      y += 18;
    }
  });

  // For single item, show summary at the end. For multiple items, each item already has its own summary and total weight sum is removed.
  if (slip.items.length === 1) {
    drawReceiptDivider(ctx, margin, y, rightX);
    y += 20;

    const grossW =
      slip.grossWeightKg ??
      (slip.items[0]?.bags && slip.items[0].bags.length > 0
        ? slip.items[0].bags.reduce((acc, b) => acc + Number(b), 0)
        : slip.items[0]?.weightKg || 0);
    const roundedGross = Math.round(grossW * 10) / 10;

    let tareW = slip.tareWeightKg ?? (slip.items[0]?.tareWeightKg || 0);
    if ((!tareW || tareW <= 0) && slip.items[0]?.bags && slip.items[0].bags.length > 0) {
      const diff = Math.round((grossW - (slip.items[0]?.weightKg || 0)) * 10) / 10;
      if (diff > 0) tareW = diff;
    }
    const roundedTare = Math.round(tareW * 10) / 10;
    const roundedNet =
      roundedTare > 0
        ? Math.round((roundedGross - roundedTare) * 10) / 10
        : Math.round((slip.items[0]?.weightKg || slip.totalWeightKg) * 10) / 10;

    if (roundedTare > 0) {
      ctx.textAlign = 'left';
      ctx.font = '700 24px "Noto Sans Gujarati", Arial, sans-serif';
      ctx.fillText('કુલ વજન:', margin, y);
      ctx.textAlign = 'right';
      ctx.font = '800 28px monospace';
      ctx.fillText(`${parseFloat(roundedGross.toFixed(1))} kg`, rightX, y);
      y += 24;

      ctx.textAlign = 'left';
      ctx.font = '700 24px "Noto Sans Gujarati", Arial, sans-serif';
      ctx.fillText(`કુલ થેલી:    ${slip.totalBagsCount || ''}`, margin, y);
      ctx.textAlign = 'right';
      ctx.font = '800 28px monospace';
      ctx.fillText(`-${parseFloat(roundedTare.toFixed(1))} kg`, rightX, y);
      y += 24;

      drawReceiptDivider(ctx, margin, y, rightX);
      y += 36;

      ctx.textAlign = 'left';
      ctx.font = '800 26px "Noto Sans Gujarati", Arial, sans-serif';
      ctx.fillText('નેટ વજન:', margin, y);
      ctx.textAlign = 'right';
      ctx.font = '900 34px monospace';
      ctx.fillText(`${parseFloat(roundedNet.toFixed(1))} kg`, rightX, y);
      y += 30;
    } else {
      if (slip.totalBagsCount && slip.totalBagsCount > 0) {
        ctx.textAlign = 'left';
        ctx.font = '700 24px "Noto Sans Gujarati", Arial, sans-serif';
        ctx.fillText(`કુલ થેલી:    ${slip.totalBagsCount}`, margin, y);
        y += 24;
      }

      ctx.textAlign = 'left';
      ctx.font = '800 26px "Noto Sans Gujarati", Arial, sans-serif';
      ctx.fillText('કુલ વજન:', margin, y);
      ctx.textAlign = 'right';
      ctx.font = '900 34px monospace';
      ctx.fillText(`${parseFloat(roundedNet.toFixed(1))} kg`, rightX, y);
      y += 30;
    }
  }

  // Divider
  drawReceiptDivider(ctx, margin, y, rightX);
  y += 18;

  // Footer Note
  if (settings.footerNote) {
    ctx.textAlign = 'center';
    ctx.font = '600 20px "Noto Sans Gujarati", Arial, sans-serif';
    ctx.fillText(settings.footerNote, width / 2, y);
    y += 20;
  }

  // ⭐️ નીચે આભાર વાળા લખાણની નીચે બરાબર .5 cm (40px) ખાલી જગ્યા
  y += 40;
  const finalHeight = y;
  const trimmed = document.createElement('canvas');
  trimmed.width = width;
  trimmed.height = finalHeight;
  const tCtx = trimmed.getContext('2d');
  if (tCtx) {
    tCtx.fillStyle = '#FFFFFF';
    tCtx.fillRect(0, 0, width, finalHeight);
    tCtx.drawImage(canvas, 0, 0, width, finalHeight, 0, 0, width, finalHeight);
    return trimmed;
  }

  return canvas;
};

/**
 * Renders a Combined Slip: First the Weight Slip (કાંટા વજન પત્રક with individual bags),
 * and immediately below it the Cash Voucher Bill (વાઉચર બિલ) on a single seamless thermal receipt!
 */
export const renderCombinedReceiptToCanvas = (
  bill: VoucherBill,
  slip: WeighmentSlipData,
  settings: FirmSettings
): HTMLCanvasElement => {
  const is80mm = settings.paperWidth === '80mm';
  const width = is80mm ? 576 : 384;
  const margin = is80mm ? 10 : 4;
  const rightX = width - margin;

  // 1. Synchronize slip items with bill items so every product from the bill is rendered in the weighment section:
  const slipItems: WeighmentSlipData['items'] = [...slip.items];
  if (bill.items && bill.items.length > 0) {
    bill.items.forEach((bItem) => {
      const alreadyPresent = slipItems.some(
        (sItem) =>
          sItem.productName.trim().toLowerCase() === bItem.productName.trim().toLowerCase() ||
          (bItem.productName.includes('+') && bItem.productName.includes(sItem.productName))
      );
      if (!alreadyPresent) {
        slipItems.push({
          productName: bItem.productName,
          weightKg: bItem.weightKg,
          grossWeightKg: bItem.weightKg,
          tareWeightKg: undefined,
          weightMan: Math.round((bItem.weightKg / 20) * 10) / 10,
          ratePer20Kg: bItem.ratePer20Kg,
          amount: bItem.amount,
          bags: [],
        });
      }
    });
  }

  let totalBags = 0;
  slipItems.forEach((it) => {
    if (it.bags && it.bags.length > 0) {
      totalBags += it.bags.length;
    }
  });

  const estimatedHeight = 2200 + Math.ceil(totalBags / 2) * 40 + slipItems.length * 300 + (bill.items?.length || 2) * 160;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.max(1500, estimatedHeight);

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, canvas.height);

  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';

  // Common Header (Firm Name, Tagline, Address, Phone, GSTIN, License No, Divider)
  let y = drawCommonReceiptHeader(ctx, settings, width, margin, rightX, 40);

  // ==========================================
  // PART 1: કાંટા વજન (WEIGHT SECTION)
  // ==========================================
  // Bill Info & Date (Matching Photo 2: Bill No on left, Date on right, No time, No પત્રક title)
  ctx.textAlign = 'left';
  ctx.font = '600 22px monospace';
  const billNum = bill.billNoStr || slip.billNoStr || (bill.billNo ? `${bill.session || 'M'}${bill.billNo}` : '-');
  ctx.fillText(`બિલ નં: ${billNum}`, margin, y);

  ctx.textAlign = 'right';
  ctx.fillText(`તારીખ: ${formatDateDDMM(slip.date || bill.date)}`, rightX, y);
  y += 26;

  // Customer Name (Prominent, matching Photo 2: "ગ્રાહક: ...")
  ctx.textAlign = 'left';
  ctx.font = '600 23px "Noto Sans Gujarati", Arial, sans-serif';
  ctx.fillText(`ગ્રાહક: ${slip.customerName || bill.customerName || 'સામાન્ય ગ્રાહક'}`, margin, y);

  const combinedTime = formatTimeSimple(slip.time || bill.time);
  if (combinedTime) {
    ctx.textAlign = 'right';
    ctx.font = '600 20px monospace';
    ctx.fillText(combinedTime, rightX, y);
  }
  y += 22;

  drawReceiptDivider(ctx, margin, y, rightX);
  y += 22;

  // Items & Bag weights
  slipItems.forEach((item, itemIdx) => {
    ctx.textAlign = 'left';
    ctx.font = '700 23px "Noto Sans Gujarati", Arial, sans-serif';
    ctx.fillText(`માલ: ${item.productName}`, margin, y);
    y += 26;

    if (item.bags && item.bags.length > 0) {
      const halfCount = Math.ceil(item.bags.length / 2);
      const leftColX = margin + 4;
      const rightColX = Math.round(width / 2) + 4;

      ctx.font = '800 21px monospace';
      let leftColTotal = 0;
      let rightColTotal = 0;

      for (let i = 0; i < halfCount; i++) {
        const leftBagNum = i + 1;
        const leftWeight = Number(item.bags[i]);
        leftColTotal += leftWeight;

        // Individual bag rows: only weight without 'kg'
        const leftText = `${String(leftBagNum).padStart(2, ' ')} ) ${leftWeight.toFixed(1)}`;
        ctx.textAlign = 'left';
        ctx.fillText(leftText, leftColX, y);

        const rightIdx = i + halfCount;
        if (rightIdx < item.bags.length) {
          const rightBagNum = rightIdx + 1;
          const rightWeight = Number(item.bags[rightIdx]);
          rightColTotal += rightWeight;

          const rightText = `${String(rightBagNum).padStart(2, ' ')} ) ${rightWeight.toFixed(1)}`;
          ctx.fillText(rightText, rightColX, y);
        }
        y += 26;
      }

      // Column Subtotals (aligned right under the ')' of ' 1 ) ', with 'kg')
      y += 2;
      drawReceiptDivider(ctx, margin, y, rightX);
      y += 20;

      ctx.font = '800 21px monospace';
      const parenOffset = ctx.measureText(' 1 ').width;

      ctx.font = '900 24px monospace';
      ctx.textAlign = 'left';
      const leftFormatted = parseFloat(leftColTotal.toFixed(1));
      ctx.fillText(`${leftFormatted} kg`, leftColX + parenOffset, y);

      if (rightColTotal > 0) {
        const rightFormatted = parseFloat(rightColTotal.toFixed(1));
        ctx.fillText(`${rightFormatted} kg`, rightColX + parenOffset, y);
      }
      y += 24;

      // If multiple items, show this item's deduction (કપાત) and net weight immediately below it
      if (slipItems.length > 1) {
        const itemGross =
          item.grossWeightKg ??
          Math.round(item.bags.reduce((acc, v) => acc + (Number(v) || 0), 0) * 10) / 10;
        const diffGrossNet = Math.round((itemGross - item.weightKg) * 10) / 10;
        const itemTare = item.tareWeightKg ?? (diffGrossNet > 0 ? diffGrossNet : 0);
        const itemNet =
          itemTare > 0
            ? Math.round((itemGross - itemTare) * 10) / 10
            : Math.round(item.weightKg * 10) / 10;
        const itemBagsCount = item.bags ? item.bags.length : 0;

        y += 2;
        drawReceiptDivider(ctx, margin, y, rightX);
        y += 22;

        if (itemTare > 0) {
          ctx.textAlign = 'left';
          ctx.font = '700 21px "Noto Sans Gujarati", Arial, sans-serif';
          ctx.fillText('કુલ વજન:', margin, y);
          ctx.textAlign = 'right';
          ctx.font = '800 23px monospace';
          ctx.fillText(`${parseFloat(itemGross.toFixed(1))} kg`, rightX, y);
          y += 26;

          ctx.textAlign = 'left';
          ctx.font = '700 21px "Noto Sans Gujarati", Arial, sans-serif';
          ctx.fillText(`કુલ થેલી:    ${itemBagsCount || ''}`, margin, y);
          ctx.textAlign = 'right';
          ctx.font = '800 23px monospace';
          ctx.fillText(`-${parseFloat(itemTare.toFixed(1))} kg`, rightX, y);
          y += 26;

          ctx.textAlign = 'left';
          ctx.font = '800 23px "Noto Sans Gujarati", Arial, sans-serif';
          ctx.fillText('નેટ વજન:', margin, y);
          ctx.textAlign = 'right';
          ctx.font = '900 28px monospace';
          ctx.fillText(`${parseFloat(itemNet.toFixed(1))} kg`, rightX, y);
          y += 30;
        } else {
          if (itemBagsCount > 0) {
            ctx.textAlign = 'left';
            ctx.font = '700 21px "Noto Sans Gujarati", Arial, sans-serif';
            ctx.fillText(`કુલ થેલી:    ${itemBagsCount}`, margin, y);
            y += 24;
          }
          ctx.textAlign = 'left';
          ctx.font = '800 23px "Noto Sans Gujarati", Arial, sans-serif';
          ctx.fillText('નેટ વજન:', margin, y);
          ctx.textAlign = 'right';
          ctx.font = '900 28px monospace';
          ctx.fillText(`${parseFloat(itemNet.toFixed(1))} kg`, rightX, y);
          y += 30;
        }
      }
    } else {
      // Direct item without individual bag entries (e.g. ઘઉં added directly from new weight)
      ctx.textAlign = 'left';
      ctx.font = '700 22px "Noto Sans Gujarati", Arial, sans-serif';
      ctx.fillText('વજન:', margin, y);
      ctx.textAlign = 'right';
      ctx.font = '800 24px monospace';
      ctx.fillText(`${parseFloat(item.weightKg.toFixed(1))} kg`, rightX, y);
      y += 28;
    }

    if (itemIdx < slipItems.length - 1) {
      drawReceiptDivider(ctx, margin, y, rightX);
      y += 20;
    }
  });

  // For single item, only show summary if it actually has bag breakdowns or tare deduction
  const singleItem = slipItems[0];
  const hasBags = Boolean(singleItem?.bags && singleItem.bags.length > 0);
  const grossW =
    slip.grossWeightKg ??
    (hasBags
      ? singleItem!.bags!.reduce((acc, b) => acc + Number(b), 0)
      : singleItem?.weightKg || 0);
  const roundedGross = Math.round(grossW * 10) / 10;

  let tareW = slip.tareWeightKg ?? (singleItem?.tareWeightKg || 0);
  if ((!tareW || tareW <= 0) && hasBags) {
    const diff = Math.round((grossW - (singleItem?.weightKg || 0)) * 10) / 10;
    if (diff > 0) tareW = diff;
  }
  const roundedTare = Math.round(tareW * 10) / 10;
  const roundedNet =
    roundedTare > 0
      ? Math.round((roundedGross - roundedTare) * 10) / 10
      : Math.round((singleItem?.weightKg || slip.totalWeightKg) * 10) / 10;

  if (slipItems.length === 1 && (hasBags || roundedTare > 0)) {
    drawReceiptDivider(ctx, margin, y, rightX);
    y += 24;

    if (roundedTare > 0) {
      ctx.textAlign = 'left';
      ctx.font = '700 22px "Noto Sans Gujarati", Arial, sans-serif';
      ctx.fillText('કુલ વજન:', margin, y);
      ctx.textAlign = 'right';
      ctx.font = '800 25px monospace';
      ctx.fillText(`${parseFloat(roundedGross.toFixed(1))} kg`, rightX, y);
      y += 28;

      ctx.textAlign = 'left';
      ctx.font = '700 22px "Noto Sans Gujarati", Arial, sans-serif';
      ctx.fillText(`કુલ થેલી:    ${slip.totalBagsCount || ''}`, margin, y);
      ctx.textAlign = 'right';
      ctx.font = '800 25px monospace';
      ctx.fillText(`-${parseFloat(roundedTare.toFixed(1))} kg`, rightX, y);
      y += 28;

      drawReceiptDivider(ctx, margin, y, rightX);
      y += 22;

      ctx.textAlign = 'left';
      ctx.font = '800 24px "Noto Sans Gujarati", Arial, sans-serif';
      ctx.fillText('નેટ વજન:', margin, y);
      ctx.textAlign = 'right';
      ctx.font = '900 30px monospace';
      ctx.fillText(`${parseFloat(roundedNet.toFixed(1))} kg`, rightX, y);
      y += 34;
    } else {
      if (slip.totalBagsCount && slip.totalBagsCount > 0) {
        ctx.textAlign = 'left';
        ctx.font = '700 22px "Noto Sans Gujarati", Arial, sans-serif';
        ctx.fillText(`કુલ થેલી:    ${slip.totalBagsCount}`, margin, y);
        y += 26;
      }

      ctx.textAlign = 'left';
      ctx.font = '800 24px "Noto Sans Gujarati", Arial, sans-serif';
      ctx.fillText('કુલ વજન:', margin, y);
      ctx.textAlign = 'right';
      ctx.font = '900 30px monospace';
      ctx.fillText(`${parseFloat(roundedNet.toFixed(1))} kg`, rightX, y);
      y += 34;
    }
  }

  // ==========================================
  // PART 2: વાઉચર બિલ (BILL / PAYMENT SECTION)
  // ==========================================
  // Prominent separator
  drawReceiptDivider(ctx, margin, y, rightX);
  y += 24;

  ctx.textAlign = 'center';
  ctx.font = '700 22px "Noto Sans Gujarati", Arial, sans-serif';
  ctx.fillText('*** વાઉચર બિલ (હિસાબ) ***', width / 2, y);
  y += 28;

  // Bill Items table
  let billItems: BillItem[] = bill.items && bill.items.length > 0 ? [...bill.items] : [];

  // If multi-item slip, ensure bill items are separated so each item has its own weight, rate, and amount
  if (
    slipItems &&
    slipItems.length > 1 &&
    (billItems.length <= 1 || billItems.some((bi) => bi.productName.includes('+')))
  ) {
    billItems = slipItems.map((sit, sIdx) => {
      const sGross =
        sit.grossWeightKg ??
        (sit.bags && sit.bags.length > 0
          ? Math.round(sit.bags.reduce((a, b) => a + Number(b), 0) * 10) / 10
          : sit.weightKg);
      const sTare =
        sit.tareWeightKg ??
        (sGross > sit.weightKg ? Math.round((sGross - sit.weightKg) * 10) / 10 : 0);
      const sNet =
        sTare > 0 ? Math.round((sGross - sTare) * 10) / 10 : Math.round(sit.weightKg * 10) / 10;
      const sRate =
        sit.ratePer20Kg ||
        billItems[sIdx]?.ratePer20Kg ||
        bill.items?.[0]?.ratePer20Kg ||
        0;
      const sAmt =
        sit.amount && sit.amount > 0 ? sit.amount : Math.round((sNet / 20) * sRate);
      return {
        id: `decomp_${sIdx}`,
        productId: `p_${sIdx}`,
        productName: sit.productName,
        productShortcut: '',
        weightKg: sNet,
        ratePer20Kg: sRate,
        amount: sAmt,
      };
    });
  } else if (billItems.length === 0) {
    billItems = [
      {
        id: 'item_1',
        productId: 'p_1',
        productName: slipItems[0]?.productName || 'માલ',
        productShortcut: '',
        weightKg: roundedNet,
        ratePer20Kg: slipItems[0]?.ratePer20Kg || 0,
        amount: slip.totalAmount || bill.finalTotal || 0,
      },
    ];
  }

  billItems.forEach((it, idx) => {
    // Header for first item
    if (idx === 0) {
      ctx.textAlign = 'left';
      ctx.font = 'bold 20px "Noto Sans Gujarati", Arial, sans-serif';
      ctx.fillText('માલ / વજન', margin, y);

      ctx.textAlign = 'center';
      ctx.fillText('ભાવ', width * 0.52, y);

      ctx.textAlign = 'right';
      ctx.fillText('રકમ', rightX, y);
      y += 8;

      // ⭐️ આડી લાઇન જે 'રકમ' માંથી નીકળે છે (રકમ ની નીચે અને રકમ ભાવ ની ઉપર)
      drawReceiptDivider(ctx, margin, y, rightX);
      y += 22;
    }

    // Product Name (with item line number)
    ctx.textAlign = 'left';
    ctx.font = 'bold 22px "Noto Sans Gujarati", Arial, sans-serif';
    ctx.fillText(`${idx + 1}. ${it.productName}`, margin, y);
    y += 26;

    // Weight, Rate, Amount
    ctx.textAlign = 'left';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`${it.weightKg} kg`, margin, y);

    ctx.textAlign = 'center';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`${it.ratePer20Kg}`, width * 0.52, y);

    ctx.textAlign = 'right';
    ctx.font = 'bold 24px monospace';
    ctx.fillText(`${Math.round(it.amount).toLocaleString('en-IN')}`, rightX, y);
    y += 30;

    if (idx < billItems.length - 1) {
      y += 6;
    }
  });

  drawReceiptDivider(ctx, margin, y, rightX);
  y += 36;

  // Final Total calculation
  const computedGrossAmount = billItems.reduce((acc, it) => acc + (it.amount || 0), 0);
  const discountVal = bill.discountLess || 0;
  const finalBillTotal =
    bill.finalTotal && bill.finalTotal > 0 && Math.abs(bill.finalTotal - computedGrossAmount) < 100
      ? bill.finalTotal
      : computedGrossAmount - discountVal;

  if (discountVal > 0) {
    ctx.textAlign = 'left';
    ctx.font = '600 20px "Noto Sans Gujarati", Arial, sans-serif';
    ctx.fillText('કુલ રકમ:', margin, y);
    ctx.textAlign = 'right';
    ctx.font = '600 22px monospace';
    ctx.fillText(`${Math.round(computedGrossAmount).toLocaleString('en-IN')}`, rightX, y);
    y += 24;

    ctx.textAlign = 'left';
    ctx.font = '600 20px "Noto Sans Gujarati", Arial, sans-serif';
    ctx.fillText('કપાત / લેસ:', margin, y);
    ctx.textAlign = 'right';
    ctx.font = '600 22px monospace';
    ctx.fillText(`-${Math.round(discountVal).toLocaleString('en-IN')}`, rightX, y);
    y += 24;
  }

  ctx.textAlign = 'left';
  ctx.font = 'bold 24px "Noto Sans Gujarati", Arial, sans-serif';
  ctx.fillText('ચોખ્ખી રકમ:', margin, y);

  ctx.textAlign = 'right';
  ctx.font = 'bold 32px monospace';
  ctx.fillText(`${Math.round(finalBillTotal).toLocaleString('en-IN')}`, rightX, y);
  y += 30;

  drawReceiptDivider(ctx, margin, y, rightX);
  y += 18;

  if (settings.footerNote) {
    ctx.textAlign = 'center';
    ctx.font = '600 20px "Noto Sans Gujarati", Arial, sans-serif';
    ctx.fillText(settings.footerNote, width / 2, y);
    y += 20;
  }

  // ⭐️ નીચે આભાર વાળા લખાણની નીચે બરાબર .5 cm (40px) ખાલી જગ્યા
  y += 40;
  const finalHeight = y;
  const trimmed = document.createElement('canvas');
  trimmed.width = width;
  trimmed.height = finalHeight;
  const tCtx = trimmed.getContext('2d');
  if (tCtx) {
    tCtx.fillStyle = '#FFFFFF';
    tCtx.fillRect(0, 0, width, finalHeight);
    tCtx.drawImage(canvas, 0, 0, width, finalHeight, 0, 0, width, finalHeight);
    return trimmed;
  }

  return canvas;
};

/**
 * Converts entire canvas into ONE continuous ESC/POS Raster stream (GS v 0).
 * Eliminates motor stuttering, eliminates intermediate buffer overflows,
 * and completely prevents garbage characters from dropped band headers.
 */
export const canvasToSingleEscPosRaster = (
  canvas: HTMLCanvasElement
): { header: Uint8Array; rasterBytes: Uint8Array; totalBytes: number } => {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { header: new Uint8Array(0), rasterBytes: new Uint8Array(0), totalBytes: 0 };
  }

  const imgData = ctx.getImageData(0, 0, width, height);
  const pixels = imgData.data;
  const widthBytes = Math.ceil(width / 8);
  const rasterBytes = new Uint8Array(widthBytes * height);

  // GS v 0 0 xL xH yL yH (8 bytes header)
  const header = new Uint8Array([
    0x1d, // GS
    0x76, // v
    0x30, // 0
    0x00, // mode 0 (normal)
    widthBytes & 0xff, // xL
    (widthBytes >> 8) & 0xff, // xH
    height & 0xff, // yL
    (height >> 8) & 0xff, // yH
  ]);

  let offset = 0;
  for (let y = 0; y < height; y++) {
    for (let xByte = 0; xByte < widthBytes; xByte++) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xByte * 8 + bit;
        if (x < width) {
          const idx = (y * width + x) * 4;
          const r = pixels[idx];
          const g = pixels[idx + 1];
          const b = pixels[idx + 2];
          // High contrast threshold for thermal paper
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum < 170) {
            byteVal |= 0x80 >> bit;
          }
        }
      }
      rasterBytes[offset++] = byteVal;
    }
  }

  return { header, rasterBytes, totalBytes: rasterBytes.length };
};

/**
 * Converts canvas into ESC/POS Raster Bands.
 * Generates rock-solid 24-line bitmap bands for thermal ESC/POS printers.
 */
export const canvasToEscPosRasterBands = (
  canvas: HTMLCanvasElement,
  bandHeight = 64
): Uint8Array[] => {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  const imgData = ctx.getImageData(0, 0, width, height);
  const pixels = imgData.data;
  const widthBytes = Math.ceil(width / 8);

  const bands: Uint8Array[] = [];

  for (let startY = 0; startY < height; startY += bandHeight) {
    const currentBandHeight = Math.min(bandHeight, height - startY);
    const rasterBytes = widthBytes * currentBandHeight;

    // Header: GS v 0 0 xL xH yL yH (8 bytes)
    const bandBuffer = new Uint8Array(8 + rasterBytes);
    bandBuffer[0] = 0x1d; // GS
    bandBuffer[1] = 0x76; // v
    bandBuffer[2] = 0x30; // 0
    bandBuffer[3] = 0x00; // mode 0 (normal)
    bandBuffer[4] = widthBytes & 0xff; // xL
    bandBuffer[5] = (widthBytes >> 8) & 0xff; // xH
    bandBuffer[6] = currentBandHeight & 0xff; // yL
    bandBuffer[7] = (currentBandHeight >> 8) & 0xff; // yH

    let offset = 8;
    for (let dy = 0; dy < currentBandHeight; dy++) {
      const y = startY + dy;
      for (let xByte = 0; xByte < widthBytes; xByte++) {
        let byteVal = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = xByte * 8 + bit;
          if (x < width) {
            const idx = (y * width + x) * 4;
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];
            // High contrast threshold for thermal paper
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            if (lum < 170) {
              byteVal |= 0x80 >> bit;
            }
          }
        }
        bandBuffer[offset++] = byteVal;
      }
    }
    bands.push(bandBuffer);
  }

  return bands;
};

/**
 * Legacy single-buffer raster generator for compatibility
 */
export const canvasToEscPosRaster = (canvas: HTMLCanvasElement): Uint8Array => {
  const bands = canvasToEscPosRasterBands(canvas, 24);
  let totalLength = 5; // ESC @ + ESC 3 0
  bands.forEach((b) => (totalLength += b.length));
  totalLength += 6; // ESC 2 + ESC d 4 + GS V 1

  const buffer = new Uint8Array(totalLength);
  let offset = 0;

  // ESC @ (init)
  buffer[offset++] = 0x1b;
  buffer[offset++] = 0x40;
  // ESC 3 0 (0 line space)
  buffer[offset++] = 0x1b;
  buffer[offset++] = 0x33;
  buffer[offset++] = 0x00;

  for (const band of bands) {
    buffer.set(band, offset);
    offset += band.length;
  }
  buffer[offset++] = 0x1b;
  buffer[offset++] = 0x32;
  buffer[offset++] = 0x1b;
  buffer[offset++] = 0x64;
  buffer[offset++] = 0x04;
  buffer[offset++] = 0x1d;
  buffer[offset++] = 0x56;
  buffer[offset++] = 0x01;
  return buffer;
};

// ============================================================================
// BLE TRANSMISSION DRIVER WITH DUAL-PRINT COOLDOWN & LOSSLESS PACKETING
// ============================================================================

/**
 * Sends a chunk of bytes to the Bluetooth printer characteristic.
 * Uses 96-byte slices with calibrated pacing so the printer's BLE RX FIFO
 * NEVER overflows and NEVER drops packets, completely preventing ASCII gibberish!
 */
async function sendBleChunk(char: any, chunk: Uint8Array, delayMs = 0) {
  let attempts = 0;
  const MTU_SLICE = 96; // 2 complete 48-byte dot lines per BLE packet
  while (true) {
    try {
      if (char.properties?.writeWithoutResponse && char.writeValueWithoutResponse) {
        for (let off = 0; off < chunk.length; off += MTU_SLICE) {
          const slice = chunk.subarray(off, Math.min(chunk.length, off + MTU_SLICE));
          await char.writeValueWithoutResponse(slice);
        }
        if (delayMs > 0) {
          await new Promise((res) => setTimeout(res, delayMs));
        }
        return;
      }
      if (char.writeValueWithResponse) {
        for (let off = 0; off < chunk.length; off += MTU_SLICE) {
          const slice = chunk.subarray(off, Math.min(chunk.length, off + MTU_SLICE));
          await char.writeValueWithResponse(slice);
        }
        return;
      } else if (char.writeValue) {
        for (let off = 0; off < chunk.length; off += MTU_SLICE) {
          const slice = chunk.subarray(off, Math.min(chunk.length, off + MTU_SLICE));
          await char.writeValue(slice);
        }
        return;
      }
      return;
    } catch (err: any) {
      attempts++;
      const msg = String(err?.message || '').toLowerCase();
      const isGattBusy =
        msg.includes('gatt operation already in progress') ||
        msg.includes('networkerror') ||
        err?.name === 'NetworkError';
      if (isGattBusy && attempts <= 6) {
        await new Promise((res) => setTimeout(res, attempts * 25));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Searches Bluetooth GATT Services for ESC/POS Write Characteristic
 */


async function findWriteCharacteristic(server: any): Promise<any> {
  try {
    const services = await server.getPrimaryServices();
    for (const service of services) {
      try {
        const chars = await service.getCharacteristics();
        for (const c of chars) {
          if (c.properties.writeWithoutResponse) return c;
        }
        for (const c of chars) {
          if (c.properties.write) return c;
        }
      } catch {}
    }
  } catch {}
  return null;
}

/**
 * Connects to device GATT with retries if GATT is temporarily busy
 */
async function safeGattConnect(device: any): Promise<any> {
  if (!device || !device.gatt) {
    throw new Error('બ્લૂટૂથ ડિવાઇસ મળ્યું નથી.');
  }
  if (device.gatt.connected) {
    return device.gatt;
  }
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const gatt = await device.gatt.connect();
      if (gatt && gatt.connected) {
        return gatt;
      }
    } catch (err: any) {
      lastErr = err;
      if (device.gatt?.connected) return device.gatt;
      if (attempt < 4) {
        await new Promise((res) => setTimeout(res, attempt * 250));
      }
    }
  }
  throw lastErr || new Error('પ્રિન્ટર સાથે બ્લૂટૂથ જોડાણ થઈ શક્યું નહીં.');
}

/**
 * Internal worker for ensuring printer connection
 */
async function ensureConnectedPrinterInternal(
  settings?: FirmSettings,
  onStatusUpdate?: (status: string) => void
): Promise<{ device: any; server: any; writeChar: any }> {
  const preferredName = (settings?.pairedPrinterName || getSavedPairedPrinterName() || 'PSF588').trim();
  const savedId = getSavedPairedDeviceId();

  // 1. FAST PATH: Already connected! Zero latency, zero prompts!
  if (
    activeBluetoothDevice &&
    activeGattServer &&
    activeGattServer.connected &&
    activeWriteCharacteristic
  ) {
    return {
      device: activeBluetoothDevice,
      server: activeGattServer,
      writeChar: activeWriteCharacteristic,
    };
  }

  const navBt = typeof navigator !== 'undefined' ? (navigator as any)?.bluetooth : null;

  // 2. RECONNECT PATH: We hold device in memory, just reconnect GATT
  if (activeBluetoothDevice && activeBluetoothDevice.gatt) {
    try {
      onStatusUpdate?.(`${activeBluetoothDevice.name || preferredName} સાથે કનેક્ટ થઈ રહ્યું છે...`);
      const server = await safeGattConnect(activeBluetoothDevice);
      activeGattServer = server;
      const writeChar = await findWriteCharacteristic(server);
      if (writeChar) {
        activeWriteCharacteristic = writeChar;
        bindDisconnectListener(activeBluetoothDevice);
        notifyStatusChange(true);
        return { device: activeBluetoothDevice, server, writeChar };
      }
    } catch (e) {
      console.warn('Memory device connect failed, falling back to getDevices...', e);
      activeGattServer = null;
      activeWriteCharacteristic = null;
    }
  }

  // 3. AUTO-PAIR PATH: Query navigator.bluetooth.getDevices()
  if (navBt?.getDevices) {
    try {
      const devices = await navBt.getDevices();
      if (devices && devices.length > 0) {
        hasPermittedDevicesCache = true;
        let match =
          (savedId && devices.find((d: any) => d.id === savedId)) ||
          (preferredName &&
            devices.find(
              (d: any) => d.name && d.name.toLowerCase().includes(preferredName.toLowerCase())
            )) ||
          (preferredName &&
            devices.find(
              (d: any) => d.name && preferredName.toLowerCase().includes(d.name.toLowerCase())
            )) ||
          devices.find(
            (d: any) =>
              d.name &&
              (d.name.toLowerCase().includes('psf') ||
                d.name.toLowerCase().includes('588') ||
                d.name.toLowerCase().includes('printer') ||
                d.name.toLowerCase().includes('pos') ||
                d.name.toLowerCase().includes('mpt') ||
                d.name.toLowerCase().includes('rpp'))
          ) ||
          devices[0];

        if (match && match.gatt) {
          onStatusUpdate?.(`${match.name || preferredName} સાથે ઑટો-કનેક્ટ થઈ રહ્યું છે...`);
          try {
            const server = await safeGattConnect(match);
            activeBluetoothDevice = match;
            activeGattServer = server;
            const writeChar = await findWriteCharacteristic(server);
            if (writeChar) {
              activeWriteCharacteristic = writeChar;
              bindDisconnectListener(match);
              if (match.name) setSavedPairedPrinterName(match.name);
              if (match.id) setSavedPairedDeviceId(match.id);
              notifyStatusChange(true);
              return { device: match, server, writeChar };
            }
          } catch (autoErr) {
            console.warn('getDevices auto-connect failed:', autoErr);
          }
        }
      }
    } catch (e) {
      console.warn('navBt.getDevices error:', e);
    }
  }

  // 4. FIRST TIME PAIR PATH: User needs to pair printer once in Chrome!
  if (!navBt) {
    throw new Error('તમારા બ્રાઉઝરમાં Web Bluetooth સપોર્ટ નથી. કૃપા કરીને Google Chrome વાપરો.');
  }

  onStatusUpdate?.(`પ્રિન્ટર શોધી રહ્યું છે (${preferredName} પસંદ કરો)...`);
  let device: any = null;
  try {
    device = await navBt.requestDevice({
      acceptAllDevices: true,
      optionalServices: PRINTER_SERVICES,
    });
  } catch (err: any) {
    if (err?.name === 'NotFoundError') {
      throw new Error('કોઈ પ્રિન્ટર પસંદ કરવામાં આવ્યું નથી.');
    }
    if (
      err?.name === 'SecurityError' ||
      String(err?.message || '').toLowerCase().includes('permissions policy') ||
      String(err?.message || '').toLowerCase().includes('disallowed')
    ) {
      throw new Error('IFRAME_PERMISSION_ERROR');
    }
    throw new Error(`બ્લૂટૂથ એરર: ${err?.message || err}`);
  }

  if (!device || !device.gatt) {
    throw new Error('બ્લૂટૂથ ડિવાઇસ મળ્યું નથી.');
  }

  activeBluetoothDevice = device;
  if (device.name) {
    setSavedPairedPrinterName(device.name);
  }
  if (device.id) {
    setSavedPairedDeviceId(device.id);
  }
  hasPermittedDevicesCache = true;
  onStatusUpdate?.(`${device.name || preferredName} સાથે કનેક્ટ થઈ રહ્યું છે...`);
  const server = await safeGattConnect(device);
  activeGattServer = server;
  const writeChar = await findWriteCharacteristic(server);
  if (!writeChar) {
    disconnectBluetoothPrinter(false);
    throw new Error('આ બ્લૂટૂથ ડિવાઇસમાં પ્રિન્ટ રાઇટ સર્વિસ મળી નથી.');
  }
  activeWriteCharacteristic = writeChar;
  bindDisconnectListener(device);
  notifyStatusChange(true);
  return { device, server, writeChar };
}

/**
 * Ensures Bluetooth printer is connected with intelligent Auto-Pair & deduplication
 */
export const ensureConnectedPrinter = async (
  settings?: FirmSettings,
  onStatusUpdate?: (status: string) => void
): Promise<{ device: any; server: any; writeChar: any }> => {
  if (!isWebBluetoothSupported()) {
    throw new Error('તમારા બ્રાઉઝરમાં Web Bluetooth સપોર્ટ નથી. કૃપા કરીને Google Chrome વાપરો.');
  }

  if (
    activeBluetoothDevice &&
    activeGattServer &&
    activeGattServer.connected &&
    activeWriteCharacteristic
  ) {
    return {
      device: activeBluetoothDevice,
      server: activeGattServer,
      writeChar: activeWriteCharacteristic,
    };
  }

  if (pendingConnectPromise) {
    return pendingConnectPromise;
  }

  pendingConnectPromise = runWithBleLock(async () => {
    isConnecting = true;
    try {
      return await ensureConnectedPrinterInternal(settings, onStatusUpdate);
    } finally {
      isConnecting = false;
      pendingConnectPromise = null;
    }
  });

  return pendingConnectPromise;
};

export interface BluetoothPrintResult {
  success: boolean;
  message?: string;
}

/**
 * Core Canvas Printing Routine over Bluetooth LE:
 * Uses Single GS v 0 Stream + Paced 96-byte Packets to guarantee:
 * - 100% Crisp Gujarati Text without gibberish or corrupted ASCII
 * - Smooth continuous motor glide without stuttering
 * - Consecutive multi-print safety with 500ms inter-job motor clearing
 */
export const printCanvasViaBluetooth = async (
  canvas: HTMLCanvasElement,
  settings: FirmSettings,
  onStatusUpdate?: (status: string) => void
): Promise<BluetoothPrintResult> => {
  // Native Android APK bypass (if present)
  const nativeAndroid =
    (typeof window !== 'undefined' && (window as any).AndroidPrinter) ||
    (typeof window !== 'undefined' && (window as any).AndroidBridge) ||
    (typeof window !== 'undefined' && (window as any).Android);
  if (nativeAndroid && typeof nativeAndroid.print === 'function') {
    try {
      onStatusUpdate?.('Android પ્રિન્ટર દ્વારા પ્રિન્ટ મોકલાઈ રહી છે...');
      const dataUrl = canvas.toDataURL('image/png');
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      nativeAndroid.print(base64Data);
      return {
        success: true,
        message: 'Android APK દ્વારા સીધી જ પ્રિન્ટ મોકલાઈ ગઈ!',
      };
    } catch (e: any) {
      console.warn('Native Android print failed, falling back to Web Bluetooth:', e);
    }
  }

  if (!isWebBluetoothSupported()) {
    throw new Error('તમારા બ્રાઉઝરમાં Web Bluetooth સપોર્ટ નથી. કૃપા કરીને Google Chrome વાપરો.');
  }

  activePrintQueueCount++;
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }

  return runWithBleLock(async () => {
    isPrinting = true;
    stopHeartbeat();

    try {
      const { device, writeChar } = await ensureConnectedPrinterInternal(settings, onStatusUpdate);
      onStatusUpdate?.('પ્રિન્ટ તૈયાર થઈ રહી છે...');

      if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
        try {
          await (document as any).fonts.ready;
        } catch {}
      }

      // Convert canvas to ONE single continuous ESC/POS raster stream (GS v 0)
      // Completely eliminates multiple band headers, stops motor stuttering,
      // and guarantees zero ASCII corruption or shifted bytes!
      const { header, rasterBytes } = canvasToSingleEscPosRaster(canvas);
      onStatusUpdate?.('પ્રિન્ટ થઈ રહી છે...');

      // 1. Non-destructive Buffer Clear:
      // CAN (0x18) clears any partial line buffer without triggering EEPROM microcontroller reset (ESC @)
      // This ensures consecutive prints NEVER lock up or crash the printer!
      const initCmd = new Uint8Array([0x18]);
      await sendBleChunk(writeChar, initCmd, 10);
      await new Promise((res) => setTimeout(res, 10));

      // 2. Send single GS v 0 raster header (8 bytes):
      await sendBleChunk(writeChar, header, 8);
      await new Promise((res) => setTimeout(res, 8));

      // 3. Continuous Butter-Smooth Paper Glide (Zero Stutter, Preroll Buffer):
      // A) Hardware Buffer Preroll:
      // We first fill the printer's 4KB FIFO with ~1,152 bytes (24 dot-lines) with 0 delay.
      // This primes the motor with a safety cushion before the burning cycle begins.
      const PREROLL_BYTES = Math.min(rasterBytes.length, 1152);
      if (PREROLL_BYTES > 0) {
        const prerollChunk = rasterBytes.subarray(0, PREROLL_BYTES);
        await sendBleChunk(writeChar, prerollChunk, 0);
      }

      // B) Continuous Flow with 7ms Pacing:
      // We stream the remaining raster in 384-byte batches (8 dot-lines).
      // A tight 7ms pacing keeps the printer's hardware FIFO 25-50% full at all times.
      // Because the FIFO never runs dry, the stepper motor never pauses or stutters!
      // The receipt hums out in ONE single, seamless, continuous glide!
      const BATCH_BYTES = 384;
      for (let i = PREROLL_BYTES; i < rasterBytes.length; i += BATCH_BYTES) {
        const batch = rasterBytes.subarray(i, Math.min(rasterBytes.length, i + BATCH_BYTES));
        await sendBleChunk(writeChar, batch, 7);
      }

      // 4. Post-print Paper Feed & Motor Flush:
      // ESC d n feeds lines cleanly, LF (0x0A) flushes motor buffer.
      // We NEVER send ESC @ between prints so consecutive prints NEVER freeze!
      const feedCount = Math.max(1, Math.min(settings.paperFeedLines ?? 1, 3));
      const endCmd = new Uint8Array([0x1b, 0x64, feedCount, 0x0a]);
      await sendBleChunk(writeChar, endCmd, 10.0);

      onStatusUpdate?.('કાગળ બહાર આવી રહ્યો છે...');

      // ⭐️ Inter-Print Hardware Cooldown:
      // Wait 500ms for the physical motor to complete paper movement before releasing the lock
      // for the next queued print job. This guarantees Print 1 and Print 2 never collide!
      await new Promise((res) => setTimeout(res, 500));

      const shouldKeepConnected = settings.keepBluetoothConnected !== false;
      const hasPendingQueue = activePrintQueueCount > 1;

      if (shouldKeepConnected || hasPendingQueue) {
        onStatusUpdate?.(`✅ પ્રિન્ટ સફળ! ${device?.name || 'PSF588'} સાથે કનેક્શન ચાલુ છે.`);
        startHeartbeat();
        return {
          success: true,
          message: 'પ્રિન્ટ સફળતાપૂર્વક પૂર્ણ થઈ અને પ્રિન્ટર તૈયાર છે!',
        };
      } else {
        if (disconnectTimer) {
          clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
        disconnectTimer = setTimeout(() => {
          if (activePrintQueueCount <= 0 && !isPrinting) {
            disconnectBluetoothPrinter(true);
          }
        }, 2000);

        onStatusUpdate?.('✅ પ્રિન્ટ સફળતાપૂર્વક પૂર્ણ થઈ!');
        return {
          success: true,
          message: 'પ્રિન્ટ સફળતાપૂર્વક પૂર્ણ થઈ!',
        };
      }
    } catch (err: any) {
      activeGattServer = null;
      activeWriteCharacteristic = null;
      throw err;
    } finally {
      activePrintQueueCount = Math.max(0, activePrintQueueCount - 1);
      isPrinting = false;
      if (settings.keepBluetoothConnected !== false) {
        startHeartbeat();
      }
    }
  });
};

/**
 * Connects to Bluetooth Thermal Printer (with Auto-Pair & Persistent Connection),
 * prints receipt using fast banded raster chunks, and maintains connection for instant subsequent prints!
 */
export const printReceiptViaBluetooth = async (
  bill: VoucherBill,
  settings: FirmSettings,
  onStatusUpdate?: (status: string) => void
): Promise<BluetoothPrintResult> => {
  if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
    try {
      await (document as any).fonts.ready;
    } catch {}
  }
  const canvas = renderReceiptToCanvas(bill, settings);
  return printCanvasViaBluetooth(canvas, settings, onStatusUpdate);
};

/**
 * Directly prints a Weight Slip (કાંટા વજન પત્રક) with bag-by-bag weights to Bluetooth printer
 */
export const printWeighmentViaBluetooth = async (
  slip: WeighmentSlipData,
  settings: FirmSettings,
  onStatusUpdate?: (status: string) => void
): Promise<BluetoothPrintResult> => {
  if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
    try {
      await (document as any).fonts.ready;
    } catch {}
  }
  const canvas = renderWeighmentToCanvas(slip, settings);
  return printCanvasViaBluetooth(canvas, settings, onStatusUpdate);
};

/**
 * Directly prints a Combined Slip (કાંટા વજન પત્રક + વાઉચર બિલ) to Bluetooth printer
 */
export const printCombinedViaBluetooth = async (
  bill: VoucherBill,
  slip: WeighmentSlipData,
  settings: FirmSettings,
  onStatusUpdate?: (status: string) => void
): Promise<BluetoothPrintResult> => {
  if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
    try {
      await (document as any).fonts.ready;
    } catch {}
  }
  const canvas = renderCombinedReceiptToCanvas(bill, slip, settings);
  return printCanvasViaBluetooth(canvas, settings, onStatusUpdate);
};

/**
 * User-initiated pairing specifically to set up printer permanently (1 time pair)
 */
export const pairOrConnectPrinter = async (
  preferredName: string = 'PSF588',
  forcePicker: boolean = false,
  onStatusUpdate?: (status: string) => void
): Promise<{ success: boolean; deviceName: string; deviceId?: string }> => {
  if (!isWebBluetoothSupported()) {
    throw new Error('તમારા બ્રાઉઝરમાં Web Bluetooth સપોર્ટ નથી. કૃપા કરીને Google Chrome વાપરો.');
  }

  const targetName = (preferredName || getSavedPairedPrinterName() || 'PSF588').trim();
  const savedId = getSavedPairedDeviceId();
  const navBt = typeof navigator !== 'undefined' ? (navigator as any)?.bluetooth : null;

  let device: any = null;
  if (!forcePicker && navBt?.getDevices) {
    try {
      const paired = await navBt.getDevices();
      if (paired && paired.length > 0) {
        const match =
          (savedId && paired.find((d: any) => d.id === savedId)) ||
          paired.find((d: any) => d.name && d.name.toLowerCase().includes(targetName.toLowerCase())) ||
          paired.find((d: any) => d.name && targetName.toLowerCase().includes(d.name.toLowerCase())) ||
          paired[0];
        if (match) {
          device = match;
        }
      }
    } catch {}
  }

  if (!device) {
    onStatusUpdate?.(`પ્રિન્ટર લિસ્ટમાંથી ${targetName} પસંદ કરો...`);
    device = await navBt.requestDevice({
      acceptAllDevices: true,
      optionalServices: PRINTER_SERVICES,
    });
  }

  activeBluetoothDevice = device;
  if (device.name) {
    setSavedPairedPrinterName(device.name);
  }
  if (device.id) {
    setSavedPairedDeviceId(device.id);
  }
  hasPermittedDevicesCache = true;

  onStatusUpdate?.(`${device.name || targetName} સાથે ચકાસણી થઈ રહી છે...`);
  const server = await safeGattConnect(device);
  activeGattServer = server;
  const writeChar = await findWriteCharacteristic(server);
  if (!writeChar) {
    disconnectBluetoothPrinter(false);
    throw new Error('આ પ્રિન્ટરમાં ESC/POS રાઇટ સર્વિસ મળી નથી.');
  }

  activeWriteCharacteristic = writeChar;
  bindDisconnectListener(device);
  notifyStatusChange(true);

  // Keep persistent connection by default
  onStatusUpdate?.(`✅ ${device.name || targetName} કાયમ માટે સેટ થઈ ગયું!`);
  return {
    success: true,
    deviceName: device.name || targetName,
    deviceId: device.id,
  };
};

/**
 * Sends a quick test receipt to PSF588 to verify setup
 */
export const printTestSlipViaBluetooth = async (
  settings: FirmSettings,
  onStatusUpdate?: (status: string) => void
): Promise<boolean> => {
  const testBill: VoucherBill = {
    id: `test_${Date.now()}`,
    billNo: 0,
    billNoStr: '#TEST',
    date: new Date().toISOString().split('T')[0],
    time: new Date().toLocaleTimeString('gu-IN', { hour: '2-digit', minute: '2-digit' }),
    session: 'M',
    customerName: 'ટેસ્ટ પ્રિન્ટ (PSF588 પેરિંગ)',
    items: [
      {
        id: 'test_item_1',
        productId: 'p_test',
        productName: 'PSF588 બ્લૂટૂથ પેરિંગ સફળ',
        productShortcut: 't',
        weightKg: 20,
        ratePer20Kg: 500,
        amount: 500,
      },
    ],
    totalWeightKg: 20,
    totalWeightMan: 1,
    grossAmount: 500,
    discountLess: 0,
    finalTotal: 500,
    createdAt: Date.now(),
  };

  const res = await printReceiptViaBluetooth(testBill, settings, onStatusUpdate);
  return res.success;
};
