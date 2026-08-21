const crypto = require('node:crypto');

const PRODUCT_ID = 'jinghe-desktop';
const LICENSE_EXTENSION = '.jinghe-license';

function normalizePayload(input) {
  return {
    schema: 1,
    product: PRODUCT_ID,
    licenseId: String(input.licenseId || '').trim(),
    issuedTo: String(input.issuedTo || '').trim(),
    machineCode: String(input.machineCode || '').trim().toUpperCase(),
    issuedAt: String(input.issuedAt || '').trim(),
    expiresAt: input.expiresAt ? String(input.expiresAt).trim() : null,
    features: Array.isArray(input.features) ? input.features.map((item) => String(item)).sort() : []
  };
}

function canonicalPayload(input) {
  return JSON.stringify(normalizePayload(input));
}

function isValidMachineCode(value) {
  return /^JH1(?:-[A-F0-9]{8}){5}$/.test(String(value || '').trim().toUpperCase());
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function localDate(d = new Date()) {
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

function issueLicense({ privateKey, machineCode, issuedTo, expiresAt, licenseId, issuedAt }) {
  const mc = String(machineCode || '').trim().toUpperCase();
  if (!isValidMachineCode(mc)) throw new Error('授权申请码格式无效（应为 JH1-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX）');
  if (!issuedTo || !String(issuedTo).trim()) throw new Error('请填写客户名称');
  if (!isValidDate(expiresAt)) throw new Error('到期日格式无效（应为 YYYY-MM-DD）');

  const payload = normalizePayload({
    product: PRODUCT_ID,
    licenseId: licenseId || `JH-${localDate().replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    issuedTo: String(issuedTo).trim(),
    machineCode: mc,
    issuedAt: issuedAt || localDate(),
    expiresAt,
    features: ['task-execution']
  });

  const signature = crypto.sign(null, Buffer.from(canonicalPayload(payload), 'utf8'), privateKey).toString('base64');
  return { ...payload, signature };
}

module.exports = { issueLicense, isValidMachineCode, isValidDate, localDate, LICENSE_EXTENSION };
