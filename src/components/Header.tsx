import React, { useState, useEffect } from 'react';
import {
  Menu,
  FilePlus2,
  Calendar,
  
  History,
  X,
  ChevronRight,
  FileSpreadsheet,
  Cloud,
  Settings,
  Download,
  Smartphone,
  ShieldCheck,
  Scale,
  Printer,
  Radio,
} from 'lucide-react';
import { FirmSettings } from '../types';

interface HeaderProps {
  businessDate: string;
  settings: FirmSettings;
  activeView: 'bill' | 'kanta' | 'history' | 'labor';
  onSelectView?: (view: 'bill' | 'kanta' | 'history' | 'labor') => void;
  onChangeView?: (view: 'bill' | 'kanta' | 'history' | 'labor') => void;
  onOpenDriveBackup: () => void;
  onOpenSettings: () => void;
  onOpenAutoPrintStation?: () => void;
  isAutoPrintStation?: boolean;
  onOpenMobileAuth?: () => void;
  authUser?: { phoneNumber: string; shopName: string } | null;
  onOpenDatePicker: () => void;
  isDateFiltered: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  businessDate,
  settings,
  activeView,
  onSelectView,
  onChangeView,
  onOpenDriveBackup,
  onOpenSettings,
  onOpenAutoPrintStation,
  isAutoPrintStation,
  onOpenMobileAuth,
  authUser,
  onOpenDatePicker,
  isDateFiltered,
}) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Check standalone mode (PWA installed / APK / TWA / Android WebView)
  const [isStandalone, setIsStandalone] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      Boolean((window.navigator as unknown as { standalone?: boolean }).standalone) ||
      document.referrer.includes('android-app://') ||
      navigator.userAgent.includes('wv') ||
      navigator.userAgent.includes('Version/4.0')
    );
  });

  useEffect(() => {
    const checkStandalone = () => {
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        Boolean((window.navigator as unknown as { standalone?: boolean }).standalone) ||
        document.referrer.includes('android-app://') ||
        navigator.userAgent.includes('wv') ||
        navigator.userAgent.includes('Version/4.0');
      setIsStandalone(Boolean(standalone));
    };

    checkStandalone();
    const mq = window.matchMedia('(display-mode: standalone)');
    if (mq?.addEventListener) {
      mq.addEventListener('change', checkStandalone);
      return () => mq.removeEventListener('change', checkStandalone);
    }
  }, []);

  const hasSafeTop = isFullscreen || isStandalone;

  // Sync fullscreen state with browser
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      }
    } catch (err) {
      console.warn('Fullscreen toggle:', err);
    }
  };

  // Prevent background scrolling when slider drawer is open
  useEffect(() => {
    if (isDrawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isDrawerOpen]);

  const handleNavigate = (view: 'bill' | 'kanta' | 'history' | 'labor') => {
    setIsDrawerOpen(false);
    if (onSelectView) onSelectView(view);
    else if (onChangeView) onChangeView(view);
  };

  return (
    <>
      {/* Main App Header */}
      <header
        id="app-main-header"
        className={`app-main-header bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs transition-all safe-camera-top ${
          hasSafeTop ? 'pt-8 pb-1.5' : ''
        }`}
        style={
          hasSafeTop
            ? { paddingTop: 'max(env(safe-area-inset-top, 0px), 32px)' }
            : { paddingTop: 'env(safe-area-inset-top, 0px)' }
        }
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between">
          {/* Left side: 3-line Menu Button & Firm Header info */}
          <div className="flex items-center gap-3">
            {/* 3 Horizontal Lines (Menu) Icon Button to open Slider Page */}
            <button
              type="button"
              onClick={() => setIsDrawerOpen(true)}
              id="header-menu-btn"
              title="મેનૂ સ્લાઇડર ખોલો (Menu)"
              className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-xs shrink-0 cursor-pointer transition active:scale-95 bg-emerald-700 text-white hover:bg-emerald-800"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="space-y-0.5">
              {activeView === 'kanta' ? (
                <h1 className="text-base sm:text-lg font-black text-slate-900 tracking-tight leading-tight">
                  કાંટા એન્ટ્રી
                </h1>
              ) : activeView === 'history' ? (
                <h1 className="text-base sm:text-lg font-black text-slate-900 tracking-tight leading-tight">
                  આજના દિવસ ના બિલો
                </h1>
              ) : activeView === 'labor' ? (
                <h1 className="text-base sm:text-lg font-black text-slate-900 tracking-tight leading-tight">
                  આજનો માલ સ્ટોક (પત્રક)
                </h1>
              ) : (
                <>
                  {/* 1st Line: Firm Name */}
                  <h1 className="text-base sm:text-lg font-black text-slate-900 tracking-tight leading-tight">
                    {settings.firmName}
                  </h1>

                  {/* 2nd Line: ખરીદ વાઉચર */}
                  <p className="text-xs sm:text-sm font-bold text-emerald-800 leading-tight">
                    ખરીદ વાઉચર
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Right: Actions - Calendar & New Bill Symbols */}
          <div className="flex items-center gap-2">
            {/* 1. કેલેન્ડર સિમ્બોલ (જ્યારે સ્ટોક/મજૂરી કે હિસ્ટ્રી પેજ હોય ત્યારે) */}
            {(activeView === 'labor' || activeView === 'history') && onOpenDatePicker && (
              <button
                type="button"
                onClick={onOpenDatePicker}
                id="header-calendar-btn"
                className={`w-10 h-10 rounded-2xl transition flex items-center justify-center shrink-0 active:scale-95 cursor-pointer shadow-xs ${
                  isDateFiltered
                    ? 'bg-amber-600 hover:bg-amber-700 text-white ring-2 ring-amber-400'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300'
                }`}
                title="તારીખ પસંદ કરો (કેલેન્ડર)"
                aria-label="કેલેન્ડર"
              >
                <Calendar className="w-5 h-5 stroke-[2.2]" />
              </button>
            )}

            {/* 2. નવું બિલ સિમ્બોલ (કાંટા વાળા પેજમાં જે છે તે જ FilePlus2 સિમ્બોલ) */}
            {activeView !== 'bill' && (
              <button
                type="button"
                onClick={() => handleNavigate('bill')}
                id="header-new-bill-btn"
                className="w-10 h-10 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white transition flex items-center justify-center shrink-0 active:scale-95 cursor-pointer shadow-xs"
                title="નવું બિલ બનાવો"
                aria-label="નવું બિલ"
              >
                <FilePlus2 className="w-5 h-5 stroke-[2.2]" />
              </button>
            )}

            {/* 3. ફૂલ સ્ક્રીન બટન (Full Screen) */}
            
          </div>
        </div>
      </header>

      {/* FULL SLIDER PAGE / NAVIGATION DRAWER (સ્લાઇડર પેજ) */}
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 transition-opacity duration-300 ${
          isDrawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsDrawerOpen(false)}
        aria-hidden="true"
      />

      {/* Sliding Drawer Panel from Left */}
      <aside
        id="navigation-slider-drawer"
        className={`fixed inset-y-0 left-0 w-80 max-w-[85vw] bg-white z-50 shadow-2xl flex flex-col transition-transform duration-300 ease-out transform ${
          isDrawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Drawer Header - Compact Green Box without symbol and date */}
        <div
          className={`drawer-header-box px-4 bg-emerald-800 text-white flex items-center justify-between shadow-xs transition-all safe-camera-top ${
            hasSafeTop ? 'pt-8 pb-3' : 'py-3'
          }`}
          style={
            hasSafeTop
              ? { paddingTop: 'max(env(safe-area-inset-top, 0px), 32px)' }
              : { paddingTop: 'env(safe-area-inset-top, 0px)' }
          }
        >
          <div className="pr-3">
            <h2 className="text-base font-black tracking-tight leading-tight">
              {settings.firmName}
            </h2>
            <p className="text-xs font-semibold text-emerald-200 mt-0.5">
              ખરીદ વાઉચર મેનેજર
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsDrawerOpen(false)}
            id="close-slider-btn"
            className="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center transition active:scale-95 text-white shrink-0 cursor-pointer"
            title="બંધ કરો (Close)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Drawer Navigation Links */}
        <div className="p-4 space-y-2 flex-1 overflow-y-auto">
          <p className="px-3 text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">
            મુખ્ય મેનૂ (Navigation)
          </p>

          {/* 1. નવું બિલ (New Bill) */}
          <button
            type="button"
            id="drawer-nav-new-bill"
            onClick={() => handleNavigate('bill')}
            className={`w-full p-3.5 rounded-2xl text-left flex items-center justify-between transition cursor-pointer active:scale-98 ${
              activeView === 'bill'
                ? 'bg-emerald-700 text-white shadow-md shadow-emerald-700/20'
                : 'bg-slate-50 hover:bg-emerald-50 text-slate-800'
            }`}
          >
            <div className="flex items-center gap-3.5">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  activeView === 'bill'
                    ? 'bg-white/20 text-white'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                <FilePlus2 className="w-5 h-5" />
              </div>
              <div>
                <span className="block font-black text-sm leading-tight">
                  નવું બિલ (ઓફિસ)
                </span>
                <span
                  className={`text-[11px] font-medium leading-tight block mt-0.5 ${
                    activeView === 'bill' ? 'text-emerald-100' : 'text-slate-500'
                  }`}
                >
                  ખરીદ વાઉચર બનાવો અને પ્રિન્ટ કરો
                </span>
              </div>
            </div>
            <ChevronRight
              className={`w-5 h-5 ${
                activeView === 'bill' ? 'text-white' : 'text-slate-400'
              }`}
            />
          </button>

          {/* 1.5. કાંટા એન્ટ્રી (Kanta Weighment Entry for Outside Table) */}
          <button
            type="button"
            id="drawer-nav-kanta"
            onClick={() => handleNavigate('kanta')}
            className={`w-full p-3.5 rounded-2xl text-left flex items-center justify-between transition cursor-pointer active:scale-98 ${
              activeView === 'kanta'
                ? 'bg-teal-800 text-white shadow-md shadow-teal-800/20'
                : 'bg-teal-50/70 hover:bg-teal-100/60 text-teal-950 border border-teal-200'
            }`}
          >
            <div className="flex items-center gap-3.5">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  activeView === 'kanta'
                    ? 'bg-white/20 text-white'
                    : 'bg-teal-700 text-white shadow-xs'
                }`}
              >
                <Scale className="w-5 h-5" />
              </div>
              <div>
                <span className="block font-black text-sm leading-tight">
                  કાંટા એન્ટ્રી
                </span>
                <span
                  className={`text-[11px] font-medium leading-tight block mt-0.5 ${
                    activeView === 'kanta' ? 'text-teal-100' : 'text-teal-800'
                  }`}
                >
                  થેલીઓ અને વજન નાખવા
                </span>
              </div>
            </div>
            <ChevronRight
              className={`w-5 h-5 ${
                activeView === 'kanta' ? 'text-white' : 'text-teal-700'
              }`}
            />
          </button>

          {/* 2. આજના દિવસની હિસ્ટ્રી (Today's History) */}
          <button
            type="button"
            id="drawer-nav-today-history"
            onClick={() => handleNavigate('history')}
            className={`w-full p-3.5 rounded-2xl text-left flex items-center justify-between transition cursor-pointer active:scale-98 ${
              activeView === 'history'
                ? 'bg-emerald-700 text-white shadow-md shadow-emerald-700/20'
                : 'bg-slate-50 hover:bg-emerald-50 text-slate-800'
            }`}
          >
            <div className="flex items-center gap-3.5">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  activeView === 'history'
                    ? 'bg-white/20 text-white'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                <History className="w-5 h-5" />
              </div>
              <div>
                <span className="block font-black text-sm leading-tight">
                  આજના દિવસની હિસ્ટ્રી
                </span>
                <span
                  className={`text-[11px] font-medium leading-tight block mt-0.5 ${
                    activeView === 'history' ? 'text-emerald-100' : 'text-slate-500'
                  }`}
                >
                  આજના તમામ બિલોની યાદી
                </span>
              </div>
            </div>
            <ChevronRight
              className={`w-5 h-5 ${
                activeView === 'history' ? 'text-white' : 'text-slate-400'
              }`}
            />
          </button>

          {/* 3. આજનો માલ સ્ટોક (Daily Goods Stock Summary) - હિસ્ટ્રી ની નીચે મૂકો */}
          <button
            type="button"
            id="drawer-nav-stock-labor"
            onClick={() => handleNavigate('labor')}
            className={`w-full p-3.5 rounded-2xl text-left flex items-center justify-between transition cursor-pointer active:scale-98 ${
              activeView === 'labor'
                ? 'bg-emerald-700 text-white shadow-md shadow-emerald-700/20'
                : 'bg-slate-50 hover:bg-emerald-50 text-slate-800'
            }`}
          >
            <div className="flex items-center gap-3.5">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  activeView === 'labor'
                    ? 'bg-white/20 text-white'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <span className="block font-black text-sm leading-tight">
                  આજનો માલ સ્ટોક (પત્રક)
                </span>
                <span
                  className={`text-[11px] font-medium leading-tight block mt-0.5 ${
                    activeView === 'labor' ? 'text-emerald-100' : 'text-slate-500'
                  }`}
                >
                  ભાવવાર અનાજ/માલ ખરીદીની વિગત
                </span>
              </div>
            </div>
            <ChevronRight
              className={`w-5 h-5 ${
                activeView === 'labor' ? 'text-white' : 'text-slate-400'
              }`}
            />
          </button>

          {/* 4. Google Drive બેકઅપ & રીસ્ટોર */}
          {onOpenDriveBackup && (
            <button
              type="button"
              id="drawer-nav-drive-backup"
              onClick={() => {
                setIsDrawerOpen(false);
                onOpenDriveBackup();
              }}
              className="w-full p-3.5 rounded-2xl text-left flex items-center justify-between transition cursor-pointer active:scale-98 bg-emerald-50/70 hover:bg-emerald-100/80 text-emerald-950 border border-emerald-200/60"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-emerald-600 text-white shadow-xs">
                  <Cloud className="w-5 h-5" />
                </div>
                <div>
                  <span className="block font-black text-sm leading-tight text-emerald-900">
                    Google Drive બેકઅપ
                  </span>
                  <span className="text-[11px] font-medium leading-tight block mt-0.5 text-emerald-700">
                    ડેટા સુરક્ષિત સાચવો & રીસ્ટોર કરો
                  </span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-emerald-600" />
            </button>
          )}

                    {/* 5. સેટિંગ્સ (Settings) */}
          {onOpenSettings && (
            <button
              type="button"
              id="drawer-nav-settings"
              onClick={() => {
                setIsDrawerOpen(false);
                onOpenSettings();
              }}
              className="w-full p-3.5 rounded-2xl text-left flex items-center justify-between transition cursor-pointer active:scale-98 bg-slate-100 hover:bg-slate-200/80 text-slate-900 border border-slate-300 shadow-2xs"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-slate-800 text-white shadow-xs">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <span className="block font-black text-sm leading-tight text-slate-900">
                    માલ યાદી અને ભાવ (પ્રોડક્ટ્સ)
                  </span>
                  <span className="text-[11px] font-semibold leading-tight block mt-0.5 text-slate-600">
                    અનાજ/કઠોળ ના નામ, ભાવ અને ક્રમ ગોઠવો
                  </span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-500" />
            </button>
          )}

          
        </div>

      </aside>
    </>
  );
};