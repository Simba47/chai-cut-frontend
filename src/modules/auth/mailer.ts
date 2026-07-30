import { Resend } from 'resend'

const resend = new Resend(process.env.AUTH_RESEND_KEY)
const FROM = process.env.AUTH_EMAIL_FROM ?? 'Chai Cut <noreply@resend.dev>'

export async function sendOtpEmail(
  email: string,
  otp: string,
  purpose: 'signup' | 'password_reset',
): Promise<void> {
  const isSignup = purpose === 'signup'
  const subject = isSignup ? 'Your Chai Cut verification code' : 'Reset your Chai Cut password'
  const heading = isSignup ? 'Verify your email' : 'Reset your password'
  const body = isSignup
    ? 'Enter this code to verify your Chai Cut account.'
    : 'Enter this code to reset your password.'

  await resend.emails.send({
    from: FROM,
    to: email,
    subject,
    html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:48px 16px;">
      <table width="420" cellpadding="0" cellspacing="0"
        style="background:#141414;border:1px solid #2a2a2a;border-radius:12px;">
        <tr><td style="padding:36px 40px;">
          <p style="margin:0 0 4px;font-size:13px;color:#555;letter-spacing:.05em;">✂ CHAI CUT</p>
          <h1 style="margin:8px 0 12px;font-size:20px;font-weight:700;color:#f0f0f0;">${heading}</h1>
          <p style="margin:0 0 28px;font-size:14px;color:#888;line-height:1.5;">${body}</p>
          <div style="background:#1e1e1e;border:1px solid #2a2a2a;border-radius:8px;
            padding:20px;text-align:center;margin-bottom:28px;">
            <span style="font-size:38px;font-weight:700;letter-spacing:14px;color:#00b4d8;
              font-variant-numeric:tabular-nums;">${otp}</span>
          </div>
          <p style="margin:0;font-size:12px;color:#555;line-height:1.6;">
            This code expires in <strong style="color:#888;">10 minutes</strong>.<br>
            If you didn&apos;t request this, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}
