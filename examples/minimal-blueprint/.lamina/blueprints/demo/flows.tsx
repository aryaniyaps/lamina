import { Flow, Transition } from '@lamina/blueprint';

export default function Flows() {
  return (
    <>
      <Flow id="main">
        <Transition trigger="sign-in" target="dashboard" from="login" />
        <Transition trigger="view-orders" target="orders" from="dashboard" />
      </Flow>
      <Flow id="add-items">
        <Transition trigger="sign-in" target="dashboard" from="login" />
        <Transition trigger="add-item" target="orders" from="dashboard" />
      </Flow>
    </>
  );
}
