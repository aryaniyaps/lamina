import { Heading, Page, Screen, Section, Table, Text } from '@lamina/blueprint';

export default function OrdersScreen() {
  return (
    <Screen id="orders" title="Orders">
      <Page>
        <Section>
          <Heading level={2}>Orders</Heading>
          <Text>Recent customer orders</Text>
          <Table
            source="orders"
            columns={['customer', 'status', 'amount', 'date']}
            metadata={{ sortable: true }}
          />
        </Section>
      </Page>
    </Screen>
  );
}
