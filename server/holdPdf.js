import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';

const fontPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts', 'NotoSansTC-Regular.ttf');

function drawCell(doc, text, x, y, width) {
  doc.text(String(text || ''), x, y, {
    width,
    height: 28,
    ellipsis: true,
  });
}

export function renderHoldPdf(hold) {
  if (!fs.existsSync(fontPath)) throw new Error('缺少中文字型，無法匯出 PDF');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font(fontPath);
    doc.fontSize(22).text('《客人留貨表格》', 48, 46, { align: 'center', width: 499 });
    doc.fontSize(12).fillColor('#333').text(`${hold.no}　　${hold.atLabel}`, 48, 82, { align: 'center', width: 499 });
    const rows = [
      ['客人名稱', hold.customerName],
      ['客人電話', hold.phone],
      ['貨號', hold.sku],
      ['碼數', hold.size],
      ['狀態', hold.status],
      ['收貨門市', hold.receiveStore],
      ['出貨門市', hold.shipStore],
      ['經手同事', hold.handlerName],
    ];
    const x = 48;
    const tableW = 499;
    const labelW = 150;
    const rowH = 46;
    let y = 118;
    doc.lineWidth(1).strokeColor('#222');
    rows.forEach(([label, value]) => {
      doc.rect(x, y, tableW, rowH).stroke();
      doc.moveTo(x + labelW, y).lineTo(x + labelW, y + rowH).stroke();
      doc.fillColor('#111').fontSize(14);
      drawCell(doc, `${label}：`, x + 12, y + 14, labelW - 24);
      drawCell(doc, value, x + labelW + 12, y + 14, tableW - labelW - 24);
      y += rowH;
    });
    doc.end();
  });
}
