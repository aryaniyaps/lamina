import { Button, Field, Form, Heading, Screen, Section, Text } from '@lamina/blueprint';

export default function LoginBaseline() {
  return (
    <Screen id="login" title="Login (baseline)">
      <Section>
        <Heading level={2}>Sign in</Heading>
        <Text>Legacy login — email only</Text>
        <Form>
          <Field name="email" label="Email" type="email" required />
          <Button label="Continue" />
        </Form>
      </Section>
    </Screen>
  );
}
