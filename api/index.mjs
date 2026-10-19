// cache-bust: force Vercel re-bundle — Oct 15
import app from '../artifacts/api-server/dist/index.mjs';

// Keep Vercel from consuming/parsing the request stream before Express can
// verify RevenueCat's HMAC against the original webhook bytes.
export const config = {
  api: {
    bodyParser: false,
  },
};

export default app;