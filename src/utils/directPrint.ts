import { FirmSettings, VoucherBill, WeighmentSlipData } from '../types';
import { formatDateDDMM, formatINR, formatTimeSimple } from './storage';
import {
  isWebBluetoothSupported,
  printReceiptViaBluetooth,
  printWeighmentViaBluetooth,
  printCombinedViaBluetooth,
} from './bluetoothPrinter';
import { getLatestWeighmentsCache } from './firebaseSync';

export const isInsideIframe = (): boolean => {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
};

/**
 * Resolves or reconstructs weighment slip data for a bill so that both
 * weight records and bill payment are printed together seamlessly.
 */
export const resolveWeighmentSlip = (bill: VoucherBill): WeighmentSlipData | undefined => {
  const billItems = bill.items && bill.items.length > 0 ? bill.items : [];

  // If bill has an attached weighmentSlip, verify it has actual Kanta bag weighment data
  if (bill.weighmentSlip) {
    const hasBags =
      (bill.weighmentSlip.totalBagsCount && bill.weighmentSlip.totalBagsCount > 0) ||
      bill.weighmentSlip.items?.some((it) => it.bags && it.bags.length > 0) ||
      Boolean(bill.weighmentId);

    // If made directly without bags, do not print a duplicate weight section
    if (!hasBags) {
      return undefined;
    }

    const slip = {
      ...bill.weighmentSlip,
      items: [...bill.weighmentSlip.items],
    };
    billItems.forEach((bItem) => {
      const exists = slip.items.some(
        (sItem) =>
          sItem.productName.trim().toLowerCase() === bItem.productName.trim().toLowerCase() ||
          (bItem.productName.includes('+') && bItem.productName.includes(sItem.productName))
      );
      if (!exists) {
        slip.items.push({
          productName: bItem.productName,
          weightKg: bItem.weightKg,
          grossWeightKg: bItem.weightKg,
          tareWeightKg: undefined,
          weightMan: Math.round((bItem.weightKg / 20) * 10) / 10,
          ratePer20Kg: bItem.ratePer20Kg,
          amount: bItem.amount,
          bags: [],
        });
        slip.totalWeightKg = Math.round((slip.totalWeightKg + bItem.weightKg) * 100) / 100;
      }
    });
    return slip;
  }

  const cache = getLatestWeighmentsCache();
  if (!cache || cache.length === 0) {
    return undefined;
  }

  // Find matching Kanta weighments explicitly attached to this bill
  const matchingWeighments = cache.filter((w) => {
    if (bill.weighmentId && w.id === bill.weighmentId) return true;
    if (w.billId && w.billId === bill.id) return true;
    return false;
  });

  // If this bill was created directly from "નવું વજન" (no attached Kanta weighments):
  // Return undefined so it prints ONLY the clean Voucher Bill (વાઉચર બિલ)!
  if (matchingWeighments.length === 0) {
    return undefined;
  }

  // Verify that at least one attached weighment has actual bags
  const hasActualBags = matchingWeighments.some(
    (w) =>
      (w.bags && w.bags.length > 0) ||
      (w.items && w.items.some((it) => it.bags && it.bags.length > 0)) ||
      (w.totalBagsCount && w.totalBagsCount > 0)
  );

  if (!hasActualBags) {
    return undefined;
  }

  let totalBags = 0;
  let totalNet = 0;
  let totalGross = 0;
  let totalTare = 0;
  const slipItems: WeighmentSlipData['items'] = [];

  matchingWeighments.forEach((w) => {
    if (w.items && w.items.length > 0) {
      w.items.forEach((it) => {
        const bList = it.bags || [];
        const grossW =
          it.grossWeightKg !== undefined
            ? it.grossWeightKg
            : bList.length > 0
            ? Math.round(bList.reduce((acc, v) => acc + (Number(v) || 0), 0) * 10) / 10
            : it.netWeightKg;
        const tareW = it.tareWeightKg || 0;
        const netW = it.netWeightKg;

        totalBags += bList.length;
        totalNet += netW;
        totalGross += grossW;
        if (tareW > 0) totalTare += tareW;

        slipItems.push({
          productName: it.productName,
          weightKg: netW,
          grossWeightKg: grossW,
          tareWeightKg: tareW > 0 ? tareW : undefined,
          weightMan: Math.round((netW / 20) * 10) / 10,
          ratePer20Kg: it.ratePer20Kg,
          amount: it.calculatedAmount,
          bags: it.bags,
        });
      });
    } else {
      const bList = Array.isArray(w.bags) ? w.bags : [];
      const grossW =
        bList.length > 0
          ? Math.round(bList.reduce((acc, v) => acc + (Number(v) || 0), 0) * 10) / 10
          : w.totalWeightKg;
      let tareW = w.tareWeightKg || 0;
      if (tareW <= 0 && grossW > w.totalWeightKg) {
        tareW = Math.round((grossW - w.totalWeightKg) * 10) / 10;
      }
      const netW = tareW > 0 ? Math.max(0, Math.round((grossW - tareW) * 10) / 10) : w.totalWeightKg;

      totalBags += w.totalBagsCount || bList.length;
      totalNet += netW;
      totalGross += grossW;
      if (tareW > 0) totalTare += tareW;

      slipItems.push({
        productName: w.productName,
        weightKg: netW,
        grossWeightKg: grossW,
        tareWeightKg: tareW > 0 ? tareW : undefined,
        weightMan: Math.round((netW / 20) * 10) / 10,
        ratePer20Kg: w.ratePer20Kg,
        amount: w.calculatedAmount,
        bags: bList,
      });
    }
  });

  // Guarantee that every item from the bill appears in the slip!
  billItems.forEach((bi) => {
    const alreadyPresent = slipItems.some(
      (si) =>
        si.productName.trim().toLowerCase() === bi.productName.trim().toLowerCase() ||
        (bi.productName.includes('+') && bi.productName.includes(si.productName))
    );
    if (!alreadyPresent) {
      totalNet += bi.weightKg;
      totalGross += bi.weightKg;
      slipItems.push({
        productName: bi.productName,
        weightKg: bi.weightKg,
        grossWeightKg: bi.weightKg,
        tareWeightKg: undefined,
        weightMan: Math.round((bi.weightKg / 20) * 10) / 10,
        ratePer20Kg: bi.ratePer20Kg,
        amount: bi.amount,
        bags: [],
      });
    }
  });

  return {
    date: matchingWeighments[0]?.date || bill.date,
    time: matchingWeighments[0]?.time || bill.time,
    customerName: bill.customerName || matchingWeighments[0]?.customerName,
    billNoStr: bill.billNoStr,
    items: slipItems,
    totalBagsCount: totalBags,
    totalWeightKg: Math.round(totalNet * 100) / 100,
    grossWeightKg: Math.round(totalGross * 100) / 100,
    tareWeightKg: totalTare > 0 ? Math.round(totalTare * 100) / 100 : undefined,
    totalWeightMan: Math.round((totalNet / 20) * 10) / 10,
    totalAmount: bill.finalTotal || matchingWeighments[0]?.calculatedAmount,
  };
};

