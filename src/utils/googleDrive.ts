// Google Drive Backup & Restore Client-Side Helper
// Uses Google Identity Services (GSI) initTokenClient and Google Drive REST API v3

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            prompt?: string;
            hint?: string;
            callback: (response: { access_token?: string; error?: string; expires_in?: number | string }) => void;
            error_callback?: (err: unknown) => void;
          }) => {
            requestAccessToken: (overrideConfig?: { hint?: string; prompt?: string }) => void;
          };
        };
      };
    };
  }
}

const BACKUP_FILE_NAME = 'kaleshwari_apmc_mandi_backup.json';
const BACKUP_MIME_TYPE = 'application/json';
const SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid';

export interface GoogleAccountInfo {
  email: string;
  name?: string;
  picture?: string;
  connectedAt?: string;
}

export const getStoredGoogleAccount = (): GoogleAccountInfo | null => {
  try {
    const raw = localStorage.getItem('kaleshwari_google_account');
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
};

export const setStoredGoogleAccount = (acc: GoogleAccountInfo | null) => {
  if (acc) {
    localStorage.setItem('kaleshwari_google_account', JSON.stringify(acc));
  } else {
    localStorage.removeItem('kaleshwari_google_account');
  }
};

export const getStoredLastBackupTime = (): string => {
  return localStorage.getItem('kaleshwari_last_backup_time') || '';
};

export const setStoredLastBackupTime = (timeStr: string) => {
  localStorage.setItem('kaleshwari_last_backup_time', timeStr);
};

// Cached Google OAuth Token with Expiration
export const getCachedGoogleToken = (): string | null => {
  try {
    const raw = localStorage.getItem('kaleshwari_google_token_cache');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // If token has at least 2 minutes left before expiring
    if (parsed.token && parsed.expiresAt && Date.now() < parsed.expiresAt - 120000) {
      return parsed.token;
    }
  } catch {}
  return null;
};

export const setCachedGoogleToken = (token: string | null, expiresInSeconds: number = 3600) => {
  if (token) {
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    localStorage.setItem(
      'kaleshwari_google_token_cache',
      JSON.stringify({ token, expiresAt })
    );
  } else {
    localStorage.removeItem('kaleshwari_google_token_cache');
  }
};

export const formatBackupDateTime = (dateInput?: string | number | Date): string => {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const hourStr = String(hours).padStart(2, '0');
  return `${day}/${month}/${year} (${hourStr}:${minutes} ${ampm})`;
};

export const fetchGoogleUserInfo = async (
  accessToken: string
): Promise<GoogleAccountInfo | null> => {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.email) {
        return {
          email: data.email,
          name: data.name || data.email.split('@')[0],
          picture: data.picture,
          connectedAt: new Date().toISOString(),
        };
      }
    }
  } catch (err) {
    console.error('Error fetching Google userinfo:', err);
  }
  return null;
};

export interface DriveBackupPayload {
  version: number;
  appName: string;
  backupDate: string;
  timestamp: number;
  bills: unknown[];
  products: unknown[];
  settings: unknown;
}

export interface DriveBackupFileInfo {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
}

// Project Google OAuth Client ID provisioned via setup
export const DEFAULT_GOOGLE_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) ||
  '641803345342-l4buleisp41h8trkthkqlfbs6lou3hb7.apps.googleusercontent.com';

