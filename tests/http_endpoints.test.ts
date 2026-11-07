import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

// Cấu hình sử dụng PGlite in-memory cô lập cho HTTP integration test trước khi import DB
process.env.USE_PGLITE = 'true';
process.env.PGLITE_DATA_DIR = 'memory://';
process.env.COOKIE_CROSS_SITE = 'false';
process.env.TRUST_PROXY_HOPS = '1';

import { initDatabase } from '../server/db/init.ts';
import { queryRows, closeDb } from '../server/db/index.ts';
import { createApp } from '../server/app.ts';
import { resetLoginRateLimit } from '../server/services/auth.ts';
import { sql } from 'drizzle-orm';

let server: Server;
let baseUrl = '';

// Helper trích xuất cookie từ header Set-Cookie
function extractCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return '';
  return setCookie.split(';')[0];
}

before(async () => {
  // Khởi tạo toàn bộ 25 bảng + constraints từ thư mục migrations/ thông qua Drizzle migrator
  await initDatabase();
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await closeDb();
});

// 1. Test gọi HTTP endpoint thật: Ép role=customer khi đăng ký + kiểm tra Referrer-Policy & HttpOnly cookie
test('HTTP POST /api/auth/register: forces role=customer even when payload sends role=admin', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Nguyễn Minh Quân',
      email: 'minhquan@baity.vn',
      phone: '0911222333',
      password: 'Password@123',
      role: 'admin', // Cố tình gửi role=admin từ phía client
    }),
  });

  assert.equal(res.status, 201);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer', 'Phải trả về header Referrer-Policy: no-referrer');

  const setCookie = res.headers.get('set-cookie') || '';
  assert.ok(setCookie.includes('baity_token='), 'Phải gán cookie baity_token');
  assert.ok(setCookie.toLowerCase().includes('httponly'), 'Cookie phải có cờ HttpOnly');

  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.user.role, 'customer', 'Response trả về bắt buộc phải là customer');

  // Kiểm tra trực tiếp trong CSDL
  const dbRows = await queryRows<{ role: string }>(sql`
    SELECT role FROM users WHERE email = 'minhquan@baity.vn';
  `);
  assert.equal(dbRows[0]?.role, 'customer', 'Trong CSDL role bắt buộc là customer');
});

// 2. Test gọi HTTP endpoint thật: Thông báo lỗi chung khi đăng nhập sai (không lộ email có tồn tại hay không)
test('HTTP POST /api/auth/login: returns identical generic error message for wrong email vs wrong password', async () => {
  // Trường hợp 1: Email hoàn toàn không tồn tại
  const resWrongEmail = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '10.10.1.1',
    },
    body: JSON.stringify({
      email: 'khongtontai_999@baity.vn',
      password: 'Password@123',
    }),
  });

  // Trường hợp 2: Email có tồn tại nhưng sai mật khẩu
  const resWrongPass = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '10.10.1.2',
    },
    body: JSON.stringify({
      email: 'minhquan@baity.vn',
      password: 'WrongPassword@999',
    }),
  });

  assert.equal(resWrongEmail.status, 401);
  assert.equal(resWrongPass.status, 401);

  const dataWrongEmail = await resWrongEmail.json();
  const dataWrongPass = await resWrongPass.json();

  assert.equal(
    dataWrongEmail.message,
    dataWrongPass.message,
    'Thông báo lỗi khi sai email và sai mật khẩu phải hoàn toàn giống nhau'
  );
  assert.equal(dataWrongEmail.message, 'Email hoặc mật khẩu không chính xác');
});

