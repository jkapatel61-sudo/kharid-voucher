import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { VoucherBill, Product, FirmSettings, PrintJob, WeighmentSlipData } from '../types';
import { normalizeBillRecord } from './storage';
import { formatBackupDateTime, setStoredLastBackupTime } from './googleDrive';

// Initialize Firebase App
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Initialize Firestore with robust offline persistence & connection resilience
function initDb() {
  const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
  try {
    return initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
        experimentalAutoDetectLongPolling: true,
      },
      dbId
    );
  } catch (e1) {
    try {
      return initializeFirestore(
        app,
        {
          localCache: memoryLocalCache(),
          experimentalAutoDetectLongPolling: true,
        },
        dbId
      );
    } catch (e2) {
      return getFirestore(app, dbId);
    }
  }
}

export const db = initDb();

// Collections
export const BILLS_COLLECTION = 'mandi_bills';
export const WEIGHMENTS_COLLECTION = 'kanta_weighments';
export const PRODUCTS_COLLECTION = 'mandi_products';
export const PRINT_JOBS_COLLECTION = 'mandi_print_jobs';
export const SETTINGS_DOC = 'mandi_settings/global';

// Local Storage Cache for instant offline launch & zero-latency UI
const WEIGHMENTS_STORAGE_KEY = 'kanta_weighments_cache_v1';

function getStoredWeighmentsCache(): KantaWeighment[] {
  try {
    const raw = localStorage.getItem(WEIGHMENTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

function saveStoredWeighmentsCache(items: KantaWeighment[]) {
  try {
    localStorage.setItem(WEIGHMENTS_STORAGE_KEY, JSON.stringify(items));
  } catch (e) {}
}

let latestWeighmentsCache: KantaWeighment[] = getStoredWeighmentsCache();

export function getLatestWeighmentsCache(): KantaWeighment[] {
  return latestWeighmentsCache;
}

// Item detail when multiple products are weighed in a single slip (e.g. 1-10 Bajri, 11-20 Wheat)
export interface KantaItemDetail {
  productId: string;
  productName: string;
  ratePer20Kg: number;
  bags: number[];
  grossWeightKg: number;
  tareWeightKg?: number;
  netWeightKg: number;
  calculatedAmount: number;
}

// Weighment Entry Model for the weighing bridge / kanta outside
export interface KantaWeighment {
  id: string;
  tokenNo?: number; // ટોકન નંબર
  date: string; // YYYY-MM-DD
  time: string; // HH:mm AM/PM
  customerName: string; // ખેડૂતનું નામ
  productId: string; // માલ આઇડી
  productName: string; // માલનું નામ (બાજરી, ઘઉં, વગેરે)
  ratePer20Kg: number; // ૨૦ કિલો દીઠ ભાવ
  bags: number[]; // દરેક થેલીનું વજન [50, 48.5, 52...]
  totalWeightKg: number; // કુલ વજન
  totalBagsCount: number; // કુલ થેલીઓ
  tareWeightKg?: number; // કપાત વજન
  calculatedAmount: number; // (કુલ વજન / 20) * ભાવ
  status: 'pending' | 'billed' | 'cancelled'; // 'pending' = અંદર ઓફિસમાં બિલ બનવાનું બાકી, 'billed' = બિલ બની ગયું
  billId?: string; // જોડાયેલા બિલનો આઈડી
  billNoStr?: string; // જોડાયેલા બિલનો નંબર (દા.ત. #A1, M1)
  createdAt: number;
  destination?: 'standard' | 'vado'; // 'vado' = વાડામાં સેવ કરેલ માલ
  isVado?: boolean; // શું વાડામાં સેવ કર્યું છે
  items?: KantaItemDetail[]; // બહુવિધ માલ (દા.ત. થેલી ૧-૧૦ બાજરી અને ૧૧-૨૦ ઘઉં)
}

/**
 * Real-time listener for Bills from Firestore
 */
export function subscribeToBills(
  onUpdate: (bills: VoucherBill[]) => void,
  onError?: (err: any) => void
) {
  const q = query(
    collection(db, BILLS_COLLECTION),
    orderBy('createdAt', 'desc'),
    limit(300)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: VoucherBill[] = [];
      snapshot.forEach((d) => {
        const raw = d.data() as VoucherBill;
        items.push(normalizeBillRecord(raw));
      });
      onUpdate(items);
    },
    (err) => {
      if (err?.code === 'unavailable') {
        console.info('Firestore bills running in offline mode (local cache active)');
      } else {
        console.warn('Firestore bills subscription notice:', err?.message || err);
      }
      if (onError) onError(err);
    }
  );
}

/**
 * Real-time listener for Kanta Weighments
 */
export function subscribeToWeighments(
  onUpdate: (weighments: KantaWeighment[]) => void,
  onError?: (err: any) => void
) {
  // Emit local cache immediately so UI is instantaneous and resilient to network delays
  if (latestWeighmentsCache.length > 0) {
    onUpdate(latestWeighmentsCache);
  }

  const q = query(
    collection(db, WEIGHMENTS_COLLECTION),
    orderBy('createdAt', 'desc'),
    limit(150)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: KantaWeighment[] = [];
      snapshot.forEach((d) => {
        items.push(d.data() as KantaWeighment);
      });
      latestWeighmentsCache = items;
      saveStoredWeighmentsCache(items);
      onUpdate(items);
    },
    (err) => {
      if (err?.code === 'unavailable') {
        console.info('Firestore weighments running in offline mode (local cache active)');
      } else {
        console.warn('Firestore weighments subscription notice:', err?.message || err);
      }
      if (onError) onError(err);
    }
  );
}

/**
 * Recursively removes any undefined values from objects or arrays
 * to prevent Firestore "Function setDoc() called with invalid data. Unsupported field value: undefined" errors.
 */
function cleanFirestoreData<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => cleanFirestoreData(item)) as unknown as T;
  }
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = cleanFirestoreData(value);
      }
    }
    return cleaned as T;
  }
  return obj;
}

