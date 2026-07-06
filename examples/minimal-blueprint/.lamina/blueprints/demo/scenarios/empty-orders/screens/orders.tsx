import { EmptyState, Heading, Page, Screen, Section, Text } from '@lamina/blueprint';

export default function OrdersEmptyScreen() {
  return (
    <Screen id="orders" title="Orders">
      <Page>
        <Section>
          <Heading level={2}>Orders</Heading>
          <EmptyState>
            <Text>No orders yet. Complete a sale to see orders here.</Text>
          </EmptyState>
        </Section>
      </Page>
    </Screen>
  );
}
