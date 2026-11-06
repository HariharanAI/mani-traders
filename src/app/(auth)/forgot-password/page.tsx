import { ForgotForm } from "../auth-forms";

export const metadata = { title: "Forgot password" };

export default function ForgotPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Enter your email. If email is not configured on this server, ask the owner to reset your password from Employees.</p>
      <ForgotForm />
    </>
  );
}
