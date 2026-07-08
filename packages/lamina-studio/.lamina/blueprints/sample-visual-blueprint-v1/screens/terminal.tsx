import { Application, Screen, Page, Main, Section, Heading, Text, Metric } from '@lamina/studio';

export default function TerminalScreen() {
  return (
    <Application>
      <Screen id="terminal" title="Terminal State">
        <Page>
          <Main>
            <Section>
              <Heading>Terminal state</Heading>
              <Text>This node should show the End badge in React Flow.</Text>
              <Metric label="Confidence" value="High" />
            </Section>
          </Main>
        </Page>
      </Screen>
    </Application>
  );
}
