import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVietnameseText } from '../server/db/seed.ts';

test('normalizeVietnameseText: strips diacritics and converts to lowercase', () => {
  const input = 'Áo Sơ Mi Oxford Nam Dài Tay Cổ Bẻ';
  const expected = 'ao so mi oxford nam dai tay co be';
  assert.equal(normalizeVietnameseText(input), expected);
});

test('normalizeVietnameseText: correctly maps đ and Đ to d', () => {
  const input = 'Đầm Maxi Nữ Đi Biển Dáng Xòe Điệu Đà';
  const expected = 'dam maxi nu di bien dang xoe dieu da';
  assert.equal(normalizeVietnameseText(input), expected);
});

test('normalizeVietnameseText: handles special characters and collapses whitespace', () => {
  const input = '   Quần Jean Nam (Ống Đứng) - Size 32 / Xanh Wash!   ';
  const expected = 'quan jean nam ong dung size 32 xanh wash';
  assert.equal(normalizeVietnameseText(input), expected);
});