// Request Access Token using GSI client (with caching)
export const requestGoogleDriveToken = (
  customClientId?: string,
  forceRefresh: boolean = false,
  accountHint?: string,
  promptSelectAccount: boolean = false
): Promise<string> => {
  if (!forceRefresh) {
    const cached = getCachedGoogleToken();
    if (cached) {
      return Promise.resolve(cached);
    }
  }

  const clientId = customClientId || DEFAULT_GOOGLE_CLIENT_ID;
  const stored = getStoredGoogleAccount();
  const hint = accountHint || stored?.email || 'jkapatel61@gmail.com';

  return new Promise((resolve, reject) => {
    if (!clientId) {
      reject(new Error('Google Client ID ઉપલબ્ધ નથી. કૃપા કરીને સેટિંગ્સ તપાસો.'));
      return;
    }

    if (!window.google?.accounts?.oauth2) {
      reject(
        new Error(
          'Google સાઇન-ઇન લાઇબ્રેરી હજુ લોડ થઈ રહી છે. કૃપા કરીને ૨ સેકન્ડ પછી ફરી પ્રયાસ કરો.'
        )
      );
      return;
    }

    try {
      const promptMode = promptSelectAccount ? 'select_account' : '';
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        prompt: promptMode,
        hint: hint || undefined,
        callback: (resp) => {
          if (resp.error) {
            setCachedGoogleToken(null);
            reject(new Error(`Google અધિકૃતતા ભૂલ: ${resp.error}`));
            return;
          }
          if (resp.access_token) {
            const expiresIn = resp.expires_in ? Number(resp.expires_in) : 3600;
            setCachedGoogleToken(resp.access_token, expiresIn);
            resolve(resp.access_token);
          } else {
            setCachedGoogleToken(null);
            reject(new Error('Google ઍક્સેસ ટોકન મળી શક્યું નથી.'));
          }
        },
        error_callback: (err) => {
          const errMsg = String((err as any)?.message || err);
          if (errMsg.toLowerCase().includes('popup window closed') || errMsg.toLowerCase().includes('closed')) {
            reject(new Error('Google સાઇન-ઇન વિન્ડો બંધ થઈ ગઈ છે.'));
          } else {
            setCachedGoogleToken(null);
            reject(new Error(`Google Sign-In ભૂલ: ${errMsg}`));
          }
        },
      });

      const requestConfig: any = {
        prompt: promptMode,
      };
      if (hint) {
        requestConfig.hint = hint;
      }
      tokenClient.requestAccessToken(requestConfig);
    } catch (err) {
      reject(err);
    }
  });
};

// Find existing backup file in user's Drive (created by this app)
export const findDriveBackupFile = async (
  accessToken: string
): Promise<DriveBackupFileInfo | null> => {
  const query = encodeURIComponent(
    `name = '${BACKUP_FILE_NAME}' and trashed = false`
  );
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=modifiedTime%20desc&fields=files(id,name,modifiedTime,size)`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error?.message || `ડ્રાઇવ ફાઇલ શોધવામાં ભૂલ: ${response.statusText}`
    );
  }

  const data = await response.json();
  if (data.files && data.files.length > 0) {
    return data.files[0] as DriveBackupFileInfo;
  }
  return null;
};

// Upload or Update Backup File to Google Drive
export const saveBackupToDrive = async (
  accessToken: string,
  payload: DriveBackupPayload
): Promise<DriveBackupFileInfo> => {
  const existingFile = await findDriveBackupFile(accessToken);
  const jsonContent = JSON.stringify(payload, null, 2);
  const fileBlob = new Blob([jsonContent], { type: BACKUP_MIME_TYPE });

  if (existingFile) {
    // Update existing file content
    const updateRes = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=media`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': BACKUP_MIME_TYPE,
        },
        body: fileBlob,
      }
    );

    if (!updateRes.ok) {
      const errorData = await updateRes.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || `ડ્રાઇવમાં બેકઅપ અપડેટ કરવામાં નિષ્ફળ: ${updateRes.statusText}`
      );
    }

    const updatedData = await updateRes.json();
    return {
      id: updatedData.id,
      name: BACKUP_FILE_NAME,
      modifiedTime: new Date().toISOString(),
    };
  } else {
    // Create multipart upload for new file with metadata + file content
    const metadata = {
      name: BACKUP_FILE_NAME,
      mimeType: BACKUP_MIME_TYPE,
      description: 'શ્રી કલેશ્વરી કૃપા ટ્રેડીંગ કું. - ખરીદ વાઉચર ડેટા બેકઅપ',
    };

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${BACKUP_MIME_TYPE}\r\n\r\n` +
      jsonContent +
      closeDelimiter;

    const createRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartRequestBody,
      }
    );

    if (!createRes.ok) {
      const errorData = await createRes.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || `ડ્રાઇવમાં નવી બેકઅપ ફાઇલ બનાવવામાં નિષ્ફળ: ${createRes.statusText}`
      );
    }

    const createdData = await createRes.json();
    return {
      id: createdData.id,
      name: createdData.name || BACKUP_FILE_NAME,
      modifiedTime: new Date().toISOString(),
    };
  }
};

// Download backup content from Google Drive
export const downloadBackupFromDrive = async (
  accessToken: string,
  fileId: string
): Promise<DriveBackupPayload> => {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error?.message || `ડ્રાઇવમાંથી બેકઅપ ડાઉનલોડ કરવામાં નિષ્ફળ: ${response.statusText}`
    );
  }

  const rawText = await response.text();
  try {
    const data = JSON.parse(rawText);
    return data as DriveBackupPayload;
  } catch (err) {
    throw new Error('બેકઅપ ફાઇલ વાંચવામાં ક્ષતિ આવી. કૃપા કરીને ફરી બેકઅપ લો.');
  }
};
