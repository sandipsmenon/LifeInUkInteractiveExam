import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <div className="card p-6">
        <h1 className="text-xl font-semibold">Life in the UK revision</h1>
        <p className="mt-1 text-sm text-ink-2">This is a private study site. Enter your password to continue.</p>
        <LoginForm />
      </div>
    </div>
  );
}
