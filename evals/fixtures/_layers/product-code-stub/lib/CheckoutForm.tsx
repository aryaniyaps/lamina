/** Brownfield product code stub — read-only during Lamina commands. */
export function CheckoutForm() {
  return (
    <form>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" />
      <button type="submit">Continue</button>
    </form>
  );
}
