/**
 * Experiment 2B: Deterministic Concurrency Test
 *
 * Purpose: Empirically determine whether two simultaneous POST /api/transfers
 * requests can overdraw a source account under the baseline (unfixed) transfer
 * implementation.
 *
 * Synchronization strategy:
 *   1. The test instruments pool.connect() so each returned pg client has its
 *      query() method wrapped.
 *   2. When a wrapped client executes the source-account balance SELECT, we
 *      record the returned balance and the client ID.
 *   3. The FIRST request's client pauses at a Promise barrier until the SECOND
 *      request's client also completes its source-balance SELECT.
 *   4. The barrier then releases BOTH requests simultaneously, so both proceed
 *      to their UPDATE with the same stale balance still in memory.
 *   5. After the barrier releases for a client, that client's query wrapper is
 *      immediately uninstalled so subsequent pool.query() calls are not
 *      intercepted and cannot re-trigger the barrier.
 *
 * Cleanup guarantees:
 *   - pool.connect is restored in BOTH a try/finally inside the test body AND afterEach.
 *   - The barrier timeout handle is cleared in a try/finally block.
 *   - client.query wrappers are removed before each client goes back to the pool.
 *   - Only accounts and transfers created by this test are deleted in afterEach.
 *
 * Production guarantee:
 *   - The instrumentation is applied only during the test and is never compiled
 *     into, deployed with, or activated by the production server.
 *   - backend/src/routes/transfers.js is NOT modified.
 */

const http = require('http');
const app = require('../src/app');
const { pool } = require('../src/config/db');

jest.setTimeout(20000);

// ─── Shared server ─────────────────────────────────────────────────────────────
// A single pre-started TCP server so both concurrent requests run simultaneously.
let server;
let serverPort;