/**
 * Triggers a direct system print for thermal receipts using a hidden iframe
 * so that no modal or popup screen appears in the application.
 */
export const directSystemPrint = (bill: VoucherBill, settings: FirmSettings): void => {
  if (typeof window === 'undefined') return;

  // If bill has or matches attached weighment data, print the combined slip (weights first + bill below)
  const resolvedSlip = resolveWeighmentSlip(bill);
  if (resolvedSlip) {
    directSystemPrintCombined(bill, resolvedSlip, settings);
    return;
  }

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0px';
  iframe.style.height = '0px';
  iframe.style.border = 'none';
  iframe.setAttribute('title', 'Direct Thermal Print');

  let phoneList = (settings.phone || '')
    .split(/[,/\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!phoneList.includes('9427077011') || !phoneList.includes('9313172801')) {
    phoneList = ['9427077011', '9313172801'];
  }

  const itemsHtml = (bill.items || [])
    .map(
      (item, idx) => `
      <div style="margin-bottom: 6px;">
        <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 13px;">
          <span>${idx + 1}. ${item.productName}</span>
          <span>${idx === 0 ? 'ભાવ' : ''}</span>
          <span>${idx === 0 ? 'રકમ' : ''}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-family: monospace; font-size: 12px; margin-top: 2px;">
          <span>${item.weightKg} kg</span>
          <span>${item.ratePer20Kg}</span>
          <span style="font-weight: bold;">${Math.round(item.amount).toLocaleString('en-IN')}</span>
        </div>
      </div>
    `
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>વાઉચર સ્લિપ - ${bill.billNoStr || bill.billNo}</title>
        <style>
          @page {
            margin: 0;
            size: ${settings.paperWidth === '80mm' ? '80mm' : '58mm'} auto;
          }
          body {
            margin: 0;
            padding: 8px 4px 20px 4px;
            font-family: monospace, sans-serif;
            font-size: 12px;
            color: #000;
            width: ${settings.paperWidth === '80mm' ? '72mm' : '48mm'};
          }
          .text-center { text-align: center; }
          .border-b-dashed { border-bottom: 1px dashed #000; padding-bottom: 3px; margin-bottom: 3px; }
          .border-t-dashed { border-top: 1px dashed #000; padding-top: 6px; margin-top: 6px; }
          .flex-between { display: flex; justify-content: space-between; }
          .bold { font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="text-center border-b-dashed">
          <div style="font-size: 15px; font-weight: bold;">${settings.firmName || 'શ્રી કલેશ્વરી કૃપા ટ્રેડીંગ કું.'}</div>
          ${(settings.tagline || 'અનાજ, કઠોળ, તેલીબીયા તથા કેટલફીડના વહેપારી') ? `<div style="font-size: 10px; margin-top: 2px;">${settings.tagline || 'અનાજ, કઠોળ, તેલીબીયા તથા કેટલફીડના વહેપારી'}</div>` : ''}
          ${(settings.address || 'હરસિદ્ધિ માતાના મંદિર પાસે') ? `<div style="font-size: 10px;">${settings.address || 'હરસિદ્ધિ માતાના મંદિર પાસે'}</div>` : ''}
          ${(settings.addressLine2 || 'મુ. વાસણા, પો. મહિસા, તા. મહુધા, જી. ખેડા') ? `<div style="font-size: 10px;">${settings.addressLine2 || 'મુ. વાસણા, પો. મહિસા, તા. મહુધા, જી. ખેડા'}</div>` : ''}
          <div style="font-size: 10px; margin-top: 3px;">Mo. ${phoneList.join('  Mo. ')}</div>
          ${(settings.gstNo || '24ADDPP1757F1ZP') ? `<div style="font-size: 9px; margin-top: 3px;">GSTIN: ${settings.gstNo || '24ADDPP1757F1ZP'}</div>` : ''}
          ${(settings.licenseNo || '01/1998 Dt.25-08-1998') ? `<div style="font-size: 9px;">લા.નં: ${settings.licenseNo || '01/1998 Dt.25-08-1998'}</div>` : ''}
        </div>

        <div class="border-b-dashed">
          <div class="flex-between">
            <span>બિલ નં: <b style="font-family: monospace;">${bill.billNoStr || bill.billNo}</b></span>
            <span>તારીખ: ${formatDateDDMM(bill.date)}</span>
          </div>
          <div class="flex-between" style="margin-top: 3px;">
            <span>ગ્રાહક: <b>${bill.customerName || 'સામાન્ય ગ્રાહક'}</b></span>
            ${bill.time ? `<span style="font-family: monospace; font-size: 11px;">${formatTimeSimple(bill.time)}</span>` : ''}
          </div>
        </div>

        <div style="margin-bottom: 4px;">
          ${itemsHtml}
        </div>

        <div class="border-t-dashed">
          <div class="flex-between bold" style="font-size: 14px;">
            <span>ચોખ્ખી રકમ:</span>
            <span>${formatINR(bill.finalTotal)}</span>
          </div>
          <div class="flex-between" style="font-size: 11px; margin-top: 3px;">
            <span>કુલ વજન:</span>
            <span>${bill.totalWeightKg} kg</span>
          </div>
        </div>

        <div class="text-center" style="font-size: 11px; margin-top: 8px; margin-bottom: 20px;">
          <div>આભાર, ફરી પધારશો!</div>
        </div>
      </body>
    </html>
  `;

  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) return;

  doc.open();
  doc.write(html);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (e) {
      console.warn('Iframe print error:', e);
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 2000);
    }
  }, 250);
};

/**
 * Direct system print for Combined Slip:
 * First the bag weights (કાંટા વજન પત્રક) and below it the Cash Voucher Bill (વાઉચર બિલ)
 */
export const directSystemPrintCombined = (
  bill: VoucherBill,
  slip: WeighmentSlipData,
  settings: FirmSettings
): void => {
  if (typeof window === 'undefined') return;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0px';
  iframe.style.height = '0px';
  iframe.style.border = 'none';
  iframe.setAttribute('title', 'Direct Combined Print');

  let phoneList = (settings.phone || '')
    .split(/[,/\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!phoneList.includes('9427077011') || !phoneList.includes('9313172801')) {
    phoneList = ['9427077011', '9313172801'];
  }

  // Weight items (bags)
  const weightItemsHtml = slip.items
    .map((item) => {
      let bagsHtml = '';
      if (item.bags && item.bags.length > 0) {
        const half = Math.ceil(item.bags.length / 2);
        let rows = '';
        let leftColTotal = 0;
        let rightColTotal = 0;

        for (let i = 0; i < half; i++) {
          const lNum = i + 1;
          const lWeight = Number(item.bags[i]);
          leftColTotal += lWeight;

          const rIdx = i + half;
          let rHtml = '<span></span>';
          if (rIdx < item.bags.length) {
            const rWeight = Number(item.bags[rIdx]);
            rightColTotal += rWeight;
            rHtml = `<span>${String(rIdx + 1).padStart(2, ' ')} ) ${rWeight.toFixed(1)}</span>`;
          }

          rows += `
            <div style="display: flex; justify-content: space-between; font-family: monospace; font-size: 13px; font-weight: bold; padding: 1.5px 0;">
              <span>${String(lNum).padStart(2, ' ')} ) ${lWeight.toFixed(1)}</span>
              ${rHtml}
            </div>
          `;
        }

        const leftFormatted = parseFloat(leftColTotal.toFixed(1));
        const rightFormatted = parseFloat(rightColTotal.toFixed(1));

        bagsHtml = `
          <div style="margin: 3px 0; padding: 2px 0;">
            ${rows}
            <div style="display: flex; justify-content: space-between; font-family: monospace; font-size: 14.5px; font-weight: 900; border-top: 1px dashed #444; margin-top: 3px; padding-top: 2px;">
              <span style="padding-left: 2.8ch;">${leftFormatted} kg</span>
              ${rightColTotal > 0 ? `<span style="padding-left: 2.8ch;">${rightFormatted} kg</span>` : '<span></span>'}
            </div>
          </div>
        `;
      }

        const itemGross =
          item.grossWeightKg ??
          (item.bags && item.bags.length > 0
            ? Math.round(item.bags.reduce((acc, v) => acc + (Number(v) || 0), 0) * 10) / 10
            : item.weightKg);
        const diffGrossNet = Math.round((itemGross - item.weightKg) * 10) / 10;
        const itemTare = item.tareWeightKg ?? (diffGrossNet > 0 ? diffGrossNet : 0);
        const itemNet =
          itemTare > 0
            ? Math.round((itemGross - itemTare) * 10) / 10
            : Math.round(item.weightKg * 10) / 10;
        const itemBagsCount = item.bags ? item.bags.length : 0;

        const itemSubSummaryHtml =
          slip.items.length > 1
            ? `
          <div style="border-top: 1px dashed #777; margin-top: 4px; padding-top: 3px;">
            ${
              itemTare > 0
                ? `
              <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold;">
                <span>કુલ વજન:</span>
                <span style="font-family: monospace; font-size: 13.5px; font-weight: 800;">${parseFloat(
                  itemGross.toFixed(1)
                )} kg</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold; margin-top: 1.5px;">
                <span>કુલ થેલી:&nbsp;&nbsp;&nbsp;&nbsp;${itemBagsCount || ''}</span>
                <span style="font-family: monospace; font-size: 13.5px; font-weight: 800;">-${parseFloat(
                  itemTare.toFixed(1)
                )} kg</span>
              </div>
              <div style="border-top: 1px dashed #999; margin: 2px 0;"></div>
              <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 900; margin-top: 1.5px;">
                <span>નેટ વજન:</span>
                <span style="font-family: monospace; font-size: 15px; font-weight: 900;">${parseFloat(
                  itemNet.toFixed(1)
                )} kg</span>
              </div>
            `
                : `
              ${
                itemBagsCount > 0
                  ? `
              <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold;">
                <span>કુલ થેલી:&nbsp;&nbsp;&nbsp;&nbsp;${itemBagsCount}</span>
              </div>`
                  : ''
              }
              <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 900; margin-top: 1.5px;">
                <span>નેટ વજન:</span>
                <span style="font-family: monospace; font-size: 15px; font-weight: 900;">${parseFloat(
                  itemNet.toFixed(1)
                )} kg</span>
              </div>
            `
            }
          </div>
        `
            : '';

        return `
        <div style="margin-bottom: 5px; border-bottom: 1px dashed #ccc; padding-bottom: 4px;">
          <div style="font-weight: bold; font-size: 13.5px;">
            <span>માલ: ${item.productName}</span>
          </div>
          ${bagsHtml}
          ${
            !item.bags || item.bags.length === 0
              ? `
          <div style="display: flex; justify-content: space-between; font-family: monospace; font-size: 13.5px; font-weight: bold; margin-top: 2px;">
            <span>વજન: ${item.weightKg} kg</span>
          </div>`
              : ''
          }
          ${itemSubSummaryHtml}
        </div>
      `;
    })
    .join('');

  // Weight summary calculation (only for single item; omitted for multi-item as requested)
  const singleItem = slip.items[0];
  const grossW =
    slip.grossWeightKg ??
    (singleItem?.bags && singleItem.bags.length > 0
      ? singleItem.bags.reduce((acc, b) => acc + Number(b), 0)
      : singleItem?.weightKg || 0);
  const roundedGross = Math.round(grossW * 10) / 10;

  let tareW = slip.tareWeightKg ?? (singleItem?.tareWeightKg || 0);
  if ((!tareW || tareW <= 0) && singleItem?.bags && singleItem.bags.length > 0) {
    const diff = Math.round((grossW - (singleItem?.weightKg || 0)) * 10) / 10;
    if (diff > 0) tareW = diff;
  }
  const roundedTare = Math.round(tareW * 10) / 10;
  const roundedNet =
    roundedTare > 0
      ? Math.round((roundedGross - roundedTare) * 10) / 10
      : Math.round((singleItem?.weightKg || slip.totalWeightKg) * 10) / 10;

  let weightSummaryHtml = '';
  if (slip.items.length === 1) {
    weightSummaryHtml =
      roundedTare > 0
        ? `
      <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; margin-top: 3px;">
        <span>કુલ વજન:</span>
        <span style="font-family: monospace; font-size: 15px; font-weight: 800;">${parseFloat(roundedGross.toFixed(1))} kg</span>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; margin-top: 2px;">
        <span>કુલ થેલી:&nbsp;&nbsp;&nbsp;&nbsp;${slip.totalBagsCount || ''}</span>
        <span style="font-family: monospace; font-size: 15px; font-weight: 800;">-${parseFloat(roundedTare.toFixed(1))} kg</span>
      </div>
      <div style="border-top: 1px solid #000; margin: 3px 0;"></div>
      <div style="display: flex; justify-content: space-between; font-size: 15px; font-weight: 900; margin-top: 2px;">
        <span>નેટ વજન:</span>
        <span style="font-family: monospace; font-size: 18px; font-weight: 900;">${parseFloat(roundedNet.toFixed(1))} kg</span>
      </div>
    `
        : `
      ${
        slip.totalBagsCount
          ? `
      <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; margin-top: 2px;">
        <span>કુલ થેલી:&nbsp;&nbsp;&nbsp;&nbsp;${slip.totalBagsCount}</span>
      </div>`
          : ''
      }
      <div style="display: flex; justify-content: space-between; font-size: 15px; font-weight: 900; margin-top: 2px;">
        <span>કુલ વજન:</span>
        <span style="font-family: monospace; font-size: 18px; font-weight: 900;">${parseFloat(roundedNet.toFixed(1))} kg</span>
      </div>
    `;
  }

  // Bill items: decompose if multiple items in slip
  let billItems = bill.items && bill.items.length > 0 ? [...bill.items] : [];
  if (
    slip.items &&
    slip.items.length > 1 &&
    (billItems.length <= 1 || billItems.some((bi) => bi.productName.includes('+')))
  ) {
    billItems = slip.items.map((sit, sIdx) => {
      const sGross =
        sit.grossWeightKg ??
        (sit.bags && sit.bags.length > 0
          ? Math.round(sit.bags.reduce((a, b) => a + Number(b), 0) * 10) / 10
          : sit.weightKg);
      const sTare =
        sit.tareWeightKg ??
        (sGross > sit.weightKg ? Math.round((sGross - sit.weightKg) * 10) / 10 : 0);
      const sNet =
        sTare > 0 ? Math.round((sGross - sTare) * 10) / 10 : Math.round(sit.weightKg * 10) / 10;
      const sRate =
        sit.ratePer20Kg ||
        billItems[sIdx]?.ratePer20Kg ||
        bill.items?.[0]?.ratePer20Kg ||
        0;
      const sAmt =
        sit.amount && sit.amount > 0 ? sit.amount : Math.round((sNet / 20) * sRate);
      return {
        id: `decomp_${sIdx}`,
        productId: `p_${sIdx}`,
        productName: sit.productName,
        productShortcut: '',
        weightKg: sNet,
        ratePer20Kg: sRate,
        amount: sAmt,
      };
    });
  } else if (billItems.length === 0) {
    billItems = [
      {
        id: 'item_1',
        productId: 'p_1',
        productName: slip.items[0]?.productName || 'માલ',
        productShortcut: '',
        weightKg: roundedNet,
        ratePer20Kg: slip.items[0]?.ratePer20Kg || 0,
        amount: slip.totalAmount || bill.finalTotal || 0,
      },
    ];
  }

  const computedGrossAmount = billItems.reduce((acc, it) => acc + (it.amount || 0), 0);
  const discountVal = bill.discountLess || 0;
  const finalBillTotal =
    bill.finalTotal && bill.finalTotal > 0 && Math.abs(bill.finalTotal - computedGrossAmount) < 100
      ? bill.finalTotal
      : computedGrossAmount - discountVal;

  const billItemsHtml = billItems
    .map(
      (item, idx) => `
      <div style="margin-bottom: 5px;">
        <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 13px; border-bottom: 1px dashed #000; padding-bottom: 3px; margin-bottom: 3px;">
          <span>${idx + 1}. ${item.productName}</span>
          <span>${idx === 0 ? 'ભાવ' : ''}</span>
          <span>${idx === 0 ? 'રકમ' : ''}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-family: monospace; font-size: 12.5px; margin-top: 2px;">
          <span>${item.weightKg} kg</span>
          <span>${item.ratePer20Kg}</span>
          <span style="font-weight: bold;">${Math.round(item.amount).toLocaleString('en-IN')}</span>
        </div>
      </div>
    `
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>વજન અને બિલ પાવતી - ${bill.customerName || slip.customerName}</title>
        <style>
          @page {
            margin: 0;
            size: ${settings.paperWidth === '80mm' ? '80mm' : '58mm'} auto;
          }
          body {
            margin: 0;
            padding: 8px 4px 20px 4px;
            font-family: monospace, sans-serif;
            font-size: 12px;
            color: #000;
            width: ${settings.paperWidth === '80mm' ? '72mm' : '48mm'};
          }
          .text-center { text-align: center; }
          .bold { font-weight: bold; }
          .border-b-dashed { border-bottom: 1px dashed #000; padding-bottom: 3px; margin-bottom: 3px; }
          .divider { border-top: 1px solid #000; margin: 3px 0; }
          .strong-divider { border-top: 2px dashed #000; margin: 4px 0; }
          .flex-between { display: flex; justify-content: space-between; }
        </style>
      </head>
      <body>
        <div class="text-center border-b-dashed">
          <div style="font-size: 15px; font-weight: bold;">${settings.firmName || 'શ્રી કલેશ્વરી કૃપા ટ્રેડીંગ કું.'}</div>
          ${(settings.tagline || 'અનાજ, કઠોળ, તેલીબીયા તથા કેટલફીડના વહેપારી') ? `<div style="font-size: 10px; margin-top: 2px;">${settings.tagline || 'અનાજ, કઠોળ, તેલીબીયા તથા કેટલફીડના વહેપારી'}</div>` : ''}
          ${(settings.address || 'હરસિદ્ધિ માતાના મંદિર પાસે') ? `<div style="font-size: 10px;">${settings.address || 'હરસિદ્ધિ માતાના મંદિર પાસે'}</div>` : ''}
          ${(settings.addressLine2 || 'મુ. વાસણા, પો. મહિસા, તા. મહુધા, જી. ખેડા') ? `<div style="font-size: 10px;">${settings.addressLine2 || 'મુ. વાસણા, પો. મહિસા, તા. મહુધા, જી. ખેડા'}</div>` : ''}
          <div style="font-size: 10px; margin-top: 3px;">Mo. ${phoneList.join('  Mo. ')}</div>
          ${(settings.gstNo || '24ADDPP1757F1ZP') ? `<div style="font-size: 9px; margin-top: 3px;">GSTIN: ${settings.gstNo || '24ADDPP1757F1ZP'}</div>` : ''}
          ${(settings.licenseNo || '01/1998 Dt.25-08-1998') ? `<div style="font-size: 9px;">લા.નં: ${settings.licenseNo || '01/1998 Dt.25-08-1998'}</div>` : ''}
        </div>

        <!-- 1. કાંટા વજન -->
        <div class="border-b-dashed">
          <div class="flex-between">
            <span>બિલ નં: <b style="font-family: monospace;">${bill.billNoStr || slip.billNoStr || '-'}</b></span>
            <span>તારીખ: ${formatDateDDMM(slip.date || bill.date)}</span>
          </div>
          <div class="flex-between" style="margin-top: 3px;">
            <span>ગ્રાહક: <b>${slip.customerName || bill.customerName || 'સામાન્ય ગ્રાહક'}</b></span>
            ${(slip.time || bill.time) ? `<span style="font-family: monospace; font-size: 11px;">${formatTimeSimple(slip.time || bill.time)}</span>` : ''}
          </div>
        </div>
        ${weightItemsHtml}
        ${weightSummaryHtml}

        <!-- 2. વાઉચર બિલ -->
        <div class="strong-divider"></div>
        <div class="text-center bold" style="font-size: 13px; margin-bottom: 4px;">*** વાઉચર બિલ (હિસાબ) ***</div>
        ${billItemsHtml}
        <div class="divider"></div>
        ${
          discountVal > 0
            ? `
          <div class="flex-between" style="font-size: 13px; margin-bottom: 2px;">
            <span>કુલ રકમ:</span>
            <span style="font-family: monospace;">${formatINR(computedGrossAmount)}</span>
          </div>
          <div class="flex-between" style="font-size: 13px; margin-bottom: 2px;">
            <span>કપાત / લેસ:</span>
            <span style="font-family: monospace;">-${formatINR(discountVal)}</span>
          </div>
        `
            : ''
        }
        <div class="flex-between bold" style="font-size: 15px; margin-top: 3px;">
          <span>ચોખ્ખી રકમ:</span>
          <span style="font-family: monospace; font-size: 17px; font-weight: 900;">${formatINR(finalBillTotal)}</span>
        </div>
        <div class="divider"></div>
        ${
          settings.footerNote
            ? `<div class="center" style="font-size: 12px; margin-top: 6px; margin-bottom: 20px; font-weight: bold;">${settings.footerNote}</div>`
            : ''
        }
      </body>
    </html>
  `;

  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) return;

  doc.open();
  doc.write(html);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (e) {
      console.warn('iframe print failed', e);
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 2000);
    }
  }, 250);
};

