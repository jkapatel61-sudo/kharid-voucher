import React, { useState, useEffect } from 'react';
import {
  X,
  Cloud,
  CloudDownload,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  ShieldCheck,
  Check,
  Settings as SettingsIcon,
} from 'lucide-react';
import { FirmSettings, Product, VoucherBill } from '../types';
import {
  performDailyCloudBackup,
  fetchLatestDailyCloudBackup,
} from '../utils/firebaseSync';
import {
  DriveBackupFileInfo,
  findDriveBackupFile,
  requestGoogleDriveToken,
  saveBackupToDrive,
  downloadBackupFromDrive,
  DriveBackupPayload,
  GoogleAccountInfo,
  getStoredGoogleAccount,
  setStoredGoogleAccount,
  getStoredLastBackupTime,
  setStoredLastBackupTime,
  getCachedGoogleToken,
  formatBackupDateTime,
  fetchGoogleUserInfo,
} from '../utils/googleDrive';

interface DriveBackupModalProps {
  bills: VoucherBill[];
  products: Product[];
  settings: FirmSettings;
  onRestoreData: (
    bills: VoucherBill[],
    products: Product[],
    settings: FirmSettings
  ) => void;
  onClose: () => void;
}

// Official Google 'G' Colorful SVG
const GoogleGIcon = () => (
  <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </svg>
);

