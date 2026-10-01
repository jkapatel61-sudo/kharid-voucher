import { Product } from '../types';

// Convert Gujarati digit characters (૦-૯) to standard numbers (0-9)
export const normalizeGujaratiDigits = (text: string): string => {
  const gujaratiDigits: Record<string, string> = {
    '૦': '0',
    '૧': '1',
    '૨': '2',
    '૩': '3',
    '૪': '4',
    '૫': '5',
    '૬': '6',
    '૭': '7',
    '૮': '8',
    '૯': '9',
  };
  return text.replace(/[૦-૯]/g, (char) => gujaratiDigits[char] || char);
};

// Gujarati spoken number words conversion table
const GUJARATI_NUMBER_WORDS: Record<string, number> = {
  એક: 1,
  બે: 2,
  ત્રણ: 3,
  ચાર: 4,
  પાંચ: 5,
  છ: 6,
  સાત: 7,
  આઠ: 8,
  નવ: 9,
  દસ: 10,
  અગિયાર: 11,
  બાર: 12,
  તેર: 13,
  ચૌદ: 14,
  પંદર: 15,
  સોળ: 16,
  સત્તર: 17,
  અઢાર: 18,
  ઓગણીસ: 19,
  વીસ: 20,
  એકવીસ: 21,
  બાવીસ: 22,
  ત્રેવીસ: 23,
  ચોવીસ: 24,
  પચીસ: 25,
  છવ્વીસ: 26,
  સત્તાવીસ: 27,
  અઠ્ઠાવીસ: 28,
  ઓગણત્રીસ: 29,
  ત્રીસ: 30,
  એકત્રીસ: 31,
  બત્રીસ: 32,
  તેંત્રીસ: 33,
  ચોત્રીસ: 34,
  પાંત્રીસ: 35,
  છત્રીસ: 36,
  સાડત્રીસ: 37,
  અડત્રીસ: 38,
  ઓગણચાલીસ: 39,
  ચાલીસ: 40,
  એકતાલીસ: 41,
  બેતાલીસ: 42,
  તેંતાલીસ: 43,
  ચુમ્માલીસ: 44,
  પિસ્તાલીસ: 45,
  છેતાલીસ: 46,
  સુડતાલીસ: 47,
  અડતાલીસ: 48,
  ઓગણપચાસ: 49,
  પચાસ: 50,
  એકાવન: 51,
  બાવન: 52,
  ત્રેપન: 53,
  ચોપન: 54,
  પંચાવન: 55,
  છપ્પન: 56,
  સત્તાવન: 57,
  અઠ્ઠાવન: 58,
  ઓગણસાઠ: 59,
  સાઠ: 60,
  સિત્તેર: 70,
  એંસી: 80,
  નેવું: 90,
  સો: 100,
  બસો: 200,
  ત્રણસો: 300,
  ચારસો: 400,
  પાંચસો: 500,
  છસો: 600,
  સાતસો: 700,
  આઠસો: 800,
  નવસો: 900,
  હજાર: 1000,
};

export interface ParsedVoiceBill {
  rawTranscript: string;
  matchedProduct?: Product;
  customerName?: string;
  weightKg?: number;
  ratePer20Kg?: number;
  isPrintTriggered: boolean;
}

// Common agricultural / Mandi commodity names in Gujarati to always exclude from customer names
const COMMON_COMMODITY_NAMES = [
  'ઘઉં', 'ઘઉ', 'બાજરી', 'બાજરો', 'દિવેલા', 'દિવેલી', 'એરંડા', 'એરંડ', 'રાયડો', 'રાયી', 'રાય',
  'રાજગરો', 'રાજગરા', 'તલ', 'તલી', 'જુવાર', 'જીરું', 'જીરૂ', 'વરિયાળી', 'ઇસબગુલ', 'ઇસબગોલ',
  'મેથી', 'અજમો', 'ચણા', 'તુવેર', 'મગ', 'અડદ', 'સોયાબીન', 'મગફળી', 'કપાસ', 'ડાંગર',
  'સુવા', 'ધાણા', 'ધાણી', 'ધાણાજીરું', 'ચોળી', 'વાલ', 'મઠ', 'ગુવાર', 'મકાઈ', 'કઠોળ', 'અનાજ'
];