// 3. Test gọi HTTP endpoint thật: Khóa tài khoản/IP sau 5 lần đăng nhập sai liên tiếp (HTTP 429)
test('HTTP POST /api/auth/login: locks out with HTTP 429 after 5 failed login attempts', async () => {
  const clientIp = '203.0.113.55';
  const targetEmail = 'ratelimit_user@baity.vn';
  resetLoginRateLimit(clientIp, targetEmail);

  // Gửi 5 lần đăng nhập sai liên tiếp qua HTTP
  for (let i = 1; i <= 5; i++) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': clientIp,
      },
      body: JSON.stringify({
        email: targetEmail,
        password: `WrongPass_${i}`,
      }),
    });
    assert.equal(res.status, 401, `Lần thử sai thứ ${i} trả về 401`);
  }

  // Lần thử thứ 6 phải bị chặn ngay với HTTP 429 Too Many Requests
  const blockedRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': clientIp,
    },
    body: JSON.stringify({
      email: targetEmail,
      password: 'Password@123',
    }),
  });

  assert.equal(blockedRes.status, 429, 'Sau 5 lần đăng nhập sai, request tiếp theo phải nhận HTTP 429');
  const blockedBody = await blockedRes.json();
  assert.equal(blockedBody.success, false);
  assert.ok(blockedBody.message.includes('15'), 'Thông báo phải nêu rõ thời gian tạm khóa');

  resetLoginRateLimit(clientIp, targetEmail);
});

// 4. Test gọi HTTP endpoint thật: Thông báo giống nhau của Quên mật khẩu
test('HTTP POST /api/auth/forgot-password: returns identical response for existing and non-existing emails', async () => {
  const resExisting = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'minhquan@baity.vn' }),
  });

  const resNonExisting = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'never_registered_xyz@baity.vn' }),
  });

  assert.equal(resExisting.status, 200);
  assert.equal(resNonExisting.status, 200);

  const bodyExisting = await resExisting.json();
  const bodyNonExisting = await resNonExisting.json();

  assert.equal(bodyExisting.success, true);
  assert.equal(bodyNonExisting.success, true);
  assert.equal(
    bodyExisting.message,
    bodyNonExisting.message,
    'Phản hồi của forgot-password cho email tồn tại và không tồn tại phải giống hệt nhau'
  );
});

