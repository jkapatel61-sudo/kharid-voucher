import React, { useState } from 'react';
import { X, Calendar, Printer, FileText, ArrowUpDown, Receipt, Sun, Moon, Layers } from 'lucide-react';
import { Product, SessionType, VoucherBill } from '../types';
import { calculateDailyReport, formatINR, getSessionInfo, formatDateDDMMYYYY, formatDateDayMonthYear } from '../utils/storage';

interface DailyReportModalProps {
  bills: VoucherBill[];
  products: Product[];
  currentDate: string;
  onClose: () => void;
  onOpenReceipt: (bill: VoucherBill) => void;
}

export const DailyReportModal: React.FC<DailyReportModalProps> = ({
  bills,
  products,
  currentDate,
  onClose,
  onOpenReceipt,
}) => {
  const [selectedDate, setSelectedDate] = useState<string>(currentDate);
  const [sessionFilter, setSessionFilter] = useState<'ALL' | SessionType>('ALL');

  const report = calculateDailyReport(selectedDate, bills, products);
  const dayBills = bills.filter((b) => b.date === selectedDate);
  const filteredBills = sessionFilter === 'ALL'
    ? dayBills
    : dayBills.filter((b) => (b.session || 'M') === sessionFilter);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 print:hidden">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-base">દૈનિક ખરીદ રિપોર્ટ (Daily Report)</h2>
              <p className="text-xs text-slate-500">
                સવાર (M) અને બપોર (A) સત્રની અલગ અલગ આવક સાથે દૈનિક હિસાબ
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-xl px-2.5 py-1 shadow-sm">
              <Calendar className="w-4 h-4 text-slate-500" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="text-xs font-bold text-slate-800 focus:outline-none bg-transparent"
              />
            </div>

            <button
              onClick={handlePrint}
              id="print-daily-report-btn"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold shadow-sm transition"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>પ્રિન્ટ</span>
            </button>

            <button
              id="close-daily-report-modal"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable & Scrollable Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Print only header */}
          <div className="hidden print:block text-center space-y-1 pb-4 border-b border-slate-300">
            <h1 className="text-xl font-black">ખરીદ વાઉચર - દૈનિક રિપોર્ટ</h1>
            <p className="text-sm font-semibold text-slate-700">તારીખ: {formatDateDDMMYYYY(selectedDate)}</p>
          </div>

          {/* SESSION INCOME COMPARISON CARDS (સવાર vs બપોર આવક) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-emerald-600" />
                <span>સત્ર મુજબ આવકનું વર્ગીકરણ (Morning vs Afternoon Sessions)</span>
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Session M (Morning: 12:00 - 1:30) */}
              <div className="p-4 bg-amber-50/70 border-2 border-amber-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Sun className="w-4 h-4 text-amber-600" />
                    <span className="text-xs font-black text-amber-950">સવારનું સત્ર (M)</span>
                  </div>
                  <span className="text-[10px] font-bold bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">
                    12:00 થી 1:30
                  </span>
                </div>
                <div className="pt-1">
                  <p className="text-2xl font-black text-amber-950 font-mono">
                    {formatINR(report.sessionM.netSale)}
                  </p>
                  <p className="text-[11px] font-bold text-amber-800">
                    {report.sessionM.billsCount} બિલ • {report.sessionM.totalWeightKg} kg ({report.sessionM.totalWeightMan} મણ)
                  </p>
                  {report.sessionM.discountLess > 0 && (
                    <p className="text-[10px] text-rose-700 font-medium">
                      લેસ કપાત: -{formatINR(report.sessionM.discountLess)}
                    </p>
                  )}
                </div>
              </div>

              {/* Session A (Afternoon: 1:31 - 12:00) */}
              <div className="p-4 bg-indigo-50/70 border-2 border-indigo-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Moon className="w-4 h-4 text-indigo-600" />
                    <span className="text-xs font-black text-indigo-950">બપોરનું સત્ર (A)</span>
                  </div>
                  <span className="text-[10px] font-bold bg-indigo-200 text-indigo-900 px-2 py-0.5 rounded-full">
                    1:31 થી 12:00
                  </span>
                </div>
                <div className="pt-1">
                  <p className="text-2xl font-black text-indigo-950 font-mono">
                    {formatINR(report.sessionA.netSale)}
                  </p>
                  <p className="text-[11px] font-bold text-indigo-800">
                    {report.sessionA.billsCount} બિલ • {report.sessionA.totalWeightKg} kg ({report.sessionA.totalWeightMan} મણ)
                  </p>
                  {report.sessionA.discountLess > 0 && (
                    <p className="text-[10px] text-rose-700 font-medium">
                      લેસ કપાત: -{formatINR(report.sessionA.discountLess)}
                    </p>
                  )}
                </div>
              </div>

              {/* Full Day Total */}
              <div className="p-4 bg-emerald-50 border-2 border-emerald-300 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-emerald-950 uppercase tracking-wider">
                    આખા દિવસનો કુલ સરવાળો
                  </span>
                  <span className="text-[10px] font-bold bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded-full">
                    કુલ {report.totalBills} બિલ
                  </span>
                </div>
                <div className="pt-1">
                  <p className="text-2xl font-black text-emerald-900 font-mono">
                    {formatINR(report.netSale)}
                  </p>
                  <p className="text-[11px] font-bold text-emerald-800">
                    કુલ વજન: {report.totalWeightKg} kg ({report.totalWeightMan} મણ)
                  </p>
                  <p className="text-[10px] text-emerald-700">
                    ગ્રોસ: {formatINR(report.totalGrossSale)} | લેસ: -{formatINR(report.totalDiscountLess)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Product-wise Breakdown Table */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <ArrowUpDown className="w-3.5 h-3.5 text-emerald-600" />
              <span>પ્રોડક્ટવાર સમરી (બાજરી, ઘઉં, ડાંગર વગેરે)</span>
            </h3>

            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3">પ્રોડક્ટ</th>
                      <th className="p-3 text-center">શોર્ટકટ</th>
                      <th className="p-3 text-center">બિલો</th>
                      <th className="p-3 text-right">કુલ વજન (kg)</th>
                      <th className="p-3 text-right">કુલ મણ (૨૦kg)</th>
                      <th className="p-3 text-right">સરેરાશ ભાવ</th>
                      <th className="p-3 text-right">ગ્રોસ રકમ</th>
                      <th className="p-3 text-right">લેસ</th>
                      <th className="p-3 text-right font-black text-emerald-800">નેટ રકમ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.productBreakdown.map((item) => (
                      <tr
                        key={item.productId}
                        className={`hover:bg-slate-50 transition ${
                          item.billsCount > 0 ? 'bg-white' : 'text-slate-400 opacity-60'
                        }`}
                      >
                        <td className="p-3 font-bold text-slate-800">{item.productName}</td>
                        <td className="p-3 text-center">
                          <span className="px-2 py-0.5 rounded bg-slate-100 font-mono font-bold text-slate-700 border border-slate-200">
                            {item.shortcut}
                          </span>
                        </td>
                        <td className="p-3 text-center font-semibold">{item.billsCount}</td>
                        <td className="p-3 text-right font-medium">
                          {item.totalWeightKg.toLocaleString('en-IN')} kg
                        </td>
                        <td className="p-3 text-right font-bold text-slate-900">
                          {item.totalWeightMan.toLocaleString('en-IN')}
                        </td>
                        <td className="p-3 text-right text-slate-700">
                          ₹{item.avgRatePer20Kg}
                        </td>
                        <td className="p-3 text-right text-slate-700">
                          {formatINR(item.totalGross)}
                        </td>
                        <td className="p-3 text-right text-rose-600">
                          {item.totalDiscount > 0 ? `-${formatINR(item.totalDiscount)}` : '₹0'}
                        </td>
                        <td className="p-3 text-right font-black text-emerald-700 text-sm">
                          {formatINR(item.netAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-100/80 font-bold text-slate-800 border-t border-slate-300">
                    <tr>
                      <td className="p-3 font-black" colSpan={2}>
                        કુલ સરવાળો
                      </td>
                      <td className="p-3 text-center">{report.totalBills}</td>
                      <td className="p-3 text-right font-bold">
                        {report.totalWeightKg.toLocaleString('en-IN')} kg
                      </td>
                      <td className="p-3 text-right font-black text-slate-900">
                        {report.totalWeightMan.toLocaleString('en-IN')} મણ
                      </td>
                      <td className="p-3 text-right">-</td>
                      <td className="p-3 text-right">{formatINR(report.totalGrossSale)}</td>
                      <td className="p-3 text-right text-rose-600">
                        {report.totalDiscountLess > 0
                          ? `-${formatINR(report.totalDiscountLess)}`
                          : '₹0'}
                      </td>
                      <td className="p-3 text-right font-black text-emerald-800 text-sm">
                        {formatINR(report.netSale)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

          {/* Bills of this day with Session Filter tabs */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                આ તારીખના બનેલા વાઉચર બિલો ({filteredBills.length})
              </h3>

              {/* Session Filter Tabs */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs print:hidden">
                <button
                  onClick={() => setSessionFilter('ALL')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition ${
                    sessionFilter === 'ALL'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  તમામ ({dayBills.length})
                </button>
                <button
                  onClick={() => setSessionFilter('M')}
                  className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition ${
                    sessionFilter === 'M'
                      ? 'bg-amber-100 text-amber-900 border border-amber-300 shadow-xs'
                      : 'text-slate-600 hover:text-amber-800'
                  }`}
                >
                  <Sun className="w-3 h-3 text-amber-600" />
                  <span>M સવાર ({report.sessionM.billsCount})</span>
                </button>
                <button
                  onClick={() => setSessionFilter('A')}
                  className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition ${
                    sessionFilter === 'A'
                      ? 'bg-indigo-100 text-indigo-900 border border-indigo-300 shadow-xs'
                      : 'text-slate-600 hover:text-indigo-800'
                  }`}
                >
                  <Moon className="w-3 h-3 text-indigo-600" />
                  <span>A બપોર ({report.sessionA.billsCount})</span>
                </button>
              </div>
            </div>

            {filteredBills.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-300 rounded-2xl text-slate-500 text-xs font-medium">
                આ ફિલ્ટર માટે કોઈ બિલો મળ્યા નથી.
              </div>
            ) : (
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                      <tr>
                        <th className="p-3">બિલ નં</th>
                        <th className="p-3">સત્ર / સમય</th>
                        <th className="p-3">ગ્રાહક</th>
                        <th className="p-3">માલ (આઇટમ્સ)</th>
                        <th className="p-3 text-right">કુલ વજન (kg)</th>
                        <th className="p-3 text-right">મણ</th>
                        <th className="p-3 text-right font-black">ચોખ્ખી રકમ</th>
                        <th className="p-3 text-center print:hidden">ક્રિયા</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredBills.map((b) => {
                        const sInfo = getSessionInfo(b.session || 'M');
                        return (
                          <tr key={b.id} className="hover:bg-slate-50 transition">
                            <td className="p-3 font-bold text-slate-900 font-mono">
                              {b.billNoStr || `${b.session || 'M'}${b.billNo}`}
                            </td>
                            <td className="p-3">
                              <span
                                className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                  b.session === 'M'
                                    ? 'bg-amber-100 text-amber-900 border-amber-200'
                                    : 'bg-indigo-100 text-indigo-900 border-indigo-200'
                                }`}
                              >
                                {b.session === 'M' ? (
                                  <Sun className="w-2.5 h-2.5 text-amber-600" />
                                ) : (
                                  <Moon className="w-2.5 h-2.5 text-indigo-600" />
                                )}
                                <span>{sInfo.badge}</span>
                              </span>
                              <span className="text-slate-500 text-[10px] block mt-0.5">
                                {b.time}
                              </span>
                            </td>
                            <td className="p-3 font-bold text-slate-800">
                              {b.customerName || 'ગ્રાહક'}
                            </td>
                            <td className="p-3">
                              <div className="space-y-1">
                                {b.items && b.items.length > 0 ? (
                                  b.items.map((it, idx) => (
                                    <div key={it.id || idx} className="flex items-center gap-1.5 text-[11px]">
                                      <span className="font-semibold text-emerald-900 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                                        {it.productName}
                                      </span>
                                      <span className="text-slate-600">
                                        {it.weightKg} kg @ ₹{it.ratePer20Kg}
                                      </span>
                                    </div>
                                  ))
                                ) : (
                                  <span className="text-slate-500">{b.productName || '-'}</span>
                                )}
                              </div>
                            </td>
                            <td className="p-3 text-right font-medium">{b.totalWeightKg} kg</td>
                            <td className="p-3 text-right font-bold text-slate-700">
                              {b.totalWeightMan}
                            </td>
                            <td className="p-3 text-right font-black text-emerald-700">
                              {formatINR(b.finalTotal)}
                            </td>
                            <td className="p-3 text-center print:hidden">
                              <button
                                onClick={() => onOpenReceipt(b)}
                                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold inline-flex items-center gap-1 transition cursor-pointer"
                                title="સીધી પ્રિન્ટ કરો"
                              >
                                <Printer className="w-3 h-3" />
                                <span>પ્રિન્ટ</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