// Spoken filler words to strip out from customer name
const FILLER_WORDS = [
  'વજન', 'વજનમાં', 'કિલો', 'કિલ્લો', 'કેજી', 'kg', 'કિ.ગ્રા', 'કિગ્રા', 'કિલોગ્રામ',
  'ભાવ', 'ભાવે', 'દર', 'rate', 'રૂપિયા', 'રૂ.', 'રૂ',
  'મણ', 'મણનો', 'મણના',
  'બિલ', 'બનાવો', 'કરો', 'આપો', 'કાઢો', 'લખો',
  'પ્રિન્ટ', 'પ્રિંટ', 'print',
  'નામ', 'નામે', 'ગ્રાહક', 'ખાતે',
  'અને', 'નો', 'ની', 'નું', 'ના', 'ને'
];

/**
 * Parses user spoken speech in Gujarati (or mixed Gujarati/English)
 * e.g.:
 * "બાજરી રમેશભાઈ વજન ૫૪૦ પ્રિન્ટ"
 * "મહેસાણા ઘઉં 320kg ભાવ 475 પ્રિન્ટ"
 * "પટેલ જીતેન્દ્રભાઈ ૪૬૦ કિલો ભાવ ૪૫૦ પ્રિન્ટ"
 * "સુરેશભાઈ ૫૫૦ કિલો"
 */
