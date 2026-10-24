const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CẤU HÌNH BẢO MẬT (Cài trong Vercel -> Settings -> Environment Variables)
// ============================================================================
const SECRET_KEY = process.env.KEY_SECRET || 'h3_studio_pro_luxury_secret_2026_x99';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'Minhyang18';
// Tùy chọn lưu trữ vĩnh viễn miễn phí qua GitHub Gist (Nếu muốn khóa HWID & thu hồi Key từ xa):
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GIST_ID = process.env.GIST_ID || '';

// Bộ nhớ tạm trong RAM (kết hợp file local khi chạy thử trên máy)
const LOCAL_DB_FILE = path.join('/tmp', 'h3_keys_db.json');
let memoryDb = {
  allow_free_trial: true,
  free_trial_hours: 24,
  keys: {},
  ip_trials: {}
};

try {
  if (fs.existsSync(LOCAL_DB_FILE)) {
    memoryDb = JSON.parse(fs.readFileSync(LOCAL_DB_FILE, 'utf-8'));
  }
} catch (e) {}

async function loadDatabase() {
  if (GITHUB_TOKEN && GIST_ID) {
    try {
      const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'H3-Studio-Key-Server'
        }
      });
      if (r.ok) {
        const gist = await r.json();
        const fileObj = gist.files && gist.files['h3_keys_db.json'];
        if (fileObj && fileObj.content) {
          memoryDb = Object.assign({ allow_free_trial: true, free_trial_hours: 24, keys: {}, ip_trials: {} }, JSON.parse(fileObj.content));
        }
      }
    } catch (e) {}
  }
  return memoryDb;
}

async function saveDatabase(db) {
  memoryDb = db;
  try {
    fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (e) {}
  if (GITHUB_TOKEN && GIST_ID) {
    try {
      await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'H3-Studio-Key-Server'
        },
        body: JSON.stringify({
          files: {
            'h3_keys_db.json': {
              content: JSON.stringify(db, null, 2)
            }
          }
        })
      });
    } catch (e) {}
  }
}

// ============================================================================
// MÃ HÓA & XÁC THỰC SIGNED KEY (HOẠT ĐỘNG 100% NGAY CẢ KHI CHƯA CÀI DATABASE)
// Cấu trúc Key: H3PRO-<EXP_HEX>-<MAX_DEV>-<NONCE>-<HMAC_SIG_8>
// ============================================================================
function createSignedKey(durationHours, maxDevices = 1) {
  const expUnix = durationHours >= 87600
    ? 4102444800 // Vĩnh viễn (Năm 2100)
    : Math.floor(Date.now() / 1000) + Math.round(durationHours * 3600);
  const expHex = expUnix.toString(16).toUpperCase();
  const devHex = Math.max(1, Math.min(99, Number(maxDevices) || 1)).toString(16).toUpperCase().padStart(2, '0');
  const nonce = crypto.randomBytes(2).toString('hex').toUpperCase();
  const payload = `${expHex}:${devHex}:${nonce}`;
  const sig = crypto.createHmac('sha256', SECRET_KEY).update(payload).digest('hex').slice(0, 8).toUpperCase();
  return {
    key: `H3PRO-${expHex}-${devHex}${nonce}-${sig}`,
    expires_at: expUnix * 1000,
    max_devices: Number(maxDevices) || 1
  };
}

