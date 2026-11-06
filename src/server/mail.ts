/**
 * Password-reset email. Uses SMTP_URL when configured; otherwise logs the link
 * to the server console (development) — the owner can also reset passwords
 * from Employees.
 */
export async function sendResetEmail(to: string, name: string, link: string) {
  if (!process.env.SMTP_URL) {
    console.info(`[password-reset] SMTP not configured. Reset link for ${to}: ${link}`);
    return;
  }
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({
    from: process.env.SMTP_FROM || "MANI TRADERS <no-reply@localhost>",
    to,
    subject: "Reset your MANI TRADERS password",
    text: `Hello ${name},\n\nUse this link to set a new password (valid for 30 minutes):\n${link}\n\nIf you did not request this, you can ignore this email.`,
  });
}