// 5. Test gọi HTTP endpoint thật: Quyền sở hữu địa chỉ & Ràng buộc chỉ một địa chỉ mặc định
test('HTTP /api/user/addresses: enforces address ownership and single default address per user', async () => {
  // Đăng ký User A
  const regA = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'User A',
      email: 'user_a@baity.vn',
      phone: '0901111222',
      password: 'Password@123',
    }),
  });
  const cookieA = extractCookie(regA);

  // Đăng ký User B
  const regB = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'User B',
      email: 'user_b@baity.vn',
      phone: '0903333444',
      password: 'Password@123',
    }),
  });
  const cookieB = extractCookie(regB);

  // User A thêm Địa chỉ 1 (tự động là mặc định vì là địa chỉ đầu tiên)
  const createAddr1 = await fetch(`${baseUrl}/api/user/addresses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieA,
    },
    body: JSON.stringify({
      receiverName: 'User A - Nhà riêng',
      phone: '0901111222',
      province: 'TP. Hồ Chí Minh',
      district: 'Quận 1',
      ward: 'Phường Bến Nghé',
      streetAddress: '10 Nguyễn Huệ',
      isDefault: true,
    }),
  });
  assert.equal(createAddr1.status, 201);
  const addr1 = (await createAddr1.json()).data;
  assert.equal(addr1.isDefault, true);

  // User A thêm Địa chỉ 2 với isDefault = true -> Địa chỉ 1 phải tự động chuyển về false
  const createAddr2 = await fetch(`${baseUrl}/api/user/addresses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieA,
    },
    body: JSON.stringify({
      receiverName: 'User A - Văn phòng',
      phone: '0901111222',
      province: 'TP. Hồ Chí Minh',
      district: 'Quận 3',
      ward: 'Phường Võ Thị Sáu',
      streetAddress: '200 Pasteur',
      isDefault: true,
    }),
  });
  assert.equal(createAddr2.status, 201);
  const addr2 = (await createAddr2.json()).data;
  assert.equal(addr2.isDefault, true);

  // Kiểm tra danh sách địa chỉ của User A: Chỉ có đúng 1 địa chỉ mặc định
  const listRes1 = await fetch(`${baseUrl}/api/user/addresses`, {
    headers: { Cookie: cookieA },
  });
  const listData1 = (await listRes1.json()).data;
  assert.equal(listData1.length, 2);
  const defaultAddrs1 = listData1.filter((a: any) => a.isDefault === true);
  assert.equal(defaultAddrs1.length, 1, 'Chỉ được phép có duy nhất 1 địa chỉ mặc định');
  assert.equal(defaultAddrs1[0].id, addr2.id);

  // Đặt lại Địa chỉ 1 làm mặc định qua PUT /api/user/addresses/:id/set-default
  const setDefRes = await fetch(`${baseUrl}/api/user/addresses/${addr1.id}/set-default`, {
    method: 'PUT',
    headers: { Cookie: cookieA },
  });
  assert.equal(setDefRes.status, 200);

  const listRes2 = await fetch(`${baseUrl}/api/user/addresses`, {
    headers: { Cookie: cookieA },
  });
  const listData2 = (await listRes2.json()).data;
  const defaultAddrs2 = listData2.filter((a: any) => a.isDefault === true);
  assert.equal(defaultAddrs2.length, 1, 'Sau khi đổi mặc định vẫn chỉ có đúng 1 địa chỉ mặc định');
  assert.equal(defaultAddrs2[0].id, addr1.id);

  // Kiểm tra quyền sở hữu: User B cố tình sửa, đặt mặc định hoặc xóa địa chỉ của User A -> Phải bị từ chối (404)
  const attackUpdate = await fetch(`${baseUrl}/api/user/addresses/${addr1.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieB,
    },
    body: JSON.stringify({
      receiverName: 'Hacked Name',
      phone: '0999999999',
      province: 'Hà Nội',
      district: 'Ba Đình',
      ward: 'Đội Cấn',
      streetAddress: '999 Đường Hack',
    }),
  });
  assert.equal(attackUpdate.status, 404, 'User B không được phép sửa địa chỉ của User A');

  const attackSetDefault = await fetch(`${baseUrl}/api/user/addresses/${addr2.id}/set-default`, {
    method: 'PUT',
    headers: { Cookie: cookieB },
  });
  assert.equal(attackSetDefault.status, 404, 'User B không được phép đặt mặc định địa chỉ của User A');

  const attackDelete = await fetch(`${baseUrl}/api/user/addresses/${addr1.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookieB },
  });
  assert.equal(attackDelete.status, 404, 'User B không được phép xóa địa chỉ của User A');

  // Kiểm tra ràng buộc DB Partial Unique Index: Cố tình chèn thêm 1 địa chỉ mặc định thứ 2 trực tiếp vào DB cho User A sẽ bị PostgreSQL chặn
  const userARows = await queryRows<{ id: string }>(sql`SELECT id FROM users WHERE email = 'user_a@baity.vn';`);
  await assert.rejects(
    async () => {
      await queryRows(sql`
        INSERT INTO addresses (user_id, receiver_name, phone, province, district, ward, street_address, is_default)
        VALUES (${userARows[0].id}, 'Duplicate Default', '0901111222', 'HCM', 'Q1', 'P1', '123 Test', true);
      `);
    },
    'Partial unique index idx_addresses_single_default phải chặn việc có 2 địa chỉ mặc định cùng lúc trong DB'
  );
});

