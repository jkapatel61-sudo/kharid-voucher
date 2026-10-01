import React, { useState } from 'react';
import {
  Printer,
  Wifi,
  WifiOff,
  CheckCircle2,
  AlertTriangle,
  Volume2,
  VolumeX,
  Clock,
  Trash2,
  X,
  Smartphone,
  Radio,
  RotateCcw,
  Sun,
  Send,
  Loader2,
} from 'lucide-react';
import { FirmSettings, PrintJob } from '../types';
import { playPrintJobChime } from '../utils/sound';

interface AutoPrintStationModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: FirmSettings;
  onSaveSettings: (settings: FirmSettings) => void;
  jobs: PrintJob[];
  isBtConnected: boolean;
  btDeviceName: string;
  currentProcessingJob: PrintJob | null;
  onConnectPrinter: () => Promise<void>;
  onToggleStationMode: (enabled: boolean) => void;
  onReprintJob: (job: PrintJob) => Promise<void>;
  onSendTestJob: () => Promise<void>;
  onDeleteJob: (jobId: string) => Promise<void>;
}

export const AutoPrintStationModal: React.FC<AutoPrintStationModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  jobs,
  isBtConnected,
  btDeviceName,
  currentProcessingJob,
  onConnectPrinter,
  onToggleStationMode,
  onReprintJob,
  onSendTestJob,
  onDeleteJob,
}) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);

  if (!isOpen) return null;

  const isStationActive = Boolean(settings.isAutoPrintStation);
  const pendingJobsCount = jobs.filter((j) => j.status === 'pending').length;

  const handleConnectClick = async () => {
    setIsConnecting(true);
    try {
      await onConnectPrinter();
    } finally {
      setIsConnecting(false);
    }
  };

  const handleTestClick = async () => {
    setIsSendingTest(true);
    try {
      await onSendTestJob();
    } finally {
      setIsSendingTest(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/70 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-xs ${
                isStationActive ? 'bg-emerald-500 text-slate-950 animate-pulse' : 'bg-slate-800 text-slate-300'
              }`}
            >
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-tight leading-tight flex items-center gap-2">
                ઓફિસ ઑટો-પ્રિન્ટ સ્ટેશન
                {isStationActive && (
                  <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-400 text-slate-950 tracking-wider">
                    સક્રિય (Active)
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400 font-medium">
                કોઈપણ બીજા ફોનથી બિલ બને તો અહીં ઓફિસમાં આપોઆપ પ્રિન્ટ થશે
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 transition active:scale-95 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
          {/* Main Mode Toggle Card */}
          <div
            className={`p-4 sm:p-5 rounded-2xl border-2 transition-all ${
              isStationActive
                ? 'bg-emerald-50 border-emerald-500 shadow-sm shadow-emerald-500/10'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Radio className={`w-5 h-5 ${isStationActive ? 'text-emerald-700 animate-pulse' : 'text-slate-400'}`} />
                  <span className="font-black text-sm sm:text-base text-slate-900">
                    આ ફોન પર "ઑટો-પ્રિન્ટ સ્ટેશન" ચાલુ કરો
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed pl-7">
                  જ્યારે આ મોડ ચાલુ હોય, ત્યારે બહાર ટેબલ પરથી કે અન્ય કોઈ પણ મોબાઈલમાંથી બિલ બનશે, તો આ ફોન બ્લૂટૂથ પ્રિન્ટરમાંથી આપોઆપ પ્રિન્ટ કાઢી આપશે.
                </p>
              </div>

              {/* Large switch */}
              <button
                type="button"
                role="switch"
                aria-checked={isStationActive}
                onClick={() => onToggleStationMode(!isStationActive)}
                className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                  isStationActive ? 'bg-emerald-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                    isStationActive ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {isStationActive && (
              <div className="mt-3 pt-3 border-t border-emerald-200 flex flex-wrap items-center gap-2 text-xs font-bold text-emerald-900">
                <span className="flex items-center gap-1 bg-emerald-200/80 px-2 py-0.5 rounded-md">
                  <Sun className="w-3.5 h-3.5 text-emerald-800" />
                  સ્ક્રીન હંમેશા ચાલુ રહેશે
                </span>
                <span className="flex items-center gap-1 bg-emerald-200/80 px-2 py-0.5 rounded-md">
                  <Radio className="w-3.5 h-3.5 text-emerald-800" />
                  ક્લાઉડ લાઈવ મોનિટરિંગ
                </span>
              </div>
            )}
          </div>

          {/* 2 Grid Cards: Bluetooth Printer & Remote Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Bluetooth Status Card */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-black uppercase text-slate-400 tracking-wider block mb-1">
                  ઓફિસ બ્લૂટૂથ પ્રિન્ટર
                </span>
                <div className="flex items-center gap-2">
                  {isBtConnected ? (
                    <>
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                      <span className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                        <Wifi className="w-4 h-4 text-emerald-600" />
                        {btDeviceName || 'PSF588'} (કનેક્ટેડ)
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      <span className="text-sm font-black text-amber-900 flex items-center gap-1.5">
                        <WifiOff className="w-4 h-4 text-amber-600" />
                        ડિસ્કનેક્ટેડ
                      </span>
                    </>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  {isBtConnected
                    ? 'પ્રિન્ટર તૈયાર છે. રિમોટ ઓર્ડર આવતાં જ પ્રિન્ટ થશે.'
                    : 'ઑટો-પ્રિન્ટ માટે પ્રિન્ટર ચાલુ કરી કનેક્ટ કરો.'}
                </p>
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleConnectClick}
                  disabled={isConnecting}
                  className={`w-full py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition cursor-pointer active:scale-95 ${
                    isBtConnected
                      ? 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                      : 'bg-emerald-700 hover:bg-emerald-800 text-white shadow-xs'
                  }`}
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>કનેક્ટ થઈ રહ્યું છે...</span>
                    </>
                  ) : (
                    <>
                      <Printer className="w-3.5 h-3.5" />
                      <span>{isBtConnected ? 'ફરી કનેક્ટ / બદલો' : 'પ્રિન્ટર કનેક્ટ કરો'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Chime & Screen Awake Card */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-black uppercase text-slate-400 tracking-wider block mb-1">
                  અવાજ અને સ્ક્રીન સેટિંગ્સ
                </span>

                <div className="flex items-center justify-between py-1.5 border-b border-slate-200">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                    <Volume2 className="w-4 h-4 text-slate-600" />
                    <span>નવું બિલ આવે ત્યારે ડીંગ-ડોંગ અવાજ</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.playChimeOnAutoPrint !== false}
                    onChange={(e) =>
                      onSaveSettings({ ...settings, playChimeOnAutoPrint: e.target.checked })
                    }
                    className="w-4 h-4 text-emerald-600 rounded border-slate-300 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                    <Sun className="w-4 h-4 text-amber-600" />
                    <span>સ્ક્રીન ઊંઘી ન જાય (Keep Awake)</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.keepScreenAwakeInStation !== false}
                    onChange={(e) =>
                      onSaveSettings({ ...settings, keepScreenAwakeInStation: e.target.checked })
                    }
                    className="w-4 h-4 text-emerald-600 rounded border-slate-300 cursor-pointer"
                  />
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => playPrintJobChime()}
                  className="flex-1 py-1.5 px-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer transition active:scale-95"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>સાઉન્ડ ટેસ્ટ</span>
                </button>
                <button
                  type="button"
                  onClick={handleTestClick}
                  disabled={isSendingTest}
                  className="flex-1 py-1.5 px-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-300 rounded-xl text-[11px] font-black flex items-center justify-center gap-1 cursor-pointer transition active:scale-95"
                >
                  {isSendingTest ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>ટેસ્ટ પ્રિન્ટ</span>
                </button>
              </div>
            </div>
          </div>

          {/* Current Processing Banner */}
          {currentProcessingJob && (
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 flex items-center gap-3 animate-pulse">
              <Loader2 className="w-5 h-5 text-amber-600 animate-spin shrink-0" />
              <div>
                <p className="text-xs font-black text-amber-950">
                  હાલમાં પ્રિન્ટ થઈ રહ્યું છે: {currentProcessingJob.title}
                </p>
                <p className="text-[11px] text-amber-800">
                  સોર્સ: {currentProcessingJob.sourceDevice || 'અન્ય મોબાઈલ'}
                </p>
              </div>
            </div>
          )}

          {/* Print Jobs Queue and Recent History */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-500" />
                <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
                  તાજેતરની રિમોટ પ્રિન્ટ્સ ({jobs.length})
                </span>
              </div>
              {pendingJobsCount > 0 && (
                <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                  {pendingJobsCount} પેન્ડિંગ
                </span>
              )}
            </div>

            {jobs.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400">
                <Printer className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-xs font-bold text-slate-600">હજુ સુધી કોઈ રિમોટ પ્રિન્ટ આવી નથી</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  કોઈપણ બીજા ફોનમાંથી બિલ બનશે ત્યારે અહીં લાઇવ યાદી દેખાશે.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {jobs.map((job) => {
                  const timeFormatted = new Date(job.createdAt).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <div
                      key={job.id}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                        job.status === 'completed'
                          ? 'bg-emerald-50/40 border-emerald-200 text-slate-800'
                          : job.status === 'printing'
                          ? 'bg-amber-50 border-amber-300 text-amber-950 font-bold'
                          : job.status === 'failed'
                          ? 'bg-rose-50 border-rose-200 text-rose-950'
                          : 'bg-white border-slate-200 text-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {job.status === 'completed' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : job.status === 'printing' ? (
                          <Loader2 className="w-4 h-4 text-amber-600 animate-spin shrink-0" />
                        ) : job.status === 'failed' ? (
                          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                        ) : (
                          <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                        )}

                        <div className="min-w-0">
                          <p className="font-black text-slate-900 truncate">{job.title}</p>
                          <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                            <span>{timeFormatted}</span>
                            <span>•</span>
                            <span className="truncate">{job.sourceDevice || 'રિમોટ'}</span>
                            {job.errorMessage && (
                              <span className="text-rose-600 font-bold truncate">({job.errorMessage})</span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {job.bill && (
                          <button
                            type="button"
                            onClick={() => onReprintJob(job)}
                            title="ફરીથી પ્રિન્ટ કરો"
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition active:scale-95 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDeleteJob(job.id)}
                          title="યાદીમાંથી કાઢી નાખો"
                          className="p-1.5 hover:bg-rose-100 text-slate-400 hover:text-rose-600 rounded-lg transition active:scale-95 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <p className="text-[11px] text-slate-500 font-medium">
            💡 ઓફિસના ફોનમાં આ પેજ ખુલ્લું રાખવાથી બ્લૂટૂથ જોડાણ સતત ચાલુ રહેશે.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black shadow-xs transition active:scale-95 cursor-pointer"
          >
            સમજાયું (OK)
          </button>
        </div>
      </div>
    </div>
  );
};
