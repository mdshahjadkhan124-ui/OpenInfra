/**
 * Passport — Google OAuth 2.0 strategy only.
 *
 * Configured for *stateless* use: `session: false` everywhere, no serialize/
 * deserialize, no session store. Passport handles the OAuth handshake and
 * nothing else; the moment we have a verified Google profile we mint our own
 * JWT and the rest of the API is identical to the local flow.
 *
 * Registering the strategy is conditional on the credentials being present, so
 * the server still boots with Google OAuth unconfigured (see config/env.js).
 */
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

export const initPassport = () => {
  if (!config.googleOAuth.ready) {
    logger.warn('Google OAuth not configured — /api/auth/google will return 503.');
    return passport;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: config.googleOAuth.clientId,
        clientSecret: config.googleOAuth.clientSecret,
        callbackURL: config.googleOAuth.callbackUrl,
        scope: ['profile', 'email'],
        // Give the verify callback access to `req` so it can read the `state`
        // parameter, which is how the requested role survives the round trip.
        passReqToCallback: true,
      },
      /**
       * Verify callback. We do not create the user here — that is the service's
       * job. This only normalises Google's profile shape and hands it on, so
       * the OAuth wire format stays out of the business logic.
       */
      (req, accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          done(null, {
            googleId: profile.id,
            email,
            name: profile.displayName,
            avatarUrl: profile.photos?.[0]?.value ?? null,
          });
        } catch (err) {
          done(err);
        }
      }
    )
  );

  logger.info('Google OAuth strategy registered.');
  return passport;
};

export default passport;