/**
 * Thin wrapper around http.request for JSON POST requests.
 * Returns { statusCode, body }.
 */
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
describe('Experiment 2B: Deterministic Concurrency Test', () => {
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
    // Safety net: restore pool.connect even if the test body's finally block ran
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
  it('determines balance behavior when both requests read before either writes', async () => {
    // observedSourceReads[]: { clientId, balance } — one entry per intercepted SELECT
    const observedSourceReads = [];
    // wrappedClients[]: pairs of { clientId, client, originalQuery }
    // so we can uninstall wrappers after the barrier releases
    const wrappedClients = [];
    let readsCompleted = 0;
    let barrierTimedOut = false;
    let releaseBarrier;
    let barrierTimeoutHandle;
    let clientCounter = 0;
    let barrierReleased = false;   // guards against re-entrant uninstall

    // ── Barrier: holds request 1 until request 2 also reads ─────────────────────
    const barrierPromise = new Promise((resolve) => {
      releaseBarrier = () => {
        if (barrierTimeoutHandle !== undefined) {
          clearTimeout(barrierTimeoutHandle);
          barrierTimeoutHandle = undefined;
        }
        if (!barrierReleased) {
          barrierReleased = true;
          // Uninstall ALL client.query wrappers so released clients going back
          // to the pool cannot intercept subsequent pool.query() calls.
          for (const { client, originalQuery } of wrappedClients) {
            client.query = originalQuery;
          }
        }
        resolve();
      };
    });

    // Safety timer: flags timeout if second request never reaches barrier in 3s
    barrierTimeoutHandle = setTimeout(() => {
      barrierTimedOut = true;
      releaseBarrier();
    }, 3000);

    // ── Instrument pool.connect ──────────────────────────────────────────────────
    pool.connect = async () => {
      const client = await originalConnect();
      const clientId = ++clientCounter;
      const originalQuery = client.query.bind(client);

      // Track this client so we can remove the wrapper after barrier release
      wrappedClients.push({ clientId, client, originalQuery });

      client.query = async (text, params) => {
        const result = await originalQuery(text, params);

        // Intercept: source-account balance SELECT only, before barrier fires
        const isSourceSelect =
          !barrierReleased &&
          typeof text === 'string' &&
          text.includes('SELECT') &&
          text.includes('balance_paise') &&
          Array.isArray(params) &&
          params[0] === sourceAccountId;

        if (isSourceSelect && result && result.rows && result.rows[0]) {
          observedSourceReads.push({
            clientId,
            balance: result.rows[0].balance_paise.toString(),
          });
          readsCompleted += 1;

          if (readsCompleted === 1) {
            // Pause: wait for the second request to also complete its SELECT
            await barrierPromise;
          } else if (readsCompleted === 2) {
            // Both have read; release the first request to continue to UPDATE
            releaseBarrier();
          }
        }

        return result;
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
      // Guarantee: restore pool.connect even if Promise.all throws
      if (originalConnect) {
        pool.connect = originalConnect;
      }
      // Guarantee: clear barrier timeout and uninstall all client wrappers
      if (barrierTimeoutHandle !== undefined) {
        clearTimeout(barrierTimeoutHandle);
        barrierTimeoutHandle = undefined;
      }
      // Uninstall any wrappers not already removed by releaseBarrier
      if (!barrierReleased) {
        barrierReleased = true;
        for (const { client, originalQuery } of wrappedClients) {
          client.query = originalQuery;
        }
      }
    }

    // ── Read final balances directly from PostgreSQL ──────────────────────────────
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

    // ── Experiment report ─────────────────────────────────────────────────────────
    console.log('');
    console.log('=== DETERMINISTIC CONCURRENCY TEST RESULTS ===');
    console.log(`Barrier Timed Out      : ${barrierTimedOut ? 'YES — BARRIER FAILURE' : 'NO  — Both reads synchronized'}`);
    console.log(`Reads Reached Barrier  : ${readsCompleted} of 2`);
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
    console.log(`Is Source Overdrawn    : ${finalSourceBalance < 0n ? 'YES — OVERDRAFT CONFIRMED' : 'NO'}`);
    console.log('==============================================');
    console.log('');

    // ── Assertions ────────────────────────────────────────────────────────────────

    // A. Barrier must NOT have timed out — a timeout means the second request
    //    never reached the barrier, so the synchronization failed and the
    //    experiment result is invalid.
    expect(barrierTimedOut).toBe(false);

    // B. Exactly two source-balance SELECTs must have been intercepted
    expect(readsCompleted).toBe(2);

    // C. Both intercepted reads must have been captured
    expect(observedSourceReads.length).toBe(2);

    // D. Both reads must have observed 100,000 paise (the initial balance,
    //    before any UPDATE committed)
    expect(observedSourceReads[0].balance).toBe('100000');
    expect(observedSourceReads[1].balance).toBe('100000');

    // E. Both reads must have come from TWO DISTINCT PostgreSQL clients,
    //    proving two separate transactions were in flight simultaneously
    const distinctClients = new Set(observedSourceReads.map((r) => r.clientId));
    expect(distinctClients.size).toBe(2);

    // F. Money conservation: total paise must equal the initial 100,000
    expect(totalMoney).toBe(100000n);

    // G. HTTP status codes and transfer record count must match the actual outcome
    if (finalSourceBalance < 0n) {
      // ── OVERDRAFT REPRODUCED ────────────────────────────────────────────────
      // Both transactions read 100,000, both passed the in-process balance
      // check (100,000 >= 80,000), and both committed their UPDATEs.
      // Both HTTP responses must be 201.
      expect(res1.statusCode).toBe(201);
      expect(res2.statusCode).toBe(201);
      expect(transfersDb.rows.length).toBe(2);
      // 100,000 - 80,000 - 80,000 = -60,000
      expect(finalSourceBalance).toBe(-60000n);
      expect(finalDest1Balance).toBe(80000n);
      expect(finalDest2Balance).toBe(80000n);
    } else {
      // ── SERIALIZED — NO OVERDRAFT ───────────────────────────────────────────
      // Despite the barrier, PostgreSQL serialized the UPDATEs so only one
      // committed. Exactly one 201 and one 422 expected.
      const statuses = [res1.statusCode, res2.statusCode].sort();
      expect(statuses).toEqual([201, 422]);
      expect(transfersDb.rows.length).toBe(1);
      expect(finalSourceBalance).toBe(20000n);
    }
  });
});