// In-memory cache of recently printed items to strictly prevent double printing
const recentlyPrintedIds = new Map<string, number>();

export function markItemAsPrinted(id: string) {
  if (!id) return;
  const now = Date.now();
  recentlyPrintedIds.set(id, now);
  // Also cross-mark combined and bare ids so dual listeners never collide:
  if (id.startsWith('combined_')) {
    recentlyPrintedIds.set(id.replace('combined_', ''), now);
  } else {
    recentlyPrintedIds.set(`combined_${id}`, now);
  }
  for (const [key, time] of recentlyPrintedIds.entries()) {
    if (now - time > 60000) {
      recentlyPrintedIds.delete(key);
    }
  }
}

export function wasItemRecentlyPrinted(id: string): boolean {
  if (!id) return false;
  const now = Date.now();
  const directTime = recentlyPrintedIds.get(id);
  if (directTime && now - directTime < 25000) return true;
  
  const altKey = id.startsWith('combined_') ? id.replace('combined_', '') : `combined_${id}`;
  const altTime = recentlyPrintedIds.get(altKey);
  if (altTime && now - altTime < 25000) return true;

  return false;
}

export function clearItemPrintedRecord(id: string) {
  if (!id) return;
  recentlyPrintedIds.delete(id);
}

/**
 * Universal Direct Print Function:
 * If Web Bluetooth is available (and not inside restricted iframe), prints directly to Bluetooth printer (PSF588).
 * If not available or inside iframe, triggers direct system print.
 * NEVER shows any popup modal screen!
 */
