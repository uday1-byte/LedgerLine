/**
 * Phase 3 Concurrency Regression Test: Deterministic Locking Verification
 *
 * Purpose: Empirically verify that simultaneous POST /api/transfers requests
 * cannot overdraw a source account after introducing pessimistic row locking
 * (SELECT ... FOR UPDATE) and conditional deduction guards.
 *
 * Concurrency proof strategy:
 *   1. Two concurrent HTTP requests are dispatched simultaneously via Promise.all.
 *   2. Client #1 executes SELECT ... FOR UPDATE, acquiring an exclusive row lock.
 *   3. Client #1 pauses inside its transaction until Client #2 has also dispatched
 *      its SELECT ... FOR UPDATE.
 *   4. Client #2's query attempts to acquire the lock and is serialized (blocked)
 *      by PostgreSQL at the database engine level until Client #1 commits.
 *   5. Client #1 executes deduction (80000 paise), credits destination 1, and commits (201).
 *   6. Upon Client #1's commit, PostgreSQL unblocks Client #2, which re-evaluates the
 *      now-updated balance (20000 paise), fails the check (20000 < 80000), rolls back,
 *      and returns 422 InsufficientFundsError.
 *
 * Required secure invariants:
 *   - Status codes: exactly one 201 Created and one 422 Unprocessable Entity.
 *   - Final source balance: exactly 20,000 paise (no overdraft).
 *   - Destination balances: exactly one 80,000 paise and one 0 paise.
 *   - Total money conserved: exactly 100,000 paise.
 *   - Completed transfers: exactly 1.
 *   - Two distinct PostgreSQL clients verified.
 */

const http = require('http');
const app = require('../src/app');
const { pool } = require('../src/config/db');

jest.setTimeout(20000);

// ─── Shared server ─────────────────────────────────────────────────────────────
let server;
let serverPort;

function httpPost(port, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Connection': 'close',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(data) }));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

beforeAll((done) => {
  server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => {
    serverPort = server.address().port;
    done();
  });
}, 10000);

