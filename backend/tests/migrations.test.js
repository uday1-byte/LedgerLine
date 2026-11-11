const fs = require('fs');
const path = require('path');

describe('Database Migrations Encoding & BOM Validation', () => {
  const migrationsDir = path.resolve(__dirname, '../../database/migrations');

  it('verifies that all migration files are UTF-8 without BOM', () => {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    expect(files.length).toBeGreaterThanOrEqual(6);

    for (const file of files) {
      const buffer = fs.readFileSync(path.join(migrationsDir, file));
      const hasBOM = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
      expect({ file, hasBOM }).toEqual({ file, hasBOM: false });
    }
  });

  it('verifies defensive BOM stripping logic for SQL execution strings', () => {
    const stripBom = (input) => {
      let sql = input;
      if (sql.charCodeAt(0) === 0xfeff) {
        sql = sql.slice(1);
      }
      return sql;
    };

    const sqlWithBom = '\uFEFF-- Migration comment\nSELECT 1;';
    const sqlWithoutBom = '-- Migration comment\nSELECT 1;';

    // Verify input with BOM has 0xFEFF as first character
    expect(sqlWithBom.charCodeAt(0)).toBe(0xfeff);

    // Verify stripping removes leading BOM character
    const stripped = stripBom(sqlWithBom);
    expect(stripped.charCodeAt(0)).not.toBe(0xfeff);
    expect(stripped).toBe(sqlWithoutBom);

    // Verify string without BOM is unaffected
    expect(stripBom(sqlWithoutBom)).toBe(sqlWithoutBom);
  });
});
