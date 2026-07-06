import {
  Action,
  Heading,
  Main,
  Metric,
  Navigation,
  Page,
  Row,
  Screen,
  Section,
  Table,
  Text,
} from '@lamina/blueprint';

export default function DashboardScreen() {
  return (
    <Screen id="dashboard" title="Dashboard">
      <Page>
        <Navigation>
          <Text>Home | Orders | Settings</Text>
        </Navigation>
        <Main>
          <Section>
            <Heading level={1}>Dashboard</Heading>
            <Row>
              <Metric label="Revenue" value="$12.4k" />
              <Metric label="Orders" value="48" />
            </Row>
            <Table source="orders" columns={['customer', 'status', 'amount']} />
            <Action label="View orders" trigger="view-orders" />
          </Section>
        </Main>
      </Page>
    </Screen>
  );
}
