import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Plus,
  Package,
  Check,
  Bluetooth,
  Printer,
  Loader2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  FileCheck2,
} from 'lucide-react';
import { FirmSettings, Product } from '../types';
import { MandiAuthUser } from '../utils/mobileAuth';
import { Smartphone } from 'lucide-react';
import { DEFAULT_FIRM_SETTINGS } from '../utils/storage';
import {
  isBluetoothConnected,
  isPrinterConfiguredOrPermitted,
  hasPairedBluetoothDevice,
  pairOrConnectPrinter,
  printTestSlipViaBluetooth,
  setSavedPairedPrinterName,
  subscribeBluetoothStatus,
} from '../utils/bluetoothPrinter';

interface SettingsModalProps {
  products: Product[];
  settings: FirmSettings;
  onSaveProducts: (products: Product[]) => void;
  onSaveSettings: (settings: FirmSettings) => void;
  onClose: () => void;
  onOpenMobileAuth?: () => void;
  authUser?: MandiAuthUser | null;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  products,
  settings,
  onSaveProducts,
  onSaveSettings,
  onClose,
  onOpenMobileAuth,
  authUser,
}) => {
  // Products state
  const [localProducts, setLocalProducts] = useState<Product[]>(products);
  const [newName, setNewName] = useState('');
  const [newRate, setNewRate] = useState('');
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    setLocalProducts(products);
  }, [products]);

  // Firm state - Locked to PSF588 and Multi-App mode in the background
  const [firmForm, setFirmForm] = useState<FirmSettings>({
    ...settings,
    pairedPrinterName: 'PSF588',
    keepBluetoothConnected: true,
    autoDisconnectBluetooth: false,
  });
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Bluetooth Pairing State
  const [printerStatusMsg, setPrinterStatusMsg] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [btConnected, setBtConnected] = useState<boolean>(() => isBluetoothConnected());
  const [isPermanentlyPaired, setIsPermanentlyPaired] = useState<boolean>(() => isPrinterConfiguredOrPermitted());

  useEffect(() => {
    hasPairedBluetoothDevice().then((paired) => {
      setIsPermanentlyPaired(paired || isPrinterConfiguredOrPermitted());
    });
  }, []);

  useEffect(() => {
    const unsub = subscribeBluetoothStatus((connected) => {
      setBtConnected(connected);
      if (connected) setIsPermanentlyPaired(true);
    });
    return unsub;
  }, []);

  // Always keep settings saved with PSF588 and multi-app support active
  useEffect(() => {
    if (
      settings.pairedPrinterName !== 'PSF588' ||
      settings.keepBluetoothConnected !== true ||
      settings.autoDisconnectBluetooth !== false
    ) {
      const fixed: FirmSettings = {
        ...settings,
        pairedPrinterName: 'PSF588',
        keepBluetoothConnected: true,
        autoDisconnectBluetooth: false,
      };
      setFirmForm(fixed);
      onSaveSettings(fixed);
      setSavedPairedPrinterName('PSF588');
    }
  }, [settings, onSaveSettings]);

  const handlePairPrinter = async () => {
    setIsPairing(true);
    setPrinterStatusMsg('PSF588 પ્રિન્ટર શોધી રહ્યું છે...');
    try {
      const res = await pairOrConnectPrinter('PSF588', true, (msg) => {
        setPrinterStatusMsg(msg);
      });
      setIsPermanentlyPaired(true);
      setSavedPairedPrinterName('PSF588');
      const updated: FirmSettings = {
        ...firmForm,
        pairedPrinterName: 'PSF588',
        keepBluetoothConnected: true,
        autoDisconnectBluetooth: false,
      };
      setFirmForm(updated);
      onSaveSettings(updated);
      setPrinterStatusMsg(
        `✅ PSF588 કાયમ માટે સેટ થઈ ગયું છે! (મલ્ટી-એપ સપોર્ટ ઓન છે, પ્રિન્ટ પછી આપોઆપ મુક્ત થશે)`
      );
    } catch (err: any) {
      if (err?.message === 'IFRAME_PERMISSION_ERROR') {
        setPrinterStatusMsg('IFRAME_PERMISSION_ERROR');
      } else {
        setPrinterStatusMsg(err?.message || 'પેરિંગ થઈ શક્યું નથી.');
      }
    } finally {
      setIsPairing(false);
    }
  };

  const handleTestPrint = async () => {
    setIsTesting(true);
    setPrinterStatusMsg('ટેસ્ટ સ્લિપ મોકલાઈ રહી છે...');
    try {
      await printTestSlipViaBluetooth(firmForm, (msg) => {
        setPrinterStatusMsg(msg);
      });
      setBtConnected(true);
      setPrinterStatusMsg('✅ ટેસ્ટ સ્લિપ પ્રિન્ટ થઈ ગઈ! PSF588 તૈયાર છે.');
    } catch (err: any) {
      if (err?.message === 'IFRAME_PERMISSION_ERROR') {
        setPrinterStatusMsg('IFRAME_PERMISSION_ERROR');
      } else {
        setPrinterStatusMsg(err?.message || 'ટેસ્ટ પ્રિન્ટ નિષ્ફળ.');
      }
    } finally {
      setIsTesting(false);
    }
  };

  const handleAddProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    // Generate unique shortcut behind the scenes
    const existingShortcuts = new Set(localProducts.map((p) => (p.shortcut || '').toLowerCase()));
    let autoShortcut = newName.trim().charAt(0).toLowerCase();
    if (existingShortcuts.has(autoShortcut)) {
      autoShortcut = String.fromCharCode(97 + (localProducts.length % 26));
    }

    const newProd: Product = {
      id: `p_${Date.now()}`,
      name: newName.trim(),
      shortcut: autoShortcut,
      lastRatePer20Kg: parseFloat(newRate) || 500,
    };

    const updated = [...localProducts, newProd];
    setLocalProducts(updated);
    onSaveProducts(updated);

    setNewName('');
    setNewRate('');
    triggerSaveToast();
  };

  const handleUpdateRate = (id: string, rate: number) => {
    const updated = localProducts.map((p) =>
      p.id === id ? { ...p, lastRatePer20Kg: rate } : p
    );
    setLocalProducts(updated);
    onSaveProducts(updated);
  };

  const reorderItem = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    const next = [...localProducts];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setLocalProducts(next);
    onSaveProducts(next);
    triggerSaveToast();
  };

  const handleTouchStart = (idx: number) => {
    setDraggedIdx(idx);
    setDragOverIdx(idx);
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(20);
      }
    } catch {}
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (draggedIdx === null) return;
    if (e.cancelable) {
      e.preventDefault();
    }
    const clientY = e.touches[0].clientY;
    for (let i = 0; i < rowRefs.current.length; i++) {
      const el = rowRefs.current[i];
      if (el) {
        const rect = el.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
          if (dragOverIdx !== i) {
            setDragOverIdx(i);
          }
          break;
        }
      }
    }
  };

  const handleTouchEnd = () => {
    if (draggedIdx !== null && dragOverIdx !== null && draggedIdx !== dragOverIdx) {
      reorderItem(draggedIdx, dragOverIdx);
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(30);
        }
      } catch {}
    }
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleDragStart = (idx: number, e: React.DragEvent) => {
    setDraggedIdx(idx);
    setDragOverIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(idx));
    } catch {}
  };

  const handleDragOver = (idx: number, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIdx !== idx) {
      setDragOverIdx(idx);
    }
  };

  const handleDrop = (idx: number, e: React.DragEvent) => {
    e.preventDefault();
    if (draggedIdx !== null && draggedIdx !== idx) {
      reorderItem(draggedIdx, idx);
    }
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const triggerSaveToast = () => {
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-emerald-700" />
            <div>
              <h2 className="font-bold text-slate-800 text-base leading-tight">
                માલ યાદી અને ભાવ (પ્રોડક્ટ્સ)
              </h2>
              <p className="text-[11px] font-semibold text-slate-500 leading-tight">
                કુલ {localProducts.length} પ્રોડક્ટ્સ
              </p>
            </div>
          </div>
          <button
            type="button"
            id="close-settings-modal-btn"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-200 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {savedSuccess && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>વિગતો સફળતાપૂર્વક સાચવાઈ ગઈ છે!</span>
            </div>
          )}

          {/* Unified Product List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <label className="text-xs font-black text-slate-800 uppercase tracking-wide">
                માલ યાદી (ક્રમ પ્રમાણે)
              </label>
              <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                પકડીને ઉપર-નીચે ગોઠવો
              </span>
            </div>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
              {localProducts.map((p, idx) => {
                const isDragging = draggedIdx === idx;
                const isDragOver =
                  dragOverIdx === idx && draggedIdx !== null && draggedIdx !== idx;

                return (
                  <div
                    key={p.id}
                    ref={(el) => {
                      rowRefs.current[idx] = el;
                    }}
                    draggable
                    onDragStart={(e) => handleDragStart(idx, e)}
                    onDragOver={(e) => handleDragOver(idx, e)}
                    onDrop={(e) => handleDrop(idx, e)}
                    onDragEnd={handleDragEnd}
                    onTouchStart={() => handleTouchStart(idx)}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={() => {
                      setDraggedIdx(null);
                      setDragOverIdx(null);
                    }}
                    className={`p-3 flex items-center justify-between gap-3 transition select-none cursor-grab active:cursor-grabbing ${
                      isDragging
                        ? 'bg-emerald-100/80 opacity-60 scale-[0.98] border-2 border-emerald-500 shadow-md'
                        : isDragOver
                        ? 'bg-emerald-50 border-t-2 border-b-2 border-emerald-500 scale-[1.01]'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    {/* Left: Number + Clear Product Name */}
                    <div className="flex items-center gap-2.5 min-w-0 flex-1 touch-none">
                      <span
                        className={`w-6 h-6 rounded-full font-black text-xs flex items-center justify-center shrink-0 ${
                          isDragging
                            ? 'bg-emerald-600 text-white'
                            : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <span className="font-black text-slate-900 text-base sm:text-lg leading-tight truncate">
                        {p.name}
                      </span>
                    </div>

                    {/* Right: Rate Input (stop drag events here) */}
                    <div
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-xl border border-slate-200 shrink-0 cursor-default"
                    >
                      <span className="text-xs font-bold text-slate-500">₹</span>
                      <input
                        type="search"
                        inputMode="decimal"
                        autoComplete="off"
                        name={`prod_rate_${p.id}`}
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        data-form-type="other"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-bwignore="true"
                        aria-autocomplete="none"
                        value={p.lastRatePer20Kg}
                        onChange={(e) =>
                          handleUpdateRate(p.id, parseFloat(e.target.value) || 0)
                        }
                        className="w-16 sm:w-20 bg-white font-bold text-slate-900 text-sm px-1 py-0.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-center"
                        title="ભાવ/૨૦kg"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add New Product Form */}
          <form
            onSubmit={handleAddProduct}
            className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3"
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <Plus className="w-4 h-4 text-emerald-600" />
              <span>નવી પ્રોડક્ટ ઉમેરો (દા.ત. મકાઈ, કપાસ, જીરૂ)</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600">માલનું નામ</label>
                <input
                  type="text"
                  autoComplete="off"
                  name="new_product_name"
                  id="new_product_name"
                  autoCorrect="off"
                  autoCapitalize="words"
                  spellCheck={false}
                  data-form-type="other"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-bwignore="true"
                  aria-autocomplete="none"
                  placeholder="દા.ત. મકાઈ"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                  className="w-full text-xs font-medium px-2.5 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600">
                  ભાવ (૨૦kg)
                </label>
                <input
                  type="search"
                  inputMode="decimal"
                  autoComplete="off"
                  name="new_product_rate"
                  id="new_product_rate"
                  autoCorrect="off"
                  spellCheck={false}
                  data-form-type="other"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-bwignore="true"
                  aria-autocomplete="none"
                  placeholder="દા.ત. 450"
                  value={newRate}
                  onChange={(e) => setNewRate(e.target.value)}
                  required
                  className="w-full text-xs font-medium px-2.5 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white font-bold"
                />
              </div>
            </div>

            <button
              type="submit"
              id="add-new-product-submit"
              className="w-full bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white text-xs font-bold py-2.5 rounded-xl transition shadow-sm cursor-pointer"
            >
              પ્રોડક્ટ ઉમેરો
            </button>
          </form>

          {/* Mobile & PIN Management Section */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-emerald-700 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-black text-slate-800 leading-tight">
                    મોબાઈલ નંબર અને સિક્રેટ પિન (PIN)
                  </h4>
                  <p className="text-[11px] font-semibold text-slate-500 leading-tight truncate mt-0.5">
                    {authUser
                      ? `લિંક થયેલ: +91 ${authUser.phoneNumber}`
                      : 'કોઈપણ ફોન લિંક કરવા પિન સેટ કરો'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                id="open-pin-auth-btn"
                onClick={() => {
                  onClose();
                  onOpenMobileAuth?.();
                }}
                className="px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs transition cursor-pointer shrink-0"
              >
                {authUser ? 'પિન તપાસો / બદલો' : 'હમણાં લિંક કરો'}
              </button>
            </div>
          </div>

          {/* Compact PSF588 Printer Bar (Background Multi-App Mode always active) */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                  <Printer className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-black text-slate-800">PSF588 પ્રિન્ટર</span>
                    <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.2 rounded border border-emerald-300">
                      મલ્ટી-એપ ઓન
                    </span>
                  </div>
                  <p className="text-[10.5px] text-slate-500">
                    {isPermanentlyPaired
                      ? '✅ પ્રિન્ટર સેટ છે. પ્રિન્ટ પછી આપોઆપ મુક્ત થાય છે (RawBT સપોર્ટ).'
                      : 'પ્રિન્ટરને ૧ વાર પેર કરી લો, પછી કાયમ આપોઆપ પ્રિન્ટ નીકળશે.'}
                  </p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  id="compact-pair-btn"
                  onClick={handlePairPrinter}
                  disabled={isPairing}
                  className="px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg flex items-center gap-1 shadow-2xs transition cursor-pointer disabled:opacity-50"
                  title="PSF588 પ્રિન્ટર પેર કરો"
                >
                  {isPairing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Bluetooth className="w-3.5 h-3.5" />
                  )}
                  <span>{isPermanentlyPaired ? 'ફરી પેર' : '૧ વાર પેર'}</span>
                </button>

                <button
                  type="button"
                  id="compact-test-slip-btn"
                  onClick={handleTestPrint}
                  disabled={isTesting}
                  className="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-lg border border-slate-300 flex items-center gap-1 shadow-2xs transition cursor-pointer disabled:opacity-50"
                  title="ટેસ્ટ સ્લિપ પ્રિન્ટ કરો"
                >
                  {isTesting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileCheck2 className="w-3.5 h-3.5 text-slate-600" />
                  )}
                  <span>ટેસ્ટ</span>
                </button>
              </div>
            </div>

            {/* Paper Margin / Feed Control (ઉપર-નીચે ખાલી જગ્યા કંટ્રોલ) */}
            <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-700">
                પ્રિન્ટ માર્જિન (ઉપર-નીચે જગ્યા):
              </span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs">
                {[
                  { lines: 0, label: '૦ લાઇન (શૂન્ય)' },
                  { lines: 1, label: '૧ લાઇન (ઓછી)' },
                  { lines: 2, label: '૨ લાઇન' },
                ].map((opt) => (
                  <button
                    key={opt.lines}
                    type="button"
                    onClick={() => {
                      const updated = { ...firmForm, paperFeedLines: opt.lines };
                      setFirmForm(updated);
                      onSaveSettings(updated);
                      triggerSaveToast();
                    }}
                    className={`px-2 py-1 text-[10.5px] font-bold rounded-md transition cursor-pointer ${
                      (firmForm.paperFeedLines ?? 1) === opt.lines
                        ? 'bg-emerald-700 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Status Message / Alert if any */}
            {printerStatusMsg && (
              <div>
                {printerStatusMsg === 'IFRAME_PERMISSION_ERROR' ? (
                  <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl text-xs space-y-1.5 text-left">
                    <div className="flex items-start gap-1.5 text-amber-950 font-semibold">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <span>બ્લૂટૂથ પ્રિન્ટર પેર કરવા માટે એપ Chrome ની નવી ટેબમાં ખોલો:</span>
                    </div>
                    <a
                      href={window.location.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-1.5 px-3 rounded-lg text-xs transition shadow-sm w-full text-center"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>નવી ટેબમાં ખોલો</span>
                    </a>
                  </div>
                ) : (
                  <div
                    className={`p-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 ${
                      printerStatusMsg.includes('✅')
                        ? 'bg-emerald-100 text-emerald-950 border border-emerald-300'
                        : 'bg-blue-50 text-blue-950 border border-blue-200'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span className="flex-1 text-[11px]">{printerStatusMsg}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
