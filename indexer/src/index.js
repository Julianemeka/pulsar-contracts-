require('dotenv').config();
const { SorobanRpc, Networks } = require('@stellar/stellar-sdk');
const { Pool } = require('pg');
const express = require('express');

const {
  HORIZON_URL,
  CONTRACT_ID,
  DATABASE_URL,
  PORT = 3001,
} = process.env;

const db = new Pool({ connectionString: DATABASE_URL });
const app = express();
app.use(express.json());

// ── REST API ──────────────────────────────────────────────────────────────────

app.get('/events', async (req, res) => {
  const { type, limit = 50, offset = 0 } = req.query;
  const params = [Number(limit), Number(offset)];
  let where = '';
  if (type) { where = 'WHERE event_type = $3'; params.push(type); }
  const { rows } = await db.query(
    `SELECT * FROM events ${where} ORDER BY ledger DESC LIMIT $1 OFFSET $2`,
    params
  );
  res.json(rows);
});

app.get('/events/:type', async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM events WHERE event_type = $1 ORDER BY ledger DESC LIMIT 50',
    [req.params.type]
  );
  res.json(rows);
});

app.listen(PORT, () => console.log(`API listening on port ${PORT}`));

// ── Indexer ───────────────────────────────────────────────────────────────────

async function getLastIndexedLedger() {
  const { rows } = await db.query('SELECT MAX(ledger) AS last FROM events');
  return rows[0].last || 0;
}

async function saveEvent(event) {
  await db.query(
    `INSERT INTO events (ledger, tx_hash, contract_id, event_type, topics, value)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [
      event.ledger,
      event.txHash,
      event.contractId,
      event.type,
      JSON.stringify(event.topic),
      JSON.stringify(event.value),
    ]
  );
}

const BASE_POLL_DELAY_MS = 6000; // poll every ~1 ledger close
const MAX_POLL_DELAY_MS = 60000;

/**
 * Compute the poll delay for a given number of consecutive errors.
 * Exponential back-off starting at BASE_POLL_DELAY_MS, capped at MAX_POLL_DELAY_MS.
 * errorCount === 0 (last poll succeeded) yields the base delay.
 */
function computePollDelay(errorCount) {
  if (!errorCount || errorCount <= 0) return BASE_POLL_DELAY_MS;
  return Math.min(BASE_POLL_DELAY_MS * 2 ** errorCount, MAX_POLL_DELAY_MS);
}

let consecutiveErrors = 0;

async function poll() {
  const server = new SorobanRpc.Server(HORIZON_URL);

  try {
    const startLedger = (await getLastIndexedLedger()) + 1;

    console.log(`Polling events from ledger ${startLedger} for contract ${CONTRACT_ID}`);

    const response = await server.getEvents({
      startLedger,
      filters: [{ type: 'contract', contractIds: [CONTRACT_ID] }],
      limit: 200,
    });

    for (const event of response.events) {
      await saveEvent({
        ledger: event.ledger,
        txHash: event.txHash,
        contractId: event.contractId,
        type: event.topic[0]?.toString() ?? 'unknown',
        topic: event.topic.map(t => t.toString()),
        value: event.value,
      });
    }

    if (response.events.length) {
      console.log(`Indexed ${response.events.length} events`);
    }

    consecutiveErrors = 0;
  } catch (err) {
    consecutiveErrors += 1;
    console.error('Poll error:', err.message);
  }

  const delay = computePollDelay(consecutiveErrors);
  if (consecutiveErrors > 0) {
    console.warn(
      `Backing off for ${delay}ms after ${consecutiveErrors} consecutive error(s)`
    );
  }

  setTimeout(poll, delay);
}

if (require.main === module) {
  poll();
}

module.exports = { computePollDelay, BASE_POLL_DELAY_MS, MAX_POLL_DELAY_MS };