// 6. Test gọi HTTP endpoint thật: GET /api/upload/signed-url
// - Từ chối path có "..", ký tự lạ
// - Chỉ cấp signed URL cho bucket đổi trả (<userId>/return/<filename>)
// - Từ chối khi path không bắt đầu bằng id của chính người gọi (403)
// - Cho phép chính chủ gọi và cho phép Admin lấy signed URL của bất kỳ ai
test('HTTP GET /api/upload/signed-url: validates path, rejects .., rejects invalid characters, non-return paths, enforces ownership (403) and allows admin', async () => {
  const nonce = Date.now();
  // Đăng ký User C (Customer thông thường)
  const regC = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Customer C',
      email: `customer_c_${nonce}@baity.vn`,
      phone: '0988777666',
      password: 'Password@123',
    }),
  });
  const cookieC = extractCookie(regC);
  const userC = (await regC.json()).user;

  // Đăng ký User D (Customer thông thường khác)
  const regD = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Customer D',
      email: `customer_d_${nonce}@baity.vn`,
      phone: '0988111222',
      password: 'Password@123',
    }),
  });
  const cookieD = extractCookie(regD);
  const userD = (await regD.json()).user;

  // Tạo tài khoản Admin (nâng cấp role trực tiếp trong CSDL)
  const regAdmin = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Admin User',
      email: `admin_test_${nonce}@baity.vn`,
      phone: '0988999888',
      password: 'Password@123',
    }),
  });
  const adminCookie = extractCookie(regAdmin);
  const adminUser = (await regAdmin.json()).user;
  await queryRows(sql`UPDATE users SET role = 'admin' WHERE id = ${adminUser.id};`);

  // a. Chưa đăng nhập -> 401 Unauthorized
  const unauthRes = await fetch(`${baseUrl}/api/upload/signed-url?path=${userC.id}/return/proof.jpg`);
  assert.equal(unauthRes.status, 401, 'Chưa đăng nhập phải bị từ chối 401');

  // b. Thiếu tham số path -> 400
  const noPathRes = await fetch(`${baseUrl}/api/upload/signed-url`, {
    headers: { Cookie: cookieC },
  });
  assert.equal(noPathRes.status, 400, 'Thiếu tham số path phải trả về 400');

  // c. Từ chối path có ".." (Directory Traversal)
  const traversalRes = await fetch(`${baseUrl}/api/upload/signed-url?path=../etc/passwd`, {
    headers: { Cookie: cookieC },
  });
  assert.equal(traversalRes.status, 400, 'Path có .. phải bị từ chối 400');
  const traversalBody = await traversalRes.json();
  assert.ok(traversalBody.message.includes('không hợp lệ') || traversalBody.message.includes('thư mục'));

  // d. Từ chối path có ký tự lạ (khoảng trắng, dấu nháy, null byte, <>)
  const weirdCharRes = await fetch(`${baseUrl}/api/upload/signed-url?path=${userC.id}/return/<script>.jpg`, {
    headers: { Cookie: cookieC },
  });
  assert.equal(weirdCharRes.status, 400, 'Path chứa ký tự đặc biệt nguy hiểm phải bị từ chối 400');

  // e. Chỉ cấp signed URL cho bucket đổi trả (nếu truyền path avatar hoặc review -> từ chối 400)
  const avatarPathRes = await fetch(`${baseUrl}/api/upload/signed-url?path=${userC.id}/avatar/profile.jpg`, {
    headers: { Cookie: cookieC },
  });
  assert.equal(avatarPathRes.status, 400, 'Chỉ cấp signed URL cho thư mục return, từ chối avatar');
  const avatarBody = await avatarPathRes.json();
  assert.ok(avatarBody.message.includes('đổi trả'));

  // User D thực hiện tải lên một ảnh minh chứng đổi trả hợp lệ bằng POST /api/upload
  const dummyJpgBase64 = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00,
    0xff, 0xd9
  ]).toString('base64');

  const uploadRes = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieD,
    },
    body: JSON.stringify({
      image: `data:image/jpeg;base64,${dummyJpgBase64}`,
      purpose: 'return',
    }),
  });
  assert.equal(uploadRes.status, 200, 'User D tải ảnh đổi trả lên thành công');
  const uploadData = await uploadRes.json();
  const userDValidReturnPath = uploadData.path; // e.g. `${userD.id}/return/<uuid>.jpg`
  assert.ok(userDValidReturnPath.startsWith(`${userD.id}/return/`));

  // f. Từ chối khi path không bắt đầu bằng ID của chính người gọi (User C cố tình lấy ảnh của User D -> 403 Forbidden)
  const forbiddenRes = await fetch(`${baseUrl}/api/upload/signed-url?path=${encodeURIComponent(userDValidReturnPath)}`, {
    headers: { Cookie: cookieC },
  });
  assert.equal(forbiddenRes.status, 403, 'User C cố truy cập ảnh của User D phải nhận 403 Forbidden');
  const forbiddenBody = await forbiddenRes.json();
  assert.equal(forbiddenBody.message, 'Bạn không có quyền truy cập hình ảnh đổi trả này');

  // g. Người dùng chính chủ (User D) lấy signed URL cho ảnh của chính mình -> Thành công 200
  const ownerRes = await fetch(`${baseUrl}/api/upload/signed-url?path=${encodeURIComponent(userDValidReturnPath)}`, {
    headers: { Cookie: cookieD },
  });
  assert.equal(ownerRes.status, 200, 'Chính chủ gọi path của mình phải được chấp thuận 200');
  const ownerBody = await ownerRes.json();
  assert.equal(ownerBody.success, true);
  assert.ok(ownerBody.signedUrl, 'Phải trả về signedUrl');

  // h. Admin được phép truy cập signed URL của bất kỳ khách hàng nào (bypass quyền sở hữu) -> Thành công 200
  const adminAccessRes = await fetch(`${baseUrl}/api/upload/signed-url?path=${encodeURIComponent(userDValidReturnPath)}`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(adminAccessRes.status, 200, 'Admin có quyền xem ảnh đổi trả của bất kỳ người dùng nào');
  const adminAccessBody = await adminAccessRes.json();
  assert.equal(adminAccessBody.success, true);
  assert.ok(adminAccessBody.signedUrl);
});

