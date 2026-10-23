export function projectOrder(row: any, itemCount = 0) {
  return {
    id: row.id, order_number: row.order_no ?? row.order_number ?? row.id?.slice(0, 8),
    status: displayStatus(row.status), created_at: row.created_at, updated_at: row.updated_at,
    customer_name: row.receiver_name ?? row.customer_name ?? row.customer ?? "Customer",
    payment_method: row.payment_method ?? row.payment_type ?? null, payment_status: row.payment_status ?? null,
    subtotal: number(row.subtotal), discount: number(row.discount), delivery_fee: number(row.delivery_fee), total: number(row.total),
    item_count: itemCount, estimated_delivery_at: row.estimated_delivery_at ?? null,
    driver_name: row.rider_name ?? row.driver_name ?? null,
  };
}
function number(value: unknown) { const result = Number(value); return Number.isFinite(result) ? result : 0; }
function displayStatus(status: string) { return status === "placed" ? "new" : status === "confirmed" ? "preparing" : ["packed", "assigned", "on_the_way"].includes(status) ? "ready" : status === "delivered" ? "completed" : status === "cancelled" ? "cancelled" : status; }
