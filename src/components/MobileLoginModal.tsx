import React, { useState } from 'react';
import {
  X,
  Lock,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
} from 'lucide-react';
import {
  MandiAuthUser,
  formatPhoneNumber,
  authenticateWithPin,
  checkPhonePinStatus,
} from '../utils/mobileAuth';

interface MobileLoginModalProps {
  isOpen?: boolean;
  currentUser: MandiAuthUser | null;
  firmName: string;
  onLoginSuccess?: (user: MandiAuthUser) => void;
  onSuccess?: (user: MandiAuthUser) => void;
  onClose: () => void;
  onLogout?: () => void;
}

export const MobileLoginModal: React.FC<MobileLoginModalProps> = ({
  isOpen = true,
  currentUser,
  firmName,
  onLoginSuccess,
  onSuccess,
  onClose,
  onLogout,
}) => {
  if (!isOpen) return null;
  const [phoneNumber, setPhoneNumber] = useState<string>(
    currentUser?.phoneNumber || '9313172801'
  );
  const [pin, setPin] = useState<string>('');
  const [confirmPin, setConfirmPin] = useState<string>('');
  const [showPin, setShowPin] = useState<boolean>(false);
  const [isFirstTimeSetup, setIsFirstTimeSetup] = useState<boolean>(false);
  const [isChangingPin, setIsChangingPin] = useState<boolean>(false);
  const [checkedPhone, setCheckedPhone] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Check phone number when user finishes entering 10 digits
  const handlePhoneBlurOrChange = async (cleanedNum: string) => {
    if (cleanedNum.length === 10 && cleanedNum !== checkedPhone) {
      setCheckedPhone(cleanedNum);
      const res = await checkPhonePinStatus(cleanedNum);
      if (res.exists && !res.hasPin) {
        setIsFirstTimeSetup(true);
      } else if (!res.exists) {
        setIsFirstTimeSetup(true);
      } else {
        setIsFirstTimeSetup(false);
      }
    }
  };

  const handleLoginOrSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-10);
    if (cleanPhone.length !== 10) {
      setErrorMsg('કૃપા કરીને ૧૦ અંકનો સાચો મોબાઈલ નંબર દાખલ કરો.');
      return;
    }

    if (pin.length < 4) {
      setErrorMsg('કૃપા કરીને ૪ અથવા ૬ અંકનો સિક્રેટ પિન દાખલ કરો.');
      return;
    }

    if (isFirstTimeSetup && confirmPin && pin !== confirmPin) {
      setErrorMsg('બંને પિન એકસરખા નથી! કૃપા કરીને ચકાસો.');
      return;
    }

    setLoading(true);
    try {
      const res = await authenticateWithPin({
        phoneNumber: cleanPhone,
        pin: pin,
        firmName: firmName,
        isSettingNewPin: isFirstTimeSetup || isChangingPin,
      });

      if (res.success && res.user) {
        setSuccessMsg(res.message);
        setTimeout(() => {
          onLoginSuccess ? onLoginSuccess(res.user!) : (onSuccess && onSuccess(res.user!));
          onClose();
        }, 600);
      } else {
        setErrorMsg(res.message);
      }
    } catch {
      setErrorMsg('કનેક્શનમાં ખામી આવી, ફરી પ્રયત્ન કરો.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col my-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-800 to-teal-800 p-5 text-white relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          <div>
            <h3 className="text-xl font-black tracking-tight leading-tight text-white">
              ખરીદ વાઉચર
            </h3>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-4">
          {/* If already logged in: show status */}
          {currentUser && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                      લિંક થયેલુ એકાઉન્ટ
                    </span>
                  </div>
                  <p className="text-base font-black text-slate-900 mt-0.5 font-mono">
                    {formatPhoneNumber(currentUser.phoneNumber)}
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    પેઢી: <span className="font-semibold text-slate-800">{currentUser.shopName}</span>
                  </p>
                </div>
              </div>
              {onLogout && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('શું તમે આ ફોનમાંથી લોગ આઉટ કરવા માંગો છો?')) {
                      onLogout();
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 transition shrink-0 cursor-pointer"
                >
                  લૉગ આઉટ
                </button>
              )}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLoginOrSetup} className="space-y-4">
            {/* Phone Input */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                વેપારી / પેઢીનો મોબાઈલ નંબર (10 અંક):
              </label>
              <div className="flex items-center border-2 border-slate-200 rounded-2xl overflow-hidden focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-400/20 bg-white transition">
                <div className="px-3.5 py-3 bg-slate-100 border-r border-slate-200 text-slate-700 font-bold text-sm shrink-0">
                  🇮🇳 +91
                </div>
                <input
                  type="tel"
                  maxLength={10}
                  placeholder="98250 12345"
                  value={phoneNumber}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                    setPhoneNumber(digits);
                    if (digits.length === 10) {
                      handlePhoneBlurOrChange(digits);
                    }
                  }}
                  onBlur={() => handlePhoneBlurOrChange(phoneNumber)}
                  autoFocus
                  className="w-full px-3.5 py-3 text-base sm:text-lg font-black text-slate-900 tracking-wider font-mono outline-hidden"
                />
              </div>
            </div>

            {/* PIN Input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  {isChangingPin
                    ? 'નવો પિન દાખલ કરો:'
                    : isFirstTimeSetup
                    ? 'નવો પિન દાખલ કરો:'
                    : 'પિન દાખલ કરો:'}
                </label>
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="text-xs text-slate-500 hover:text-emerald-700 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  {showPin ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5" />
                      <span>છુપાવો</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5" />
                      <span>જુઓ</span>
                    </>
                  )}
                </button>
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-5 h-5" />
                </div>
                <input
                  type={showPin ? 'text' : 'password'}
                  maxLength={6}
                  inputMode="numeric"
                  placeholder="પિન દાખલ કરો"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-2xl text-lg font-mono font-bold text-slate-900 focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-400/20 outline-hidden transition tracking-widest"
                />
              </div>
            </div>

            {/* If first time setup or changing PIN: Confirm PIN field */}
            {(isFirstTimeSetup || isChangingPin) && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  પિન ફરીથી દાખલ કરો (Confirm PIN):
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <KeyRound className="w-5 h-5" />
                  </div>
                  <input
                    type={showPin ? 'text' : 'password'}
                    maxLength={6}
                    inputMode="numeric"
                    placeholder="પિન ફરી લખો"
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-2xl text-lg font-mono font-bold text-slate-900 focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-400/20 outline-hidden transition tracking-widest"
                  />
                </div>
              </div>
            )}

            {/* Error Message */}
            {errorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Success Message */}
            {successMsg && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || phoneNumber.length < 10 || pin.length < 4}
              className="w-full py-3.5 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-2xl shadow-md hover:shadow-lg transition cursor-pointer flex items-center justify-center gap-2 text-sm sm:text-base mt-2"
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>
                {loading
                  ? 'ચકાસી રહ્યું છે...'
                  : isChangingPin
                  ? 'નવો પિન સાચવો'
                  : isFirstTimeSetup
                  ? 'પિન સેટ કરો અને લોગીન કરો'
                  : 'લોગીન કરો'}
              </span>
            </button>
          </form>

          {/* Footer with PIN Change button */}
          <div className="pt-2 flex items-center justify-center border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                setIsChangingPin(!isChangingPin);
                setErrorMsg(null);
                setSuccessMsg(null);
                setPin('');
                setConfirmPin('');
              }}
              className="text-xs font-bold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer py-1 px-3 rounded-lg hover:bg-emerald-50 transition"
            >
              {isChangingPin ? '← લોગીન પર પાછા જાઓ' : 'પિન ચેન્જ (PIN બદલો)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
