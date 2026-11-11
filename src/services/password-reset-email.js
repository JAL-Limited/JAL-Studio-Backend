const nodemailer = require('nodemailer');

function createPasswordResetEmailService(env) {
  const isConfigured = Boolean(
    env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM,
  );
  const transporter = isConfigured
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      })
    : null;

  return {
    isConfigured,
    async sendCode({ email, code }) {
      if (!transporter) {
        const error = new Error('Password reset email is not configured');
        error.status = 503;
        throw error;
      }
      await transporter.sendMail({
        from: env.SMTP_FROM,
        to: email,
        subject: 'Your JAL Studio password reset code',
        text: `Use this one-time code to reset your JAL Studio password: ${code}\n\nIt expires in 15 minutes. If you did not request this, you can ignore this email.`,
      });
    },
  };
}

module.exports = { createPasswordResetEmailService };
