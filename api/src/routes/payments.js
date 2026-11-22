import { Router } from "express";
import { nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { invoke, view } from "../contractClient.js";

const router = Router();

/**
 * POST /api/payments
 * Body: { payer, order: { order_id, merchant_address, payer, token, amount, description, expires_at }, signature }
 */
router.post("/", async (req, res, next) => {
  try {
    const { payer, order, signature } = req.body;
    if (!payer || !order || !signature) {
      return res.status(422).json({ error: { code: "InvalidInput", message: "Missing required fields" } });
    }
    await invoke("process_payment_with_signature", [
      nativeToScVal(payer, { type: "address" }),
      orderToScVal(order),
      nativeToScVal(Buffer.from(signature, "hex"), { type: "bytes" }),
    ]);
    res.status(201).json({ message: "Payment processed" });
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
 * Query: { merchant, cursor, limit, date_start, date_end, amount_min, amount_max, status, sort_field, sort_order, format }
 * When format=csv, returns a CSV attachment instead of JSON.
 */
router.get("/", async (req, res, next) => {
  try {
    const { merchant, cursor, limit = 10, date_start, date_end, amount_min, amount_max, status = "Any", sort_field = "Date", sort_order = "Descending", format } = req.query;
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
    const data = scValToNative(result);

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=payments.csv");
      return res.send(toCsv(data));
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

const CSV_COLUMNS = ["order_id", "merchant_address", "payer", "token", "amount", "status", "paid_at"];

function csvEscape(value) {
  if (value == null) return "";
  let str;
  if (Buffer.isBuffer(value)) {
    str = value.toString("hex");
  } else if (typeof value === "object") {
    str = JSON.stringify(value);
  } else {
    str = String(value);
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(data) {
  const records = Array.isArray(data) ? data : (data?.records ?? []);
  const lines = [CSV_COLUMNS.join(",")];
  for (const record of records) {
    lines.push(CSV_COLUMNS.map((col) => csvEscape(record?.[col])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

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

export { toCsv, csvEscape, CSV_COLUMNS };
export default router;
