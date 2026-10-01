import React, { useState } from 'react';
import { X, Plus, Check } from 'lucide-react';
import { Product } from '../types';

interface AddItemModalProps {
  existingProducts: Product[];
  onClose: () => void;
  onAdd: (newProduct: Product) => void;
}

export const AddItemModal: React.FC<AddItemModalProps> = ({
  existingProducts,
  onClose,
  onAdd,
}) => {
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('કૃપા કરીને આઇટમનું નામ લખો.');
      return;
    }

    const rateNum = parseFloat(rate) || 0;
    if (rateNum <= 0) {
      alert('કૃપા કરીને યોગ્ય ભાવ લખો.');
      return;
    }

    const shortcutChar = name.trim().charAt(0).toLowerCase();

    const newProd: Product = {
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      shortcut: shortcutChar,
      lastRatePer20Kg: rateNum,
    };

    onAdd(newProd);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden flex flex-col border border-slate-200">
        {/* Modal Header */}
        <div className="px-4 py-3 bg-emerald-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
              <Plus className="w-4 h-4" />
            </div>
            <h3 className="font-black text-sm sm:text-base leading-tight">
              નવી આઇટમ ઉમેરો (Add Item)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center transition active:scale-95 cursor-pointer"
            title="બંધ કરો"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 block">
              આઇટમનું નામ:
            </label>
            <input
              type="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="words"
              spellCheck={false}
              data-form-type="other"
              data-lpignore="true"
              required
              autoFocus
              placeholder="દા.ત. જીરૂ, બાજરી, કપાસ, ઘઉં..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-slate-50 focus:bg-white"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 block">
              ભાવ (₹ પ્રતિ ૨૦ kg / મણ):
            </label>
            <input
              type="search"
              inputMode="decimal"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              data-form-type="other"
              data-lpignore="true"
              required
              step="any"
              placeholder="દા.ત. 1200"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-slate-50 focus:bg-white"
            />
          </div>

          {/* Modal Footer */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl text-slate-600 font-bold text-xs hover:bg-slate-100 transition cursor-pointer"
            >
              રદ કરો
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs flex items-center gap-1.5 shadow-xs transition active:scale-95 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>સેવ કરો (Save)</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