/**
 * Save / Update a Bill to Firestore
 */
export async function syncBillToCloud(bill: VoucherBill) {
  try {
    const billRef = doc(db, BILLS_COLLECTION, bill.id);
    const cleaned = cleanFirestoreData(bill);
    await setDoc(billRef, cleaned, { merge: true });
  } catch (err: any) {
    if (err?.code === 'unavailable') {
      console.info('Bill synced to local offline cache; will push when back online.');
    } else {
      console.warn('Cloud bill sync notice:', err?.message || err);
    }
  }
}

/**
 * Delete a Bill from Firestore
 */
export async function deleteBillFromCloud(billId: string) {
  try {
    const billRef = doc(db, BILLS_COLLECTION, billId);
    await deleteDoc(billRef);
  } catch (err: any) {
    if (err?.code === 'unavailable') {
      console.info('Bill deleted in local offline cache; will push when back online.');
    } else {
      console.warn('Cloud bill delete notice:', err?.message || err);
    }
  }
}

/**
 * Save / Update a Kanta Weighment
 */
export async function saveKantaWeighmentToCloud(weighment: KantaWeighment) {
  // Update local memory & storage cache immediately
  const existingIdx = latestWeighmentsCache.findIndex((w) => w.id === weighment.id);
  if (existingIdx >= 0) {
    latestWeighmentsCache[existingIdx] = weighment;
  } else {
    latestWeighmentsCache = [weighment, ...latestWeighmentsCache];
  }
  saveStoredWeighmentsCache(latestWeighmentsCache);

  try {
    const ref = doc(db, WEIGHMENTS_COLLECTION, weighment.id);
    const cleaned = cleanFirestoreData(weighment);
    await setDoc(ref, cleaned, { merge: true });
  } catch (err: any) {
    // If offline / unavailable, Firestore local cache still holds the write and syncs later
    if (err?.code === 'unavailable') {
      console.info('Kanta weighment saved to offline cache, will upload when online.');
      return;
    }
    console.error('Cloud save weighment error:', err);
    throw err;
  }
}

/**
 * Update Weighment status (e.g. mark as billed)
 */
export async function updateWeighmentStatus(
  weighmentId: string,
  status: 'pending' | 'billed' | 'cancelled',
  billId?: string,
  billNoStr?: string
) {
  // Update local cache immediately
  const existing = latestWeighmentsCache.find((w) => w.id === weighmentId);
  if (existing) {
    existing.status = status;
    if (billId) existing.billId = billId;
    if (billNoStr) existing.billNoStr = billNoStr;
    saveStoredWeighmentsCache(latestWeighmentsCache);
  }

  try {
    const ref = doc(db, WEIGHMENTS_COLLECTION, weighmentId);
    const payload: Record<string, any> = { status };
    if (billId) {
      payload.billId = billId;
    }
    if (billNoStr) {
      payload.billNoStr = billNoStr;
    }
    await setDoc(ref, payload, { merge: true });
  } catch (err: any) {
    if (err?.code === 'unavailable') {
      console.info('Status updated in local offline cache.');
    } else {
      console.warn('Update weighment status notice:', err?.message || err);
    }
  }
}

/**
 * Delete a Weighment
 */
export async function deleteWeighmentFromCloud(weighmentId: string) {
  latestWeighmentsCache = latestWeighmentsCache.filter((w) => w.id !== weighmentId);
  saveStoredWeighmentsCache(latestWeighmentsCache);

  try {
    const ref = doc(db, WEIGHMENTS_COLLECTION, weighmentId);
    await deleteDoc(ref);
  } catch (err: any) {
    if (err?.code === 'unavailable') {
      console.info('Weighment deleted in local offline cache.');
    } else {
      console.warn('Delete weighment notice:', err?.message || err);
    }
  }
}

/**
 * Enqueues a new print job to the Cloud print queue (mandi_print_jobs)
 * so that any office mobile connected to Bluetooth printer can print it automatically!
 */
