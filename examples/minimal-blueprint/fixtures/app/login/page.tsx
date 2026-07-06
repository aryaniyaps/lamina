// Fixture production page for brownfield manifest source-path validation.
export default function LoginPage() {
  return (
    <main>
      <h1>Sign in</h1>
      <p>Access your account</p>
      <form>
        <input name="email" aria-label="Email" />
        <input name="password" type="password" aria-label="Password" />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