export const printReceiptDirectly = async (
  bill: VoucherBill,
  settings: FirmSettings,
  onStatusUpdate?: (status: string) => void,
  force?: boolean
): Promise<void> => {
  const resolvedSlip = resolveWeighmentSlip(bill);
  if (resolvedSlip) {
    return printCombinedDirectly(bill, resolvedSlip, settings, onStatusUpdate, force);
  }

  // Deduplication guard: ignore duplicate calls for the exact same bill within 20 seconds
  if (false && !force && bill?.id && wasItemRecentlyPrinted(bill.id)) {
    console.warn(`[printReceiptDirectly] Bill ${bill.id} was already printed within last 20 seconds. Skipping duplicate print.`);
    return;
  }
  if (bill?.id) {
    markItemAsPrinted(bill.id);
  }

  // Direct system print when configured
  if (settings.printMethod === 'system') {
    onStatusUpdate?.('પ્રિન્ટ મોકલાઈ રહી છે...');
    directSystemPrint(bill, settings);
    return;
  }

  if (isWebBluetoothSupported() && !isInsideIframe()) {
    try {
      await printReceiptViaBluetooth(bill, settings, onStatusUpdate);
    } catch (err: any) {
      if (err?.message === 'IFRAME_PERMISSION_ERROR') {
        onStatusUpdate?.('પ્રિન્ટ મોકલાઈ રહી છે...');
        directSystemPrint(bill, settings);
        return;
      }
      // If error was due to temporary connection or GATT busy, retry once with fresh connect
      const msg = String(err?.message || '').toLowerCase();
      const isRecoverable =
        msg.includes('gatt') ||
        msg.includes('connection lost') ||
        msg.includes('disconnected') ||
        msg.includes('networkerror') ||
        err?.name === 'NetworkError';

      if (isRecoverable) {
        onStatusUpdate?.('પ્રિન્ટર સાથે ફરી જોડાણ કરી પ્રિન્ટ થઈ રહી છે...');
        await new Promise((res) => setTimeout(res, 600));
        try {
          await printReceiptViaBluetooth(bill, settings, onStatusUpdate);
          return;
        } catch (retryErr) {
          console.warn('Bluetooth retry failed, using system print fallback:', retryErr);
        }
      }
      
      // If Bluetooth connection failed or device not found, seamlessly fallback to system print
      console.warn('Bluetooth print failed, falling back to system print:', err);
      onStatusUpdate?.('સિસ્ટમ પ્રિન્ટ પર મોકલાઈ રહી છે...');
      directSystemPrint(bill, settings);
    }
  } else {
    onStatusUpdate?.('પ્રિન્ટ મોકલાઈ રહી છે...');
    directSystemPrint(bill, settings);
  }
};

