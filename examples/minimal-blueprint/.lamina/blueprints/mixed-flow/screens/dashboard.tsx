import { Heading, Page, Screen, Section, Text } from '@lamina/blueprint';

export default function DashboardScreen() {
  return (
    <Screen id="dashboard" title="Dashboard">
      <Page>
        <Section>
          <Heading level={1}>Dashboard</Heading>
          <Text>All set.</Text>
        </Section>
      </Page>
    </Screen>
  );
}
