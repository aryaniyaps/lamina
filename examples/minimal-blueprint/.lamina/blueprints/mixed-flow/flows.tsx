import { Flow, Transition } from '@lamina/blueprint';

export default function Flows() {
  return (
    <Flow id="main">
      <Transition trigger="sign-in" target="welcome" from="login" />
      <Transition trigger="continue" target="dashboard" from="welcome" />
    </Flow>
  );
}