/**
 * Universal Direct Print Function for Combined Slip (વજન પત્રક + વાઉચર બિલ):
 * Bluetooth or direct system print with zero popup!
 */
export const printCombinedDirectly = async (
  bill: VoucherBill,
  slip: WeighmentSlipData,
  settings: FirmSettings,
  onStatusUpdate?: (status: string) => void,
  force?: boolean
): Promise<void> => {
  const dedupeKey = bill?.id ? `combined_${bill.id}` : slip?.billNoStr ? `combined_${slip.billNoStr}` : '';
  if (false && !force && dedupeKey && wasItemRecentlyPrinted(dedupeKey)) {
    console.warn(`[printCombinedDirectly] ${dedupeKey} was already printed within last 20 seconds. Skipping duplicate.`);
    return;
  }
  if (dedupeKey) {
    markItemAsPrinted(dedupeKey);
  }

  // Direct system print when configured
  if (settings.printMethod === 'system') {
    onStatusUpdate?.('વજન અને બિલ પ્રિન્ટ મોકલાઈ રહી છે...');
    directSystemPrintCombined(bill, slip, settings);
    return;
  }

  if (isWebBluetoothSupported() && !isInsideIframe()) {
    try {
      await printCombinedViaBluetooth(bill, slip, settings, onStatusUpdate);
    } catch (err: any) {
      if (err?.message === 'IFRAME_PERMISSION_ERROR') {
        onStatusUpdate?.('વજન અને બિલ પ્રિન્ટ મોકલાઈ રહી છે...');
        directSystemPrintCombined(bill, slip, settings);
        return;
      }
      const msg = String(err?.message || '').toLowerCase();
      const isRecoverable =
        msg.includes('gatt') ||
        msg.includes('connection lost') ||
        msg.includes('disconnected') ||
        msg.includes('networkerror') ||
        err?.name === 'NetworkError';

      if (isRecoverable) {
        onStatusUpdate?.('પ્રિન્ટર સાથે ફરી જોડાણ કરી પ્રિન્ટ થઈ રહી છે...');
        await new Promise((res) => setTimeout(res, 600));
        try {
          await printCombinedViaBluetooth(bill, slip, settings, onStatusUpdate);
          return;
        } catch (retryErr) {
          console.warn('Bluetooth retry combined failed, using system print fallback:', retryErr);
        }
      }
      
      // If Bluetooth connection failed or device not found, seamlessly fallback to system print
      console.warn('Bluetooth combined print failed, falling back to system print:', err);
      onStatusUpdate?.('સિસ્ટમ પ્રિન્ટ પર મોકલાઈ રહી છે...');
      directSystemPrintCombined(bill, slip, settings);
    }
  } else {
    onStatusUpdate?.('વજન અને બિલ પ્રિન્ટ મોકલાઈ રહી છે...');
    directSystemPrintCombined(bill, slip, settings);
  }
};

