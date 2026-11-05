import { SaleTransaction, ReceiptBrandingConfig } from '../types';

/**
 * Direct ESC/POS Hardware Thermal Printer & RJ11 Cash Drawer Utility
 * Supports WebSerial API (USB-Serial / Bluetooth thermal printers) and WebUSB API
 * for zero-dialog 58mm / 80mm receipt printing and automatic cash drawer kick-open.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const CMD = {
  INIT: [ESC, 0x40], // Initialize printer
  ALIGN_LEFT: [ESC, 0x61, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  ALIGN_RIGHT: [ESC, 0x61, 0x02],
  BOLD_ON: [ESC, 0x45, 0x01],
  BOLD_OFF: [ESC, 0x45, 0x00],
  DOUBLE_HEIGHT_ON: [GS, 0x21, 0x01],
  NORMAL_SIZE: [GS, 0x21, 0x00],
  FEED_AND_CUT: [GS, 0x56, 0x41, 0x03], // Full cut with 3-line feed
  KICK_DRAWER_PIN2: [ESC, 0x70, 0x00, 0x19, 0xfa], // Standard RJ11 Pin 2 pulse (50ms on, 500ms off)
  KICK_DRAWER_PIN5: [ESC, 0x70, 0x01, 0x19, 0xfa], // Standard RJ11 Pin 5 pulse
};

let activeSerialPort: any = null;
let activeUsbDevice: any = null;

function encodeAscii(text: string): number[] {
  const clean = text
    .replace(/₦/g, 'NGN ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/•/g, '*')
    .replace(/[^\x20-\x7E\n]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    bytes.push(clean.charCodeAt(i));
  }
  return bytes;
}

function formatRow(left: string, right: string, width: number): string {
  const cleanLeft = left.slice(0, Math.max(1, width - right.length - 1));
  const spaces = Math.max(1, width - cleanLeft.length - right.length);
  return `${cleanLeft}${' '.repeat(spaces)}${right}\n`;
}

/**
 * Generates raw ESC/POS byte stream for a SaleTransaction
 */
export function buildEscPosReceiptBytes(
  tx: SaleTransaction,
  settings: ReceiptBrandingConfig,
  cashierName: string,
  customerName: string,
  kickDrawer: boolean = true
): Uint8Array {
  const is58mm = settings.paper_width === '58mm';
  const lineWidth = is58mm ? 32 : 42;
  const divider = `${'-'.repeat(lineWidth)}\n`;
  const doubleDivider = `${'='.repeat(lineWidth)}\n`;

  const buf: number[] = [];
  const pushBytes = (arr: number[]) => buf.push(...arr);
  const pushText = (txt: string) => buf.push(...encodeAscii(txt));

  pushBytes(CMD.INIT);
  if (kickDrawer) {
    pushBytes(CMD.KICK_DRAWER_PIN2);
  }

  // Header
  pushBytes(CMD.ALIGN_CENTER);
  pushBytes(CMD.BOLD_ON);
  pushBytes(CMD.DOUBLE_HEIGHT_ON);
  pushText(`${(settings.business_name || 'SMARTSALES POS').toUpperCase()}\n`);
  pushBytes(CMD.NORMAL_SIZE);
  pushBytes(CMD.BOLD_OFF);

  if (settings.tagline) {
    pushText(`${settings.tagline}\n`);
  }
  if (settings.address_line1) {
    pushText(`${settings.address_line1}\n`);
  }
  if (settings.phone_numbers) {
    pushText(`Tel: ${settings.phone_numbers}\n`);
  }
  pushText(doubleDivider);

  // Metadata
  pushBytes(CMD.ALIGN_LEFT);
  pushText(formatRow('Receipt #:', tx.transaction_id, lineWidth));
  pushText(formatRow('Date:', new Date(tx.date_time).toLocaleString('en-GB'), lineWidth));
  pushText(formatRow('Cashier:', cashierName, lineWidth));
  pushText(formatRow('Customer:', customerName, lineWidth));
  if (tx.branch_id) {
    pushText(formatRow('Branch:', tx.branch_id, lineWidth));
  }
  pushText(divider);

  // Line Items
  pushBytes(CMD.BOLD_ON);
  pushText(formatRow('ITEM / QTY', 'AMOUNT', lineWidth));
  pushBytes(CMD.BOLD_OFF);
  pushText(divider);

  for (const item of tx.items) {
    pushText(`${item.item_name}\n`);
    const qtyPrice = `  ${item.quantity_sold} ${item.unit} x ${item.unit_price.toLocaleString()}`;
    const lineTotal = `NGN ${item.total_amount.toLocaleString()}`;
    pushText(formatRow(qtyPrice, lineTotal, lineWidth));
  }

  pushText(divider);

  // Totals
  pushText(formatRow('Subtotal:', `NGN ${tx.total_amount.toLocaleString()}`, lineWidth));
  if (tx.discount_applied > 0) {
    pushText(formatRow('Discount:', `-NGN ${tx.discount_applied.toLocaleString()}`, lineWidth));
  }

  pushBytes(CMD.BOLD_ON);
  pushBytes(CMD.DOUBLE_HEIGHT_ON);
  pushText(formatRow('TOTAL:', `NGN ${tx.final_amount.toLocaleString()}`, lineWidth));
  pushBytes(CMD.NORMAL_SIZE);
  pushBytes(CMD.BOLD_OFF);

  pushText(formatRow('Payment Method:', tx.payment_method, lineWidth));
  if (tx.amount_paid !== undefined && tx.amount_paid > 0) {
    pushText(formatRow('Amount Tendered:', `NGN ${tx.amount_paid.toLocaleString()}`, lineWidth));
  }
  if (tx.change_due !== undefined && tx.change_due > 0) {
    pushText(formatRow('Change Due:', `NGN ${tx.change_due.toLocaleString()}`, lineWidth));
  }

  pushText(doubleDivider);

  // Footer
  pushBytes(CMD.ALIGN_CENTER);
  pushText(`${settings.footer_thank_you || 'Thank you for your patronage!'}\n`);
  if (settings.footer_policy_notice) {
    pushText(`${settings.footer_policy_notice}\n`);
  }
  pushText('Powered by SmartSales Cloud POS\n');
  pushBytes([LF, LF]);
  pushBytes(CMD.FEED_AND_CUT);

  return new Uint8Array(buf);
}

