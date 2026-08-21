const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { publicKey } = require('./license-public-key');

const execFileAsync = promisify(execFile);
const PRODUCT_ID = 'jinghe-desktop';
const LICENSE_EXTENSION = '.jinghe-license';
const LICENSE_FILE = `license${LICENSE_EXTENSION}`;

function localDate(value = new Date()) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function normalizeIdentifier(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function usableIdentifier(value) {
  const normalized = normalizeIdentifier(value);
  return normalized.length >= 6 && !/^0+$/.test(normalized) && !/^F+$/.test(normalized) && !/TOBEFILLEDBYOEM/.test(normalized);
}

async function readMachineIdentifiers() {
  const values = [];
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { windowsHide: true });
    const match = stdout.match(/MachineGuid\s+REG_\w+\s+([^\r\n]+)/i);
    if (match && usableIdentifier(match[1])) values.push(`windows=${normalizeIdentifier(match[1])}`);
  } catch (_) {
    // A Windows installation ID is preferred, but the firmware ID below is sufficient as a fallback.
  }
  try {
    const script = "Get-CimInstance -ClassName Win32_ComputerSystemProduct | Select-Object -ExpandProperty UUID";
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    if (usableIdentifier(stdout)) values.push(`firmware=${normalizeIdentifier(stdout)}`);
  } catch (_) {
    // Some managed Windows installations deny CIM queries.
  }
  if (!values.length) throw new Error('未能读取本机授权标识，请以管理员身份重新打开软件后重试');
  return values.sort();
}

async function getMachineCode() {
  const identifiers = await readMachineIdentifiers();
  const digest = crypto.createHash('sha256').update(`jinghe-machine-v1|${identifiers.join('|')}`, 'utf8').digest('hex').toUpperCase();
  return `JH1-${digest.slice(0, 8)}-${digest.slice(8, 16)}-${digest.slice(16, 24)}-${digest.slice(24, 32)}-${digest.slice(32, 40)}`;
}

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

function canonicalLicensePayload(input) {
  return JSON.stringify(normalizePayload(input));
}

function licenseSummary(license) {
  return {
    licenseId: license.licenseId,
    issuedTo: license.issuedTo,
    expiresAt: license.expiresAt,
    issuedAt: license.issuedAt
  };
}

function validateLicense(license, machineCode, now = localDate()) {
  if (!publicKey || !publicKey.includes('BEGIN PUBLIC KEY')) return { active: false, code: 'key_unconfigured', message: '应用尚未配置正式授权密钥' };
  if (!license || typeof license !== 'object' || typeof license.signature !== 'string') return { active: false, code: 'invalid_format', message: '授权文件格式无效' };
  const payload = normalizePayload(license);
  if (!payload.licenseId || !payload.issuedTo || !payload.machineCode || !/^\d{4}-\d{2}-\d{2}$/.test(payload.issuedAt)) return { active: false, code: 'invalid_content', message: '授权文件内容不完整' };
  if (payload.expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(payload.expiresAt)) return { active: false, code: 'invalid_expiry', message: '授权文件中的有效期格式无效' };
  let signatureValid = false;
  try {
    signatureValid = crypto.verify(null, Buffer.from(canonicalLicensePayload(payload), 'utf8'), publicKey, Buffer.from(license.signature, 'base64'));
  } catch (_) {
    return { active: false, code: 'invalid_signature', message: '授权文件签名无效' };
  }
  if (!signatureValid) return { active: false, code: 'invalid_signature', message: '授权文件签名无效' };
  if (payload.machineCode !== machineCode) return { active: false, code: 'wrong_machine', message: '该授权文件不属于本电脑' };
  if (payload.issuedAt > now) return { active: false, code: 'not_started', message: `授权将在 ${payload.issuedAt} 生效` };
  if (payload.expiresAt && payload.expiresAt < now) return { active: false, code: 'expired', message: `授权已于 ${payload.expiresAt} 到期` };
  return { active: true, code: 'active', message: '已激活', license: licenseSummary(payload) };
}

function createLicenseStore(userDataPath) {
  const licensePath = path.join(userDataPath, 'license', LICENSE_FILE);

  async function status() {
    let machineCode;
    try {
      machineCode = await getMachineCode();
    } catch (error) {
      return { active: false, code: 'machine_error', message: error.message, machineCode: '' };
    }
    try {
      const license = JSON.parse(await fs.readFile(licensePath, 'utf8'));
      return { ...validateLicense(license, machineCode), machineCode };
    } catch (error) {
      if (error.code === 'ENOENT') return { active: false, code: 'not_activated', message: '尚未激活', machineCode };
      return { active: false, code: 'invalid_file', message: '本机授权文件无法读取', machineCode };
    }
  }

  async function importFile(filePath) {
    const machineCode = await getMachineCode();
    let license;
    try {
      license = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (_) {
      return { active: false, code: 'invalid_file', message: '无法读取授权文件，请确认文件未损坏' };
    }
    const result = validateLicense(license, machineCode);
    if (!result.active) return { ...result, machineCode };
    await fs.mkdir(path.dirname(licensePath), { recursive: true });
    await fs.writeFile(licensePath, `${JSON.stringify(license, null, 2)}\n`, 'utf8');
    return { ...result, machineCode, message: `已激活：${result.license.issuedTo}` };
  }

  return { status, importFile, getMachineCode, licensePath };
}

module.exports = { PRODUCT_ID, LICENSE_EXTENSION, LICENSE_FILE, canonicalLicensePayload, createLicenseStore, getMachineCode, localDate, normalizePayload, validateLicense };
