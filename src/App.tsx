import React, { useState, useEffect } from 'react';
import { FileText, Settings } from 'lucide-react';
import { FirmSettings, Product, SessionType, VoucherBill } from './types';
import {
  getCurrentSession,
  getStoredBills,
  getStoredFirmSettings,
  getStoredProducts,
  getTodayISODate,
  saveStoredBills,
  saveStoredFirmSettings,
  saveStoredProducts,
} from './utils/storage';
import { Header } from './components/Header';
import { TodayBillView } from './components/TodayBillView';
import { HistoryView } from './components/HistoryView';
import { DailyStockLaborView } from './components/DailyStockLaborView';
import { DateRangePickerModal } from './components/DateRangePickerModal';
import { SettingsModal } from './components/SettingsModal';
import { MobileLoginModal } from './components/MobileLoginModal';
import {
  MandiAuthUser,
  getStoredAuthUser,
  clearStoredAuthUser,
} from './utils/mobileAuth';
import { DriveBackupModal } from './components/DriveBackupModal';
import { AutoPrintStationModal } from './components/AutoPrintStationModal';
import { KantaEntryView } from './components/KantaEntryView';
import { printReceiptDirectly } from './utils/directPrint';
import { isBluetoothConnected, isPrinterConfiguredOrPermitted } from './utils/bluetoothPrinter';
import {
  subscribeToBills,
  syncBillToCloud,
  deleteBillFromCloud,
  enqueuePrintJob,
  KantaWeighment,
  performDailyCloudBackup,
} from './utils/firebaseSync';
import { useAutoPrintStation } from './hooks/useAutoPrintStation';
import { useBackHandler } from './utils/useBackHandler';
import {
  getCachedGoogleToken,
  saveBackupToDrive,
  formatBackupDateTime,
  setStoredLastBackupTime,
} from './utils/googleDrive';

