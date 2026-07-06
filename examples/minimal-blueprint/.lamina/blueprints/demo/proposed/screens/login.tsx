import { Button, Field, Form, Heading, Screen, Section, Text } from '@lamina/blueprint';

export default function LoginProposed() {
  return (
    <Screen id="login" title="Login (proposed)">
      <Section>
        <Heading level={2}>Sign in</Heading>
        <Text>Streamlined login with password</Text>
        <Form>
          <Field name="email" label="Email" type="email" required />
          <Field name="password" label="Password" type="password" required />
          <Button label="Sign in" />
        </Form>
      </Section>
    </Screen>
  );
}