// 7. PII Redaction (không lộ password_hash)
test('PII Redaction (không lộ password_hash): auth and profile endpoints never expose password_hash or reset_token_hash', async () => {
  const email = `pii_check_${Date.now()}@baity.vn`;
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'PII Test User',
      email,
      phone: '0912345678',
      password: 'Password@123',
    }),
  });
  assert.equal(regRes.status, 201);
  const cookie = extractCookie(regRes);
  const regBody = await regRes.json();
  assert.equal('password_hash' in regBody.user, false);
  assert.equal('passwordHash' in regBody.user, false);
  assert.equal('reset_token_hash' in regBody.user, false);

  const meRes = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  const meBody = await meRes.json();
  assert.equal('password_hash' in meBody.user, false);
  assert.equal('passwordHash' in meBody.user, false);

  const profRes = await fetch(`${baseUrl}/api/user/profile`, { headers: { Cookie: cookie } });
  const profBody = await profRes.json();
  assert.equal('password_hash' in profBody.data, false);
  assert.equal('passwordHash' in profBody.data, false);
  assert.equal('reset_token_hash' in profBody.data, false);
});

// 8. Role isolation (khách không vào được /api/admin/*)
test('Role isolation (khách không vào được /api/admin/*): customer receives HTTP 403 on /api/admin/* while admin succeeds', async () => {
  const nonce = Date.now();
  const regCust = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Normal Customer',
      email: `cust_role_${nonce}@baity.vn`,
      phone: '0912345670',
      password: 'Password@123',
    }),
  });
  const custCookie = extractCookie(regCust);

  // Chưa đăng nhập -> 401
  const unauthAdmin = await fetch(`${baseUrl}/api/admin/dashboard`);
  assert.equal(unauthAdmin.status, 401);

  // Khách hàng gọi /api/admin/* -> 403 Forbidden
  const custAdmin = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: custCookie },
  });
  assert.equal(custAdmin.status, 403, 'Khách không được phép truy cập /api/admin/*');

  // Nâng lên admin -> 200 OK
  const custUser = (await regCust.json()).user;
  await queryRows(sql`UPDATE users SET role = 'admin' WHERE id = ${custUser.id};`);
  const adminRes = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: custCookie },
  });
  assert.equal(adminRes.status, 200);
});

// 9. Token Tampering (JWT bị sửa)
test('Token Tampering (JWT bị sửa): rejects modified JWT payload or signature with HTTP 401', async () => {
  const email = `tamper_${Date.now()}@baity.vn`;
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Tamper User',
      email,
      phone: '0912345671',
      password: 'Password@123',
    }),
  });
  const validCookie = extractCookie(regRes); // baity_token=eyJ...
  const tokenValue = validCookie.split('=')[1];
  const parts = tokenValue.split('.');

  // Sửa payload base64url để giả mạo role=admin nhưng giữ chữ ký cũ
  const forgedPayload = Buffer.from(JSON.stringify({ userId: '00000000-0000-0000-0000-000000000000', role: 'admin' })).toString('base64url');
  const tamperedToken = `${parts[0]}.${forgedPayload}.${parts[2]}`;

  const res = await fetch(`${baseUrl}/api/user/profile`, {
    headers: { Cookie: `baity_token=${tamperedToken}` },
  });
  assert.equal(res.status, 401, 'JWT bị sửa payload hoặc chữ ký phải bị từ chối với HTTP 401');
});

