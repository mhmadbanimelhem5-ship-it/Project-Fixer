import rateLimit from 'express-rate-limit';

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.',
  },
});

// ✅ تعديل: زيادة الحد من 5 إلى 20، وتقليل النافذة إلى 5 دقائق
// لأن authenticatedFetch الجديد يحاول 3 مرات خلال 6 ثوانٍ
export const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again after 5 minutes.',
  },
});

export const waitlistLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    accepted: false,
    error: 'Too many waitlist requests. Please try again later.',
  },
});