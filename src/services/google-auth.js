const { OAuth2Client } = require('google-auth-library');

function createGoogleAuthService(env) {
  const client = env.GOOGLE_CLIENT_ID
    ? new OAuth2Client(env.GOOGLE_CLIENT_ID)
    : null;

  return {
    isConfigured: client !== null,
    async verifyIdToken(idToken) {
      if (!client) throw new Error('Google sign-in is not configured');
      const ticket = await client.verifyIdToken({
        idToken,
        audience: env.GOOGLE_CLIENT_ID,
      });
      return ticket.getPayload();
    },
  };
}

module.exports = { createGoogleAuthService };
