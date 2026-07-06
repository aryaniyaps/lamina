import { Flow, Transition } from '@lamina/blueprint';

export default function Flows() {
  return (
    <Flow id="main">
      <Transition trigger="sign-in" target="dashboard" from="login" />
    </Flow>
  );
}
