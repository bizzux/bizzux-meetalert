// react-native-razorpay@3.0.0 ships its types as plain .ts source under
// src/, with no "types"/"typings" field in its package.json pointing TS at
// them - so without this ambient declaration, `import RazorpayCheckout from
// 'react-native-razorpay'` fails to compile under this project's
// strict: true (TS7016, "could not find a declaration file"). Shape below
// is trimmed to just what services/razorpay.ts actually uses; see the
// package's own src/types.ts if a future change needs more of its options.
declare module 'react-native-razorpay' {
  interface RazorpayOptions {
    key: string;
    amount: number | string;
    currency?: string;
    name?: string;
    description?: string;
    order_id?: string;
    prefill?: { name?: string; email?: string; contact?: string };
    theme?: { color?: string };
    [extra: string]: unknown;
  }

  interface RazorpaySuccessResult {
    razorpay_payment_id: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
  }

  interface RazorpayErrorResult {
    code: number;
    description: string;
    [extra: string]: unknown;
  }

  const RazorpayCheckout: {
    open(options: RazorpayOptions): Promise<RazorpaySuccessResult>;
  };

  export default RazorpayCheckout;
}
