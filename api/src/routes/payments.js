import { Router } from "express";
import { nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { invoke, view } from "../contractClient.js";

const router = Router();

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const idempotencyCache = new Map();

function getCachedResponse(key) {
  const entry = idempotencyCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    idempotencyCache.delete(key);
    return null;
  }
  return entry;
}

function setCachedResponse(key, status, body) {
  idempotencyCache.set(key, { status, body, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
}

function isPaymentAlreadyExists(err) {
  const candidates = [err?.message, err?.code, err?.name, err?.response?.data?.error?.code, err?.response?.data?.error?.message];
  return candidates.some((c) => typeof c === "string" && c.includes("PaymentAlreadyExists"));
}

/**
 * POST /api/payments
 * Headers: { Idempotency-Key }
 * Body: { payer, order: { order_id, merchant_address, payer, token, amount, description, expires_at }, signature }
 */
router.post("/", async (req, res, next) => {
  try {
    const idempotencyKey = req.get("Idempotency-Key");

    if (idempotencyKey) {
      const cached = getCachedResponse(idempotencyKey);
      if (cached) {
        return res.status(cached.status).json({ ...cached.body, idempotent: true });
      }
    }

    const { payer, order, signature } = req.body;
    if (!payer || !order || !signature) {
      return res.status(422).json({ error: { code: "InvalidInput", message: "Missing required fields" } });
    }

    let status;
    let body;
    try {
      await invoke("process_payment_with_signature", [
        nativeToScVal(payer, { type: "address" }),
        orderToScVal(order),
        nativeToScVal(Buffer.from(signature, "hex"), { type: "bytes" }),
      ]);
      status = 201;
      body = { message: "Payment processed" };
    } catch (err) {
      if (!isPaymentAlreadyExists(err)) throw err;
      status = 200;
      body = { message: "Payment already processed", idempotent: true };
    }

    if (idempotencyKey) {
      setCachedResponse(idempotencyKey, status, body);
    }

    res.status(status).json(body);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payments/:id
 * Query: { caller }
 */
router.get("/:id", async (req, res, next) => {
  try {
    const { caller } = req.query;
    if (!caller) {
      return res.status(422).json({ error: { code: "InvalidInput", message: "caller query param required" } });
    }
    const result = await view("get_payment_by_id", [
      nativeToScVal(caller, { type: "address" }),
      nativeToScVal(Buffer.from(req.params.id), { type: "bytes" }),
    ]);
    res.json(scValToNative(result));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payments
 * Query: { merchant, cursor, limit, date_start, date_end, amount_min, amount_max, status, sort_field, sort_order }
 */
router.get("/", async (req, res, next) => {
  try {
    const { merchant, cursor, limit = 10, date_start, date_end, amount_min, amount_max, status = "Any", sort_field = "Date", sort_order = "Descending" } = req.query;
    if (!merchant) {
      return res.status(422).json({ error: { code: "InvalidInput", message: "merchant query param required" } });
    }

    const filter = buildFilter({ date_start, date_end, amount_min, amount_max, status });

    const result = await view("get_merchant_payment_history", [
      nativeToScVal(merchant, { type: "address" }),
      cursor ? nativeToScVal(Buffer.from(cursor), { type: "bytes" }) : xdr.ScVal.scvVoid(),
      nativeToScVal(parseInt(limit, 10), { type: "u32" }),
      filter,
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(sort_field)]),
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(sort_order)]),
    ]);
    res.json(scValToNative(result));
  } catch (err) {
    next(err);
  }
});

function orderToScVal(order) {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("order_id"), val: nativeToScVal(Buffer.from(order.order_id), { type: "bytes" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("merchant_address"), val: nativeToScVal(order.merchant_address, { type: "address" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("payer"), val: nativeToScVal(order.payer, { type: "address" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("token"), val: nativeToScVal(order.token, { type: "address" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("amount"), val: nativeToScVal(BigInt(order.amount), { type: "i128" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("description"), val: nativeToScVal(order.description, { type: "string" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("expires_at"), val: nativeToScVal(BigInt(order.expires_at ?? 0), { type: "u64" }) }),
  ]);
}

function buildFilter({ date_start, date_end, amount_min, amount_max, status }) {
  const none = xdr.ScVal.scvVoid();
  const opt = (val, type) => val != null ? nativeToScVal(BigInt(val), { type }) : none;
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("date_start"), val: opt(date_start, "u64") }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("date_end"), val: opt(date_end, "u64") }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("amount_min"), val: opt(amount_min, "i128") }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("amount_max"), val: opt(amount_max, "i128") }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("token"), val: none }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("status"), val: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(status)]) }),
  ]);
}

export default router;
