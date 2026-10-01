import React, { useState, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
} from 'lucide-react';

interface DateRangePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  startDate: string;
  endDate: string;
  onApply: (start: string, end: string) => void;
}

const GUJARATI_MONTHS = [
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

const WEEKDAYS = ['સોમ', 'મંગળ', 'બુધ', 'ગુરુ', 'શુક્ર', 'શનિ', 'રવિ'];

export const DateRangePickerModal: React.FC<DateRangePickerModalProps> = ({
  isOpen,
  onClose,
  startDate,
  endDate,
  onApply,
}) => {
  const initialDate = startDate ? new Date(startDate) : new Date();
  const [viewYear, setViewYear] = useState<number>(
    isNaN(initialDate.getFullYear()) ? new Date().getFullYear() : initialDate.getFullYear()
  );
  const [viewMonth, setViewMonth] = useState<number>(
    isNaN(initialDate.getMonth()) ? new Date().getMonth() : initialDate.getMonth()
  );

  const [tempStart, setTempStart] = useState<string>(startDate);
  const [tempEnd, setTempEnd] = useState<string>(endDate);
  const [isSelectingEnd, setIsSelectingEnd] = useState<boolean>(false);

  // Sync state when modal opens
  useEffect(() => {
    if (isOpen) {
      const d = startDate ? new Date(startDate) : new Date();
      if (!isNaN(d.getTime())) {
        setViewYear(d.getFullYear());
        setViewMonth(d.getMonth());
      }
      setTempStart(startDate);
      setTempEnd(endDate);
      setIsSelectingEnd(false);
    }
  }, [isOpen, startDate, endDate]);

  if (!isOpen) return null;

  // Calendar calculations for current viewMonth & viewYear
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // 0=Mon, 6=Sun

  const formatISO = (year: number, month: number, day: number) => {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  };

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const handleDayClick = (day: number) => {
    const selected = formatISO(viewYear, viewMonth, day);

    if (!isSelectingEnd) {
      // Starting new selection
      setTempStart(selected);
      setTempEnd(selected);
      setIsSelectingEnd(true);
    } else {
      // Second click completes range
      if (selected >= tempStart) {
        setTempEnd(selected);
      } else {
        setTempEnd(tempStart);
        setTempStart(selected);
      }
      setIsSelectingEnd(false);
    }
  };

  const handleConfirm = () => {
    const s = tempStart <= tempEnd ? tempStart : tempEnd;
    const e = tempStart <= tempEnd ? tempEnd : tempStart;
    onApply(s, e);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div
        className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-emerald-800 text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-4 h-4 text-emerald-200" />
            <h2 className="text-sm font-black tracking-tight">કેલેન્ડર</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-emerald-200 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1 Month Calendar View */}
        <div className="p-4">
          {/* Month Header with Navigation */}
          <div className="flex items-center justify-between mb-3 bg-slate-50 p-2 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-700 transition cursor-pointer"
              title="અગાઉનો મહિનો"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="text-center">
              <span className="font-black text-sm sm:text-base text-slate-900">
                {GUJARATI_MONTHS[viewMonth]} {viewYear}
              </span>
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-700 transition cursor-pointer"
              title="પછીનો મહિનો"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Weekday Names */}
          <div className="grid grid-cols-7 gap-1 text-center mb-1.5">
            {WEEKDAYS.map((w, idx) => (
              <span
                key={w}
                className={`text-[11px] font-black py-1 ${
                  idx === 6 ? 'text-red-500' : 'text-slate-500'
                }`}
              >
                {w}
              </span>
            ))}
          </div>

          {/* Calendar Day Grid (1 Month) */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {/* Empty slots before first day */}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="h-9 w-full" />
            ))}

            {/* Days 1 to daysInMonth */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dayNum = i + 1;
              const dateStr = formatISO(viewYear, viewMonth, dayNum);
              const isStart = dateStr === tempStart;
              const isEnd = dateStr === tempEnd;
              const inRange =
                tempStart && tempEnd && dateStr >= tempStart && dateStr <= tempEnd;

              let style = 'bg-white hover:bg-slate-100 text-slate-800';
              if (isStart || isEnd) {
                style = 'bg-emerald-800 text-white font-black shadow-xs';
              } else if (inRange) {
                style = 'bg-emerald-100 text-emerald-950 font-bold';
              }

              return (
                <button
                  key={dayNum}
                  type="button"
                  onClick={() => handleDayClick(dayNum)}
                  className={`h-9 w-full rounded-lg text-xs font-mono font-bold transition flex items-center justify-center cursor-pointer ${style}`}
                >
                  {dayNum}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
              onApply(todayStr, todayStr);
              onClose();
            }}
            className="px-3 py-1.5 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-xs transition cursor-pointer"
          >
            આજની તારીખ
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs transition cursor-pointer"
            >
              રદ કરો
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="px-4 py-1.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-black text-xs flex items-center gap-1 shadow-xs transition active:scale-95 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5 text-emerald-200" />
              <span>લાગુ કરો</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

