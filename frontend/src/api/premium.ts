import { apiFetch } from "./client";

export interface PremiumOrder {
  order_id: string;
  amount: number; // paise
  currency: string;
  key_id: string;
  policy_number: string;
}

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: { error: { description: string } }) => void) => void };
  }
}

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load Razorpay Checkout"));
    document.body.appendChild(s);
  });
}

/** Opens Razorpay Checkout for a policy premium. Resolves true when paid and verified. */
export async function payPremium(policyId: string, prefill?: { name?: string; email?: string }): Promise<boolean> {
  const order = await apiFetch<PremiumOrder>(`/premium/${policyId}/order`, { method: "POST" });
  await loadCheckout();
  return new Promise<boolean>((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount,
      currency: order.currency,
      name: "FarmTrust",
      description: `Premium for policy ${order.policy_number}`,
      prefill,
      theme: { color: "#2f7d4f" },
      handler: (resp: RazorpaySuccess) => {
        apiFetch(`/premium/verify`, { method: "POST", body: resp }).then(() => resolve(true)).catch(reject);
      },
      modal: { ondismiss: () => resolve(false) },
    });
    rzp.on("payment.failed", (r) => reject(new Error(r.error.description)));
    rzp.open();
  });
}