// 10. Password Complexity
test('Password Complexity: rejects passwords shorter than 8 characters on register, reset-password, and change-password', async () => {
  const email = `pwd_complex_${Date.now()}@baity.vn`;
  const shortReg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Short Pass',
      email,
      phone: '0912345672',
      password: '1234567', // 7 ký tự (< 8)
    }),
  });
  assert.equal(shortReg.status, 400, 'Mật khẩu dưới 8 ký tự khi đăng ký phải bị từ chối 400');

  const validReg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Valid Pass',
      email,
      phone: '0912345672',
      password: 'Password@123',
    }),
  });
  assert.equal(validReg.status, 201);
  const cookie = extractCookie(validReg);

  const shortChange = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      currentPassword: 'Password@123',
      newPassword: 'short',
    }),
  });
  assert.equal(shortChange.status, 400, 'Mật khẩu mới dưới 8 ký tự khi đổi mật khẩu phải bị từ chối 400');
});

// 11. Phone Format & Security
test('Phone Format & Security: rejects invalid phone formats and SQL injection payloads', async () => {
  const email = `phone_sec_${Date.now()}@baity.vn`;

  // Số điện thoại quá ngắn hoặc chứa ký tự chữ/SQLi
  for (const badPhone of ['12345', "0901234567' OR '1'='1", 'abcdefghij', '09012345678901234567']) {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Phone Test',
        email,
        phone: badPhone,
        password: 'Password@123',
      }),
    });
    assert.equal(res.status, 400, `Số điện thoại không hợp lệ (${badPhone}) phải bị từ chối 400`);
  }
});