export default function App() {
  // Directly load data
  const [products, setProducts] = useState<Product[]>(getStoredProducts);
  const [settings, setSettings] = useState<FirmSettings>(getStoredFirmSettings);
  const [bills, setBills] = useState<VoucherBill[]>(getStoredBills);

  // Active view: 'bill', 'kanta', 'history', or 'labor' (persisted across reloads / screen-off)
  const [currentView, setCurrentView] = useState<'bill' | 'kanta' | 'history' | 'labor'>(() => {
    try {
      const saved = localStorage.getItem('mandi_app_current_view');
      if (saved === 'bill' || saved === 'kanta' || saved === 'history' || saved === 'labor') {
        return saved;
      }
    } catch (e) {}
    return 'bill';
  });

  const handleSetCurrentView = (view: 'bill' | 'kanta' | 'history' | 'labor') => {
    setCurrentView(view);
    try {
      localStorage.setItem('mandi_app_current_view', view);
    } catch (e) {}
  };

  // Business Date and Auto-session (M: 12:00-1:30, A: 1:31-12:00)
  const [businessDate, setBusinessDate] = useState<string>(getTodayISODate);
  const [currentSession, setCurrentSession] = useState<SessionType>(getCurrentSession);

  // Date filtering state for Historical viewing in Stock/Labor & History (હેડરના કેલેન્ડર સિમ્બોલ માટે)
  const [filterStartDate, setFilterStartDate] = useState<string>(getTodayISODate);
  const [filterEndDate, setFilterEndDate] = useState<string>(getTodayISODate);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState<boolean>(false);
  const [authUser, setAuthUser] = useState<MandiAuthUser | null>(getStoredAuthUser);
  // First time app open: Show login immediately if not yet linked to a mobile number!
  const [isMobileAuthOpen, setIsMobileAuthOpen] = useState<boolean>(() => {
    return !getStoredAuthUser();
  });

  const isDateFiltered = Boolean(
    (filterStartDate && filterStartDate !== businessDate) ||
    (filterEndDate && filterEndDate !== businessDate)
  );

  const handleResetFilterDate = () => {
    setFilterStartDate(businessDate);
    setFilterEndDate(businessDate);
  };

  // Modals state
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showDriveBackup, setShowDriveBackup] = useState<boolean>(false);

  const [selectedWeighmentForBill, setSelectedWeighmentForBill] = useState<KantaWeighment | null>(null);
  const [weighmentToEditInKanta, setWeighmentToEditInKanta] = useState<KantaWeighment | null>(null);

  // Auto-Print Station modal
  const [showAutoPrintStation, setShowAutoPrintStation] = useState<boolean>(false);

    // Unified Step-by-Step Back Navigation Hooks:
  // 1. Modals (Top layer)
  useBackHandler('modal-settings', showSettings, () => setShowSettings(false));
  useBackHandler('modal-drive-backup', showDriveBackup, () => setShowDriveBackup(false));
  useBackHandler('modal-auto-print', showAutoPrintStation, () => setShowAutoPrintStation(false));
  useBackHandler('modal-datepicker', isDatePickerOpen, () => setIsDatePickerOpen(false));
  useBackHandler('modal-mobile-auth', isMobileAuthOpen, () => setIsMobileAuthOpen(false));

  // 2. Past Date filter in History or Labor:
  // When user looks at older dates in history, pressing Back first brings them back to today's history!
  const isPastDateFiltered = Boolean(
    (currentView === 'history' || currentView === 'labor') &&
    ((filterStartDate && filterStartDate !== businessDate) ||
     (filterEndDate && filterEndDate !== businessDate))
  );
  useBackHandler('filter-past-date', isPastDateFiltered, () => {
    setFilterStartDate(businessDate);
    setFilterEndDate(businessDate);
  });

  // 3. Views (History, Kanta, Labor):
  // When in history, kanta, or labor on today's date, pressing Back brings user to 'bill' (નવું બિલ)!
  useBackHandler('view-non-bill', currentView !== 'bill', () => {
    handleSetCurrentView('bill');
  });

  const handleSaveSettings = (newSettings: FirmSettings) => {
    setSettings(newSettings);
    saveStoredFirmSettings(newSettings);
  };

  // Auto-Print Station Hook (for zero-touch remote printing in office)
  const {
    jobs: stationJobs,
    isBtConnected: stationBtConnected,
    btDeviceName: stationBtDeviceName,
    currentProcessingJob,
    stationToast,
    handleConnectPrinter: handleStationConnectPrinter,
    handleToggleStationMode,
    handleReprintJob,
    handleSendTestJob,
    handleDeleteJob,
  } = useAutoPrintStation(settings, handleSaveSettings);

  // Universal Direct Print (Zero-modal direct printing)
  const [printingBillId, setPrintingBillId] = useState<string | null>(null);
  const [printToastMsg, setPrintToastMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  const handleDirectPrintBill = async (bill: VoucherBill) => {

    const hasLocalPrinter =
      isBluetoothConnected() ||
      isPrinterConfiguredOrPermitted();

    // If this mobile does not have the printer connected/paired, send to the connected master device:
    if (!hasLocalPrinter && settings.cloudRemotePrintEnabled !== false) {
      setPrintingBillId(bill.id);
      setPrintToastMsg({ text: `📡 પ્રિન્ટર સાથે જોડાયેલા ફોન પર મોકલાઈ રહ્યું છે...` });
      try {
        await enqueuePrintJob({
          type: 'bill',
          bill,
          title: `બિલ ${bill.billNoStr || bill.billNo} - ${bill.customerName}`,
          sourceDevice: 'મોબાઈલ',
        });
        setPrintToastMsg({ text: `✅ ઓફિસ પ્રિન્ટરમાં મોકલાઈ ગયું! (ત્યાં પ્રિન્ટ થઈ જશે)` });
        setTimeout(() => setPrintToastMsg(null), 3500);
        return;
      } catch (e: any) {
        console.warn('Enqueue failed, trying local direct print', e);
      } finally {
        setPrintingBillId(null);
      }
    }

    setPrintingBillId(bill.id);
    setPrintToastMsg({ text: `🖨️ બિલ ${bill.billNoStr || bill.billNo} પ્રિન્ટ થઈ રહ્યું છે...` });

    try {
      await printReceiptDirectly(bill, settings, (status) => {
        setPrintToastMsg({ text: status });
      }, true);
      setPrintToastMsg({ text: `✅ બિલ ${bill.billNoStr || bill.billNo} પ્રિન્ટ સફળ!` });
      setTimeout(() => setPrintToastMsg(null), 3000);
    } catch (err: any) {
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
        console.warn('Direct print warning/error:', err);
        const errorText = `પ્રિન્ટિંગ એરર: ${err?.message || 'પ્રિન્ટર કનેક્ટ થઈ શક્યું નહીં. પ્રિન્ટર ચાલુ છે કે નહીં તે ચકાસો.'}`;
        setPrintToastMsg({ text: errorText, isError: true });
        setTimeout(() => setPrintToastMsg(null), 4500);
      } else {
        setPrintToastMsg(null);
      }
    } finally {
      setPrintingBillId(null);
    }
  };

  // Update business date and session every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setBusinessDate(getTodayISODate());
      setCurrentSession(getCurrentSession());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // Real-time Cloud sync for bills across multiple devices
  useEffect(() => {
    const unsubscribe = subscribeToBills((cloudBills) => {
      if (cloudBills && cloudBills.length > 0) {
        setBills((prevLocal) => {
          // Merge cloud bills with local bills by ID, prioritizing latest
          const billMap = new Map<string, VoucherBill>();
          prevLocal.forEach((b) => billMap.set(b.id, b));
          cloudBills.forEach((b) => billMap.set(b.id, b));
          const merged = Array.from(billMap.values()).sort((a, b) => b.createdAt - a.createdAt);
          saveStoredBills(merged);
          return merged;
        });
      }
    });

    return () => unsubscribe();
  }, []);

  // Automated Daily Backup Runner (Runs every day in background on launch / date change)
  useEffect(() => {
    if (bills.length === 0) return;
    const todayDate = getTodayISODate();
    const lastBackupDate = localStorage.getItem('kaleshwari_last_daily_backup_date');

    // Run daily cloud backup snapshot automatically if not performed today
    if (lastBackupDate !== todayDate) {
      performDailyCloudBackup(bills, products, settings)
        .then((timeStr) => {
          console.log('Automated Daily Cloud Backup saved for today:', todayDate, timeStr);
        })
        .catch((err) => console.warn('Daily cloud backup notice:', err));
    }

    // If Google Drive token is currently valid in cache, also update Google Drive silently
    const driveToken = getCachedGoogleToken();
    if (driveToken) {
      saveBackupToDrive(driveToken, {
        version: 1,
        appName: 'APMC Mandi Bill & Stock',
        backupDate: new Date().toISOString(),
        timestamp: Date.now(),
        bills,
        products,
        settings,
      })
        .then(() => {
          setStoredLastBackupTime(formatBackupDateTime(new Date()));
        })
        .catch(() => {});
    }
  }, [bills.length]);

  const handleSaveBill = (newBill: VoucherBill, updatedProducts: Product[]) => {
    const nextBills = [newBill, ...bills];
    setBills(nextBills);
    saveStoredBills(nextBills);
    syncBillToCloud(newBill); // Real-time sync to Cloud

    setProducts(updatedProducts);
    saveStoredProducts(updatedProducts);

    // Save Daily Cloud Backup Snapshot
    performDailyCloudBackup(nextBills, updatedProducts, settings).catch(() => {});

    // If Google Drive token is active, quietly sync backup to Drive in background
    const driveToken = getCachedGoogleToken();
    if (driveToken) {
      saveBackupToDrive(driveToken, {
        version: 1,
        appName: 'APMC Mandi Bill & Stock',
        backupDate: new Date().toISOString(),
        timestamp: Date.now(),
        bills: nextBills,
        products: updatedProducts,
        settings,
      })
        .then(() => {
          setStoredLastBackupTime(formatBackupDateTime(new Date()));
        })
        .catch(() => {});
    }
  };

  const handleDeleteBill = (id: string) => {
    const nextBills = bills.filter((b) => b.id !== id);
    setBills(nextBills);
    saveStoredBills(nextBills);
    deleteBillFromCloud(id); // Delete from Cloud
  };

  const handleUpdateBill = (updatedBill: VoucherBill) => {
    const nextBills = bills.map((b) => (b.id === updatedBill.id ? updatedBill : b));
    setBills(nextBills);
    saveStoredBills(nextBills);
    syncBillToCloud(updatedBill); // Update in Cloud
  };

  const handleSaveProducts = (newProducts: Product[]) => {
    setProducts(newProducts);
    saveStoredProducts(newProducts);
  };

  const handleRestoreData = (
    restoredBills: VoucherBill[],
    restoredProducts: Product[],
    restoredSettings: FirmSettings
  ) => {
    setBills(restoredBills);
    saveStoredBills(restoredBills);

    setProducts(restoredProducts);
    saveStoredProducts(restoredProducts);

    setSettings(restoredSettings);
    saveStoredFirmSettings(restoredSettings);
  };

  return (
    <div
      className={`bg-slate-100 flex flex-col font-sans text-slate-800 selection:bg-emerald-100 selection:text-emerald-900 ${
        currentView === 'bill' || currentView === 'labor'
          ? 'h-[100dvh] max-h-[100dvh] overflow-hidden overscroll-none'
          : 'min-h-screen'
      }`}
    >
      {/* Top Header with 3 horizontal lines (menu) button, and Calendar + New Bill symbols on top right */}
      <Header
        businessDate={businessDate}
        settings={settings}
        activeView={currentView}
        onSelectView={(view) => handleSetCurrentView(view)}
        onOpenDriveBackup={() => setShowDriveBackup(true)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenAutoPrintStation={() => setShowAutoPrintStation(true)}
        onOpenMobileAuth={() => setIsMobileAuthOpen(true)}
        authUser={authUser}
        isAutoPrintStation={Boolean(settings.isAutoPrintStation)}
        onOpenDatePicker={() => setIsDatePickerOpen(true)}
        isDateFiltered={isDateFiltered}
      />

      {/* Main Content: Today's Bill Page, Kanta Entry, Kanta Records, History Page, or Daily Stock & Labor Summary Page */}
      <main
        className={`flex-1 max-w-7xl w-full mx-auto ${
          currentView === 'bill'
            ? 'p-1.5 sm:p-3 lg:p-4 overflow-hidden flex flex-col min-h-0'
            : currentView === 'labor'
            ? 'p-2 sm:p-3 lg:p-4 overflow-y-auto min-h-0 overscroll-contain'
            : 'p-2 sm:p-4 lg:p-6'
        }`}
      >
        {currentView === 'kanta' ? (
          <KantaEntryView
            products={products}
            initialWeighmentToEdit={weighmentToEditInKanta}
            onClearInitialWeighmentToEdit={() => setWeighmentToEditInKanta(null)}
            onViewAllRecords={() => handleSetCurrentView('history')}
            onOpenBillForWeighment={(weighment) => {
              setSelectedWeighmentForBill(weighment);
              handleSetCurrentView('bill');
            }}
            businessDate={businessDate}
            currentSession={currentSession}
            settings={settings}
            bills={bills}
            onSaveBill={handleSaveBill}
            onSaveProducts={handleSaveProducts}
            onOpenReceipt={handleDirectPrintBill}
          />
        ) : currentView === 'history' ? (
          <HistoryView
            bills={bills}
            products={products}
            settings={settings}
            currentDate={businessDate}
            startDate={filterStartDate}
            endDate={filterEndDate}
            onResetDate={handleResetFilterDate}
            onBack={() => handleSetCurrentView('bill')}
            onOpenReceipt={handleDirectPrintBill}
            onDeleteBill={handleDeleteBill}
            onUpdateBill={handleUpdateBill}
          />
        ) : currentView === 'labor' ? (
          <DailyStockLaborView
            bills={bills}
            products={products}
            settings={settings}
            currentDate={businessDate}
            startDate={filterStartDate}
            endDate={filterEndDate}
            onResetDate={handleResetFilterDate}
            onBack={() => handleSetCurrentView('bill')}
            onOpenReceipt={handleDirectPrintBill}
          />
        ) : (
          <TodayBillView
            businessDate={businessDate}
            currentSession={currentSession}
            products={products}
            settings={settings}
            bills={bills}
            initialWeighment={selectedWeighmentForBill}
            onClearInitialWeighment={() => setSelectedWeighmentForBill(null)}
            onSaveBill={handleSaveBill}
            onDeleteBill={handleDeleteBill}
            onSaveProducts={handleSaveProducts}
            onOpenReceipt={handleDirectPrintBill}
            onGoToKanta={() => setCurrentView('kanta')}
          />
        )}
      </main>

      {/* Date Range Picker Modal (હેડરના કેલેન્ડર સિમ્બોલ પર ક્લિક કરવાથી ખુલે છે) */}
      <DateRangePickerModal
        isOpen={isDatePickerOpen}
        startDate={filterStartDate}
        endDate={filterEndDate}
        onClose={() => setIsDatePickerOpen(false)}
        onApply={(start, end) => {
          setFilterStartDate(start);
          setFilterEndDate(end);
          setIsDatePickerOpen(false);
        }}
      />

      {/* Khatabook Style Mobile Phone + OTP Auth Modal */}
      <MobileLoginModal
        isOpen={isMobileAuthOpen}
        onClose={() => setIsMobileAuthOpen(false)}
        firmName={settings.firmName}
        currentUser={authUser}
        onLoginSuccess={(user) => {
          setAuthUser(user);
        }}
        onLogout={() => {
          clearStoredAuthUser();
          setAuthUser(null);
        }}
      />

      {/* Product & Firm Settings Modal */}
      {showSettings && (
        <SettingsModal
          products={products}
          settings={settings}
          onSaveProducts={handleSaveProducts}
          onSaveSettings={handleSaveSettings}
          onClose={() => setShowSettings(false)}
          onOpenMobileAuth={() => setIsMobileAuthOpen(true)}
          authUser={authUser}
        />
      )}

      {/* Google Drive Backup & Restore Modal */}
      {showDriveBackup && (
        <DriveBackupModal
          bills={bills}
          products={products}
          settings={settings}
          onRestoreData={handleRestoreData}
          onClose={() => setShowDriveBackup(false)}
        />
      )}

      {/* Office Auto-Print Station Modal (રિમોટ ઑટો પ્રિન્ટિંગ કંટ્રોલ) */}
      {showAutoPrintStation && (
        <AutoPrintStationModal
          settings={settings}
          jobs={stationJobs}
          isBtConnected={stationBtConnected}
          btDeviceName={stationBtDeviceName}
          currentProcessingJob={currentProcessingJob}
          onClose={() => setShowAutoPrintStation(false)}
          onConnectPrinter={handleStationConnectPrinter}
          onToggleStationMode={handleToggleStationMode}
          onReprintJob={handleReprintJob}
          onSendTestJob={handleSendTestJob}
          onDeleteJob={handleDeleteJob}
        />
      )}

      {/* Floating Direct Print / Station Status Toast */}
      {(printToastMsg || stationToast) && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 animate-bounce-short pointer-events-none">
          <div
            className={`px-4 py-2.5 rounded-2xl shadow-xl text-xs sm:text-sm font-bold flex items-center gap-2.5 border ${
              (printToastMsg?.isError || stationToast?.isError)
                ? 'bg-rose-900 text-white border-rose-700 shadow-rose-950/40'
                : 'bg-slate-900 text-white border-slate-700 shadow-black/30'
            }`}
          >
            <span>{printToastMsg ? printToastMsg.text : stationToast?.text}</span>
          </div>
        </div>
      )}
    </div>
  );
}

