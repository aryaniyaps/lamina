import { Button, Heading, Page, Screen, Section, Text } from '@lamina/blueprint';

export default function WelcomeScreen() {
  return (
    <Screen id="welcome" title="Welcome">
      <Page>
        <Section>
          <Heading level={1}>Welcome aboard</Heading>
          <Text>Quick setup before you continue.</Text>
          <Button label="Continue" trigger="continue" />
        </Section>
      </Page>
    </Screen>
  );
}
