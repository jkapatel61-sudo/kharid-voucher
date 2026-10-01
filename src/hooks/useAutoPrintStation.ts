import { useEffect, useRef, useState, useCallback } from 'react';
import { FirmSettings, PrintJob, VoucherBill } from '../types';
import {
  subscribeToPrintJobs,
  updatePrintJobStatus,
  enqueuePrintJob,
  deletePrintJobFromCloud,
} from '../utils/firebaseSync';
import {
  isBluetoothConnected,
  isPrinterConfiguredOrPermitted,
  subscribeBluetoothStatus,
  requestWakeLock,
  releaseWakeLock,
  attemptSilentReconnect,
  pairOrConnectPrinter,
  getActiveBluetoothDeviceName,
  isWebBluetoothSupported,
} from '../utils/bluetoothPrinter';
import {
  printReceiptDirectly,
  wasItemRecentlyPrinted,
  clearItemPrintedRecord,
} from '../utils/directPrint';
import { playPrintJobChime, playPrintSuccessChime } from '../utils/sound';

export function useAutoPrintStation(
  settings: FirmSettings,
  onSaveSettings: (settings: FirmSettings) => void
) {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [isBtConnected, setIsBtConnected] = useState<boolean>(isBluetoothConnected);
  const [btDeviceName, setBtDeviceName] = useState<string>(getActiveBluetoothDeviceName);
  const [currentProcessingJob, setCurrentProcessingJob] = useState<PrintJob | null>(null);
  const [stationToast, setStationToast] = useState<{ text: string; isError?: boolean } | null>(null);
  const isProcessingRef = useRef<boolean>(false);
  const processedJobIdsRef = useRef<Set<string>>(new Set());

  // Subscribe to Bluetooth connection status
  useEffect(() => {
    const unsub = subscribeBluetoothStatus((connected, name) => {
      setIsBtConnected(connected);
      setBtDeviceName(name || settings.pairedPrinterName || 'PSF588');
    });
    return () => unsub();
  }, [settings.pairedPrinterName]);

  // When Station mode is active, keep the screen awake and attempt printer reconnect if needed
  useEffect(() => {
    if (settings.isAutoPrintStation) {
      if (settings.keepScreenAwakeInStation !== false) {
        requestWakeLock();
      }
      if (!isBluetoothConnected()) {
        attemptSilentReconnect().catch(() => {});
      }
    } else {
      releaseWakeLock();
    }
  }, [settings.isAutoPrintStation, settings.keepScreenAwakeInStation]);

  // Subscribe to cloud print jobs
  useEffect(() => {
    const unsub = subscribeToPrintJobs((cloudJobs) => {
      setJobs(cloudJobs);
    });
    return () => unsub();
  }, []);

  // Process pending jobs sequentially in the background whenever Bluetooth is connected, paired, or station mode is enabled
  const processNextJob = useCallback(async () => {
    const isStationOrHasPrinter =
      settings.isAutoPrintStation ||
      isBluetoothConnected() ||
      isPrinterConfiguredOrPermitted();

    if (!isStationOrHasPrinter) return;
    if (isProcessingRef.current) return;

    // Find first pending job that we haven't already processed in this session
    const pendingJob = jobs.find(
      (j) => j.status === 'pending' && !processedJobIdsRef.current.has(j.id)
    );

    if (!pendingJob) return;

    // Ignore jobs older than 15 minutes to prevent stale reprinting
    if (pendingJob.createdAt && Date.now() - pendingJob.createdAt > 15 * 60 * 1000) {
      processedJobIdsRef.current.add(pendingJob.id);
      updatePrintJobStatus(pendingJob.id, 'completed');
      return;
    }

    // If this bill was already printed locally within the last 20 seconds, skip duplicate
    if (pendingJob.bill?.id && wasItemRecentlyPrinted(pendingJob.bill.id)) {
      console.log(`[useAutoPrintStation] Bill ${pendingJob.bill.id} was already printed locally, skipping duplicate.`);
      processedJobIdsRef.current.add(pendingJob.id);
      updatePrintJobStatus(pendingJob.id, 'completed');
      return;
    }

    isProcessingRef.current = true;
    processedJobIdsRef.current.add(pendingJob.id);
    setCurrentProcessingJob(pendingJob);

    try {
      // 1. Update status to 'printing'
      await updatePrintJobStatus(pendingJob.id, 'printing');

      // 2. Play audible Ding-Dong notification if enabled
      if (settings.playChimeOnAutoPrint !== false) {
        playPrintJobChime();
      }

      setStationToast({
        text: `🖨️ ઑટો-પ્રિન્ટ થઈ રહ્યું છે: ${pendingJob.title}`,
      });

      // 3. Print the bill or slip
      if (pendingJob.bill) {
        await printReceiptDirectly(pendingJob.bill, settings, (statusMsg) => {
          setStationToast({ text: `🖨️ ${statusMsg}` });
        });
      } else {
        throw new Error('બિલનો ડેટા મળ્યો નથી');
      }

      // 4. Mark job as completed
      await updatePrintJobStatus(pendingJob.id, 'completed');
      if (settings.playChimeOnAutoPrint !== false) {
        playPrintSuccessChime();
      }

      setStationToast({
        text: `✅ ઑટો-પ્રિન્ટ સફળ: ${pendingJob.title}`,
      });
      setTimeout(() => setStationToast(null), 4000);
    } catch (err: any) {
      console.error('Auto-print station job failed:', err);
      const errMsg = err?.message || 'પ્રિન્ટર એરર';
      await updatePrintJobStatus(pendingJob.id, 'failed', errMsg);

      setStationToast({
        text: `⚠️ ઑટો-પ્રિન્ટ નિષ્ફળ (${pendingJob.title}): ${errMsg}`,
        isError: true,
      });
      setTimeout(() => setStationToast(null), 6000);
    } finally {
      isProcessingRef.current = false;
      setCurrentProcessingJob(null);
    }
  }, [jobs, settings]);

  useEffect(() => {
    if (settings.isAutoPrintStation || isBluetoothConnected()) {
      processNextJob();
    }
  }, [jobs, settings.isAutoPrintStation, isBtConnected, processNextJob]);

  // Connect printer handler
  const handleConnectPrinter = async () => {
    try {
      setStationToast({ text: 'પ્રિન્ટર સાથે જોડાણ થઈ રહ્યું છે...' });
      const res = await pairOrConnectPrinter(
        settings.pairedPrinterName || 'PSF588',
        false,
        (msg) => setStationToast({ text: msg })
      );
      if (res.success) {
        setIsBtConnected(true);
        setStationToast({ text: `✅ પ્રિન્ટર ${res.deviceName} સફળતાપૂર્વક જોડાયું!` });
        setTimeout(() => setStationToast(null), 3000);
      }
    } catch (err: any) {
      const isUserCancel =
        err?.name === 'NotFoundError' ||
        err?.message?.includes('User cancelled') ||
        err?.message?.includes('કોઈ પ્રિન્ટર પસંદ કરવામાં આવ્યું નથી');
      if (!isUserCancel) {
        setStationToast({
          text: `જોડાણ નિષ્ફળ: ${err?.message || 'પ્રિન્ટર ચાલુ છે કે નહીં તે ચકાસો'}`,
          isError: true,
        });
        setTimeout(() => setStationToast(null), 4500);
      } else {
        setStationToast(null);
      }
    }
  };

  // Toggle station mode
  const handleToggleStationMode = (enabled: boolean) => {
    const updated = {
      ...settings,
      isAutoPrintStation: enabled,
    };
    onSaveSettings(updated);
    if (enabled) {
      setStationToast({
        text: '🟢 ઓફિસ ઑટો-પ્રિન્ટ સ્ટેશન સક્રિય થયું! હવે અન્ય મોબાઈલના બિલ અહીં આપોઆપ પ્રિન્ટ થશે.',
      });
      setTimeout(() => setStationToast(null), 4500);
    } else {
      setStationToast({
        text: 'ઑટો-પ્રિન્ટ સ્ટેશન બંધ કર્યું.',
      });
      setTimeout(() => setStationToast(null), 2500);
    }
  };

  // Re-print an existing job
  const handleReprintJob = async (job: PrintJob) => {
    if (!job.bill) return;
    setStationToast({ text: `🖨️ ${job.title} ફરીથી પ્રિન્ટ થઈ રહ્યું છે...` });
    try {
      await printReceiptDirectly(job.bill, settings, (msg) => {
        setStationToast({ text: msg });
      }, true);
      setStationToast({ text: `✅ પ્રિન્ટ સફળ: ${job.title}` });
      setTimeout(() => setStationToast(null), 3000);
    } catch (err: any) {
      setStationToast({
        text: `પ્રિન્ટિંગ એરર: ${err?.message || 'પ્રિન્ટ થઈ શક્યું નહીં'}`,
        isError: true,
      });
      setTimeout(() => setStationToast(null), 4500);
    }
  };

  // Send a test bill through cloud queue
  const handleSendTestJob = async () => {
    try {
      setStationToast({ text: '📡 ટેસ્ટ પ્રિન્ટ જોબ ક્લાઉડમાં મોકલાઈ રહી છે...' });
      const testBill: VoucherBill = {
        id: `test_${Date.now()}`,
        billNo: 999,
        billNoStr: '#TEST',
        date: new Date().toISOString().split('T')[0],
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        session: 'M',
        customerName: 'ટેસ્ટ ગ્રાહક (રિમોટ પ્રિન્ટ ચકાસણી)',
        items: [
          {
            id: 'it_test',
            productId: 'p_bajri',
            productName: 'બાજરી (ટેસ્ટ)',
            productShortcut: 'b',
            weightKg: 100,
            ratePer20Kg: 450,
            amount: 2250,
          },
        ],
        totalWeightKg: 100,
        totalWeightMan: 5,
        grossAmount: 2250,
        discountLess: 0,
        finalTotal: 2250,
        createdAt: Date.now(),
      };

      await enqueuePrintJob({
        type: 'bill',
        bill: testBill,
        title: 'ટેસ્ટ બિલ (#TEST - રિમોટ પ્રિન્ટ)',
        sourceDevice: 'આ મોબાઈલ (ટેસ્ટ બટન)',
      });

      setStationToast({
        text: '📡 ટેસ્ટ પ્રિન્ટ ક્લાઉડમાં મૂકાઈ ગઈ! જો સ્ટેશન ચાલુ હશે તો તરત પ્રિન્ટર ચાલુ થશે.',
      });
      setTimeout(() => setStationToast(null), 4000);
    } catch (e: any) {
      setStationToast({
        text: `ટેસ્ટ જોબ મોકલવામાં એરર: ${e?.message}`,
        isError: true,
      });
      setTimeout(() => setStationToast(null), 4000);
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    await deletePrintJobFromCloud(jobId);
  };

  return {
    jobs,
    isBtConnected,
    btDeviceName,
    currentProcessingJob,
    stationToast,
    handleConnectPrinter,
    handleToggleStationMode,
    handleReprintJob,
    handleSendTestJob,
    handleDeleteJob,
  };
}