export const parseVoiceBillingCommand = (
  rawSpeech: string,
  availableProducts: Product[],
  currentActiveProduct?: Product
): ParsedVoiceBill => {
  if (!rawSpeech || !rawSpeech.trim()) {
    return { rawTranscript: '', isPrintTriggered: false };
  }

  // 1. Normalize numbers
  let text = normalizeGujaratiDigits(rawSpeech.trim());

  // Replace common spoken words to digits
  Object.entries(GUJARATI_NUMBER_WORDS).forEach(([word, num]) => {
    // Unicode-safe word replacement
    text = text.split(word).join(num.toString());
  });

  // 2. Check print command
  // Matches "પ્રિન્ટ", "પ્રિન્ટ કરો", "પ્રિન્ટ કાઢો", "print", "print bill"
  const isPrintTriggered =
    /પ્રિન્ટ|પ્રિંટ|print|છાપો|કાઢો|સેવ\s*કરો/i.test(text);

  // Remove print keywords
  let workingText = text
    .replace(/પ્રિન્ટ\s*કરો|પ્રિન્ટ\s*કાઢો|પ્રિન્ટ|પ્રિંટ|print\s*bill|print/gi, ' ')
    .trim();

  // 3. Match Product
  // Sort products by length descending so longer names match first
  const sortedProds = [...availableProducts].sort(
    (a, b) => (b.name?.length || 0) - (a.name?.length || 0)
  );

  let matchedProduct: Product | undefined = undefined;
  for (const prod of sortedProds) {
    if (prod.name && prod.name.trim().length >= 2 && workingText.includes(prod.name.trim())) {
      matchedProduct = prod;
      break;
    }
  }

  // Fallback to currently active/ticked product on screen if not spoken
  if (!matchedProduct && currentActiveProduct) {
    matchedProduct = currentActiveProduct;
  }

  // 4. Extract Rate (ભાવ / દર / rate / રૂપિયા)
  let ratePer20Kg: number | undefined = undefined;
  const rateRegex1 = /(?:ભાવ|દર|rate|રૂપિયા|રૂ\.)\s*[:=]?\s*(\d+(?:\.\d+)?)/i;
  const rateRegex2 = /(\d+(?:\.\d+)?)\s*(?:ભાવ|દર|રૂપિયા|રૂ\.)/i;

  const rMatch1 = workingText.match(rateRegex1);
  if (rMatch1) {
    ratePer20Kg = parseFloat(rMatch1[1]);
  } else {
    const rMatch2 = workingText.match(rateRegex2);
    if (rMatch2) {
      ratePer20Kg = parseFloat(rMatch2[1]);
    }
  }

  // 5. Extract Weight (વજન / કિલો / kg / કેજી)
  let weightKg: number | undefined = undefined;
  const weightRegex1 = /(?:વજન|વજનમાં|weight|કિલો|કિલ્લો|કેજી|kg|કિ\.ગ્રા|કિગ્રા)\s*[:=]?\s*(\d+(?:\.\d+)?)/i;
  const weightRegex2 = /(\d+(?:\.\d+)?)\s*(?:કિલો|કિલ્લો|કેજી|kg|કિ\.ગ્રા|કિગ્રા|કિલોગ્રામ|વજન)/i;

  const wMatch1 = workingText.match(weightRegex1);
  if (wMatch1) {
    weightKg = parseFloat(wMatch1[1]);
  } else {
    const wMatch2 = workingText.match(weightRegex2);
    if (wMatch2) {
      weightKg = parseFloat(wMatch2[1]);
    }
  }

  // 6. Extract Customer Name cleanly without ANY item name or numbers
  let cleanNameText = workingText;

  // Remove rate phrases
  cleanNameText = cleanNameText
    .replace(/(?:ભાવ|દર|rate|રૂપિયા|રૂ\.)\s*[:=]?\s*\d+(?:\.\d+)?/gi, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:ભાવ|દર|રૂપિયા|રૂ\.)/gi, ' ');

  // Remove weight phrases
  cleanNameText = cleanNameText
    .replace(/(?:વજન|વજનમાં|weight|કિલો|કિલ્લો|કેજી|kg|કિ\.ગ્રા|કિગ્રા)\s*[:=]?\s*\d+(?:\.\d+)?/gi, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:કિલો|કિલ્લો|કેજી|kg|કિ\.ગ્રા|કિગ્રા|કિલોગ્રામ|વજન)/gi, ' ');

  // If weight wasn't explicitly tagged with "કિલો/વજન", look for standalone numbers
  if (!weightKg) {
    const standaloneNumMatch = cleanNameText.match(/\b\d+(?:\.\d+)?\b/);
    if (standaloneNumMatch) {
      weightKg = parseFloat(standaloneNumMatch[0]);
      cleanNameText = cleanNameText.replace(standaloneNumMatch[0], ' ');
    }
  }

  // CRITICAL: Strip ALL product/item words and known Mandi commodity words
  // so NO item name (like "ઘઉં", "બાજરી", "દિવેલા", વગેરે) can ever leak into customer name
  const allItemWords = new Set<string>();
  if (matchedProduct?.name) allItemWords.add(matchedProduct.name);
  if (currentActiveProduct?.name) allItemWords.add(currentActiveProduct.name);

  availableProducts.forEach((p) => {
    if (p.name) allItemWords.add(p.name);
    if (p.shortcut) allItemWords.add(p.shortcut);
  });

  COMMON_COMMODITY_NAMES.forEach((c) => allItemWords.add(c));

  // Sort words by length descending so longer words match first
  const sortedItemWords = Array.from(allItemWords)
    .filter((w) => Boolean(w) && w.trim().length >= 2)
    .sort((a, b) => b.length - a.length);

  for (const itemWord of sortedItemWords) {
    if (cleanNameText.includes(itemWord)) {
      cleanNameText = cleanNameText.split(itemWord).join(' ');
    }
  }

  // Strip filler words (વજન, ભાવ, બિલ, etc.)
  for (const filler of FILLER_WORDS) {
    const fRegex = new RegExp(`(^|\\s)${filler}(\\s|$)`, 'gi');
    cleanNameText = cleanNameText.replace(fRegex, ' ');
  }

  // Strip any remaining numbers/digits
  cleanNameText = cleanNameText.replace(/\d+(?:\.\d+)?/g, ' ');

  // Clean punctuation and collapse spaces
  cleanNameText = cleanNameText
    .replace(/[,\-:।!@#$%^&*()_+={}\[\]|\\;'"<>?/`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // If anything remains and it has at least 2 characters, treat it as the customer name
  let customerName: string | undefined = undefined;
  if (cleanNameText.length >= 2) {
    customerName = cleanNameText;
  }

  return {
    rawTranscript: rawSpeech,
    matchedProduct,
    customerName,
    weightKg,
    ratePer20Kg,
    isPrintTriggered,
  };
};

export const checkSpeechRecognitionSupport = (): boolean => {
  return (
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  );
};