afterAll(async () => {
  if (server && server.closeAllConnections) {
    server.closeAllConnections();
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}, 15000);

// ─── Test suite ────────────────────────────────────────────────────────────────
describe('Phase 3 Concurrency Hardening: Deterministic Regression Test', () => {
  let sourceAccountId;
  let dest1AccountId;
  let dest2AccountId;
  let originalConnect;

  // ── Account setup ────────────────────────────────────────────────────────────
  beforeEach(async () => {
    const srcRes = await pool.query(
      `INSERT INTO accounts (account_number, balance_paise) VALUES ($1, $2) RETURNING id`,
      [`DET-SRC-${Date.now()}`, 100000]
    );
    sourceAccountId = srcRes.rows[0].id;
    await new Promise((r) => setTimeout(r, 2));

    const dst1Res = await pool.query(
      `INSERT INTO accounts (account_number, balance_paise) VALUES ($1, $2) RETURNING id`,
      [`DET-DST1-${Date.now()}`, 0]
    );
    dest1AccountId = dst1Res.rows[0].id;
    await new Promise((r) => setTimeout(r, 2));

    const dst2Res = await pool.query(
      `INSERT INTO accounts (account_number, balance_paise) VALUES ($1, $2) RETURNING id`,
      [`DET-DST2-${Date.now()}`, 0]
    );
    dest2AccountId = dst2Res.rows[0].id;

    originalConnect = pool.connect.bind(pool);
  }, 10000);

  // ── Unconditional cleanup ────────────────────────────────────────────────────
  afterEach(async () => {
    if (originalConnect) {
      pool.connect = originalConnect;
    }
    if (sourceAccountId && dest1AccountId && dest2AccountId) {
      await pool.query(
        `DELETE FROM transfers
         WHERE source_account_id = $1
            OR destination_account_id IN ($2, $3)`,
        [sourceAccountId, dest1AccountId, dest2AccountId]
      );
      await pool.query(
        `DELETE FROM accounts WHERE id IN ($1, $2, $3)`,
        [sourceAccountId, dest1AccountId, dest2AccountId]
      );
    }
  }, 10000);

  // ── Main experiment ──────────────────────────────────────────────────────────
  it('prevents overdraft by serializing concurrent transfers via SELECT ... FOR UPDATE', async () => {
    const observedSourceReads = [];
    const wrappedClients = [];
    let firstClientSelectFinished = false;
    let secondClientDispatched = false;
    let barrierTimedOut = false;
    let releaseFirstClient;
    let barrierTimeoutHandle;
    let clientCounter = 0;

    const secondClientDispatchedPromise = new Promise((resolve) => {
      releaseFirstClient = () => {
        if (barrierTimeoutHandle !== undefined) {
          clearTimeout(barrierTimeoutHandle);
          barrierTimeoutHandle = undefined;
        }
        resolve();
      };
    });

    barrierTimeoutHandle = setTimeout(() => {
      barrierTimedOut = true;
      releaseFirstClient();
    }, 3000);

    // ── Instrument pool.connect ──────────────────────────────────────────────────
    pool.connect = async () => {
      const client = await originalConnect();
      const clientId = ++clientCounter;
      const originalQuery = client.query.bind(client);

      wrappedClients.push({ clientId, client, originalQuery });

      client.query = async (text, params) => {
        // Intercept: locking SELECT on accounts containing sourceAccountId
        const isAccountsLockSelect =
          typeof text === 'string' &&
          text.includes('SELECT') &&
          text.includes('balance_paise') &&
          text.includes('FOR UPDATE') &&
          Array.isArray(params) &&
          params.includes(sourceAccountId);

        if (isAccountsLockSelect) {
          if (!firstClientSelectFinished) {
            // First client to arrive executes SELECT ... FOR UPDATE to acquire row lock
            firstClientSelectFinished = true;
            const result = await originalQuery(text, params);
            const srcRow = result.rows.find((r) => r.id === sourceAccountId);
            observedSourceReads.push({
              clientId,
              order: 1,
              balance: srcRow.balance_paise.toString(),
            });

            // Pause Client 1 holding lock until Client 2 has dispatched its SELECT ... FOR UPDATE
            await secondClientDispatchedPromise;
            return result;
          } else {
            // Second client arrives and signals it is about to request the lock
            secondClientDispatched = true;
            releaseFirstClient();

            // Client 2 query blocks in PostgreSQL until Client 1 commits
            const result = await originalQuery(text, params);
            const srcRow = result.rows.find((r) => r.id === sourceAccountId);
            observedSourceReads.push({
              clientId,
              order: 2,
              balance: srcRow.balance_paise.toString(),
            });
            return result;
          }
        }

        return originalQuery(text, params);
      };

      return client;
    };

    // ── Launch two concurrent transfer requests over real TCP ────────────────────
    let res1, res2;
    try {
      [res1, res2] = await Promise.all([
        httpPost(serverPort, '/api/transfers', {
          sourceAccountId,
          destinationAccountId: dest1AccountId,
          amountPaise: 80000,
        }),
        httpPost(serverPort, '/api/transfers', {
          sourceAccountId,
          destinationAccountId: dest2AccountId,
          amountPaise: 80000,
        }),
      ]);
    } finally {
      if (originalConnect) {
        pool.connect = originalConnect;
      }
      if (barrierTimeoutHandle !== undefined) {
        clearTimeout(barrierTimeoutHandle);
        barrierTimeoutHandle = undefined;
      }
      for (const { client, originalQuery } of wrappedClients) {
        client.query = originalQuery;
      }
    }

    // ── Read final balances directly from PostgreSQL ─────────────────────────────
    const srcDb  = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [sourceAccountId]);
    const dst1Db = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [dest1AccountId]);
    const dst2Db = await pool.query('SELECT balance_paise FROM accounts WHERE id = $1', [dest2AccountId]);
    const transfersDb = await pool.query(
      'SELECT id, amount_paise FROM transfers WHERE source_account_id = $1',
      [sourceAccountId]
    );

    const finalSourceBalance = BigInt(srcDb.rows[0].balance_paise);
    const finalDest1Balance  = BigInt(dst1Db.rows[0].balance_paise);
    const finalDest2Balance  = BigInt(dst2Db.rows[0].balance_paise);
    const totalMoney         = finalSourceBalance + finalDest1Balance + finalDest2Balance;

    // ── Experiment report ────────────────────────────────────────────────────────
    console.log('');
    console.log('=== CONCURRENCY REGRESSION TEST RESULTS ===');
    console.log(`Barrier Timed Out      : ${barrierTimedOut ? 'YES — BARRIER FAILURE' : 'NO — Both requests synchronized'}`);
    console.log(`Second Client Dispatched: ${secondClientDispatched ? 'YES — Contended for row lock' : 'NO'}`);
    console.log(`Distinct Client IDs    : ${[...new Set(observedSourceReads.map((r) => r.clientId))].join(', ')}`);
    console.log(`Observed Source Reads  : ${JSON.stringify(observedSourceReads)}`);
    console.log(`Request 1 HTTP Status  : ${res1.statusCode}`);
    console.log(`Request 2 HTTP Status  : ${res2.statusCode}`);
    console.log(`Initial Source Balance : 100000 paise  (₹1,000.00)`);
    console.log(`Final Source Balance   : ${finalSourceBalance.toString()} paise`);
    console.log(`Final Dest 1 Balance   : ${finalDest1Balance.toString()} paise`);
    console.log(`Final Dest 2 Balance   : ${finalDest2Balance.toString()} paise`);
    console.log(`Total Money in System  : ${totalMoney.toString()} paise`);
    console.log(`Completed Transfers    : ${transfersDb.rows.length}`);
    console.log(`Is Source Overdrawn    : ${finalSourceBalance < 0n ? 'YES — OVERDRAFT' : 'NO — PROTECTED'}`);
    console.log('===========================================');
    console.log('');

    // ── Assertions ────────────────────────────────────────────────────────────────

    // 1. Both requests were synchronized without timing out
    expect(barrierTimedOut).toBe(false);
    expect(secondClientDispatched).toBe(true);

    // 2. Both reads were captured through two distinct PostgreSQL connections
    expect(observedSourceReads.length).toBe(2);
    const distinctClients = new Set(observedSourceReads.map((r) => r.clientId));
    expect(distinctClients.size).toBe(2);

    // 3. Client 1 saw initial balance 100,000; Client 2 saw updated balance 20,000
    expect(observedSourceReads[0].balance).toBe('100000');
    expect(observedSourceReads[1].balance).toBe('20000');

    // 4. Strict HTTP response codes: exactly one 201 Created and one 422 Unprocessable Entity
    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([201, 422]);

    // 5. Final database balances: source is exactly 20,000 paise (not negative)
    expect(finalSourceBalance).toBe(20000n);
    expect(finalSourceBalance).toBeGreaterThanOrEqual(0n);

    // 6. Exactly one destination received 80,000 paise; other remained 0
    const destBalances = [finalDest1Balance, finalDest2Balance].sort();
    expect(destBalances).toEqual([0n, 80000n]);
    expect(finalDest1Balance).toBeGreaterThanOrEqual(0n);
    expect(finalDest2Balance).toBeGreaterThanOrEqual(0n);

    // 7. Exactly one transfer record was created
    expect(transfersDb.rows.length).toBe(1);

    // 8. Money conservation invariant: total money is exactly 100,000 paise
    expect(totalMoney).toBe(100000n);
  });
});