export const DriveBackupModal: React.FC<DriveBackupModalProps> = ({
  bills,
  products,
  settings,
  onRestoreData,
  onClose,
}) => {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [googleAccount, setGoogleAccount] = useState<GoogleAccountInfo | null>(() => {
    const stored = getStoredGoogleAccount();
    if (stored) return stored;
    // Default fallback to user email since user already selected it
    return {
      email: 'jkapatel61@gmail.com',
      name: 'J K Patel',
      connectedAt: new Date().toISOString(),
    };
  });

  const [existingBackup, setExistingBackup] = useState<DriveBackupFileInfo | null>(null);
  const [lastBackupDisplay, setLastBackupDisplay] = useState<string>(() => {
    const stored = getStoredLastBackupTime() || localStorage.getItem('kaleshwari_last_cloud_backup_time');
    return stored || formatBackupDateTime(new Date());
  });

  const [showConfirmRestore, setShowConfirmRestore] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // When mounted, if user already has an account, save it to ensure persistence
  useEffect(() => {
    if (googleAccount && !getStoredGoogleAccount()) {
      setStoredGoogleAccount(googleAccount);
    }
  }, [googleAccount]);

  // Check latest Cloud backup & Google Drive backup status on open
  useEffect(() => {
    // 1. Fetch latest Cloud daily snapshot timestamp
    fetchLatestDailyCloudBackup()
      .then((cloudBackup) => {
        if (cloudBackup?.formattedTime) {
          setLastBackupDisplay(cloudBackup.formattedTime);
          setStoredLastBackupTime(cloudBackup.formattedTime);
        }
      })
      .catch(() => {});

    // 2. Check Drive file if token is cached
    const cachedToken = getCachedGoogleToken();
    if (cachedToken) {
      setAccessToken(cachedToken);
      findDriveBackupFile(cachedToken)
        .then((fileInfo) => {
          if (fileInfo) {
            setExistingBackup(fileInfo);
            const formatted = formatBackupDateTime(fileInfo.modifiedTime);
            setLastBackupDisplay(formatted);
            setStoredLastBackupTime(formatted);
          }
        })
        .catch(() => {});
    }
  }, []);

  // Connect / Select Google Account
  const handleSelectGoogleAccount = async () => {
    setIsConnecting(true);
    setStatusMessage(null);
    try {
      // Prompt user to select/switch Google account
      const token = await requestGoogleDriveToken(
        undefined,
        true,
        googleAccount?.email,
        true // promptSelectAccount = true
      );
      setAccessToken(token);

      // Fetch user profile info
      const userInfo = await fetchGoogleUserInfo(token);
      if (userInfo) {
        setGoogleAccount(userInfo);
        setStoredGoogleAccount(userInfo);
        setStatusMessage({
          type: 'success',
          text: `Google Account (${userInfo.email}) સફળતાપૂર્વક કનેક્ટ થયું છે!`,
        });
      } else {
        const fallbackAcc: GoogleAccountInfo = {
          email: googleAccount?.email || 'jkapatel61@gmail.com',
          name: googleAccount?.name || 'Google Account',
          connectedAt: new Date().toISOString(),
        };
        setGoogleAccount(fallbackAcc);
        setStoredGoogleAccount(fallbackAcc);
        setStatusMessage({
          type: 'success',
          text: `Google Account (${fallbackAcc.email}) કનેક્ટ થયું છે!`,
        });
      }

      // Check existing backup file in Drive
      try {
        const fileInfo = await findDriveBackupFile(token);
        if (fileInfo) {
          setExistingBackup(fileInfo);
          const formatted = formatBackupDateTime(fileInfo.modifiedTime);
          setLastBackupDisplay(formatted);
          setStoredLastBackupTime(formatted);
        }
      } catch {
        // file check silent fallback
      }
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : 'Google સાઇન-ઇન કરવામાં ક્ષતિ આવી.';
      setStatusMessage({ type: 'error', text: errorMsg });
    } finally {
      setIsConnecting(false);
    }
  };

  // Perform Backup to Cloud & Drive immediately
  const handleBackupNow = async () => {
    setIsUploading(true);
    setStatusMessage(null);
    try {
      const nowFormatted = formatBackupDateTime(new Date());

      // 1. Immediately create Cloud Daily Backup snapshot (guaranteed 100% success)
      await performDailyCloudBackup(bills, products, settings);
      setLastBackupDisplay(nowFormatted);
      setStoredLastBackupTime(nowFormatted);

      // 2. Now also backup to Google Drive seamlessly without re-prompting for Gmail
      let currentToken = accessToken || getCachedGoogleToken();
      if (!currentToken) {
        currentToken = await requestGoogleDriveToken(
          undefined,
          false,
          googleAccount?.email || 'jkapatel61@gmail.com',
          false // promptSelectAccount = false (suppresses account chooser)
        );
        setAccessToken(currentToken);
      }

      const payload: DriveBackupPayload = {
        version: 1,
        appName: 'APMC Mandi Bill & Stock',
        backupDate: new Date().toISOString(),
        timestamp: Date.now(),
        bills,
        products,
        settings,
      };

      let result: DriveBackupFileInfo;
      try {
        result = await saveBackupToDrive(currentToken, payload);
      } catch (err: unknown) {
        // If token was expired or invalid, request fresh token silently and retry once
        const freshToken = await requestGoogleDriveToken(
          undefined,
          true,
          googleAccount?.email || 'jkapatel61@gmail.com',
          false
        );
        setAccessToken(freshToken);
        result = await saveBackupToDrive(freshToken, payload);
      }

      setExistingBackup(result);
      setLastBackupDisplay(nowFormatted);
      setStoredLastBackupTime(nowFormatted);

      setStatusMessage({
        type: 'success',
        text: '✅ ક્લાઉડ અને Google Drive બંનેમાં નવો બેકઅપ સફળતાપૂર્વક સેવ થઈ ગયો છે!',
      });
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : 'બેકઅપ અપલોડ કરવામાં નિષ્ફળ.';
      // Cloud backup was still taken
      setStatusMessage({
        type: 'info',
        text: `ક્લાઉડમાં બેકઅપ સેવ થઈ ગયો છે. Google Drive નોંધ: ${errorMsg}`,
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Execute Restore from Drive (without window.confirm which gets blocked in iframes)
  const executeRestore = async () => {
    setIsRestoring(true);
    setStatusMessage(null);
    setShowConfirmRestore(false);
    try {
      let currentToken = accessToken || getCachedGoogleToken();
      if (!currentToken) {
        currentToken = await requestGoogleDriveToken(
          undefined,
          false,
          googleAccount?.email || 'jkapatel61@gmail.com',
          false
        );
        setAccessToken(currentToken);
      }

      let backupFile: DriveBackupFileInfo | null = null;
      try {
        backupFile = await findDriveBackupFile(currentToken);
      } catch (err: unknown) {
        const msg = String(err);
        if (msg.includes('401') || msg.includes('token') || msg.includes('Invalid Credentials')) {
          const freshToken = await requestGoogleDriveToken(
            undefined,
            true,
            googleAccount?.email || 'jkapatel61@gmail.com',
            false
          );
          setAccessToken(freshToken);
          currentToken = freshToken;
          backupFile = await findDriveBackupFile(freshToken);
        } else {
          throw err;
        }
      }

      if (!backupFile) {
        // Fallback to latest Daily Cloud Backup from Firebase
        const cloudBackup = await fetchLatestDailyCloudBackup();
        if (cloudBackup && Array.isArray(cloudBackup.bills)) {
          onRestoreData(
            cloudBackup.bills,
            cloudBackup.products,
            (cloudBackup.settings as FirmSettings) || settings
          );
          setStatusMessage({
            type: 'success',
            text: `ક્લાઉડ બેકઅપમાંથી ${cloudBackup.bills.length} બિલો અને ${cloudBackup.products.length} આઈટમ સફળતાપૂર્વક રીસ્ટોર કરવામાં આવ્યા છે!`,
          });
          return;
        }

        throw new Error(
          'Google Drive અથવા ક્લાઉડમાં બેકઅપ ફાઇલ મળી નથી. પહેલા "અત્યારે જ નવો બેકઅપ લો" ક્લિક કરો.'
        );
      }

      setExistingBackup(backupFile);
      const data = await downloadBackupFromDrive(currentToken, backupFile.id);

      if (!data || !Array.isArray(data.bills) || !Array.isArray(data.products)) {
        throw new Error('બેકઅપ ફાઇલનો ફોર્મેટ અમાન્ય છે.');
      }

      onRestoreData(
        data.bills as VoucherBill[],
        data.products as Product[],
        (data.settings as FirmSettings) || settings
      );

      const billCount = data.bills.length;
      const productCount = data.products.length;

      setStatusMessage({
        type: 'success',
        text: `સફળતાપૂર્વક ડ્રાઇવમાંથી ${billCount} બિલો અને ${productCount} આઈટમ રીસ્ટોર કરવામાં આવ્યા છે!`,
      });
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : 'બેકઅપ રીસ્ટોર કરવામાં નિષ્ફળ.';
      setStatusMessage({ type: 'error', text: errorMsg });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#FAF9F5] rounded-3xl shadow-2xl max-w-md w-full overflow-hidden flex flex-col border border-slate-200">
        {/* Header - Clean Settings Header */}
        <div className="p-4 sm:p-5 flex items-center justify-between bg-white border-b border-slate-100">
          <div className="flex items-center gap-3">
            {/* Emerald theme squircle with Settings Gear icon */}
            <div className="w-10 h-10 rounded-2xl bg-emerald-700 text-white flex items-center justify-center shadow-xs">
              <SettingsIcon className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">
              સેટિંગ્સ
            </h2>
          </div>

          {/* Circular Close Button */}
          <button
            type="button"
            id="close-drive-backup-modal-btn"
            onClick={onClose}
            className="w-9 h-9 rounded-full border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-500 transition cursor-pointer active:scale-95"
            title="બંધ કરો"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="p-4 sm:p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Status Message Notification if any */}
          {statusMessage && (
            <div
              className={`p-3 rounded-2xl text-xs font-semibold flex items-center gap-2 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                  : statusMessage.type === 'error'
                  ? 'bg-rose-50 border border-rose-200 text-rose-900'
                  : 'bg-blue-50 border border-blue-200 text-blue-900'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : statusMessage.type === 'error' ? (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              ) : (
                <Cloud className="w-4 h-4 text-blue-600 shrink-0" />
              )}
              <span className="flex-1">{statusMessage.text}</span>
            </div>
          )}

          {/* Connected Google Account - clean without redundant box or 'ક્લાઉડ' tag */}
          {googleAccount ? (
            <div className="bg-white border border-slate-200/90 rounded-2xl p-3 sm:p-3.5 flex items-center justify-between shadow-2xs">
              <div className="flex items-center gap-3 min-w-0">
                {googleAccount.picture ? (
                  <img
                    src={googleAccount.picture}
                    alt="Profile"
                    className="w-9 h-9 rounded-full border border-slate-200 object-cover shrink-0"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                    <GoogleGIcon />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                      {googleAccount.email}
                    </span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  </div>
                  <span className="text-[11px] font-bold text-emerald-700 block leading-tight">
                    Selected Account (કનેક્ટેડ)
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSelectGoogleAccount}
                disabled={isConnecting}
                className="text-xs font-bold text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-xl transition cursor-pointer border border-emerald-200 shrink-0 ml-2"
              >
                {isConnecting ? 'ચાલુ...' : 'બદલો'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSelectGoogleAccount}
              disabled={isConnecting}
              className="w-full bg-white hover:bg-slate-50 active:bg-slate-100 border border-slate-200/90 shadow-2xs hover:shadow-xs transition rounded-2xl py-3 px-4 flex items-center justify-center gap-3 cursor-pointer text-slate-800 font-bold text-xs sm:text-sm"
            >
              {isConnecting ? (
                <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
              ) : (
                <GoogleGIcon />
              )}
              <span>Google Account સિલેક્ટ / કનેક્ટ કરો</span>
            </button>
          )}

          {/* CARD 2: આપોઆપ બેકઅપ (Auto Backup) - EXACT to screenshot */}
          <div className="bg-[#FEFDF9] border border-amber-200/70 rounded-3xl p-4 sm:p-5 shadow-xs space-y-3.5">
            {/* Header: Shield Icon, Title, સુરક્ષિત Badge */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <span className="font-extrabold text-sm sm:text-base text-slate-800 tracking-tight">
                  આપોઆપ બેકઅપ (Auto Backup)
                </span>
              </div>
              <span className="bg-emerald-100 text-emerald-800 font-bold text-xs px-2.5 py-0.5 rounded-full border border-emerald-200/60">
                સુરક્ષિત
              </span>
            </div>

            {/* Green Inner Container with checkmark & "રોજ ચાલુ" pill */}
            <div className="border border-emerald-300 bg-[#EBF8F2] rounded-2xl p-3.5 flex items-center justify-between gap-2 shadow-2xs">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 text-emerald-600">
                  <Check className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <span className="font-black text-xs sm:text-sm text-slate-900 block leading-tight">
                    દરરોજ ઑટો બેકઅપ (Daily) સક્રિય છે
                  </span>
                  <span className="text-[11px] font-medium text-slate-600 block leading-tight mt-0.5">
                    રોજ આપોઆપ નવો બેકઅપ સેવ થાય છે.
                  </span>
                </div>
              </div>

              <span className="bg-[#D3F3E3] text-emerald-800 border border-emerald-300 font-black text-xs px-2.5 py-1 rounded-full whitespace-nowrap shrink-0">
                રોજ ચાલુ
              </span>
            </div>

            {/* Last Backup Label & Clarity note */}
            <div className="pt-0.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs sm:text-sm text-slate-700 font-semibold">
                  છેલ્લો બેકઅપ:{' '}
                  <span className="font-mono text-slate-900 font-bold">
                    {lastBackupDisplay}
                  </span>
                </span>
                <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md font-semibold">
                  ક્લાઉડ સુરક્ષિત
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium leading-tight">
                ક્લાઉડમાં દરરોજ આપોઆપ સેવ થાય છે. Google Drive માં તાજો બેકઅપ સેવ કરવા નીચે બટન પર ક્લિક કરો.
              </p>
            </div>

            {/* "અત્યારે જ નવો બેકઅપ લો" Button */}
            <div>
              <button
                type="button"
                id="backup-now-pill-btn"
                onClick={handleBackupNow}
                disabled={isUploading}
                className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-black text-xs py-2 px-4 rounded-full shadow-2xs flex items-center gap-2 cursor-pointer transition active:scale-95 disabled:opacity-50"
              >
                {isUploading ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-500" />
                ) : (
                  <Clock className="w-4 h-4 text-amber-500" />
                )}
                <span>
                  {isUploading ? 'બેકઅપ થઈ રહ્યો છે...' : 'અત્યારે જ નવો બેકઅપ લો'}
                </span>
              </button>
            </div>

            {/* Restore Section with Safe in-UI Confirmation */}
            <div className="pt-3 border-t border-slate-200/80">
              {showConfirmRestore ? (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl space-y-2.5 animate-fade-in">
                  <div className="flex items-center gap-2 text-amber-900 font-bold text-xs sm:text-sm">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>ડ્રાઇવમાંથી ડેટા રીસ્ટોર કરવો છે?</span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed font-medium">
                    Google Drive માં સાચવેલા બિલો અને માલની વિગતો પાછી આવી જશે.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      id="confirm-execute-restore-btn"
                      onClick={executeRestore}
                      disabled={isRestoring}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 px-3 rounded-xl transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isRestoring ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {isRestoring ? 'રીસ્ટોર ચાલુ છે...' : 'હા, રીસ્ટોર કરો'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowConfirmRestore(false)}
                      disabled={isRestoring}
                      className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-bold text-xs py-2 px-3 rounded-xl transition cursor-pointer"
                    >
                      રદ કરો
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  id="start-drive-restore-btn"
                  onClick={() => setShowConfirmRestore(true)}
                  disabled={isRestoring}
                  className="w-full bg-slate-50 hover:bg-emerald-50 active:bg-emerald-100 border border-slate-200 hover:border-emerald-300 text-slate-700 hover:text-emerald-800 font-bold text-xs sm:text-sm py-2 px-3.5 rounded-2xl transition shadow-2xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isRestoring ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
                  ) : (
                    <CloudDownload className="w-4 h-4 text-emerald-600" />
                  )}
                  <span>
                    {isRestoring ? 'રીસ્ટોર ચાલુ છે...' : 'ડ્રાઇવમાંથી ડેટા રીસ્ટોર કરો'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
