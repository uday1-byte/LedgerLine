import { describe, it, expect } from 'vitest';
import { formatPaiseToINR, parseRupeesToPaise, PG_MAX_BIGINT } from '../utils/currency';

describe('Currency Utilities (Safe Integer & BigInt Money Handling)', () => {
  describe('formatPaiseToINR', () => {
    it('formats standard positive paise values into Indian Rupees', () => {
      expect(formatPaiseToINR(100000)).toBe('₹1,000.00');
      expect(formatPaiseToINR(5000)).toBe('₹50.00');
      expect(formatPaiseToINR(50)).toBe('₹0.50');
      expect(formatPaiseToINR(1)).toBe('₹0.01');
      expect(formatPaiseToINR(0)).toBe('₹0.00');
    });

    it('formats string paise inputs cleanly', () => {
      expect(formatPaiseToINR('100000')).toBe('₹1,000.00');
      expect(formatPaiseToINR('25050')).toBe('₹250.50');
      expect(formatPaiseToINR('99')).toBe('₹0.99');
    });

    it('formats BigInt paise inputs cleanly', () => {
      expect(formatPaiseToINR(100000n)).toBe('₹1,000.00');
      expect(formatPaiseToINR(123456789n)).toBe('₹12,34,567.89');
    });

    it('formats negative paise values with a negative sign prefix', () => {
      expect(formatPaiseToINR(-100000)).toBe('-₹1,000.00');
      expect(formatPaiseToINR(-50)).toBe('-₹0.50');
      expect(formatPaiseToINR('-2500')).toBe('-₹25.00');
      expect(formatPaiseToINR(-99999n)).toBe('-₹999.99');
    });

    it('handles null, undefined, and empty string safely', () => {
      expect(formatPaiseToINR(null)).toBe('₹0.00');
      expect(formatPaiseToINR(undefined)).toBe('₹0.00');
      expect(formatPaiseToINR('')).toBe('₹0.00');
    });

    it('preserves exact fractional amounts without IEEE-754 floating-point drift', () => {
      // 19.99 * 100 in float is 1998.9999999999998; integer paise 1999 must format to ₹19.99
      expect(formatPaiseToINR(1999)).toBe('₹19.99');
      expect(formatPaiseToINR(7001)).toBe('₹70.01');
    });

    it('formats maximum PostgreSQL BIGINT amount without error or precision loss', () => {
      const formattedMax = formatPaiseToINR(PG_MAX_BIGINT);
      expect(formattedMax).toContain('₹');
      expect(formattedMax.endsWith('.07')).toBe(true);
    });
  });

  describe('parseRupeesToPaise', () => {
    it('parses whole Rupee strings into integer paise', () => {
      const res = parseRupeesToPaise('100');
      expect(res.isValid).toBe(true);
      expect(res.paise).toBe('10000');
      expect(res.paiseBigInt).toBe(10000n);
    });

    it('parses 1-decimal place amounts correctly (e.g. 10.5 -> 1050 paise)', () => {
      const res = parseRupeesToPaise('10.5');
      expect(res.isValid).toBe(true);
      expect(res.paise).toBe('1050');
      expect(res.paiseBigInt).toBe(1050n);
    });

    it('parses 2-decimal place amounts correctly (e.g. 10.50 -> 1050 paise, 0.05 -> 5 paise)', () => {
      const res1 = parseRupeesToPaise('10.50');
      expect(res1.isValid).toBe(true);
      expect(res1.paise).toBe('1050');

      const res2 = parseRupeesToPaise('0.05');
      expect(res2.isValid).toBe(true);
      expect(res2.paise).toBe('5');

      const res3 = parseRupeesToPaise('0.01');
      expect(res3.isValid).toBe(true);
      expect(res3.paise).toBe('1');
    });

    it('handles leading zeroes safely on whole numbers (e.g. 05 -> 500 paise)', () => {
      const res = parseRupeesToPaise('5.00');
      expect(res.isValid).toBe(true);
      expect(res.paise).toBe('500');
    });

    it('rejects values with more than 2 decimal places', () => {
      const res = parseRupeesToPaise('10.123');
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/more than 2 decimal places/i);
    });

    it('rejects zero or negative amounts', () => {
      const resZero = parseRupeesToPaise('0');
      expect(resZero.isValid).toBe(false);
      expect(resZero.error).toMatch(/greater than zero/i);

      const resZeroDec = parseRupeesToPaise('0.00');
      expect(resZeroDec.isValid).toBe(false);
      expect(resZeroDec.error).toMatch(/greater than zero/i);

      const resNeg = parseRupeesToPaise('-50');
      expect(resNeg.isValid).toBe(false);
      expect(resNeg.error).toMatch(/must be positive/i);
    });

    it('rejects empty, null, undefined, or whitespace-only inputs', () => {
      expect(parseRupeesToPaise('').isValid).toBe(false);
      expect(parseRupeesToPaise('   ').isValid).toBe(false);
      expect(parseRupeesToPaise(null).isValid).toBe(false);
      expect(parseRupeesToPaise(undefined).isValid).toBe(false);
    });

    it('rejects non-numeric or malformed strings', () => {
      expect(parseRupeesToPaise('abc').isValid).toBe(false);
      expect(parseRupeesToPaise('12a').isValid).toBe(false);
      expect(parseRupeesToPaise('1.2.3').isValid).toBe(false);
      expect(parseRupeesToPaise('$50').isValid).toBe(false);
      expect(parseRupeesToPaise('₹100').isValid).toBe(false);
    });

    it('rejects amounts exceeding PostgreSQL BIGINT maximum', () => {
      // PG_MAX_BIGINT in paise is 9223372036854775807 paise (approx 92233720368547758.07 rupees)
      const resOverflow = parseRupeesToPaise('9223372036854775808');
      expect(resOverflow.isValid).toBe(false);
      expect(resOverflow.error).toMatch(/exceeds maximum allowed limit/i);
    });

    it('converts arbitrarily large values up to BIGINT limit without float precision loss', () => {
      // 90071992547409.91 in paise is 9007199254740991 paise (above JS MAX_SAFE_INTEGER 9007199254740991)
      const res = parseRupeesToPaise('90071992547409.91');
      expect(res.isValid).toBe(true);
      expect(res.paise).toBe('9007199254740991');
      expect(res.paiseBigInt).toBe(9007199254740991n);
    });
  });
});

