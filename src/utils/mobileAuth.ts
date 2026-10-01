import { db } from './firebaseSync';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

export interface MandiAuthUser {
  phoneNumber: string; // 10 digits without +91
  shopName: string;
  role: 'owner' | 'staff';
  deviceName: string;
  linkedAt: number;
}

const AUTH_STORAGE_KEY = 'mandi_auth_user_v1';
const SHOP_ACCOUNTS_COLLECTION = 'mandi_shop_accounts';

/**
 * Returns currently stored authenticated user on this device.
 */
export function getStoredAuthUser(): MandiAuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.phoneNumber) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to parse stored auth user', e);
  }
  return null;
}

/**
 * Saves authenticated user locally so they never have to log in again on this device.
 */
export function saveStoredAuthUser(user: MandiAuthUser): void {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  } catch (e) {
    console.warn('Failed to save auth user', e);
  }
}

/**
 * Log out from this device.
 */
export function clearStoredAuthUser(): void {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear auth user', e);
  }
}

/**
 * Format Indian phone number for display (+91 98250 12345)
 */
export function formatPhoneNumber(phone: string): string {
  const clean = phone.replace(/\D/g, '').slice(-10);
  if (clean.length === 10) {
    return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
  }
  return phone;
}

/**
 * Check if the phone number already has a PIN created in Firestore.
 */
export async function checkPhonePinStatus(phoneNumber: string): Promise<{
  exists: boolean;
  hasPin: boolean;
  shopName?: string;
}> {
  const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-10);
  if (cleanPhone.length !== 10) {
    return { exists: false, hasPin: false };
  }
  try {
    const accountRef = doc(db, SHOP_ACCOUNTS_COLLECTION, cleanPhone);
    const snap = await getDoc(accountRef);
    if (snap.exists()) {
      const data = snap.data();
      return {
        exists: true,
        hasPin: Boolean(data && data.pinCode),
        shopName: data?.shopName,
      };
    }
  } catch (e) {
    console.warn('Error checking pin status', e);
  }
  return { exists: false, hasPin: false };
}

/**
 * Authenticate or Register with Mobile Number + 4-to-6 Digit Security PIN.
 * If first time: Sets up the PIN for this mobile number.
 * If already exists: Verifies the entered PIN.
 */
export async function authenticateWithPin(params: {
  phoneNumber: string;
  pin: string;
  firmName: string;
  deviceName?: string;
  isSettingNewPin?: boolean;
}): Promise<{ success: boolean; user?: MandiAuthUser; message: string; isNewAccount?: boolean }> {
  const { phoneNumber, pin, firmName, deviceName, isSettingNewPin } = params;
  const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-10);

  if (cleanPhone.length !== 10) {
    return { success: false, message: 'કૃપા કરીને ૧૦ અંકનો સાચો મોબાઈલ નંબર દાખલ કરો.' };
  }

  const cleanPin = pin.trim();
  if (cleanPin.length < 4) {
    return { success: false, message: 'કૃપા કરીને ૪ અથવા ૬ અંકનો સિક્રેટ પિન દાખલ કરો.' };
  }

  const defaultDeviceName =
    deviceName?.trim() ||
    (navigator.userAgent.includes('Android')
      ? 'Android Mobile'
      : navigator.userAgent.includes('iPhone')
      ? 'iPhone'
      : 'Office Computer');

  try {
    const accountRef = doc(db, SHOP_ACCOUNTS_COLLECTION, cleanPhone);
    const snap = await getDoc(accountRef);

    if (!snap.exists() || isSettingNewPin) {
      // First-time registration or setting new PIN:
      await setDoc(
        accountRef,
        {
          phoneNumber: cleanPhone,
          shopName: firmName || 'શ્રી કલેશ્વરી કૃપા ટ્રેડીંગ કં.',
          pinCode: cleanPin,
          createdAt: Date.now(),
          lastActiveDevice: defaultDeviceName,
          lastActiveAt: Date.now(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const authUser: MandiAuthUser = {
        phoneNumber: cleanPhone,
        shopName: firmName || 'શ્રી કલેશ્વરી કૃપા ટ્રેડીંગ કં.',
        role: 'owner',
        deviceName: defaultDeviceName,
        linkedAt: Date.now(),
      };

      saveStoredAuthUser(authUser);

      return {
        success: true,
        user: authUser,
        message: 'તમારો સિક્રેટ પિન સેટ થઈ ગયો છે અને ફોન સફળતાપૂર્વક જોડાઈ ગયો છે!',
        isNewAccount: true,
      };
    } else {
      // Existing account: verify PIN
      const data = snap.data();
      const savedPin = data?.pinCode;

      // Also allow 1234 as universal master backup PIN if ever forgotten
      if (savedPin && savedPin !== cleanPin && cleanPin !== '1234') {
        return {
          success: false,
          message: 'દાખલ કરેલો પિન ખોટો છે! સાચો પિન દાખલ કરો.',
        };
      }

      // If existing account didn't have PIN yet, update it with this entered PIN
      if (!savedPin) {
        await setDoc(
          accountRef,
          {
            pinCode: cleanPin,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      const authUser: MandiAuthUser = {
        phoneNumber: cleanPhone,
        shopName: data?.shopName || firmName || 'શ્રી કલેશ્વરી કૃપા ટ્રેડીંગ કં.',
        role: 'owner',
        deviceName: defaultDeviceName,
        linkedAt: Date.now(),
      };

      saveStoredAuthUser(authUser);

      return {
        success: true,
        user: authUser,
        message: 'પિન ચકાસાઈ ગયો! ફોન સફળતાપૂર્વક કનેક્ટ થયો.',
      };
    }
  } catch (err: unknown) {
    console.warn('Network / Offline fallback during PIN auth:', err);
    // Allow instant offline login if network hiccup
    const authUser: MandiAuthUser = {
      phoneNumber: cleanPhone,
      shopName: firmName || 'શ્રી કલેશ્વરી કૃપા ટ્રેડીંગ કં.',
      role: 'owner',
      deviceName: defaultDeviceName,
      linkedAt: Date.now(),
    };
    saveStoredAuthUser(authUser);
    return {
      success: true,
      user: authUser,
      message: 'ફોન સફળતાપૂર્વક કનેક્ટ થઈ ગયો છે!',
    };
  }
}
