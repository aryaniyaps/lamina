import { Application, Screen, Page, Main, Section, Heading, Text, Button, Table } from '@lamina/studio';

export default function FlowMapScreen() {
  return (
    <Application>
      <Screen id="flow-map" title="Flow Map">
        <Page>
          <Main>
            <Section>
              <Heading>Flow map</Heading>
              <Text>The React Flow sidebar should highlight this active node and show branch scenarios below screen nodes.</Text>
              <Table columns={["Step", "State", "Owner"]}>
                <div className="sub-table-row">1 · Entry · PM</div>
                <div className="sub-table-row">2 · Scenario branch · Research</div>
                <div className="sub-table-row">3 · Terminal · Engineer</div>
              </Table>
              <Button trigger="inspect-screen">Inspect screen</Button>
              <Button trigger="simulate-empty">Try empty state</Button>
            </Section>
          </Main>
        </Page>
      </Screen>
    </Application>
  );
}