export async function enqueuePrintJob(params: {
  type: 'bill' | 'kanta_weighment' | 'combined';
  billId?: string;
  bill?: VoucherBill;
  slip?: WeighmentSlipData;
  title: string;
  sourceDevice?: string;
}): Promise<string> {
  try {
    const id = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const job: PrintJob = {
      id,
      type: params.type,
      billId: params.billId || params.bill?.id,
      bill: params.bill,
      slip: params.slip,
      title: params.title,
      status: 'pending',
      sourceDevice: params.sourceDevice || 'અન્ય મોબાઈલ (યાર્ડ/ઓનલાઇન)',
      createdAt: Date.now(),
    };

    const ref = doc(db, PRINT_JOBS_COLLECTION, id);
    const cleaned = cleanFirestoreData(job);
    await setDoc(ref, cleaned);
    console.log('Enqueued cloud print job:', id, job.title);
    return id;
  } catch (err) {
    console.error('Failed to enqueue cloud print job:', err);
    throw err;
  }
}

/**
 * Update the status of a Print Job (e.g. 'printing', 'completed', 'failed')
 */
export async function updatePrintJobStatus(
  jobId: string,
  status: 'pending' | 'printing' | 'completed' | 'failed',
  errorMessage?: string
): Promise<void> {
  try {
    const ref = doc(db, PRINT_JOBS_COLLECTION, jobId);
    const payload: Record<string, any> = {
      status,
      ...(status === 'completed' ? { completedAt: Date.now() } : {}),
      ...(errorMessage ? { errorMessage } : {}),
    };
    await setDoc(ref, cleanFirestoreData(payload), { merge: true });
  } catch (err) {
    console.warn('Failed to update print job status:', err);
  }
}

/**
 * Subscribe to recent print jobs (for live activity list and status monitoring)
 */
export function subscribeToPrintJobs(
  onUpdate: (jobs: PrintJob[]) => void,
  onError?: (err: any) => void
) {
  const q = query(
    collection(db, PRINT_JOBS_COLLECTION),
    orderBy('createdAt', 'desc'),
    limit(50)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: PrintJob[] = [];
      snapshot.forEach((d) => {
        items.push(d.data() as PrintJob);
      });
      onUpdate(items);
    },
    (err) => {
      if (err?.code === 'unavailable') {
        console.info('Firestore print jobs running in offline mode (local cache active)');
      } else {
        console.warn('Firestore print jobs subscription notice:', err?.message || err);
      }
      if (onError) onError(err);
    }
  );
}

/**
 * Delete a print job from cloud
 */
export async function deletePrintJobFromCloud(jobId: string): Promise<void> {
  try {
    const ref = doc(db, PRINT_JOBS_COLLECTION, jobId);
    await deleteDoc(ref);
  } catch (err) {
    console.warn('Failed to delete print job:', err);
  }
}

/**
 * ---------------------------------------------------------------------------
 * AUTOMATED DAILY CLOUD BACKUP (Firebase Firestore Snapshots)
 * ---------------------------------------------------------------------------
 * Completely automated, runs 24/7 without requiring OAuth tokens or user clicks.
 * Stores a full daily snapshot of bills, products, and settings.
 */
export const DAILY_BACKUPS_COLLECTION = 'mandi_daily_backups';

export interface DailyBackupSnapshot {
  dateStr: string; // YYYY-MM-DD
  timestamp: number;
  formattedTime: string; // e.g. "20/09/26 (12:45 PM)"
  billsCount: number;
  productsCount: number;
  bills: VoucherBill[];
  products: Product[];
  settings: FirmSettings;
}

/**
 * Perform a full snapshot backup to Firebase Cloud.
 */
export async function performDailyCloudBackup(
  bills: VoucherBill[],
  products: Product[],
  settings: FirmSettings
): Promise<string> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const nowFormatted = formatBackupDateTime(new Date());
    const ref = doc(db, DAILY_BACKUPS_COLLECTION, today);

    const snapshot: DailyBackupSnapshot = {
      dateStr: today,
      timestamp: Date.now(),
      formattedTime: nowFormatted,
      billsCount: bills.length,
      productsCount: products.length,
      bills,
      products,
      settings,
    };

    await setDoc(ref, cleanFirestoreData(snapshot));
    setStoredLastBackupTime(nowFormatted);
    try {
      localStorage.setItem('kaleshwari_last_cloud_backup_time', nowFormatted);
      localStorage.setItem('kaleshwari_last_daily_backup_date', today);
    } catch {}
    return nowFormatted;
  } catch (err) {
    console.warn('Failed to perform daily cloud backup:', err);
    throw err;
  }
}

/**
 * Fetch the latest automated daily backup from Firebase Cloud.
 */
export async function fetchLatestDailyCloudBackup(): Promise<DailyBackupSnapshot | null> {
  try {
    const q = query(
      collection(db, DAILY_BACKUPS_COLLECTION),
      orderBy('timestamp', 'desc'),
      limit(1)
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      return snapshot.docs[0].data() as DailyBackupSnapshot;
    }
  } catch (err) {
    console.warn('Failed to fetch latest daily cloud backup:', err);
  }
  return null;
}