/**
 * Generates raw ESC/POS cash drawer kick pulse bytes
 */
export function buildEscPosDrawerKickBytes(): Uint8Array {
  return new Uint8Array([...CMD.INIT, ...CMD.KICK_DRAWER_PIN2, ...CMD.KICK_DRAWER_PIN5]);
}

async function sendBytesToHardware(bytes: Uint8Array): Promise<{ success: boolean; method: string; error?: string }> {
  const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;

  // 1. Try WebSerial API first (most common for USB/Bluetooth ESC/POS thermal printers)
  if (nav?.serial) {
    try {
      if (!activeSerialPort) {
        const existingPorts = await nav.serial.getPorts();
        activeSerialPort = existingPorts.length > 0 ? existingPorts[0] : await nav.serial.requestPort();
      }
      if (!activeSerialPort.readable && !activeSerialPort.writable) {
        await activeSerialPort.open({ baudRate: 9600 });
      }
      const writer = activeSerialPort.writable.getWriter();
      await writer.write(bytes);
      writer.releaseLock();
      return { success: true, method: 'WebSerial ESC/POS' };
    } catch (err: any) {
      activeSerialPort = null;
      return { success: false, method: 'WebSerial', error: err.message || 'Serial thermal printer not connected.' };
    }
  }

  // 2. Try WebUSB API fallback
  if (nav?.usb) {
    try {
      if (!activeUsbDevice) {
        const devices = await nav.usb.getDevices();
        activeUsbDevice = devices.length > 0 ? devices[0] : await nav.usb.requestDevice({ filters: [] });
      }
      if (!activeUsbDevice.opened) {
        await activeUsbDevice.open();
        if (activeUsbDevice.configuration === null) {
          await activeUsbDevice.selectConfiguration(1);
        }
        await activeUsbDevice.claimInterface(0);
      }
      const iface = activeUsbDevice.configuration.interfaces[0].alternates[0];
      const outEndpoint = iface.endpoints.find((e: any) => e.direction === 'out');
      if (!outEndpoint) {
        throw new Error('No bulk OUT endpoint found on USB printer.');
      }
      await activeUsbDevice.transferOut(outEndpoint.endpointNumber, bytes);
      return { success: true, method: 'WebUSB ESC/POS' };
    } catch (err: any) {
      activeUsbDevice = null;
      return { success: false, method: 'WebUSB', error: err.message || 'USB thermal printer not connected.' };
    }
  }

  return {
    success: false,
    method: 'None',
    error: 'WebSerial / WebUSB is not supported in this browser. Use Chrome/Edge or standard Print.',
  };
}

export async function printDirectEscPos(
  tx: SaleTransaction,
  settings: ReceiptBrandingConfig,
  cashierName: string,
  customerName: string,
  kickDrawer: boolean = true
): Promise<{ success: boolean; method: string; error?: string }> {
  const bytes = buildEscPosReceiptBytes(tx, settings, cashierName, customerName, kickDrawer);
  return sendBytesToHardware(bytes);
}

export async function kickCashDrawerDirect(): Promise<{ success: boolean; method: string; error?: string }> {
  const bytes = buildEscPosDrawerKickBytes();
  return sendBytesToHardware(bytes);
}