// 12. Cross-User Profile Isolation
test('Cross-User Profile Isolation: User A cannot view or overwrite User B profile fields', async () => {
  const nonce = Date.now();
  const [reg1, reg2] = await Promise.all([
    fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Iso User 1',
        email: `iso1_${nonce}@baity.vn`,
        phone: '0911111111',
        password: 'Password@123',
      }),
    }),
    fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Iso User 2',
        email: `iso2_${nonce}@baity.vn`,
        phone: '0922222222',
        password: 'Password@123',
      }),
    }),
  ]);
  const cookie1 = extractCookie(reg1);
  const cookie2 = extractCookie(reg2);
  const user2 = (await reg2.json()).user;

  // User 1 cố tình gửi id/email của User 2 trong PUT /api/user/profile
  const updateRes = await fetch(`${baseUrl}/api/user/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
    body: JSON.stringify({
      id: user2.id,
      email: user2.email,
      fullName: 'Tên Mới Của User 1',
      phone: '0911111999',
    }),
  });
  assert.equal(updateRes.status, 200);

  // Kiểm tra hồ sơ của User 2 hoàn toàn không bị thay đổi
  const prof2Res = await fetch(`${baseUrl}/api/user/profile`, {
    headers: { Cookie: cookie2 },
  });
  const prof2 = (await prof2Res.json()).data;
  assert.equal(prof2.fullName, 'Iso User 2');
  assert.equal(prof2.phone, '0922222222');
});

// 13. Email uniqueness (409)
test('Email uniqueness (409): duplicate email registration (case-insensitive) returns HTTP 409 Conflict', async () => {
  const baseEmail = `unique_${Date.now()}@baity.vn`;
  const firstReg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'First User',
      email: baseEmail,
      phone: '0933333333',
      password: 'Password@123',
    }),
  });
  assert.equal(firstReg.status, 201);

  // Đăng ký lại với chữ HOA -> Phải trả về 409 Conflict
  const dupReg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Duplicate User',
      email: baseEmail.toUpperCase(),
      phone: '0944444444',
      password: 'Password@123',
    }),
  });
  assert.equal(dupReg.status, 409, 'Email trùng lặp phải trả về HTTP 409 Conflict');
});

// 14. Single active reset token
test('Single active reset token: requesting forgot-password multiple times keeps only the latest token hash active', async () => {
  const email = `reset_single_${Date.now()}@baity.vn`;
  await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Reset User',
      email,
      phone: '0955555555',
      password: 'Password@123',
    }),
  });

  await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const row1 = await queryRows<{ reset_token_hash: string }>(sql`
    SELECT reset_token_hash FROM users WHERE email = ${email};
  `);
  const hash1 = row1[0]?.reset_token_hash;
  assert.ok(hash1, 'Phải sinh reset_token_hash lần 1');

  await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const row2 = await queryRows<{ reset_token_hash: string }>(sql`
    SELECT reset_token_hash FROM users WHERE email = ${email};
  `);
  const hash2 = row2[0]?.reset_token_hash;
  assert.ok(hash2, 'Phải sinh reset_token_hash lần 2');
  assert.notEqual(hash1, hash2, 'Token cũ phải bị ghi đè, chỉ giữ duy nhất 1 reset token đang hoạt động');
});

// 15. Address Cascade Deletion
test('Address Cascade Deletion: deleting default address promotes next address, and deleting user cascades to addresses', async () => {
  const email = `cascade_${Date.now()}@baity.vn`;
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Cascade User',
      email,
      phone: '0966666666',
      password: 'Password@123',
    }),
  });
  const cookie = extractCookie(regRes);
  const user = (await regRes.json()).user;

  // Thêm 2 địa chỉ (địa chỉ 2 là mặc định)
  await fetch(`${baseUrl}/api/user/addresses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      receiverName: 'Addr 1',
      phone: '0966666666',
      province: 'TP. Hồ Chí Minh',
      ward: 'Phường Bến Nghé',
      streetAddress: '10 Lê Lợi',
      isDefault: true,
    }),
  });
  const add2Res = await fetch(`${baseUrl}/api/user/addresses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      receiverName: 'Addr 2',
      phone: '0966666666',
      province: 'TP. Hồ Chí Minh',
      ward: 'Phường Võ Thị Sáu',
      streetAddress: '20 Pasteur',
      isDefault: true,
    }),
  });
  const addr2 = (await add2Res.json()).data;

  // Xóa địa chỉ mặc định (Addr 2) -> Addr 1 tự động được nâng lên làm mặc định
  const delRes = await fetch(`${baseUrl}/api/user/addresses/${addr2.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
  assert.equal(delRes.status, 200);

  const listAfterDel = (await (await fetch(`${baseUrl}/api/user/addresses`, { headers: { Cookie: cookie } })).json()).data;
  assert.equal(listAfterDel.length, 1);
  assert.equal(listAfterDel[0].isDefault, true, 'Địa chỉ còn lại phải tự động thành mặc định');

  // Xóa user trong DB -> toàn bộ địa chỉ của user đó tự động bị xóa theo ON DELETE CASCADE
  await queryRows(sql`DELETE FROM users WHERE id = ${user.id};`);
  const remainingAddrs = await queryRows(sql`SELECT id FROM addresses WHERE user_id = ${user.id};`);
  assert.equal(remainingAddrs.length, 0, 'Xóa user phải tự động xóa cascade toàn bộ địa chỉ của user');
});

// 16. Profile Partial Updates
test('Profile Partial Updates: updating only heightCm/weightKg preserves existing fullName and phone', async () => {
  const email = `partial_${Date.now()}@baity.vn`;
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Nguyễn Văn Giữ Nguyên',
      email,
      phone: '0977777777',
      password: 'Password@123',
    }),
  });
  const cookie = extractCookie(regRes);

  // Chỉ gửi heightCm và weightKg
  const partRes = await fetch(`${baseUrl}/api/user/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      heightCm: 174,
      weightKg: 68,
    }),
  });
  assert.equal(partRes.status, 200);
  const partData = (await partRes.json()).data;
  assert.equal(partData.fullName, 'Nguyễn Văn Giữ Nguyên', 'Họ tên phải được giữ nguyên khi cập nhật một phần');
  assert.equal(partData.phone, '0977777777', 'Số điện thoại phải được giữ nguyên khi cập nhật một phần');
  assert.equal(partData.heightCm, 174);
  assert.equal(partData.weightKg, 68);
});

// 17. Concurrent Address Operations
test('Concurrent Address Operations: parallel default address creations maintain exactly one default address without DB error', async () => {
  const email = `concurrent_addr_${Date.now()}@baity.vn`;
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Concurrent Addr User',
      email,
      phone: '0988888881',
      password: 'Password@123',
    }),
  });
  const cookie = extractCookie(regRes);

  // Gửi 4 request tạo địa chỉ mặc định cùng lúc qua Promise.all
  const responses = await Promise.all(
    [1, 2, 3, 4].map((idx) =>
      fetch(`${baseUrl}/api/user/addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          receiverName: `Người nhận ${idx}`,
          phone: '0988888881',
          province: 'Hà Nội',
          ward: 'Phường Điện Biên',
          streetAddress: `Số ${idx} Đường Độc Lập`,
          isDefault: true,
        }),
      })
    )
  );

  for (const r of responses) {
    assert.equal(r.status, 201, 'Mọi request đồng thời phải thành công 201 mà không văng lỗi 500');
  }

  const listRes = await fetch(`${baseUrl}/api/user/addresses`, { headers: { Cookie: cookie } });
  const listData = (await listRes.json()).data;
  assert.equal(listData.length, 4);
  const defaults = listData.filter((a: any) => a.isDefault === true);
  assert.equal(defaults.length, 1, 'Sau khi chạy song song chỉ được có đúng 1 địa chỉ mặc định duy nhất');
});