/**
 * Direct system print for Weight Slip (કાંટા વજન પત્રક)
 */
export const directSystemPrintWeighment = (slip: WeighmentSlipData, settings: FirmSettings): void => {
  if (typeof window === 'undefined') return;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0px';
  iframe.style.height = '0px';
  iframe.style.border = 'none';
  iframe.setAttribute('title', 'Direct Weight Print');

  let phoneList = (settings.phone || '')
    .split(/[,/\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!phoneList.includes('9427077011') || !phoneList.includes('9313172801')) {
    phoneList = ['9427077011', '9313172801'];
  }

  const itemsHtml = slip.items
    .map((item) => {
      let bagsHtml = '';
      if (item.bags && item.bags.length > 0) {
        const half = Math.ceil(item.bags.length / 2);
        let rows = '';
        let leftColTotal = 0;
        let rightColTotal = 0;

        for (let i = 0; i < half; i++) {
          const lNum = i + 1;
          const lWeight = Number(item.bags[i]);
          leftColTotal += lWeight;
          const lW = lWeight.toFixed(1);

          const rIdx = i + half;
          let rHtml = '<span></span>';
          if (rIdx < item.bags.length) {
            const rWeight = Number(item.bags[rIdx]);
            rightColTotal += rWeight;
            rHtml = `<span>${String(rIdx + 1).padStart(2, ' ')} ) ${rWeight.toFixed(1)}</span>`;
          }

          rows += `
            <div style="display: flex; justify-content: space-between; font-family: monospace; font-size: 13px; font-weight: bold; padding: 2px 0;">
              <span>${String(lNum).padStart(2, ' ')} ) ${lW}</span>
              ${rHtml}
            </div>
          `;
        }

        const leftFormatted = parseFloat(leftColTotal.toFixed(1));
        const rightFormatted = parseFloat(rightColTotal.toFixed(1));

        bagsHtml = `
          <div style="margin: 3px 0; padding: 2px 0;">
            ${rows}
            <div style="display: flex; justify-content: space-between; font-family: monospace; font-size: 14.5px; font-weight: 900; border-top: 1px dashed #444; margin-top: 4px; padding-top: 3px;">
              <span style="padding-left: 2.8ch;">${leftFormatted} kg</span>
              ${rightColTotal > 0 ? `<span style="padding-left: 2.8ch;">${rightFormatted} kg</span>` : '<span></span>'}
            </div>
          </div>
        `;
      }

      const itemGross =
        item.grossWeightKg ??
        (item.bags && item.bags.length > 0
          ? Math.round(item.bags.reduce((acc, v) => acc + (Number(v) || 0), 0) * 10) / 10
          : item.weightKg);
      const diffGrossNet = Math.round((itemGross - item.weightKg) * 10) / 10;
      const itemTare = item.tareWeightKg ?? (diffGrossNet > 0 ? diffGrossNet : 0);
      const itemNet =
        itemTare > 0
          ? Math.round((itemGross - itemTare) * 10) / 10
          : Math.round(item.weightKg * 10) / 10;
      const itemBagsCount = item.bags ? item.bags.length : 0;

      const itemSubSummaryHtml =
        slip.items.length > 1
          ? `
        <div style="border-top: 1px dashed #777; margin-top: 4px; padding-top: 3px;">
          ${
            itemTare > 0
              ? `
            <div style="display: flex; justify-content: space-between; font-size: 12.5px; font-weight: bold;">
              <span>કુલ વજન:</span>
              <span style="font-family: monospace; font-size: 14px; font-weight: 800;">${parseFloat(
                itemGross.toFixed(1)
              )} kg</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12.5px; font-weight: bold; margin-top: 1.5px;">
              <span>કુલ થેલી:&nbsp;&nbsp;&nbsp;&nbsp;${itemBagsCount || ''}</span>
              <span style="font-family: monospace; font-size: 14px; font-weight: 800;">-${parseFloat(
                itemTare.toFixed(1)
              )} kg</span>
            </div>
            <div style="border-top: 1px dashed #999; margin: 2px 0;"></div>
            <div style="display: flex; justify-content: space-between; font-size: 13.5px; font-weight: 900; margin-top: 1.5px;">
              <span>નેટ વજન:</span>
              <span style="font-family: monospace; font-size: 15.5px; font-weight: 900;">${parseFloat(
                itemNet.toFixed(1)
              )} kg</span>
            </div>
          `
              : `
            ${
              itemBagsCount > 0
                ? `
            <div style="display: flex; justify-content: space-between; font-size: 12.5px; font-weight: bold;">
              <span>કુલ થેલી:&nbsp;&nbsp;&nbsp;&nbsp;${itemBagsCount}</span>
            </div>`
                : ''
            }
            <div style="display: flex; justify-content: space-between; font-size: 13.5px; font-weight: 900; margin-top: 1.5px;">
              <span>નેટ વજન:</span>
              <span style="font-family: monospace; font-size: 15.5px; font-weight: 900;">${parseFloat(
                itemNet.toFixed(1)
              )} kg</span>
            </div>
          `
          }
        </div>
      `
          : '';

      return `
        <div style="margin-bottom: 6px; border-bottom: 1px dashed #ccc; padding-bottom: 5px;">
          <div style="font-weight: bold; font-size: 14px;">
            <span>માલ: ${item.productName}</span>
          </div>
          ${bagsHtml}
          ${!item.bags || item.bags.length === 0 ? `
          <div style="display: flex; justify-content: space-between; font-family: monospace; font-size: 14px; font-weight: bold; margin-top: 2px;">
            <span>વજન: ${item.weightKg} kg</span>
          </div>` : ''}
          ${itemSubSummaryHtml}
        </div>
      `;
    })
    .join('');

  // Summary calculation (only for single item; omitted for multi-item as requested)
  let summaryHtml = '';
  if (slip.items.length === 1) {
    const singleItem = slip.items[0];
    const grossW =
      slip.grossWeightKg ??
      (singleItem?.bags && singleItem.bags.length > 0
        ? singleItem.bags.reduce((acc, b) => acc + Number(b), 0)
        : singleItem?.weightKg || 0);
    const roundedGross = Math.round(grossW * 10) / 10;

    let tareW = slip.tareWeightKg ?? (singleItem?.tareWeightKg || 0);
    if ((!tareW || tareW <= 0) && singleItem?.bags && singleItem.bags.length > 0) {
      const diff = Math.round((grossW - (singleItem?.weightKg || 0)) * 10) / 10;
      if (diff > 0) tareW = diff;
    }
    const roundedTare = Math.round(tareW * 10) / 10;
    const roundedNet =
      roundedTare > 0
        ? Math.round((roundedGross - roundedTare) * 10) / 10
        : Math.round((singleItem?.weightKg || slip.totalWeightKg) * 10) / 10;

    summaryHtml =
      roundedTare > 0
        ? `
      <div style="display: flex; justify-content: space-between; font-size: 13.5px; font-weight: bold; margin-top: 3px;">
        <span>કુલ વજન:</span>
        <span style="font-family: monospace; font-size: 16px; font-weight: 800;">${parseFloat(roundedGross.toFixed(1))} kg</span>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 13.5px; font-weight: bold; margin-top: 2px;">
        <span>કુલ થેલી:&nbsp;&nbsp;&nbsp;&nbsp;${slip.totalBagsCount || ''}</span>
        <span style="font-family: monospace; font-size: 16px; font-weight: 800;">-${parseFloat(roundedTare.toFixed(1))} kg</span>
      </div>
      <div class="divider"></div>
      <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: 900; margin-top: 3px;">
        <span>નેટ વજન:</span>
        <span style="font-family: monospace; font-size: 19px; font-weight: 900;">${parseFloat(roundedNet.toFixed(1))} kg</span>
      </div>
    `
        : `
      ${
        slip.totalBagsCount
          ? `
      <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; margin-top: 2px;">
        <span>કુલ થેલી:&nbsp;&nbsp;&nbsp;&nbsp;${slip.totalBagsCount}</span>
      </div>`
          : ''
      }
      <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: 900; margin-top: 3px;">
        <span>કુલ વજન:</span>
        <span style="font-family: monospace; font-size: 19px; font-weight: 900;">${parseFloat(roundedNet.toFixed(1))} kg</span>
      </div>
    `;
  }

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>કાંટા વજન પત્રક - ${slip.customerName}</title>
        <style>
          @page {
            margin: 0;
            size: ${settings.paperWidth === '80mm' ? '80mm' : '58mm'} auto;
          }
          body {
            margin: 0;
            padding: 8px 4px 20px 4px;
            font-family: monospace, sans-serif;
            font-size: 12px;
            color: #000;
            width: ${settings.paperWidth === '80mm' ? '72mm' : '48mm'};
          }
          .text-center { text-align: center; }
          .bold { font-weight: bold; }
          .border-b-dashed { border-bottom: 1px dashed #000; padding-bottom: 3px; margin-bottom: 3px; }
          .divider { border-top: 1px solid #000; margin: 3px 0; }
        </style>
      </head>
      <body>
        <div class="text-center border-b-dashed">
          <div style="font-size: 15px; font-weight: bold;">${settings.firmName || 'શ્રી કલેશ્વરી કૃપા ટ્રેડીંગ કું.'}</div>
          ${(settings.tagline || 'અનાજ, કઠોળ, તેલીબીયા તથા કેટલફીડના વહેપારી') ? `<div style="font-size: 10px; margin-top: 2px;">${settings.tagline || 'અનાજ, કઠોળ, તેલીબીયા તથા કેટલફીડના વહેપારી'}</div>` : ''}
          ${(settings.address || 'હરસિદ્ધિ માતાના મંદિર પાસે') ? `<div style="font-size: 10px;">${settings.address || 'હરસિદ્ધિ માતાના મંદિર પાસે'}</div>` : ''}
          ${(settings.addressLine2 || 'મુ. વાસણા, પો. મહિસા, તા. મહુધા, જી. ખેડા') ? `<div style="font-size: 10px;">${settings.addressLine2 || 'મુ. વાસણા, પો. મહિસા, તા. મહુધા, જી. ખેડા'}</div>` : ''}
          <div style="font-size: 10px; margin-top: 3px;">Mo. ${phoneList.join('  Mo. ')}</div>
          ${(settings.gstNo || '24ADDPP1757F1ZP') ? `<div style="font-size: 9px; margin-top: 3px;">GSTIN: ${settings.gstNo || '24ADDPP1757F1ZP'}</div>` : ''}
          ${(settings.licenseNo || '01/1998 Dt.25-08-1998') ? `<div style="font-size: 9px;">લા.નં: ${settings.licenseNo || '01/1998 Dt.25-08-1998'}</div>` : ''}
        </div>
        <div class="border-b-dashed">
          <div class="flex-between">
            <span>બિલ નં: <b style="font-family: monospace;">${slip.billNoStr || '-'}</b></span>
            <span>તારીખ: ${formatDateDDMM(slip.date)}</span>
          </div>
          <div class="flex-between" style="margin-top: 3px;">
            <span>ગ્રાહક: <b>${slip.customerName || 'સામાન્ય ગ્રાહક'}</b></span>
            ${slip.time ? `<span style="font-family: monospace; font-size: 11px;">${formatTimeSimple(slip.time)}</span>` : ''}
          </div>
        </div>
        ${itemsHtml}
        ${summaryHtml}
        <div class="divider"></div>
        <div class="text-center" style="font-size: 11px; margin-top: 6px; margin-bottom: 20px;">આભાર, ફરી પધારશો!</div>
      </body>
    </html>
  `;

  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) return;

  doc.open();
  doc.write(html);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (e) {
      console.warn('iframe print failed', e);
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 2000);
    }
  }, 250);
};

/**
 * Universal Direct Print Function for Weight Slip:
 * Bluetooth or direct system print with zero popup!
 */
export const printWeighmentDirectly = async (
  slip: WeighmentSlipData,
  settings: FirmSettings,
  onStatusUpdate?: (status: string) => void
): Promise<void> => {
  // Direct system print when configured
  if (settings.printMethod === 'system') {
    onStatusUpdate?.('વજન પ્રિન્ટ મોકલાઈ રહી છે...');
    directSystemPrintWeighment(slip, settings);
    return;
  }

  if (isWebBluetoothSupported() && !isInsideIframe()) {
    try {
      await printWeighmentViaBluetooth(slip, settings, onStatusUpdate);
    } catch (err: any) {
      if (err?.message === 'IFRAME_PERMISSION_ERROR') {
        onStatusUpdate?.('વજન પ્રિન્ટ મોકલાઈ રહી છે...');
        directSystemPrintWeighment(slip, settings);
        return;
      }
      const msg = String(err?.message || '').toLowerCase();
      const isRecoverable =
        msg.includes('gatt') ||
        msg.includes('connection lost') ||
        msg.includes('disconnected') ||
        msg.includes('networkerror') ||
        err?.name === 'NetworkError';

      if (isRecoverable) {
        onStatusUpdate?.('પ્રિન્ટર સાથે ફરી જોડાણ કરી વજન પ્રિન્ટ થઈ રહી છે...');
        await new Promise((res) => setTimeout(res, 600));
        try {
          await printWeighmentViaBluetooth(slip, settings, onStatusUpdate);
          return;
        } catch (retryErr) {
          console.warn('Bluetooth retry weighment failed, using system print fallback:', retryErr);
        }
      }
      
      // If Bluetooth connection failed or device not found, seamlessly fallback to system print
      console.warn('Bluetooth weighment print failed, falling back to system print:', err);
      onStatusUpdate?.('સિસ્ટમ પ્રિન્ટ પર મોકલાઈ રહી છે...');
      directSystemPrintWeighment(slip, settings);
    }
  } else {
    onStatusUpdate?.('વજન પ્રિન્ટ મોકલાઈ રહી છે...');
    directSystemPrintWeighment(slip, settings);
  }
};
