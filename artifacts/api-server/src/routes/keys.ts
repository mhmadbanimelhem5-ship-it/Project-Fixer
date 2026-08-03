/**
 * routes/keys.ts
 *
 * RSA public-key registry.
 *   POST /api/keys/register  — store a user's public key JWK (upsert)
 *   GET  /api/keys/:email    — retrieve a user's public key JWK
 */

import { Router } from 'express';
import { storePublicKey, lookupPublicKey } from '../lib/keyStore';
import { requireAuth, requireOwner, requirePublicKeyAccess } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validation';
import { publicKeyEmailParams, registerKeyBody } from '../middleware/schemas';

const router = Router();

// POST /api/keys/register
router.post('/register', requireAuth, validateBody(registerKeyBody), requireOwner('email'), async (req, res, next) => {
  try {
    const email = req.body.email;
    const jwk   = req.body.publicKeyJwk;

    if (typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ message: 'email is required and must be valid' });
      return;
    }
    if (!jwk || typeof jwk !== 'object') {
      res.status(400).json({ message: 'publicKeyJwk is required' });
      return;
    }

    await storePublicKey(email, jwk as Record<string, unknown>);
    req.log.info({ email }, 'RSA public key registered (upsert)');
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/keys/:email
router.get('/:email', requireAuth, validateParams(publicKeyEmailParams), requirePublicKeyAccess('email'), async (req, res, next) => {
  try {
    const jwk = await lookupPublicKey(String(req.params.email));
    if (!jwk) {
      req.log.warn({ email: req.params.email }, 'RSA public key lookup: not found');
      res.status(404).json({ message: 'Public key not found for this email' });
      return;
    }
    req.log.info({ email: req.params.email }, 'RSA public key fetched');
    res.json({ publicKeyJwk: jwk });
  } catch (err) { next(err); }
});

export default router;