// 18. Profile Change Auditing
test('Profile Change Auditing: changing password updates password_changed_at and invalidates older tokens', async () => {
  const email = `audit_${Date.now()}@baity.vn`;
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Audit User',
      email,
      phone: '0988888882',
      password: 'Password@123',
    }),
  });
  const cookie = extractCookie(regRes);
  const user = (await regRes.json()).user;

  const beforeRows = await queryRows<{ password_changed_at: string }>(sql`
    SELECT password_changed_at FROM users WHERE id = ${user.id};
  `);
  const beforeTime = new Date(beforeRows[0].password_changed_at).getTime();

  await new Promise((r) => setTimeout(r, 50));

  const changeRes = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      currentPassword: 'Password@123',
      newPassword: 'NewPassword@456',
    }),
  });
  assert.equal(changeRes.status, 200);

  const afterRows = await queryRows<{ password_changed_at: string }>(sql`
    SELECT password_changed_at FROM users WHERE id = ${user.id};
  `);
  const afterTime = new Date(afterRows[0].password_changed_at).getTime();
  assert.ok(afterTime > beforeTime, 'password_changed_at phải được cập nhật mới sau khi đổi mật khẩu');
});

// 19. Địa chỉ hai cấp (Tỉnh/Thành phố, Phường/Xã; district = null)
test('Two-Level Address (Tỉnh/Thành phố, Phường/Xã): allows creating and updating address with district=null while preserving backward compatibility', async () => {
  const email = `two_level_addr_${Date.now()}@baity.vn`;
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Khách Địa Chỉ 2 Cấp',
      email,
      phone: '0919888777',
      password: 'Password@123',
    }),
  });
  const cookie = extractCookie(regRes);

  // Tạo địa chỉ 2 cấp (không truyền district)
  const createRes = await fetch(`${baseUrl}/api/user/addresses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      receiverName: 'Khách 2 Cấp',
      phone: '0919888777',
      province: 'Thành phố Hồ Chí Minh',
      ward: 'Phường Bến Nghé',
      streetAddress: 'Số 10 Đường Nguyễn Huệ',
      isDefault: true,
    }),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()).data;
  assert.equal(created.province, 'Thành phố Hồ Chí Minh');
  assert.equal(created.ward, 'Phường Bến Nghé');
  assert.equal(created.district, null, 'Địa chỉ 2 cấp mới phải lưu district = null');

  // Cập nhật địa chỉ vẫn giữ district = null
  const updateRes = await fetch(`${baseUrl}/api/user/addresses/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      receiverName: 'Khách 2 Cấp Đã Sửa',
      phone: '0919888777',
      province: 'Thành phố Hà Nội',
      district: null,
      ward: 'Phường Tràng Tiền',
      streetAddress: 'Số 25 Phố Hàng Khay',
      isDefault: true,
    }),
  });
  assert.equal(updateRes.status, 200);
  const updated = (await updateRes.json()).data;
  assert.equal(updated.province, 'Thành phố Hà Nội');
  assert.equal(updated.ward, 'Phường Tràng Tiền');
  assert.equal(updated.district, null);
});