function verifySignedKeyFormat(keyStr) {
  const clean = String(keyStr || '').trim().toUpperCase();
  const m = clean.match(/^H3PRO-([0-9A-F]{8})-([0-9A-F]{2})([0-9A-F]{4})-([0-9A-F]{8})$/);
  if (!m) return { valid: false, reason: 'Định dạng Key không hợp lệ' };
  const [, expHex, devHex, nonce, sig] = m;
  const payload = `${expHex}:${devHex}:${nonce}`;
  const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(payload).digest('hex').slice(0, 8).toUpperCase();
  if (sig !== expectedSig) {
    return { valid: false, reason: 'Chữ ký Key không hợp lệ (Key giả mạo)' };
  }
  const expMs = parseInt(expHex, 16) * 1000;
  const maxDevices = parseInt(devHex, 16) || 1;
  if (Date.now() > expMs) {
    return { valid: false, expired: true, expires_at: expMs, reason: 'Key đã hết hạn sử dụng' };
  }
  return {
    valid: true,
    expires_at: expMs,
    max_devices: maxDevices
  };
}

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (typeof req.body === 'string') {
      try { return resolve(JSON.parse(req.body)); } catch (e) { return resolve({}); }
    }
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); }
    });
  });
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  res.end(JSON.stringify(obj));
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.searchParams.get('__path') || urlObj.pathname;

  // Serve UI nếu truy cập / hoặc /admin
  if (pathname === '/' || pathname === '/admin' || pathname.startsWith('/admin/') || pathname === '/public/index.html') {
    try {
      const uiPath1 = path.join(__dirname, 'ui.html');
      const uiPath2 = path.join(__dirname, '..', 'public', 'index.html');
      const htmlPath = fs.existsSync(uiPath1) ? uiPath1 : uiPath2;
      const html = fs.readFileSync(htmlPath, 'utf-8');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.end(html);
    } catch (e) {
      return sendJson(res, 200, { ok: true, service: 'H3 Studio Pro Key Server' });
    }
  }

  const body = req.method === 'POST' ? await parseBody(req) : {};
  const db = await loadDatabase();

  // 1. API NHẬN KEY FREE DÙNG THỬ CHO NGƯỜI DÙNG (1 IP / HWID nhận 1 Key dùng thử)
  if (pathname === '/api/free-key' && req.method === 'POST') {
    if (!db.allow_free_trial) {
      return sendJson(res, 403, { ok: false, error: 'Chức năng nhận Key miễn phí hiện đang tạm đóng.' });
    }
    const clientIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const hwid = String(body.hwid || clientIp).trim();
    const existingTrial = db.ip_trials[hwid] || db.ip_trials[clientIp];
    if (existingTrial && existingTrial.expires_at > Date.now()) {
      return sendJson(res, 200, {
        ok: true,
        key: existingTrial.key,
        expires_at: existingTrial.expires_at,
        reused: true,
        msg: 'Bạn đã nhận Key dùng thử trước đó (vẫn còn hạn).'
      });
    }
    const hours = Number(db.free_trial_hours) || 24;
    const gen = createSignedKey(hours, 1);
    const record = {
      key: gen.key,
      note: `Free Trial (${clientIp})`,
      created_at: Date.now(),
      expires_at: gen.expires_at,
      max_devices: 1,
      hwids: body.hwid ? [String(body.hwid).trim()] : [],
      banned: false,
      is_trial: true
    };
    db.keys[gen.key] = record;
    db.ip_trials[hwid] = { key: gen.key, expires_at: gen.expires_at };
    db.ip_trials[clientIp] = { key: gen.key, expires_at: gen.expires_at };
    await saveDatabase(db);
    return sendJson(res, 200, {
      ok: true,
      key: gen.key,
      expires_at: gen.expires_at,
      hours: hours,
      msg: `Đã tạo Key miễn phí (${hours} giờ) thành công!`
    });
  }

  // 2. API XÁC THỰC KEY TỪ APP H3 STUDIO PRO (POST /api/verify)
  if (pathname === '/api/verify' && req.method === 'POST') {
    const rawKey = String(body.key || '').trim().toUpperCase();
    const hwid = String(body.hwid || 'DEFAULT_PC').trim();
    if (!rawKey) {
      return sendJson(res, 400, { ok: false, error: 'Vui lòng nhập mã Key bản quyền!' });
    }

    // Kiểm tra chữ ký mật mã
    const sigCheck = verifySignedKeyFormat(rawKey);
    if (!sigCheck.valid) {
      return sendJson(res, 403, { ok: false, error: sigCheck.reason });
    }

    // Kiểm tra trong DB (nếu có lưu trên Gist/RAM) để kiểm soát khóa Key & giới hạn thiết bị HWID
    let rec = db.keys[rawKey];
    if (!rec) {
      rec = {
        key: rawKey,
        note: 'Signed Key',
        created_at: Date.now(),
        expires_at: sigCheck.expires_at,
        max_devices: sigCheck.max_devices || 1,
        hwids: [],
        banned: false
      };
      db.keys[rawKey] = rec;
    }

    if (rec.banned) {
      return sendJson(res, 403, { ok: false, error: 'Key này đã bị Quản trị viên khóa!' });
    }
    if (Date.now() > rec.expires_at) {
      return sendJson(res, 403, { ok: false, error: 'Key đã hết hạn sử dụng!' });
    }

    rec.hwids = Array.isArray(rec.hwids) ? rec.hwids : [];
    if (hwid && !rec.hwids.includes(hwid)) {
      if (rec.hwids.length >= (rec.max_devices || 1)) {
        return sendJson(res, 403, {
          ok: false,
          error: `Key này đã đạt giới hạn thiết bị (${rec.hwids.length}/${rec.max_devices} máy). Vui lòng liên hệ Đường Thọ (Zalo: 0934415387 | genpixo.com | gencpu.com) để Reset HWID!`
        });
      }
      rec.hwids.push(hwid);
      rec.last_verified_at = Date.now();
      await saveDatabase(db);
    }

    const remainHours = Math.max(0, Math.round((rec.expires_at - Date.now()) / 360000) / 10);
    return sendJson(res, 200, {
      ok: true,
      key: rawKey,
      expires_at: rec.expires_at,
      remaining_hours: remainHours,
      max_devices: rec.max_devices || 1,
      used_devices: rec.hwids.length,
      note: rec.note || ''
    });
  }

  // 3. CÁC API QUẢN TRỊ VIÊN (ADMIN)
  const reqPass = req.headers['x-admin-password'] || body.admin_password || urlObj.searchParams.get('admin_password') || '';
  if (pathname.startsWith('/api/admin/')) {
    if (reqPass !== ADMIN_PASS) {
      return sendJson(res, 401, { ok: false, error: 'Mật khẩu Admin không đúng!' });
    }

    if (pathname === '/api/admin/list') {
      const list = Object.values(db.keys || {}).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      return sendJson(res, 200, {
        ok: true,
        allow_free_trial: Boolean(db.allow_free_trial),
        free_trial_hours: Number(db.free_trial_hours) || 24,
        persistent_storage: Boolean(GITHUB_TOKEN && GIST_ID),
        keys: list
      });
    }

    if (pathname === '/api/admin/generate' && req.method === 'POST') {
      const count = Math.max(1, Math.min(100, parseInt(body.count || '1', 10) || 1));
      const hours = Math.max(1, Number(body.hours || 168));
      const maxDev = Math.max(1, Math.min(99, parseInt(body.max_devices || '1', 10) || 1));
      const note = String(body.note || '').trim();
      const created = [];

      for (let i = 0; i < count; i++) {
        const g = createSignedKey(hours, maxDev);
        const item = {
          key: g.key,
          note: note || `Gói ${hours >= 87600 ? 'Vĩnh viễn' : (hours + 'h')}`,
          created_at: Date.now(),
          expires_at: g.expires_at,
          max_devices: maxDev,
          hwids: [],
          banned: false
        };
        db.keys[g.key] = item;
        created.push(item);
      }
      await saveDatabase(db);
      return sendJson(res, 200, { ok: true, created });
    }

    if (pathname === '/api/admin/action' && req.method === 'POST') {
      const act = String(body.action || '').trim();
      const targetKey = String(body.key || '').trim().toUpperCase();

      if (act === 'toggle_trial_config') {
        db.allow_free_trial = Boolean(body.allow_free_trial);
        if (body.free_trial_hours) db.free_trial_hours = Math.max(1, Number(body.free_trial_hours));
        await saveDatabase(db);
        return sendJson(res, 200, { ok: true, allow_free_trial: db.allow_free_trial, free_trial_hours: db.free_trial_hours });
      }

      const rec = db.keys[targetKey];
      if (!rec) return sendJson(res, 404, { ok: false, error: 'Không tìm thấy Key này trong danh sách' });

      if (act === 'reset_hwid') {
        rec.hwids = [];
      } else if (act === 'toggle_ban') {
        rec.banned = !rec.banned;
      } else if (act === 'delete') {
        delete db.keys[targetKey];
      }
      await saveDatabase(db);
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 404, { ok: false, error: 'Endpoint not found' });
}

module.exports = handler;

// Cho phép chạy trực tiếp bằng `node api/index.js` ở dưới máy local
if (require.main === module) {
  const http = require('http');
  const port = process.env.PORT || 4050;
  http.createServer(handler).listen(port, () => {
    console.log(`H3 Key Server running at http://127.0.0.1:${port}`);
  });
}
